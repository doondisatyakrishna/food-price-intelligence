from collections import defaultdict
from contextlib import asynccontextmanager
import gc
import json
import os
from pathlib import Path
import sqlite3
import threading
import time
from typing import Any, Optional
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import joblib
import numpy as np
import pandas as pd
from pydantic import BaseModel, Field
import requests

try:
  from backend.sync import run_catchup_sync, sync_status
except ImportError:
  from sync import run_catchup_sync, sync_status

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db"
MODEL_DIR = PROJECT_ROOT / "models"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

# 6 Sub-Regional Agro-Climatic Weather Hubs so users know the exact location
# and coordinates behind every 14-day meteorological forecast.
WEATHER_HUBS = {
    "Coastal Andhra": {
        "label": "Coastal Andhra (Guntur / Amaravati)",
        "state_group": "Andhra Pradesh",
        "districts": "Guntur, Krishna, Bapatla, Nellore, Godavari Belt",
        "lat": 16.3067,
        "lon": 80.4365,
    },
    "Rayalaseema": {
        "label": "Rayalaseema (Kurnool / Madanapalle)",
        "state_group": "Andhra Pradesh",
        "districts": "Kurnool, Chittoor, Annamayya, Anantapur, Kadapa",
        "lat": 15.8281,
        "lon": 78.0373,
    },
    "North Telangana": {
        "label": "North Telangana (Nizamabad / Warangal)",
        "state_group": "Telangana",
        "districts": "Nizamabad, Warangal, Karimnagar, Adilabad",
        "lat": 18.6725,
        "lon": 78.0941,
    },
    "South Telangana": {
        "label": "South Telangana (Khammam / Nalgonda)",
        "state_group": "Telangana",
        "districts": "Khammam, Nalgonda, Suryapet, Rangareddy, Mahbubnagar",
        "lat": 17.2473,
        "lon": 80.1514,
    },
    "Nashik": {
        "label": "Nashik Hub (North Maharashtra)",
        "state_group": "Nashik",
        "districts": "Lasalgaon, Pimpalgaon, Nashik APMC Belt",
        "lat": 19.9975,
        "lon": 73.7898,
    },
    "Kolar": {
        "label": "Kolar Hub (South Karnataka)",
        "state_group": "Kolar",
        "districts": "Kolar, Chikkaballapur, Srinivaspur Belt",
        "lat": 13.1367,
        "lon": 78.1292,
    },
}

# Maps state/region dropdown selections to a default agro-climatic weather hub
DEFAULT_HUB_BY_REGION = {
    "Andhra Pradesh": "Coastal Andhra",
    "Telangana": "North Telangana",
    "Nashik": "Nashik",
    "Kolar": "Kolar",
}

ml_state = {
    "model_7d": None,
    "model_14d": None,
    "metrics": {},
}

# --- Thread-Safe In-Memory TTL Cache ---
_ttl_cache: dict[tuple, tuple[float, Any]] = {}
_cache_lock = threading.Lock()
CACHE_TTL_SECONDS = 300


def cache_get(key: tuple) -> Any | None:
  with _cache_lock:
    entry = _ttl_cache.get(key)
    if entry and time.time() < entry[0]:
      return entry[1]
    if entry:
      del _ttl_cache[key]
  return None


def cache_set(key: tuple, value: Any, ttl: int = CACHE_TTL_SECONDS):
  with _cache_lock:
    _ttl_cache[key] = (time.time() + ttl, value)


# --- Sliding-Window Rate Limiter (90 req/min per client IP) ---
_rate_buckets: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()
RATE_LIMIT_MAX_REQUESTS = 90
RATE_LIMIT_WINDOW_SEC = 60


def _delayed_startup_sync():
  """Runs background catch-up sync after initial page-load traffic settles and frees RAM."""
  try:
    run_catchup_sync(bypass_cooldown=True)
  finally:
    gc.collect()


