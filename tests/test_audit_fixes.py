from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import ml_service, sync_manager, weather_service
from backend.api import app

client = TestClient(app)


def test_spa_path_traversal_blocked():
  resp = client.get("/..%2Fbackend%2Fapi.py")
  assert resp.status_code == 404


def test_forecast_rejects_unbounded_inputs():
  resp = client.post(
      "/api/forecast",
      json={
          "region_name": "Andhra Pradesh",
          "commodity": "Tomato",
          "rain_21d_delta_mm": 99999.0,
          "price_shock_pct": 0.0,
      },
  )
  assert resp.status_code == 422


def test_missing_model_fails_loudly_with_503():
  orig_7d = ml_service.ml_state.get("model_7d")
  try:
    ml_service.ml_state["model_7d"] = None
    health = client.get("/health").json()
    assert health["status"] == "degraded"

    resp = client.post(
        "/api/forecast",
        json={"region_name": "Andhra Pradesh", "commodity": "Tomato"},
    )
    assert resp.status_code == 503
  finally:
    ml_service.ml_state["model_7d"] = orig_7d


def test_sync_manager_preserves_failure_status():
  with patch.object(
      sync_manager,
      "_raw_run_catchup_sync",
      return_value={
          "status": "failed",
          "new_price_rows": 0,
          "new_weather_rows": 0,
          "errors": ["Upstream timeout"],
          "last_message": "Sync failed: Upstream timeout",
      },
  ):
    result = sync_manager.run_catchup_sync(bypass_cooldown=True)
    assert result["status"] == "failed"
    assert "failed" in result["last_message"].lower()


def test_weather_fallback_deduplicates_dates():
  weather_service._stale_weather_backup.clear()
  with patch(
      "backend.weather_service.requests.get",
      side_effect=weather_service.requests.RequestException("down"),
  ):
    data = weather_service.fetch_regional_weather("Coastal Andhra", days=14)
    dates = [d["date"] for d in data["daily"]]
    assert len(dates) == len(set(dates))
    assert "Observed SQLite Baseline" in data["source"]