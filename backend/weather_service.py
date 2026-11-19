from fastapi import HTTPException
import requests
from backend.db import cache_get, cache_set, get_db_connection

WEATHER_HUBS = {
    "Coastal Andhra": {
        "label": "Coastal Andhra (Guntur / Amaravati)",
        "districts": "Guntur, Krishna, Bapatla, Nellore, East & West Godavari",
        "state_group": "Andhra Pradesh",
        "lat": 16.31,
        "lon": 80.44,
    },
    "Rayalaseema": {
        "label": "Rayalaseema (Kurnool / Madanapalle)",
        "districts": "Kurnool, Chittoor, Annamayya, Anantapur, Kadapa",
        "state_group": "Andhra Pradesh",
        "lat": 15.83,
        "lon": 78.04,
    },
    "North Telangana": {
        "label": "North Telangana (Nizamabad / Warangal)",
        "districts": "Nizamabad, Warangal, Karimnagar, Adilabad, Siddipet",
        "state_group": "Telangana",
        "lat": 18.67,
        "lon": 78.09,
    },
    "South Telangana": {
        "label": "South Telangana (Khammam / Nalgonda)",
        "districts": "Khammam, Nalgonda, Suryapet, Mahabubnagar, Rangareddy",
        "state_group": "Telangana",
        "lat": 17.25,
        "lon": 80.15,
    },
    "Nashik": {
        "label": "Nashik Hub (North Maharashtra)",
        "districts": "Lasalgaon, Pimpalgaon, Nashik, Sinnar",
        "state_group": "Nashik",
        "lat": 20.00,
        "lon": 73.79,
    },
    "Kolar": {
        "label": "Kolar Hub (South Karnataka)",
        "districts": "Kolar, Chikkaballapur, Srinivaspur",
        "state_group": "Kolar",
        "lat": 13.14,
        "lon": 78.13,
    },
}

DEFAULT_HUB_BY_REGION = {
    "Andhra Pradesh": "Coastal Andhra",
    "Telangana": "North Telangana",
    "Nashik": "Nashik",
    "Kolar": "Kolar",
}

_stale_weather_backup: dict[str, dict] = {}


def get_weather_hubs_list() -> list[dict]:
  return [
      {
          "id": hub_id,
          "label": info["label"],
          "districts": info["districts"],
          "lat": info["lat"],
          "lon": info["lon"],
      }
      for hub_id, info in WEATHER_HUBS.items()
  ]


def fetch_regional_weather(
    region_name: str, days: int = 14, sync_token=None
) -> dict:
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
  cached = cache_get(c_key, sync_token)
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
    cache_set(c_key, result, sync_token, ttl=1800)
    _stale_weather_backup[hub_key] = result
    return result

  except requests.RequestException:
    if hub_key in _stale_weather_backup:
      return _stale_weather_backup[hub_key]

    conn = get_db_connection()
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