@asynccontextmanager
async def lifespan(app: FastAPI):
  """Loads trained ML pipelines once at startup and schedules deferred background sync."""
  path_7d = MODEL_DIR / "price_forecaster_7d.joblib"
  path_14d = MODEL_DIR / "price_forecaster_14d.joblib"
  metrics_path = MODEL_DIR / "training_metrics.json"

  if path_7d.exists():
    ml_state["model_7d"] = joblib.load(path_7d)
  if path_14d.exists():
    ml_state["model_14d"] = joblib.load(path_14d)
  if metrics_path.exists():
    with open(metrics_path, "r") as f:
      ml_state["metrics"] = json.load(f)

  # Let initial dashboard requests finish before sync competes for worker memory.
  startup_timer = threading.Timer(45.0, _delayed_startup_sync)
  startup_timer.daemon = True
  startup_timer.start()

  yield
  startup_timer.cancel()
  ml_state.clear()
  gc.collect()


app = FastAPI(
    title="Food Price Intelligence & Early Warning API",
    description=(
        "Serves 7-day & 14-day mandi price forecasts, What-If shock"
        " simulations, district mandi leaderboards, and sub-regional weather"
        " outlooks."
    ),
    version="2.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def gateway_telemetry_and_rate_limit(request: Request, call_next):
  """Attaches worker PID + latency headers and enforces per-IP rate limiting."""
  client_ip = request.client.host if request.client else "unknown"
  now = time.time()

  if request.url.path.startswith("/api/"):
    with _rate_lock:
      timestamps = [
          t for t in _rate_buckets[client_ip] if now - t < RATE_LIMIT_WINDOW_SEC
      ]
      if len(timestamps) >= RATE_LIMIT_MAX_REQUESTS:
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Please slow down."},
        )
      timestamps.append(now)
      _rate_buckets[client_ip] = timestamps

  start_perf = time.perf_counter()
  response = await call_next(request)
  elapsed_ms = (time.perf_counter() - start_perf) * 1000

  response.headers["X-Worker-PID"] = str(os.getpid())
  response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"
  return response


def get_db_connection() -> sqlite3.Connection:
  if not DB_PATH.exists():
    raise HTTPException(
        status_code=503, detail="Database file not found on server."
    )
  conn = sqlite3.connect(DB_PATH, timeout=30)
  conn.row_factory = sqlite3.Row
  return conn


class ForecastRequest(BaseModel):
  region_name: str = Field(..., examples=["Andhra Pradesh"])
  commodity: str = Field(..., examples=["Tomato"])
  as_of_date: Optional[str] = Field(None, examples=[None])
  # Optional "What-If" Shock Simulator parameters (0.0 = live ground truth)
  rain_21d_delta_mm: float = Field(0.0, ge=-200.0, le=500.0)
  price_shock_pct: float = Field(0.0, ge=-50.0, le=100.0)


class HorizonPrediction(BaseModel):
  horizon_days: int
  predicted_price_inr: float
  expected_change_pct: float
  model_mae_inr: float


class ForecastResponse(BaseModel):
  region_name: str
  commodity: str
  reference_date: str
  current_modal_price_inr: float
  alert_status: str
  price_zscore_30d: Optional[float]
  rain_7d_sum_mm: Optional[float]
  rain_lag_21d_mm: Optional[float]
  is_simulated: bool
  forecasts: list[HorizonPrediction]


# --- Sync & Health Endpoints ---


@app.get("/api/sync/status")
def get_sync_status():
  return sync_status


@app.post("/api/sync")
def trigger_manual_sync(background_tasks: BackgroundTasks):
  if sync_status["is_syncing"]:
    return {"started": False, "status": sync_status}

  background_tasks.add_task(run_catchup_sync, bypass_cooldown=False)
  return {"started": True, "status": sync_status}


@app.get("/health")
def health_check():
  return {
      "status": "ok",
      "worker_pid": os.getpid(),
      "database_connected": DB_PATH.exists(),
      "models_loaded": {
          "7d": ml_state["model_7d"] is not None,
          "14d": ml_state["model_14d"] is not None,
      },
      "sync": sync_status,
  }


# --- Catalog, Alerts & Historical Series ---


