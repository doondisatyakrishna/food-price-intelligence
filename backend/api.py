from collections import defaultdict
from contextlib import asynccontextmanager
import gc
import logging
import os
from pathlib import Path
import sqlite3
import threading
import time

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.db import cache_get, cache_set, get_db_connection
from backend.sync_manager import get_sync_status, run_catchup_sync
from backend.ml_service import (
    clear_ml_models,
    generate_price_forecast,
    load_ml_models,
    ml_state,
)
from backend.sync import get_sync_status, run_catchup_sync
from backend.weather_service import (
    DEFAULT_HUB_BY_REGION,
    fetch_regional_weather,
    get_weather_hubs_list,
)

logger = logging.getLogger("agropulse")
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"


def _delayed_startup_sync() -> None:
  try:
    run_catchup_sync(bypass_cooldown=True)
  finally:
    gc.collect()


@asynccontextmanager
async def lifespan(app: FastAPI):
  load_ml_models()
  startup_timer = threading.Timer(45.0, _delayed_startup_sync)
  startup_timer.daemon = True
  startup_timer.start()
  yield
  startup_timer.cancel()
  clear_ml_models()


app = FastAPI(
    title="AgroPulse India API",
    description="Agricultural Mandi Price Intelligence & Early-Warning System",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sliding-window rate limiter (90 req/min per IP) + Worker Telemetry headers
_ip_requests: dict[str, list[float]] = defaultdict(list)


@app.middleware("http")
async def gateway_middleware(request: Request, call_next):
  start = time.perf_counter()
  if request.url.path.startswith("/api/"):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    recent = [t for t in _ip_requests[client_ip] if now - t < 60.0]
    if len(recent) >= 90:
      return JSONResponse(
          status_code=429,
          content={"detail": "Rate limit exceeded (90 requests/min)."},
      )
    recent.append(now)
    _ip_requests[client_ip] = recent

  response = await call_next(request)
  elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
  response.headers["X-Worker-PID"] = str(os.getpid())
  response.headers["X-Process-Time-Ms"] = str(elapsed_ms)
  return response


@app.exception_handler(sqlite3.Error)
async def sqlite_exception_handler(request: Request, exc: sqlite3.Error):
  logger.exception("SQLite error on %s", request.url.path)
  return JSONResponse(
      status_code=503,
      content={
          "detail": (
              "Market database is updating records. Please retry in a few"
              " seconds."
          )
      },
  )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
  logger.exception("Unhandled server error on %s", request.url.path)
  return JSONResponse(
      status_code=500,
      content={
          "detail": (
              "Unexpected server error while processing market analytics."
          )
      },
  )


class ForecastRequest(BaseModel):
  region_name: str
  commodity: str
  rain_21d_delta_mm: float = 0.0
  price_shock_pct: float = 0.0


@app.get("/health")
def health_check():
  conn = get_db_connection()
  db_ok = conn.execute("SELECT 1").fetchone() is not None
  conn.close()
  return {
      "status": "ok",
      "worker_pid": os.getpid(),
      "database_connected": db_ok,
      "models_loaded": {
          "7d": ml_state.get("model_7d") is not None,
          "14d": ml_state.get("model_14d") is not None,
      },
      "sync": get_sync_status(),
  }


@app.get("/api/catalog")
def get_catalog():
  sync_token = get_sync_status().get("last_completed_at")
  cached = cache_get(("catalog",), sync_token)
  if cached is not None:
    return cached

  conn = get_db_connection()
  rows = conn.execute("""
        SELECT region_name, commodity, COUNT(*) AS trading_days,
               MIN(date) AS start_date, MAX(date) AS end_date
        FROM engineered_features
        GROUP BY region_name, commodity
        ORDER BY region_name, commodity
        """).fetchall()
  conn.close()

  series = [dict(r) for r in rows]
  regions = sorted({r["region_name"] for r in series})
  commodities = sorted({r["commodity"] for r in series})

  payload = {
      "regions": regions,
      "commodities": commodities,
      "series": series,
      "weather_hubs": get_weather_hubs_list(),
      "default_hub_by_region": DEFAULT_HUB_BY_REGION,
      "model_metrics": ml_state.get("metrics", {}),
  }
  cache_set(("catalog",), payload, sync_token, ttl=600)
  return payload


@app.get("/api/alerts")
def get_alerts(include_normal: bool = Query(False)):
  sync_token = get_sync_status().get("last_completed_at")
  cached = cache_get(("alerts", include_normal), sync_token)
  if cached is not None:
    return cached

  conn = get_db_connection()
  rows = conn.execute("""
        SELECT ef.region_name, ef.commodity, ef.date, ef.median_modal_price,
               ef.price_zscore_30d, ef.alert_status
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
        """).fetchall()
  conn.close()

  alerts = []
  for r in rows:
    item = dict(r)
    if include_normal or item["alert_status"] in ("CRITICAL_SURGE", "WATCH"):
      alerts.append(item)

  payload = {"count": len(alerts), "alerts": alerts}
  cache_set(("alerts", include_normal), payload, sync_token, ttl=300)
  return payload


@app.get("/api/history")
def get_history(
    region_name: str = Query("Andhra Pradesh"),
    commodity: str = Query("Tomato"),
    limit: int = Query(120, ge=10, le=1500),
):
  sync_token = get_sync_status().get("last_completed_at")
  c_key = ("history", region_name, commodity, limit)
  cached = cache_get(c_key, sync_token)
  if cached is not None:
    return cached

  conn = get_db_connection()
  rows = conn.execute(
      """
        SELECT date, median_modal_price, price_ma_7d, price_ma_30d,
               price_zscore_30d, precipitation_mm, rain_lag_21d, alert_status
        FROM engineered_features
        WHERE region_name = ? AND commodity = ?
        ORDER BY date DESC
        LIMIT ?
        """,
      (region_name, commodity, limit),
  ).fetchall()
  conn.close()

  data = [dict(r) for r in reversed(rows)]
  for d in data:
    d["date"] = str(d["date"])[:10]

  payload = {
      "region_name": region_name,
      "commodity": commodity,
      "count": len(data),
      "data": data,
  }
  cache_set(c_key, payload, sync_token, ttl=300)
  return payload


@app.get("/api/mandis")
def get_mandi_leaderboard(
    region_name: str = Query("Andhra Pradesh"),
    commodity: str = Query("Tomato"),
):
  sync_token = get_sync_status().get("last_completed_at")
  c_key = ("mandis", region_name, commodity)
  cached = cache_get(c_key, sync_token)
  if cached is not None:
    return cached

  conn = get_db_connection()
  latest_row = conn.execute(
      """
        SELECT MAX(dp.date) AS latest_date
        FROM daily_prices dp
        JOIN markets m ON dp.market_id = m.id
        JOIN commodities c ON dp.commodity_id = c.id
        WHERE (m.state = ? OR m.district = ?) AND c.name = ?
        """,
      (region_name, region_name, commodity),
  ).fetchone()

  latest_date = latest_row["latest_date"] if latest_row else None
  if not latest_date:
    conn.close()
    return {
        "region_name": region_name,
        "commodity": commodity,
        "latest_date": None,
        "mandi_count": 0,
        "spread_inr": 0,
        "mandis": [],
    }

  rows = conn.execute(
      """
        SELECT m.name AS market_name, m.district,
               dp.min_price_inr, dp.max_price_inr, dp.modal_price_inr
        FROM daily_prices dp
        JOIN markets m ON dp.market_id = m.id
        JOIN commodities c ON dp.commodity_id = c.id
        WHERE (m.state = ? OR m.district = ?) AND c.name = ? AND dp.date = ?
        ORDER BY dp.modal_price_inr DESC
        """,
      (region_name, region_name, commodity, latest_date),
  ).fetchall()
  conn.close()

  mandis = [dict(r) for r in rows]
  modals = [
      float(m["modal_price_inr"])
      for m in mandis
      if m["modal_price_inr"] is not None
  ]
  spread = round(max(modals) - min(modals), 2) if len(modals) >= 2 else 0.0

  payload = {
      "region_name": region_name,
      "commodity": commodity,
      "latest_date": str(latest_date)[:10],
      "mandi_count": len(mandis),
      "spread_inr": spread,
      "mandis": mandis,
  }
  cache_set(c_key, payload, sync_token, ttl=300)
  return payload


@app.get("/api/weather-forecast")
def weather_forecast_endpoint(
    region_name: str = Query("Coastal Andhra"),
    days: int = Query(14, ge=3, le=16),
):
  sync_token = get_sync_status().get("last_completed_at")
  return fetch_regional_weather(region_name, days, sync_token)


@app.post("/api/forecast")
def forecast_endpoint(req: ForecastRequest):
  return generate_price_forecast(
      region_name=req.region_name,
      commodity=req.commodity,
      rain_21d_delta_mm=req.rain_21d_delta_mm,
      price_shock_pct=req.price_shock_pct,
  )


@app.post("/api/sync")
def trigger_sync():
  status = get_sync_status()
  if status["is_syncing"]:
    return {"started": False, "message": "Sync already in progress.", **status}
  if status["cooldown_remaining_sec"] > 0:
    return {
        "started": False,
        "message": (
            f"Cooldown active ({status['cooldown_remaining_sec']}s remaining)."
        ),
        **status,
    }
  t = threading.Thread(
      target=run_catchup_sync, kwargs={"bypass_cooldown": False}, daemon=True
  )
  t.start()
  return {"started": True, "message": "Background catch-up sync triggered."}


@app.get("/api/sync/status")
def sync_status_endpoint():
  return get_sync_status()


# Mount compiled React frontend for single-service Render deployment
if FRONTEND_DIST.exists():
  app.mount(
      "/assets",
      StaticFiles(directory=FRONTEND_DIST / "assets"),
      name="assets",
  )

  @app.get("/{full_path:path}")
  def serve_spa(full_path: str):
    candidate = FRONTEND_DIST / full_path
    if full_path and candidate.is_file():
      return FileResponse(candidate)
    return FileResponse(FRONTEND_DIST / "index.html")