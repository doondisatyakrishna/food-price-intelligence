from pathlib import Path
import sqlite3
import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db"

MIN_TRADING_DAYS = 30
DISTRICT_ALIASES = {"Chittor": "Chittoor"}


def load_and_clean_raw_data(db_path: Path):
  """Loads Andhra Pradesh & Telangana mandi prices and weather from SQLite.

  Produces both state-wide ('Andhra Pradesh', 'Telangana') and per-district
  series, along with a mapping from each region_name to its state weather key.
  """
  conn = sqlite3.connect(db_path)

  prices_sql = """
    SELECT
        dp.date,
        m.state,
        m.district,
        m.name AS market_name,
        c.name AS commodity,
        dp.min_price_inr,
        dp.max_price_inr,
        dp.modal_price_inr
    FROM daily_prices dp
    JOIN markets m ON dp.market_id = m.id
    JOIN commodities c ON dp.commodity_id = c.id
    WHERE dp.modal_price_inr > 0
      AND lower(m.state) IN ('andhra pradesh', 'telangana')
    """
  df_prices = pd.read_sql_query(prices_sql, conn, parse_dates=["date"])
  df_weather = pd.read_sql_query(
      "SELECT * FROM weather_data", conn, parse_dates=["date"]
  )
  conn.close()

  if not df_weather.empty:
    df_weather = (
        df_weather.sort_values("date")
        .drop_duplicates(subset=["region_name", "date"], keep="last")
        .copy()
    )

  if df_prices.empty:
    return pd.DataFrame(), df_weather, {}

  df_prices["district"] = (
      df_prices["district"].fillna("").str.strip().replace(DISTRICT_ALIASES)
  )

  # Map each district to its parent state so weather lookup matches AP or Telangana
  region_to_state = {
      "Andhra Pradesh": "Andhra Pradesh",
      "Telangana": "Telangana",
  }
  for dist, st in (
      df_prices[df_prices["district"] != ""][["district", "state"]]
      .drop_duplicates()
      .itertuples(index=False)
  ):
    region_to_state[dist] = st

  # 1. State-wide aggregates (Andhra Pradesh & Telangana)
  state_df = df_prices.copy()
  state_df["region_name"] = state_df["state"]

  # 2. District-level series for every AP & Telangana district
  district_df = df_prices[df_prices["district"] != ""].copy()
  district_df["region_name"] = district_df["district"]

  combined_prices = pd.concat([state_df, district_df], ignore_index=True)

  daily_prices = (
      combined_prices.groupby(["region_name", "commodity", "date"])
      .agg(
          mandi_count=("market_name", "nunique"),
          median_modal_price=("modal_price_inr", "median"),
          mean_modal_price=("modal_price_inr", "mean"),
          min_price=("min_price_inr", "min"),
          max_price=("max_price_inr", "max"),
      )
      .reset_index()
  )

  return daily_prices, df_weather, region_to_state


def _get_weather_for_region(
    df_weather: pd.DataFrame, region_name: str, state_fallback: str
) -> pd.DataFrame:
  if df_weather.empty:
    return pd.DataFrame(
        columns=[
            "date",
            "temperature_max_c",
            "temperature_min_c",
            "precipitation_mm",
        ]
    )

  w_sub = df_weather[df_weather["region_name"] == region_name]
  if w_sub.empty:
    w_sub = df_weather[df_weather["region_name"] == state_fallback]
  if w_sub.empty:
    w_sub = df_weather

  return (
      w_sub.sort_values("date")
      .drop_duplicates(subset=["date"], keep="last")
      .copy()
  )