@app.get("/api/catalog")
def get_catalog():
  c_key = ("catalog", sync_status["last_completed_at"])
  cached = cache_get(c_key)
  if cached is not None:
    return cached

  conn = get_db_connection()
  rows = conn.execute("""
        SELECT 
            region_name,
            commodity,
            COUNT(*) AS trading_days,
            MIN(date) AS earliest_date,
            MAX(date) AS latest_date
        FROM engineered_features
        GROUP BY region_name, commodity
        ORDER BY region_name, commodity
        """).fetchall()
  conn.close()

  catalog = [dict(r) for r in rows]
  regions = sorted({item["region_name"] for item in catalog})

  weather_hubs_list = [
      {
          "id": hub_id,
          "label": info["label"],
          "state_group": info["state_group"],
          "districts": info["districts"],
          "lat": info["lat"],
          "lon": info["lon"],
      }
      for hub_id, info in WEATHER_HUBS.items()
  ]

  result = {
      "regions": regions,
      "series": catalog,
      "weather_hubs": weather_hubs_list,
      "default_hub_by_region": DEFAULT_HUB_BY_REGION,
      "model_metrics": ml_state["metrics"],
  }
  cache_set(c_key, result)
  return result


@app.get("/api/alerts")
def get_early_warning_alerts(include_normal: bool = Query(False)):
  c_key = ("alerts", include_normal, sync_status["last_completed_at"])
  cached = cache_get(c_key)
  if cached is not None:
    return cached

  conn = get_db_connection()
  query = """
    SELECT ef.region_name, ef.commodity, ef.date, ef.median_modal_price,
           ef.price_ma_30d, ef.pct_change_7d, ef.price_zscore_30d,
           ef.alert_status, ef.rain_7d_sum, ef.rain_lag_21d
    FROM engineered_features ef
    INNER JOIN (
        SELECT region_name, commodity, MAX(date) AS max_date
        FROM engineered_features
        GROUP BY region_name, commodity
    ) latest
    ON ef.region_name = latest.region_name
       AND ef.commodity = latest.commodity
       AND ef.date = latest.max_date
    ORDER BY ef.price_zscore_30d DESC
    """
  df = pd.read_sql_query(query, conn)
  conn.close()

  if not include_normal:
    df = df[df["alert_status"] != "NORMAL"]

  df = df.replace({np.nan: None})
  result = {
      "total_alerts": len(df),
      "alerts": df.to_dict(orient="records"),
  }
  cache_set(c_key, result)
  return result


@app.get("/api/history")
def get_historical_series(
    region_name: str = Query(..., examples=["Andhra Pradesh"]),
    commodity: str = Query(..., examples=["Tomato"]),
    limit: int = Query(180, ge=7, le=2000),
):
  c_key = (
      "history",
      region_name,
      commodity,
      limit,
      sync_status["last_completed_at"],
  )
  cached = cache_get(c_key)
  if cached is not None:
    return cached

  conn = get_db_connection()
  query = """
    SELECT date, mandi_count, median_modal_price, min_price, max_price,
           price_ma_7d, price_ma_30d, price_zscore_30d, alert_status,
           temperature_max_c, precipitation_mm, rain_7d_sum, rain_lag_21d
    FROM engineered_features
    WHERE region_name = ? AND commodity = ?
    ORDER BY date DESC
    LIMIT ?
    """
  df = pd.read_sql_query(query, conn, params=(region_name, commodity, limit))
  conn.close()

  if df.empty:
    raise HTTPException(
        status_code=404,
        detail=f"No historical data found for {region_name} - {commodity}.",
    )

  df = df.iloc[::-1].replace({np.nan: None})
  result = {
      "region_name": region_name,
      "commodity": commodity,
      "count": len(df),
      "data": df.to_dict(orient="records"),
  }
  cache_set(c_key, result)
  return result


# --- NEW: Live District & Mandi Price Leaderboard ("Where to Sell Today") ---


