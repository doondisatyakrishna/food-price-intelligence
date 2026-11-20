import json
from pathlib import Path
import sqlite3
import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

# Resolve paths relative to project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db"
MODEL_DIR = PROJECT_ROOT / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Define input features grouped by type
CATEGORICAL_FEATURES = ["region_name", "commodity"]

NUMERIC_FEATURES = [
    "mandi_count",
    "median_modal_price",
    "price_ma_7d",
    "price_ma_14d",
    "price_ma_30d",
    "price_std_30d",
    "pct_change_7d",
    "pct_change_14d",
    "intraday_spread_pct",
    "price_zscore_30d",
    "temperature_max_c",
    "temperature_min_c",
    "precipitation_mm",
    "rain_7d_sum",
    "rain_14d_sum",
    "rain_lag_7d",
    "rain_lag_14d",
    "rain_lag_21d",
    "temp_anomaly_c",
    "month",
    "sin_day_of_year",
    "cos_day_of_year",
]

ALL_FEATURES = CATEGORICAL_FEATURES + NUMERIC_FEATURES


def load_feature_data() -> pd.DataFrame:
  """Loads the engineered feature table from SQLite sorted chronologically."""
  conn = sqlite3.connect(DB_PATH)
  df = pd.read_sql_query(
      "SELECT * FROM engineered_features ORDER BY date ASC",
      conn,
      parse_dates=["date"],
  )
  conn.close()
  return df


def build_model_pipeline(horizon_days: int = 7) -> Pipeline:
  """Builds an end-to-end preprocessing + gradient boosting pipeline."""
  preprocessor = ColumnTransformer(
      transformers=[
          (
              "cat",
              OrdinalEncoder(
                  handle_unknown="use_encoded_value", unknown_value=-1
              ),
              CATEGORICAL_FEATURES,
          ),
          ("num", "passthrough", NUMERIC_FEATURES),
      ]
  )

  if horizon_days >= 14:
    regressor = HistGradientBoostingRegressor(
        loss="absolute_error",
        max_iter=200,
        learning_rate=0.03,
        max_leaf_nodes=15,
        min_samples_leaf=60,
        l2_regularization=5.0,
        early_stopping=True,
        validation_fraction=0.15,
        n_iter_no_change=15,
        categorical_features=[0, 1],
        random_state=42,
    )
  else:
    regressor = HistGradientBoostingRegressor(
        loss="absolute_error",
        max_iter=300,
        learning_rate=0.04,
        max_leaf_nodes=23,
        min_samples_leaf=40,
        l2_regularization=2.0,
        early_stopping=True,
        validation_fraction=0.15,
        n_iter_no_change=15,
        categorical_features=[0, 1],
        random_state=42,
    )

  return Pipeline(steps=[("preprocessor", preprocessor), ("model", regressor)])

