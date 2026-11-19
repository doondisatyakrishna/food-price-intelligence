from pathlib import Path
import sqlite3
import time
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "data" / "food_price_intelligence.db"

_ttl_cache: dict[tuple, tuple[float, Any]] = {}


def get_db_connection() -> sqlite3.Connection:
  conn = sqlite3.connect(DB_PATH, timeout=15.0, check_same_thread=False)
  conn.row_factory = sqlite3.Row
  conn.execute("PRAGMA journal_mode=WAL;")
  conn.execute("PRAGMA busy_timeout = 15000;")
  return conn


def cache_get(key: tuple, sync_token: Any = None) -> Any:
  full_key = (sync_token, *key)
  entry = _ttl_cache.get(full_key)
  if not entry:
    return None
  expires_at, payload = entry
  if time.time() > expires_at:
    _ttl_cache.pop(full_key, None)
    return None
  return payload


def cache_set(
    key: tuple, payload: Any, sync_token: Any = None, ttl: int = 300
) -> None:
  full_key = (sync_token, *key)
  if len(_ttl_cache) > 250:
    _ttl_cache.clear()
  _ttl_cache[full_key] = (time.time() + ttl, payload)