@app.get("/api/mandis")
def get_mandi_leaderboard(
    region_name: str = Query(..., examples=["Andhra Pradesh"]),
    commodity: str = Query(..., examples=["Tomato"]),
):
  """Queries raw daily_prices for the latest reporting date of (region_name, commodity)

  and ranks individual APMC mandis by modal price so users can compare
  district-level realizations and price spreads.
  """
  c_key = ("mandis", region_name, commodity, sync_status["last_completed_at"])
  cached = cache_get(c_key)
  if cached is not None:
    return cached

  conn = get_db_connection()
  is_state = region_name in ("Andhra Pradesh", "Telangana")
  where_clause = "m.state = ?" if is_state else "m.district = ?"

  # 1. Find the latest trading date for this region + commodity in daily_prices
  latest_row = conn.execute(
      f"""
        SELECT MAX(dp.date) AS latest_date
        FROM daily_prices dp
        JOIN markets m ON dp.market_id = m.id
        JOIN commodities c ON dp.commodity_id = c.id
        WHERE {where_clause} AND c.name = ? AND dp.modal_price_inr > 0
        """,
      (region_name, commodity),
  ).fetchone()

  if not latest_row or not latest_row["latest_date"]:
    conn.close()
    return {
        "region_name": region_name,
        "commodity": commodity,
        "latest_date": None,
        "spread_inr": 0,
        "mandis": [],
    }

  latest_date = latest_row["latest_date"]

  # 2. Fetch all mandis reporting on that latest trading date
  rows = conn.execute(
      f"""
        SELECT 
            m.name AS market_name,
            m.district,
            m.state,
            dp.min_price_inr,
            dp.max_price_inr,
            dp.modal_price_inr
        FROM daily_prices dp
        JOIN markets m ON dp.market_id = m.id
        JOIN commodities c ON dp.commodity_id = c.id
        WHERE {where_clause}
          AND c.name = ?
          AND dp.date = ?
          AND dp.modal_price_inr > 0
        ORDER BY dp.modal_price_inr DESC
        """,
      (region_name, commodity, latest_date),
  ).fetchall()
  conn.close()

  mandis = [dict(r) for r in rows]
  prices = [m["modal_price_inr"] for m in mandis]
  spread = round(max(prices) - min(prices), 2) if len(prices) > 1 else 0.0

  result = {
      "region_name": region_name,
      "commodity": commodity,
      "latest_date": str(latest_date)[:10],
      "mandi_count": len(mandis),
      "highest_price_inr": max(prices) if prices else 0,
      "lowest_price_inr": min(prices) if prices else 0,
      "spread_inr": spread,
      "mandis": mandis,
  }
  cache_set(c_key, result)
  return result


# --- Sub-Regional 14-Day Weather Forecast (Resilient Open-Meteo + SQLite Fallback) ---

_stale_weather_backup: dict[str, dict] = {}

