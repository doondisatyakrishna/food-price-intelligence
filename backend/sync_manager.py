from datetime import datetime, timezone
import gc
import inspect
import threading
import time
from backend.sync import run_catchup_sync as _raw_run_catchup_sync

_COOLDOWN_SEC = 600  # 10-minute cooldown between manual syncs
_sync_lock = threading.Lock()
_last_completed_ts: float = 0.0

_sync_state = {
    "status": "idle",
    "is_syncing": False,
    "last_started_at": None,
    "last_completed_at": None,
    "last_message": "Idle (ready to sync).",
    "new_price_rows": 0,
    "new_weather_rows": 0,
    "errors": [],
    "cooldown_remaining_sec": 0,
}


def _utc_now_str() -> str:
  return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def get_sync_status() -> dict:
  remaining = 0
  if not _sync_state["is_syncing"] and _last_completed_ts > 0:
    elapsed = time.time() - _last_completed_ts
    remaining = max(0, int(_COOLDOWN_SEC - elapsed))
  return {**_sync_state, "cooldown_remaining_sec": remaining}


def _update_message(msg: str) -> None:
  _sync_state["last_message"] = msg


def run_catchup_sync(bypass_cooldown: bool = False) -> dict:
  global _last_completed_ts

  status = get_sync_status()
  if status["is_syncing"]:
    return status
  if not bypass_cooldown and status["cooldown_remaining_sec"] > 0:
    return status

  if not _sync_lock.acquire(blocking=False):
    return get_sync_status()

  try:
    _sync_state["status"] = "running"
    _sync_state["is_syncing"] = True
    _sync_state["errors"] = []
    _sync_state["last_started_at"] = _utc_now_str()
    _sync_state["last_message"] = (
        "Syncing AP, Telangana & hub weather + prices..."
    )

    sig = inspect.signature(_raw_run_catchup_sync)
    kwargs = {}
    if "bypass_cooldown" in sig.parameters:
      kwargs["bypass_cooldown"] = True
    if "progress_callback" in sig.parameters:
      kwargs["progress_callback"] = _update_message
    elif "status_callback" in sig.parameters:
      kwargs["status_callback"] = _update_message

    result = _raw_run_catchup_sync(**kwargs)

    if isinstance(result, dict):
      raw_status = result.get("status", "success")
      price_rows = int(result.get("new_price_rows", 0))
      weather_rows = int(result.get("new_weather_rows", 0))
      errors = list(result.get("errors", []))
      raw_msg = result.get("last_message") or result.get("message")

      _sync_state["status"] = raw_status
      _sync_state["new_price_rows"] = price_rows
      _sync_state["new_weather_rows"] = weather_rows
      _sync_state["errors"] = errors

      if raw_status == "failed":
        _sync_state["last_message"] = raw_msg or "Sync failed."
      elif raw_status == "partial":
        _sync_state["last_completed_at"] = _utc_now_str()
        _last_completed_ts = time.time()
        _sync_state["last_message"] = raw_msg or (
            f"Partial sync: +{price_rows} prices, +{weather_rows} weather days."
        )
      else:
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        _sync_state["last_completed_at"] = _utc_now_str()
        _last_completed_ts = time.time()
        _sync_state["last_message"] = raw_msg or (
            f"Up to date ({today_str}). Added {price_rows} price rows &"
            f" {weather_rows} weather days."
        )
  except Exception as exc:
    _sync_state["status"] = "failed"
    _sync_state["errors"] = [str(exc)]
    _sync_state["last_message"] = f"Sync failed: {exc}"
  finally:
    _sync_state["is_syncing"] = False
    _sync_lock.release()
    gc.collect()

  return get_sync_status()