def train_and_evaluate_horizon(df: pd.DataFrame, horizon_days: int):
  """Trains a forecasting model for a given horizon (7 or 14 days),

  evaluates it out-of-time against a persistence baseline, and saves the
  artifact.
  """
  target_col = f"target_price_{horizon_days}d"

  # 1. Drop rows where future target is unavailable (e.g., right before archive gaps)
  valid_df = df.dropna(subset=[target_col, "median_modal_price"]).copy()
  valid_df = valid_df[valid_df["median_modal_price"] > 0]

  # 2. Compute scale-invariant target return: (Future_Price - Current_Price) / Current_Price
  valid_df["target_return"] = (
      valid_df[target_col] - valid_df["median_modal_price"]
  ) / valid_df["median_modal_price"]

  # Clip extreme single-week data entry typos (> +250% or < -80%) during training only
  # so outliers don't distort tree splits, while keeping test evaluation untouched
  split_date = valid_df["date"].quantile(0.80)
  embargo_cutoff = split_date - pd.Timedelta(days=horizon_days)

  train_df = valid_df[valid_df["date"] < embargo_cutoff].copy()
  train_df = train_df[train_df["target_return"].between(-0.80, 2.50)]

  test_df = valid_df[valid_df["date"] >= split_date].copy()

  print(f"\n{'='*65}")
  print(f"HORIZON: {horizon_days}-DAY PRICE FORECAST")
  print(f"{'='*65}")
  print(
      f"Train Period: {train_df['date'].min().date()} ->"
      f" {train_df['date'].max().date()} ({len(train_df):,} rows)"
  )
  print(
      f"Test Period : {test_df['date'].min().date()} ->"
      f" {test_df['date'].max().date()} ({len(test_df):,} rows)"
  )

  X_train = train_df[ALL_FEATURES]
  y_train_return = train_df["target_return"]

  X_test = test_df[ALL_FEATURES]
  y_test_price = test_df[target_col].values
  current_test_price = test_df["median_modal_price"].values

  # 3. Fit the ML pipeline
  pipeline = build_model_pipeline(horizon_days=horizon_days)
  pipeline.fit(X_train, y_train_return)

  # 4. Predict future return and convert back to ₹/Quintal
  pred_return = pipeline.predict(X_test)
  pred_price_ml = current_test_price * (1.0 + pred_return)

  # 5. Benchmark against Naive Persistence (predicting price stays unchanged)
  mae_naive = mean_absolute_error(y_test_price, current_test_price)
  mape_naive = (
      mean_absolute_percentage_error(y_test_price, current_test_price) * 100
  )

  mae_ml = mean_absolute_error(y_test_price, pred_price_ml)
  mape_ml = mean_absolute_percentage_error(y_test_price, pred_price_ml) * 100

  improvement_pct = ((mae_naive - mae_ml) / mae_naive) * 100

  print(
      f"\n[Baseline - Persistence] MAE: ₹{mae_naive:,.2f}/Quintal | MAPE:"
      f" {mape_naive:.2f}%"
  )
  print(
      f"[ML Model - HistGBM]     MAE: ₹{mae_ml:,.2f}/Quintal | MAPE:"
      f" {mape_ml:.2f}%"
  )
  print(f"[Error Reduction]        {improvement_pct:+.2f}% MAE improvement")

  # 6. Inspect Top 8 Most Influential Features using Permutation Importance
  perm = permutation_importance(
      pipeline, X_test, test_df["target_return"], n_repeats=5, random_state=42
  )
  importance_df = pd.DataFrame({
      "feature": ALL_FEATURES,
      "importance": perm.importances_mean,
  }).sort_values(by="importance", ascending=False)

  print("\nTop 8 Predictive Drivers (Permutation Importance):")
  for _, imp_row in importance_df.head(8).iterrows():
    print(f"  - {imp_row['feature']:<22}: {imp_row['importance']:.5f}")

  # 7. Save model artifact and evaluation metadata for FastAPI backend
  model_path = MODEL_DIR / f"price_forecaster_{horizon_days}d.joblib"
  artifact = {
      "pipeline": pipeline,
      "horizon_days": horizon_days,
      "features": ALL_FEATURES,
      "metrics": {
          "mae_inr": round(float(mae_ml), 2),
          "mape_pct": round(float(mape_ml), 2),
          "baseline_mae_inr": round(float(mae_naive), 2),
          "improvement_pct": round(float(improvement_pct), 2),
          "test_start": str(test_df["date"].min().date()),
          "test_end": str(test_df["date"].max().date()),
      },
  }
  joblib.dump(artifact, model_path)
  print(f"\nSaved model artifact -> {model_path}")
  return artifact["metrics"]


if __name__ == "__main__":
  df_features = load_feature_data()
  metrics_summary = {}

  for horizon in [7, 14]:
    metrics_summary[f"{horizon}d"] = train_and_evaluate_horizon(
        df_features, horizon_days=horizon
    )

  # Save a clean JSON report of model performance for your API / portfolio docs
  report_path = MODEL_DIR / "training_metrics.json"
  with open(report_path, "w") as f:
    json.dump(metrics_summary, f, indent=2)
  print(f"\nAll training metrics saved to {report_path}")