@app.get("/api/weather-forecast")
def get_regional_weather_forecast(
    region_name: str = Query("Coastal Andhra", examples=["Coastal Andhra"]),
    days: int = Query(14, ge=3, le=16),
):
  """Fetches Open-Meteo forecast with cached and observed-weather fallbacks.
  """
  hub_key = DEFAULT_HUB_BY_REGION.get(region_name, region_name)
  if hub_key not in WEATHER_HUBS:
    raise HTTPException(
        status_code=400,
        detail=(
            f"Unknown weather hub '{region_name}'. Choose from"
            f" {list(WEATHER_HUBS.keys())}."
        ),
    )

  c_key = ("weather_v2", hub_key, days)
  cached = cache_get(c_key)
  if cached is not None:
    return cached

  hub = WEATHER_HUBS[hub_key]
  lat, lon = hub["lat"], hub["lon"]

  url = (
      f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max"
      f"&timezone=Asia/Kolkata&forecast_days={days}"
  )
  try:
    resp = requests.get(url, timeout=8)
    resp.raise_for_status()
    daily = resp.json().get("daily", {})

    dates = daily.get("time", [])
    t_max = daily.get("temperature_2m_max", [])
    t_min = daily.get("temperature_2m_min", [])
    precip = daily.get("precipitation_sum", [])
    prob = daily.get("precipitation_probability_max", [])

    forecast_days = []
    total_rain = 0.0
    heavy_rain_days = 0

    for i, d_str in enumerate(dates):
      rain_mm = float(precip[i] or 0.0)
      total_rain += rain_mm
      is_heavy = rain_mm >= 25.0
      if is_heavy:
        heavy_rain_days += 1

      forecast_days.append({
          "date": d_str,
          "temp_max_c": t_max[i],
          "temp_min_c": t_min[i],
          "precipitation_mm": round(rain_mm, 1),
          "rain_probability_pct": prob[i],
          "supply_risk_flag": "HIGH_RAIN_RISK" if is_heavy else "NORMAL",
      })

    result = {
        "hub_id": hub_key,
        "location_label": hub["label"],
        "districts_covered": hub["districts"],
        "coordinates": {"lat": lat, "lon": lon},
        "source": "Open-Meteo Official Meteorological Forecast API",
        "horizon_days": len(forecast_days),
        "total_expected_rain_mm": round(total_rain, 1),
        "heavy_rain_days_count": heavy_rain_days,
        "outlook_summary": (
            f"{heavy_rain_days} heavy rain day(s) expected — monitor harvest &"
            " transit delays."
            if heavy_rain_days > 0
            else (
                "Dry/moderate conditions — low weather-driven arrival"
                " disruption."
            )
        ),
        "daily": forecast_days,
    }
    cache_set(c_key, result, ttl=1800)
    _stale_weather_backup[hub_key] = result
    return result

  except requests.RequestException:
    if hub_key in _stale_weather_backup:
      return _stale_weather_backup[hub_key]

    conn = get_db_connection()
    try:
      rows = conn.execute(
          """
          SELECT date, temperature_max_c, temperature_min_c, precipitation_mm
          FROM weather_data
          WHERE region_name = ?
          ORDER BY date DESC
          LIMIT 5
          """,
          (hub["state_group"],),
      ).fetchall()
    finally:
      conn.close()

    fallback_days = [
        {
            "date": str(r["date"])[:10],
            "temp_max_c": r["temperature_max_c"],
            "temp_min_c": r["temperature_min_c"],
            "precipitation_mm": round(float(r["precipitation_mm"] or 0.0), 1),
            "rain_probability_pct": None,
            "supply_risk_flag": (
                "HIGH_RAIN_RISK"
                if float(r["precipitation_mm"] or 0.0) >= 25.0
                else "NORMAL"
            ),
        }
        for r in reversed(rows)
    ]

    return {
        "hub_id": hub_key,
        "location_label": hub["label"],
        "districts_covered": hub["districts"],
        "coordinates": {"lat": lat, "lon": lon},
        "source": "Recent Regional Baseline (Open-Meteo temporarily busy)",
        "horizon_days": len(fallback_days),
        "total_expected_rain_mm": round(
            sum(d["precipitation_mm"] for d in fallback_days), 1
        ),
        "heavy_rain_days_count": sum(
            1 for d in fallback_days if d["precipitation_mm"] >= 25.0
        ),
        "outlook_summary": (
            "Live forecast feed temporarily busy — displaying latest regional"
            " observations."
        ),
        "daily": fallback_days,
    }


# --- ML Price Forecast + Interactive "What-If" Shock Simulator ---


