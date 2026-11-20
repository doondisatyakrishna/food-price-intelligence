from pathlib import Path
import shutil
import sqlite3

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db"
BACKUP_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db.bak"

TARGET_STATES = ("andhra pradesh", "telangana")


def setup_telugu_states() -> None:
  if BACKUP_PATH.exists():
    shutil.copy2(BACKUP_PATH, DB_PATH)
    print(f"[Restore] Restored full database from {BACKUP_PATH}")
  else:
    print("[Warning] No .bak file found; operating on current database.")

  conn = sqlite3.connect(DB_PATH, timeout=30)
  conn.execute("PRAGMA foreign_keys = OFF;")
  try:
    with conn:
      # 1. Remove non-Telugu states (Nashik/Maharashtra, Kolar/Karnataka, etc.)
      del_prices = conn.execute("""
                DELETE FROM daily_prices
                WHERE market_id NOT IN (
                    SELECT id FROM markets
                    WHERE lower(state) IN ('andhra pradesh', 'telangana')
                );
                """).rowcount

      del_markets = conn.execute("""
                DELETE FROM markets
                WHERE lower(state) NOT IN ('andhra pradesh', 'telangana');
                """).rowcount

      del_commodities = conn.execute("""
                DELETE FROM commodities
                WHERE id NOT IN (SELECT DISTINCT commodity_id FROM daily_prices);
                """).rowcount

      # 2. Keep only Andhra Pradesh & Telangana weather rows
      del_weather = conn.execute("""
                DELETE FROM weather_data
                WHERE lower(region_name) NOT LIKE '%andhra%'
                  AND lower(region_name) NOT LIKE '%telangana%';
                """).rowcount

      conn.execute("""
                UPDATE weather_data
                SET region_name = 'Andhra Pradesh'
                WHERE lower(region_name) LIKE '%andhra%';
                """)
      conn.execute("""
                UPDATE weather_data
                SET region_name = 'Telangana'
                WHERE lower(region_name) LIKE '%telangana%';
                """)

      # 3. Fix Chittoor spelling noise (avoiding unique-key collisions)
      fixed_chittor = conn.execute("""
                UPDATE markets
                SET district = 'Chittoor'
                WHERE district = 'Chittor'
                  AND NOT EXISTS (
                      SELECT 1 FROM markets m2
                      WHERE m2.name = markets.name
                        AND m2.state = markets.state
                        AND m2.district = 'Chittoor'
                  );
                """).rowcount

    conn.execute("ANALYZE;")
    conn.execute("VACUUM;")

    price_count = conn.execute("SELECT COUNT(*) FROM daily_prices").fetchone()[0]
    ap_d = conn.execute(
        "SELECT COUNT(DISTINCT district) FROM markets WHERE lower(state) = 'andhra pradesh'"
    ).fetchone()[0]
    ts_d = conn.execute(
        "SELECT COUNT(DISTINCT district) FROM markets WHERE lower(state) = 'telangana'"
    ).fetchone()[0]

    print(
        f"[Done] Removed {del_prices:,} non-Telugu price rows, {del_markets:,} markets, "
        f"{del_commodities:,} unused commodities, {del_weather:,} weather rows."
    )
    print(f"[Cleaned] Normalized {fixed_chittor} 'Chittor' -> 'Chittoor' market records.")
    print(f"[Remaining] {price_count:,} price rows across {ap_d} AP districts & {ts_d} Telangana districts.")
  finally:
    conn.close()


if __name__ == "__main__":
  setup_telugu_states()