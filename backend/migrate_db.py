from backend.db import get_db_connection


def migrate_database() -> None:
  conn = get_db_connection()
  try:
    with conn:
      # 1. Repair zero or inverted min/max prices where modal_price_inr is positive
      cur_fix_max = conn.execute("""
                UPDATE daily_prices
                SET max_price_inr = modal_price_inr
                WHERE modal_price_inr > 0
                  AND (max_price_inr IS NULL OR max_price_inr < modal_price_inr);
                """)
      cur_fix_min = conn.execute("""
                UPDATE daily_prices
                SET min_price_inr = modal_price_inr
                WHERE modal_price_inr > 0
                  AND (min_price_inr IS NULL OR min_price_inr <= 0 OR min_price_inr > modal_price_inr);
                """)

      # 2. Deduplicate daily_prices on (market_id, commodity_id, date)
      cur_del_prices = conn.execute("""
                DELETE FROM daily_prices
                WHERE id NOT IN (
                    SELECT MIN(id)
                    FROM daily_prices
                    GROUP BY market_id, commodity_id, date
                );
                """)

      # 3. Deduplicate weather_data on (region_name, date)
      cur_del_weather = conn.execute("""
                DELETE FROM weather_data
                WHERE id NOT IN (
                    SELECT MIN(id)
                    FROM weather_data
                    GROUP BY region_name, date
                );
                """)

      # 4. Enforce unique constraints & composite query indexes
      conn.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_price_mkt_comm_date
                ON daily_prices (market_id, commodity_id, date);
                """)
      conn.execute("""
                CREATE INDEX IF NOT EXISTS ix_daily_prices_date
                ON daily_prices (date);
                """)
      conn.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_weather_region_date
                ON weather_data (region_name, date);
                """)
      conn.execute("""
                CREATE INDEX IF NOT EXISTS ix_engineered_features_series_date
                ON engineered_features (region_name, commodity, date);
                """)
      conn.execute("ANALYZE;")

    print(
        f"[Migration OK] Fixed {cur_fix_max.rowcount} max-price rows & "
        f"{cur_fix_min.rowcount} min-price rows; removed {cur_del_prices.rowcount} "
        f"duplicate price rows & {cur_del_weather.rowcount} duplicate weather rows; "
        "created unique + lookup indexes."
    )
  finally:
    conn.close()


if __name__ == "__main__":
  migrate_database()