def engineer_series_features(
    price_group: pd.DataFrame, weather_region: pd.DataFrame
) -> pd.DataFrame:
  price_group = price_group.sort_values("date").copy()

  full_dates = pd.date_range(
      start=price_group["date"].min(),
      end=price_group["date"].max(),
      freq="D",
  )
  calendar_df = pd.DataFrame({"date": full_dates})
  merged = pd.merge(calendar_df, price_group, on="date", how="left")

  merged["is_trading_day"] = merged["median_modal_price"].notna()

  price_ffill = merged["median_modal_price"].ffill(limit=3)
  min_ffill = merged["min_price"].ffill(limit=3)
  max_ffill = merged["max_price"].ffill(limit=3)

  merged["price_ma_7d"] = price_ffill.rolling(window=7, min_periods=3).mean()
  merged["price_ma_14d"] = price_ffill.rolling(window=14, min_periods=5).mean()
  merged["price_ma_30d"] = price_ffill.rolling(window=30, min_periods=10).mean()
  merged["price_std_30d"] = price_ffill.rolling(window=30, min_periods=10).std()

  merged["pct_change_7d"] = price_ffill.pct_change(periods=7, fill_method=None)
  merged["pct_change_14d"] = price_ffill.pct_change(
      periods=14, fill_method=None
  )

  merged["intraday_spread_pct"] = (max_ffill - min_ffill) / price_ffill.replace(
      0, np.nan
  )

  merged["price_zscore_30d"] = (
      merged["median_modal_price"] - merged["price_ma_30d"]
  ) / merged["price_std_30d"].replace(0, np.nan)

  merged["alert_status"] = np.select(
      [merged["price_zscore_30d"] >= 2.0, merged["price_zscore_30d"] >= 1.5],
      ["CRITICAL_SURGE", "WATCH"],
      default="NORMAL",
  )

  weather_cols = weather_region[[
      "date",
      "temperature_max_c",
      "temperature_min_c",
      "precipitation_mm",
  ]]
  merged = pd.merge(merged, weather_cols, on="date", how="left")

  merged["rain_7d_sum"] = (
      merged["precipitation_mm"].rolling(window=7, min_periods=1).sum()
  )
  merged["rain_14d_sum"] = (
      merged["precipitation_mm"].rolling(window=14, min_periods=1).sum()
  )
  merged["rain_lag_7d"] = merged["rain_7d_sum"].shift(7)
  merged["rain_lag_14d"] = merged["rain_7d_sum"].shift(14)
  merged["rain_lag_21d"] = merged["rain_7d_sum"].shift(21)

  temp_ma_30d = (
      merged["temperature_max_c"].rolling(window=30, min_periods=10).mean()
  )
  merged["temp_anomaly_c"] = merged["temperature_max_c"] - temp_ma_30d

  day_of_year = merged["date"].dt.day_of_year
  merged["month"] = merged["date"].dt.month
  merged["sin_day_of_year"] = np.sin(2 * np.pi * day_of_year / 365.25)
  merged["cos_day_of_year"] = np.cos(2 * np.pi * day_of_year / 365.25)

  merged["target_price_7d"] = merged["median_modal_price"].shift(-7)
  merged["target_price_14d"] = merged["median_modal_price"].shift(-14)

  return merged[merged["is_trading_day"]].drop(columns=["is_trading_day"])


def build_feature_store():
  daily_prices, df_weather, region_to_state = load_and_clean_raw_data(DB_PATH)
  if daily_prices.empty:
    print("No Andhra Pradesh / Telangana price rows found in database.")
    return

  counts = (
      daily_prices.groupby(["region_name", "commodity"])
      .size()
      .reset_index(name="days")
  )
  qualified = counts[counts["days"] >= MIN_TRADING_DAYS]
  print(
      f"Qualified AP + Telangana series (>= {MIN_TRADING_DAYS} trading days):"
      f" {len(qualified)} pairs"
  )

  all_features = []
  for _, row in qualified.iterrows():
    reg = row["region_name"]
    comm = row["commodity"]

    p_sub = daily_prices[
        (daily_prices["region_name"] == reg)
        & (daily_prices["commodity"] == comm)
    ]
    w_sub = _get_weather_for_region(
        df_weather, reg, region_to_state.get(reg, "Andhra Pradesh")
    )

    feat_df = engineer_series_features(p_sub, w_sub)
    feat_df["region_name"] = reg
    feat_df["commodity"] = comm
    all_features.append(feat_df)

  final_df = (
      pd.concat(all_features, ignore_index=True)
      if all_features
      else pd.DataFrame()
  )

  conn = sqlite3.connect(DB_PATH)
  final_df.to_sql(
      "engineered_features", conn, if_exists="replace", index=False
  )
  conn.execute("""
        CREATE INDEX IF NOT EXISTS ix_engineered_features_series_date
        ON engineered_features (region_name, commodity, date);
        """)
  conn.commit()
  conn.close()

  print(
      f"Saved {len(final_df):,} feature-engineered rows to"
      " 'engineered_features' table."
  )
  print(
      "Regions/Districts in feature store:",
      sorted(final_df["region_name"].unique().tolist())
      if not final_df.empty
      else [],
  )


if __name__ == "__main__":
  build_feature_store()