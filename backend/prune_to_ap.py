from pathlib import Path
import shutil
import sqlite3

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db"
BACKUP_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db.bak"


def prune_to_andhra_pradesh() -> None:
  if not DB_PATH.exists():
    raise FileNotFoundError(f"Database not found at {DB_PATH}")

  shutil.copy2(DB_PATH, BACKUP_PATH)
  print(f"[Backup] Saved safety copy to {BACKUP_PATH}")

  conn = sqlite3.connect(DB_PATH, timeout=30)
  conn.execute("PRAGMA foreign_keys = OFF;")
  try:
    with conn:
      # 1. Remove daily_prices for markets outside Andhra Pradesh
      del_prices = conn.execute("""
                DELETE FROM daily_prices
                WHERE market_id NOT IN (
                    SELECT id FROM markets WHERE lower(state) = 'andhra pradesh'
                );
                """).rowcount

      # 2. Remove non-AP markets
      del_markets = conn.execute("""
                DELETE FROM markets
                WHERE lower(state) != 'andhra pradesh';
                """).rowcount

      # 3. Remove orphaned commodities no longer referenced by daily_prices
      del_commodities = conn.execute("""
                DELETE FROM commodities
                WHERE id NOT IN (
                    SELECT DISTINCT commodity_id FROM daily_prices
                );
                """).rowcount

      # 4. Keep only Andhra Pradesh weather rows (and normalize state name)
      del_weather = conn.execute("""
                DELETE FROM weather_data
                WHERE lower(region_name) NOT LIKE '%andhra%'
                  AND region_name NOT IN (
                      SELECT DISTINCT district FROM markets
                  );
                """).rowcount

      conn.execute("""
                UPDATE weather_data
                SET region_name = 'Andhra Pradesh'
                WHERE lower(region_name) LIKE '%andhra%';
                """)

    conn.execute("ANALYZE;")
    conn.execute("VACUUM;")

    ap_districts = [
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT district FROM markets WHERE district IS NOT NULL AND trim(district) != '' ORDER BY district"
        ).fetchall()
    ]
    weather_regs = [
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT region_name FROM weather_data ORDER BY region_name"
        ).fetchall()
    ]
    price_count = conn.execute("SELECT COUNT(*) FROM daily_prices").fetchone()[0]

    print(
        f"[Prune Complete] Deleted {del_prices:,} non-AP price rows, "
        f"{del_markets:,} non-AP markets, {del_commodities:,} unused commodities, "
        f"and {del_weather:,} non-AP weather rows."
    )
    print(f"[Remaining AP Prices] {price_count:,} rows")
    print(f"[AP Districts ({len(ap_districts)})]: {ap_districts}")
    print(f"[Weather Regions]: {weather_regs}")
  finally:
    conn.close()


if __name__ == "__main__":
  prune_to_andhra_pradesh()