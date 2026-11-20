from pathlib import Path
import sqlite3
import joblib
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "data" / "food_price_intelligence.db"
MODEL_PATH = PROJECT_ROOT / "models" / "price_forecaster_14d.joblib"

TARGET_COMMODITIES = ["Dry Chillies", "Onion", "Tomato"]


def _calc_row(label: str, sub: pd.DataFrame) -> dict:
  y_true = sub["target_price_14d"].values
  y_base = sub["median_modal_price"].values
  y_pred = sub["pred_price"].values

  mae_base = mean_absolute_error(y_true, y_base)
  mae_ml = mean_absolute_error(y_true, y_pred)
  mae_gain = ((mae_base - mae_ml) / mae_base) * 100 if mae_base > 0 else 0.0

  mape_base = mean_absolute_percentage_error(y_true, y_base) * 100
  mape_ml = mean_absolute_percentage_error(y_true, y_pred) * 100

  return {
      "label": label,
      "rows": len(sub),
      "mae_base": mae_base,
      "mae_ml": mae_ml,
      "mae_diff": mae_ml - mae_base,
      "mae_gain": mae_gain,
      "mape_base": mape_base,
      "mape_ml": mape_ml,
  }


def _print_table(title: str, rows: list[dict], col_name: str):
  header = (
      f"{col_name:<22} {'Rows':>5} | {'Base MAE':>10} {'ML MAE':>10}"
      f" {'MAE Gain':>9} | {'Base MAPE':>9} {'ML MAPE':>9}"
  )
  print(f"\n{title}")
  print("-" * len(header))
  print(header)
  print("-" * len(header))
  for r in rows:
    print(
        f"{r['label']:<22} {r['rows']:>5} | ₹{r['mae_base']:>8,.1f}"
        f" ₹{r['mae_ml']:>8,.1f} {r['mae_gain']:>+8.2f}% |"
        f" {r['mape_base']:>8.2f}% {r['mape_ml']:>8.2f}%"
    )


def main():
  artifact = joblib.load(MODEL_PATH)
  pipeline = artifact["pipeline"]
  features = artifact["features"]

  conn = sqlite3.connect(DB_PATH)
  df = pd.read_sql_query(
      "SELECT * FROM engineered_features ORDER BY date ASC",
      conn,
      parse_dates=["date"],
  )
  conn.close()

  valid_df = df.dropna(subset=["target_price_14d", "median_modal_price"]).copy()
  valid_df = valid_df[valid_df["median_modal_price"] > 0]

  split_date = valid_df["date"].quantile(0.80)
  test_df = valid_df[valid_df["date"] >= split_date].copy()

  pred_return = pipeline.predict(test_df[features])
  test_df["pred_price"] = test_df["median_modal_price"] * (1.0 + pred_return)

  date_span = f"{test_df['date'].min().date()} -> {test_df['date'].max().date()}"

  # 1. Core commodities + overall
  core_rows = [
      _calc_row(c, test_df[test_df["commodity"] == c])
      for c in TARGET_COMMODITIES
      if not test_df[test_df["commodity"] == c].empty
  ]
  core_rows.append(_calc_row("ALL TEST ROWS", test_df))
  _print_table(f"14-Day Core Commodities ({date_span})", core_rows, "Commodity")

  # 2. Top 5 districts with highest 14-day ML MAE (excluding state aggregates)
  district_df = test_df[
      ~test_df["region_name"].isin(["Andhra Pradesh", "Telangana"])
  ]
  district_rows = [
      _calc_row(reg, sub)
      for reg, sub in district_df.groupby("region_name")
      if len(sub) >= 15
  ]
  district_rows.sort(key=lambda r: r["mae_ml"], reverse=True)
  _print_table(
      "Top 5 Districts by 14-Day ML MAE (>= 15 test rows)",
      district_rows[:5],
      "District",
  )

  # 3. Top 5 commodities dragging overall MAE down (worst ML MAE - Base MAE)
  comm_rows = [
      _calc_row(comm, sub)
      for comm, sub in test_df.groupby("commodity")
      if len(sub) >= 15
  ]
  comm_rows.sort(key=lambda r: r["mae_diff"], reverse=True)
  _print_table(
      "Top 5 Commodities Dragging Overall 14-Day MAE (>= 15 test rows)",
      comm_rows[:5],
      "Commodity",
  )


if __name__ == "__main__":
  main()
