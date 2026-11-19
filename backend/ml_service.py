import gc
import json
from pathlib import Path
from fastapi import HTTPException
import joblib
import numpy as np
import pandas as pd
from backend.db import get_db_connection

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / "models"

ml_state = {"model_7d": None, "model_14d": None, "metrics": {}}


def _unwrap_model_bundle(raw_obj) -> dict | None:
  """Extracts the sklearn estimator and feature schema whether saved as a dict or raw model."""
  if raw_obj is None:
    return None

  if isinstance(raw_obj, dict):
    estimator = next(
        (v for v in raw_obj.values() if hasattr(v, "predict")), None
    )
    feature_cols = (
        raw_obj.get("feature_cols")
        or raw_obj.get("features")
        or raw_obj.get("columns")
    )
    cat_cols = raw_obj.get("cat_cols") or raw_obj.get("categorical_cols")
    mae = raw_obj.get("mae") or raw_obj.get("ml_mae") or raw_obj.get("test_mae")
    return {
        "estimator": estimator,
        "feature_cols": list(feature_cols) if feature_cols is not None else None,
        "cat_cols": (
            set(cat_cols)
            if cat_cols is not None
            else {"region_name", "commodity"}
        ),
        "mae": float(mae) if mae is not None else None,
    }

  return {
      "estimator": raw_obj,
      "feature_cols": None,
      "cat_cols": {"region_name", "commodity"},
      "mae": None,
  }


def load_ml_models() -> None:
  path_7d = MODEL_DIR / "price_forecaster_7d.joblib"
  path_14d = MODEL_DIR / "price_forecaster_14d.joblib"
  metrics_path = MODEL_DIR / "training_metrics.json"

  if path_7d.exists():
    ml_state["model_7d"] = _unwrap_model_bundle(joblib.load(path_7d))
  if path_14d.exists():
    ml_state["model_14d"] = _unwrap_model_bundle(joblib.load(path_14d))
  if metrics_path.exists():
    with open(metrics_path, "r") as f:
      ml_state["metrics"] = json.load(f)


def clear_ml_models() -> None:
  ml_state.clear()
  gc.collect()


def classify_zscore(z_val: float | None) -> str:
  if z_val is None:
    return "NORMAL"
  if z_val >= 2.0:
    return "CRITICAL_SURGE"
  if z_val >= 1.5:
    return "WATCH"
  return "NORMAL"


def _predict_return(bundle: dict | None, feat_dict: dict) -> float:
  if not bundle or bundle.get("estimator") is None:
    return 0.0

  estimator = bundle["estimator"]
  feature_cols = bundle.get("feature_cols")
  if feature_cols is None and hasattr(estimator, "feature_names_in_"):
    feature_cols = list(estimator.feature_names_in_)

  df = pd.DataFrame([feat_dict]).fillna(value=np.nan)
  if feature_cols:
    for col in feature_cols:
      if col not in df.columns:
        df[col] = np.nan
    df = df[feature_cols]

  cat_cols = bundle.get("cat_cols") or {"region_name", "commodity"}
  for col in df.columns:
    if col in cat_cols:
      df[col] = df[col].astype("category")
    elif col not in ("date", "alert_status"):
      df[col] = pd.to_numeric(df[col], errors="coerce")

  return float(estimator.predict(df)[0])


def generate_price_forecast(
    region_name: str,
    commodity: str,
    rain_21d_delta_mm: float = 0.0,
    price_shock_pct: float = 0.0,
) -> dict:
  conn = get_db_connection()
  row = conn.execute(
      """
        SELECT * FROM engineered_features
        WHERE region_name = ? AND commodity = ?
        ORDER BY date DESC
        LIMIT 1
        """,
      (region_name, commodity),
  ).fetchone()
  conn.close()

  if not row:
    raise HTTPException(
        status_code=404,
        detail=f"No engineered features found for {region_name} - {commodity}.",
    )

  feat_dict = dict(row)
  base_price = float(feat_dict["median_modal_price"])
  shock_multiplier = 1.0 + (price_shock_pct / 100.0)
  simulated_price = round(base_price * shock_multiplier, 2)

  # Apply What-If overrides in memory without mutating SQLite
  feat_dict["median_modal_price"] = simulated_price
  if price_shock_pct != 0.0:
    feat_dict["pct_change_7d"] = float(feat_dict.get("pct_change_7d") or 0.0) + (
        price_shock_pct / 100.0
    )
    feat_dict["pct_change_14d"] = float(
        feat_dict.get("pct_change_14d") or 0.0
    ) + (price_shock_pct / 100.0)
    ma_30 = float(feat_dict.get("price_ma_30d") or simulated_price)
    std_30 = float(feat_dict.get("price_std_30d") or 0.0)
    if std_30 > 0:
      feat_dict["price_zscore_30d"] = round(
          (simulated_price - ma_30) / std_30, 2
      )

  sim_rain_21d = max(
      0.0, float(feat_dict.get("rain_lag_21d") or 0.0) + rain_21d_delta_mm
  )
  feat_dict["rain_lag_21d"] = sim_rain_21d
  feat_dict["rain_7d_sum"] = max(
      0.0, float(feat_dict.get("rain_7d_sum") or 0.0) + (rain_21d_delta_mm * 0.4)
  )
  feat_dict["rain_14d_sum"] = max(
      0.0,
      float(feat_dict.get("rain_14d_sum") or 0.0) + (rain_21d_delta_mm * 0.7),
  )

  bundle_7d = ml_state.get("model_7d")
  bundle_14d = ml_state.get("model_14d")
  metrics = ml_state.get("metrics", {})

  mae_7d = round(
      float(
          (bundle_7d or {}).get("mae")
          or metrics.get("7d", {}).get("ml_mae", 598.22)
      ),
      2,
  )
  mae_14d = round(
      float(
          (bundle_14d or {}).get("mae")
          or metrics.get("14d", {}).get("ml_mae", 672.95)
      ),
      2,
  )

  ret_7d = _predict_return(bundle_7d, feat_dict)
  ret_14d = _predict_return(bundle_14d, feat_dict)

  pred_7d = round(simulated_price * (1.0 + ret_7d), 2)
  pred_14d = round(simulated_price * (1.0 + ret_14d), 2)
  z_val = feat_dict.get("price_zscore_30d")

  return {
      "region_name": region_name,
      "commodity": commodity,
      "reference_date": str(feat_dict["date"])[:10],
      "current_modal_price_inr": simulated_price,
      "rain_lag_21d_mm": round(sim_rain_21d, 1),
      "price_zscore_30d": round(float(z_val), 2) if z_val is not None else None,
      "alert_status": classify_zscore(
          float(z_val) if z_val is not None else None
      ),
      "forecasts": [
          {
              "horizon_days": 7,
              "predicted_price_inr": pred_7d,
              "expected_change_pct": round(ret_7d * 100.0, 2),
              "model_mae_inr": mae_7d,
          },
          {
              "horizon_days": 14,
              "predicted_price_inr": pred_14d,
              "expected_change_pct": round(ret_14d * 100.0, 2),
              "model_mae_inr": mae_14d,
          },
      ],
  }