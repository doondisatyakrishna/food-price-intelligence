from datetime import date, datetime, timedelta
import os
from pathlib import Path
import sqlite3
import threading
import time
from dotenv import find_dotenv, load_dotenv
import requests

try:
  from backend.features import build_feature_store
  from backend.models import Commodity, DailyPrice, Market, WeatherData, init_db
except ImportError:
  from features import build_feature_store
  from models import Commodity, DailyPrice, Market, WeatherData, init_db

load_dotenv(find_dotenv(), override=True)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db"

RAW_KEY = os.getenv("DATA_GOV_API_KEY", "")
DATA_GOV_API_KEY = RAW_KEY.strip().strip('"').strip("'")

LIVE_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070"
ARCHIVE_RESOURCE_ID = "35985678-0d79-46b4-9ed6-6f13308a1d24"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

REGIONS = [
    ("Andhra Pradesh", 16.5062, 80.6480),
    ("Telangana", 17.9689, 79.5941),
    ("Nashik", 19.9975, 73.7898),
    ("Kolar", 13.1367, 78.1292),
]

MANDI_TARGETS = [
    ("Andhra Pradesh", "Andhra Pradesh", None),
    ("Telangana", "Telangana", None),
    ("Nashik", "Maharashtra", "Nashik"),
    ("Kolar", "Karnataka", "Kolar"),
]

COOLDOWN_SECONDS = 600
_last_sync_timestamp = 0.0
_sync_lock = threading.Lock()

sync_status = {
    "is_syncing": False,
    "last_started_at": None,
    "last_completed_at": None,
    "last_message": "Waiting for initial sync check.",
    "new_price_rows": 0,
    "new_weather_rows": 0,
    "cooldown_remaining_sec": 0,
}


def enable_sqlite_wal():
  if DB_PATH.exists():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.close()


def fetch_gov_records(resource_id: str, params: dict, retries: int = 3) -> dict:
  url = f"https://api.data.gov.in/resource/{resource_id}"
  for attempt in range(1, retries + 1):
    try:
      resp = requests.get(url, params=params, headers=HEADERS, timeout=(10, 60))
      if resp.status_code == 200:
        return resp.json()
      if resp.status_code in (429, 502, 503, 504):
        time.sleep(3 * attempt)
      else:
        return {}
    except requests.RequestException:
      time.sleep(3 * attempt)
  return {}


def fetch_state_page(
    resource_id: str, state_name: str, limit: int, offset: int
) -> dict:
  """Handles data.gov.in schema differences where some resources index `filters[State]`

  while others index `filters[state.keyword]`.
  """
  for filter_key in ("filters[State]", "filters[state.keyword]", "filters[state]"):
    params = {
        "api-key": DATA_GOV_API_KEY,
        "format": "json",
        "limit": limit,
        "offset": offset,
        filter_key: state_name,
    }
    payload = fetch_gov_records(resource_id, params)
    if payload.get("records"):
      return payload
  return {}


def parse_arrival_date(raw_str: str) -> date | None:
  clean = (raw_str or "").strip()[:10]
  for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
    try:
      return datetime.strptime(clean, fmt).date()
    except ValueError:
      continue
  return None