@app.post("/api/forecast", response_model=ForecastResponse)
def predict_commodity_prices(req: ForecastRequest):
  """Generates 7-day and 14-day mandi price forecasts, supporting live ground truth

  as well as interactive "What-If" rainfall & price shock simulations.
  """
  artifact_7d = ml_state.get("model_7d")
  artifact_14d = ml_state.get("model_14d")

  if artifact_7d is None or artifact_14d is None:
    raise HTTPException(
        status_code=503,
        detail="Forecasting models are not loaded. Run backend/train.py first.",
    )

  conn = get_db_connection()
  if req.as_of_date:
    query = """
        SELECT * FROM engineered_features
        WHERE region_name = ? AND commodity = ? AND date <= ?
        ORDER BY date DESC LIMIT 1
        """
    params = (req.region_name, req.commodity, req.as_of_date)
  else:
    query = """
        SELECT * FROM engineered_features
        WHERE region_name = ? AND commodity = ?
        ORDER BY date DESC LIMIT 1
        """
    params = (req.region_name, req.commodity)

  row_df = pd.read_sql_query(query, conn, params=params)
  conn.close()

  if row_df.empty:
    raise HTTPException(
        status_code=404,
        detail=(
            f"No feature record found for '{req.region_name}' -"
            f" '{req.commodity}'."
        ),
    )

  is_simulated = (req.rain_21d_delta_mm != 0.0) or (req.price_shock_pct != 0.0)
  base_price = float(row_df["median_modal_price"].iloc[0])

  # Apply temporary in-memory "What-If" overrides without mutating SQLite
  sim_df = row_df.copy()
  current_price = base_price * (1.0 + (req.price_shock_pct / 100.0))
  sim_df["median_modal_price"] = current_price

  if req.price_shock_pct != 0.0:
    shock_frac = req.price_shock_pct / 100.0
    if pd.notna(sim_df["pct_change_7d"].iloc[0]):
      sim_df["pct_change_7d"] = float(sim_df["pct_change_7d"].iloc[0]) + shock_frac
    if pd.notna(sim_df["pct_change_14d"].iloc[0]):
      sim_df["pct_change_14d"] = (
          float(sim_df["pct_change_14d"].iloc[0]) + shock_frac
      )

    ma_30 = sim_df["price_ma_30d"].iloc[0]
    std_30 = sim_df["price_std_30d"].iloc[0]
    if pd.notna(ma_30) and pd.notna(std_30) and float(std_30) > 0:
      new_z = (current_price - float(ma_30)) / float(std_30)
      sim_df["price_zscore_30d"] = new_z
      if new_z >= 2.0:
        sim_df["alert_status"] = "CRITICAL_SURGE"
      elif new_z >= 1.5:
        sim_df["alert_status"] = "WATCH"
      else:
        sim_df["alert_status"] = "NORMAL"

  if req.rain_21d_delta_mm != 0.0:
    base_rain_21 = (
        float(sim_df["rain_lag_21d"].iloc[0])
        if pd.notna(sim_df["rain_lag_21d"].iloc[0])
        else 0.0
    )
    sim_df["rain_lag_21d"] = max(0.0, base_rain_21 + req.rain_21d_delta_mm)

  forecasts = []
  for horizon, artifact in [(7, artifact_7d), (14, artifact_14d)]:
    X_input = sim_df[artifact["features"]]
    pred_return = float(artifact["pipeline"].predict(X_input)[0])
    pred_price = current_price * (1.0 + pred_return)

    forecasts.append(
        HorizonPrediction(
            horizon_days=horizon,
            predicted_price_inr=round(pred_price, 2),
            expected_change_pct=round(pred_return * 100, 2),
            model_mae_inr=artifact["metrics"]["mae_inr"],
        )
    )

  z_val = sim_df["price_zscore_30d"].iloc[0]
  rain_7d = sim_df["rain_7d_sum"].iloc[0]
  rain_21d = sim_df["rain_lag_21d"].iloc[0]

  return ForecastResponse(
      region_name=req.region_name,
      commodity=req.commodity,
      reference_date=str(sim_df["date"].iloc[0])[:10],
      current_modal_price_inr=round(current_price, 2),
      alert_status=str(sim_df["alert_status"].iloc[0]),
      price_zscore_30d=round(float(z_val), 2) if pd.notna(z_val) else None,
      rain_7d_sum_mm=round(float(rain_7d), 1) if pd.notna(rain_7d) else None,
      rain_lag_21d_mm=round(float(rain_21d), 1) if pd.notna(rain_21d) else None,
      is_simulated=is_simulated,
      forecasts=forecasts,
  )


# Serve compiled React bundle automatically when deployed on Render
if FRONTEND_DIST.exists():
  app.mount(
      "/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend"
  )