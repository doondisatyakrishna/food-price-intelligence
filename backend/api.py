from collections import defaultdict
from contextlib import asynccontextmanager
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

# Support running from project root (`uvicorn backend.api:app`) or inside `backend/`
try:
  from backend.sync import REGIONS, run_catchup_sync, sync_status
except ImportError:
  from sync import REGIONS, run_catchup_sync, sync_status

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db"
MODEL_DIR = PROJECT_ROOT / "models"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

ml_state = {
    "model_7d": None,
    "model_14d": None,
    "metrics": {},
}

# --- 1. Thread-Safe In-Memory TTL Cache ---
# Stores {cache_key: (expiry_timestamp, payload)} to serve repeated GET requests in <1ms
_ttl_cache: dict[tuple, tuple[float, Any]] = {}
_cache_lock = threading.Lock()
CACHE_TTL_SECONDS = 300  # 5 minutes


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


# --- 2. Sliding-Window Rate Limiter (60 req/min per client IP) ---
_rate_buckets: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()
RATE_LIMIT_MAX_REQUESTS = 60
RATE_LIMIT_WINDOW_SEC = 60


@asynccontextmanager
async def lifespan(app: FastAPI):
  """Loads trained ML pipelines into memory at startup and launches a

  non-blocking background thread to catch up any missed days since last run.
  """
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

  # Run initial catch-up sync in a background daemon thread so startup is instant
  threading.Thread(
      target=run_catchup_sync, kwargs={"bypass_cooldown": True}, daemon=True
  ).start()

  yield
  ml_state.clear()


app = FastAPI(
    title="Food Price Intelligence & Early Warning API",
    description=(
        "Production-grade backend API serving 7-day & 14-day mandi price"
        " forecasts, early-warning surge alerts, and 14-day regional weather"
        " outlooks."
    ),
    version="2.2.0",
    lifespan=lifespan,
)

# Enable CORS so React (Vite on localhost:5173) can talk to FastAPI/Nginx
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def gateway_telemetry_and_rate_limit(request: Request, call_next):
  """Base-level API Gateway middleware:

  1. Enforces per-IP rate limiting (60 requests / 60 seconds).
  2. Attaches `X-Worker-PID` (proves Load Balancer distribution across workers)
     and `X-Process-Time-Ms` (measures endpoint latency).
  """
  client_ip = request.client.host if request.client else "unknown"
  now = time.time()

  # Enforce rate limit on /api/* routes
  if request.url.path.startswith("/api/"):
    with _rate_lock:
      timestamps = [
          t for t in _rate_buckets[client_ip] if now - t < RATE_LIMIT_WINDOW_SEC
      ]
      if len(timestamps) >= RATE_LIMIT_MAX_REQUESTS:
        return JSONResponse(
            status_code=429,
            content={
                "detail": (
                    "Rate limit exceeded (60 requests/min). Please slow down."
                )
            },
        )
      timestamps.append(now)
      _rate_buckets[client_ip] = timestamps

  start_perf = time.perf_counter()
  response = await call_next(request)
  elapsed_ms = (time.perf_counter() - start_perf) * 1000

  # Telemetry headers visible in browser DevTools -> Network tab
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
  forecasts: list[HorizonPrediction]


# --- Sync Endpoints (Powers the "Sync Latest Data" Button) ---


@app.get("/api/sync/status")
def get_sync_status():
  """Returns current background sync state and cooldown timer."""
  return sync_status


@app.post("/api/sync")
def trigger_manual_sync(background_tasks: BackgroundTasks):
  """Starts a background catch-up sync (protected by a 10-minute cooldown)."""
  if sync_status["is_syncing"]:
    return {"started": False, "status": sync_status}

  background_tasks.add_task(run_catchup_sync, bypass_cooldown=False)
  return {"started": True, "status": sync_status}


# --- Core Intelligence & Forecasting Endpoints ---


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


@app.get("/api/catalog")
def get_catalog():
  """Returns available regions, commodities, date spans, and model accuracy metrics."""
  # Including last_completed_at in the key auto-invalidates cache after a fresh sync
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

  result = {
      "regions": regions,
      "series": catalog,
      "model_metrics": ml_state["metrics"],
  }
  cache_set(c_key, result)
  return result


@app.get("/api/alerts")
def get_early_warning_alerts(include_normal: bool = Query(False)):
  """Returns latest early-warning Z-score alerts across all tracked commodities."""
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
  """Returns historical price, moving averages, Z-scores, and rainfall for charts."""
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


@app.get("/api/weather-forecast")
def get_regional_weather_forecast(
    region_name: str = Query("Andhra Pradesh", examples=["Andhra Pradesh"]),
    days: int = Query(14, ge=3, le=16),
):
  """Fetches Open-Meteo's standalone 14-day forecast and flags heavy-rain risk days."""
  c_key = ("weather", region_name, days)
  cached = cache_get(c_key)
  if cached is not None:
    return cached

  coords = {name: (lat, lon) for name, lat, lon in REGIONS}
  if region_name not in coords:
    raise HTTPException(
        status_code=400,
        detail=(
            f"Unknown region '{region_name}'. Choose from"
            f" {list(coords.keys())}."
        ),
    )

  lat, lon = coords[region_name]
  url = (
      f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
      f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max"
      f"&timezone=Asia/Kolkata&forecast_days={days}"
  )
  resp = requests.get(url, timeout=20)
  if resp.status_code != 200:
    raise HTTPException(
        status_code=502, detail="Failed to reach Open-Meteo forecast service."
    )

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
      "region_name": region_name,
      "horizon_days": len(forecast_days),
      "total_expected_rain_mm": round(total_rain, 1),
      "heavy_rain_days_count": heavy_rain_days,
      "outlook_summary": (
          f"{heavy_rain_days} heavy rain day(s) expected — monitor transport &"
          " curing delays."
          if heavy_rain_days > 0
          else "Dry/moderate conditions — low weather-driven arrival disruption."
      ),
      "daily": forecast_days,
  }
  # Cache weather forecasts for 30 minutes (1800s)
  cache_set(c_key, result, ttl=1800)
  return result


@app.post("/api/forecast", response_model=ForecastResponse)
def predict_commodity_prices(req: ForecastRequest):
  """Generates 7-day and 14-day mandi price forecasts using the trained ML models."""
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

  current_price = float(row_df["median_modal_price"].iloc[0])
  forecasts = []

  for horizon, artifact in [(7, artifact_7d), (14, artifact_14d)]:
    X_input = row_df[artifact["features"]]
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

  z_val = row_df["price_zscore_30d"].iloc[0]
  rain_7d = row_df["rain_7d_sum"].iloc[0]
  rain_21d = row_df["rain_lag_21d"].iloc[0]

  return ForecastResponse(
      region_name=req.region_name,
      commodity=req.commodity,
      reference_date=str(row_df["date"].iloc[0])[:10],
      current_modal_price_inr=round(current_price, 2),
      alert_status=str(row_df["alert_status"].iloc[0]),
      price_zscore_30d=round(float(z_val), 2) if pd.notna(z_val) else None,
      rain_7d_sum_mm=round(float(rain_7d), 1) if pd.notna(rain_7d) else None,
      rain_lag_21d_mm=round(float(rain_21d), 1) if pd.notna(rain_21d) else None,
      forecasts=forecasts,
  )


# Serve compiled React bundle automatically when deployed on Render
if FRONTEND_DIST.exists():
  app.mount(
      "/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend"
  )