def sync_weather_gap(session, today: date) -> int:
  total_inserted = 0

  for region_name, lat, lon in REGIONS:
    latest_row = (
        session.query(WeatherData.date)
        .filter_by(region_name=region_name)
        .order_by(WeatherData.date.desc())
        .first()
    )
    last_w_date = latest_row[0] if latest_row else date(2022, 1, 1)
    gap_days = (today - last_w_date).days

    if gap_days <= 0:
      continue

    existing = {
        r[0]
        for r in session.query(WeatherData.date)
        .filter(
            WeatherData.region_name == region_name,
            WeatherData.date >= last_w_date,
        )
        .all()
    }

    if gap_days > 90:
      start_str = last_w_date.strftime("%Y-%m-%d")
      end_str = (today - timedelta(days=2)).strftime("%Y-%m-%d")
      arch_url = (
          f"https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}"
          f"&start_date={start_str}&end_date={end_str}"
          f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
          f"&timezone=Asia/Kolkata"
      )
      resp = requests.get(arch_url, timeout=35)
      if resp.status_code == 200:
        daily = resp.json().get("daily", {})
        for i, d_str in enumerate(daily.get("time", [])):
          d_obj = datetime.strptime(d_str, "%Y-%m-%d").date()
          if d_obj not in existing and daily["temperature_2m_max"][i] is not None:
            session.add(
                WeatherData(
                    region_name=region_name,
                    date=d_obj,
                    temperature_max_c=float(daily["temperature_2m_max"][i]),
                    temperature_min_c=float(daily["temperature_2m_min"][i]),
                    precipitation_mm=float(daily["precipitation_sum"][i] or 0.0),
                )
            )
            existing.add(d_obj)
            total_inserted += 1
      session.commit()
      gap_days = 5

    recent_url = (
        f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
        f"&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
        f"&timezone=Asia/Kolkata&past_days={min(gap_days, 90)}&forecast_days=1"
    )
    resp = requests.get(recent_url, timeout=25)
    if resp.status_code == 200:
      daily = resp.json().get("daily", {})
      for i, d_str in enumerate(daily.get("time", [])):
        d_obj = datetime.strptime(d_str, "%Y-%m-%d").date()
        if (
            d_obj <= today
            and d_obj not in existing
            and daily["temperature_2m_max"][i] is not None
        ):
          session.add(
              WeatherData(
                  region_name=region_name,
                  date=d_obj,
                  temperature_max_c=float(daily["temperature_2m_max"][i]),
                  temperature_min_c=float(daily["temperature_2m_min"][i]),
                  precipitation_mm=float(daily["precipitation_sum"][i] or 0.0),
              )
          )
          existing.add(d_obj)
          total_inserted += 1
    session.commit()

  return total_inserted


def ingest_records_into_db(
    session,
    records: list[dict],
    district_filter: str | None,
    min_date: date,
    market_cache: dict,
    comm_cache: dict,
) -> int:
  inserted = 0
  for raw in records:
    row = {k.lower().strip(): v for k, v in raw.items()}

    r_state = (row.get("state") or "").strip()
    r_district = (row.get("district") or "Unknown").strip()
    r_market = (row.get("market") or "").strip()
    r_commodity = (row.get("commodity") or "").strip()
    price_date = parse_arrival_date(row.get("arrival_date", ""))

    if district_filter and r_district.lower() != district_filter.lower():
      continue
    if not all([r_state, r_market, r_commodity, price_date]):
      continue
    if price_date < min_date:
      continue

    modal_val = float(row.get("modal_price") or 0)
    if modal_val <= 0:
      continue

    mkt_key = (r_market, r_state)
    if mkt_key not in market_cache:
      mkt = Market(name=r_market, district=r_district, state=r_state)
      session.add(mkt)
      session.flush()
      market_cache[mkt_key] = mkt.id
    mkt_id = market_cache[mkt_key]

    if r_commodity not in comm_cache:
      comm = Commodity(name=r_commodity, category="Agricultural")
      session.add(comm)
      session.flush()
      comm_cache[r_commodity] = comm.id
    comm_id = comm_cache[r_commodity]

    exists = (
        session.query(DailyPrice.id)
        .filter_by(market_id=mkt_id, commodity_id=comm_id, date=price_date)
        .first()
    )
    if exists:
      continue

    session.add(
        DailyPrice(
            market_id=mkt_id,
            commodity_id=comm_id,
            date=price_date,
            modal_price_inr=modal_val,
            min_price_inr=float(row.get("min_price") or modal_val),
            max_price_inr=float(row.get("max_price") or modal_val),
        )
    )
    inserted += 1

  session.commit()
  return inserted


def sync_mandi_gap(session, today: date) -> int:
  if not DATA_GOV_API_KEY:
    print("[Sync] DATA_GOV_API_KEY missing in .env; skipping mandi sync.")
    return 0

  market_cache = {(m.name, m.state): m.id for m in session.query(Market).all()}
  comm_cache = {c.name: c.id for c in session.query(Commodity).all()}
  total_inserted = 0

  for label, state_name, district_filter in MANDI_TARGETS:
    state_row_count = (
        session.query(DailyPrice.id)
        .join(Market, DailyPrice.market_id == Market.id)
        .filter(Market.state == state_name)
        .count()
    )
    latest_state_row = (
        session.query(DailyPrice.date)
        .join(Market, DailyPrice.market_id == Market.id)
        .filter(Market.state == state_name)
        .order_by(DailyPrice.date.desc())
        .first()
    )

    is_initial_state_backfill = state_row_count < 1000
    state_watermark = (
        date(2022, 1, 1)
        if is_initial_state_backfill
        else (latest_state_row[0] if latest_state_row else date(2024, 1, 1))
    )

    # Step A: Multi-day rolling archive catch-up
    if is_initial_state_backfill or (today - state_watermark).days > 1:
      max_offset = 15000 if is_initial_state_backfill else 2000
      for offset in range(0, max_offset + 1, 1000):
        payload = fetch_state_page(
            ARCHIVE_RESOURCE_ID, state_name, limit=1000, offset=offset
        )
        records = payload.get("records", [])
        if not records:
          break

        added = ingest_records_into_db(
            session,
            records,
            district_filter,
            min_date=state_watermark,
            market_cache=market_cache,
            comm_cache=comm_cache,
        )
        total_inserted += added
        if is_initial_state_backfill:
          print(f"  [{label} Archive] offset {offset} -> +{added} rows")

    # Step B: Live daily mandi feed
    offset = 0
    while True:
      payload = fetch_state_page(
          LIVE_RESOURCE_ID, state_name, limit=1000, offset=offset
      )
      records = payload.get("records", [])
      total_avail = int(payload.get("total", 0))

      added = ingest_records_into_db(
          session,
          records,
          district_filter,
          min_date=state_watermark,
          market_cache=market_cache,
          comm_cache=comm_cache,
      )
      total_inserted += added

      offset += len(records)
      if offset >= total_avail or not records:
        break

  return total_inserted


def run_catchup_sync(
    bypass_cooldown: bool = False, force_feature_rebuild: bool = False
) -> dict:
  global _last_sync_timestamp

  now = time.time()
  elapsed = now - _last_sync_timestamp
  if (
      not bypass_cooldown
      and _last_sync_timestamp > 0
      and elapsed < COOLDOWN_SECONDS
  ):
    remaining = int(COOLDOWN_SECONDS - elapsed)
    sync_status["cooldown_remaining_sec"] = remaining
    sync_status["last_message"] = (
        f"Already synced recently. Next sync available in {remaining // 60}m"
        f" {remaining % 60}s."
    )
    return sync_status

  if not _sync_lock.acquire(blocking=False):
    return sync_status

  try:
    sync_status["is_syncing"] = True
    sync_status["cooldown_remaining_sec"] = 0
    sync_status["last_started_at"] = datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    sync_status["last_message"] = (
        "Syncing AP, Telangana & hub weather + prices..."
    )

    enable_sqlite_wal()
    session = init_db()
    today = date.today()

    new_weather = sync_weather_gap(session, today)
    new_prices = sync_mandi_gap(session, today)
    session.close()

    if new_prices > 0 or new_weather > 0 or force_feature_rebuild:
      sync_status["last_message"] = (
          "Rebuilding rolling features & alert Z-scores..."
      )
      build_feature_store()

    _last_sync_timestamp = time.time()
    sync_status["new_price_rows"] = new_prices
    sync_status["new_weather_rows"] = new_weather
    sync_status["last_completed_at"] = datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    sync_status["last_message"] = (
        f"Up to date ({today}). Added {new_prices} price rows & {new_weather}"
        " weather days."
    )
    print(f"[Sync Complete] {sync_status['last_message']}")
  except Exception as exc:
    sync_status["last_message"] = f"Sync warning: {exc}"
    print(f"[Sync Error] {exc}")
  finally:
    sync_status["is_syncing"] = False
    _sync_lock.release()

  return sync_status


if __name__ == "__main__":
  run_catchup_sync(bypass_cooldown=True, force_feature_rebuild=True)