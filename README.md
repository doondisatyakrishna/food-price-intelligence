# AgroPulse India — Agricultural Commodity Price Intelligence

**Live Dashboard:** [https://agropulse-india.onrender.com](https://agropulse-india.onrender.com)

AgroPulse India is an end-to-end agricultural commodity price forecasting and early-warning platform focused on **Andhra Pradesh and Telangana**. It combines daily Agmarknet mandi quotes with observed weather data to generate **7-day and 14-day price forecasts** (`₹/kg`) and **30-day Z-score surge alerts** across state-wide and district-level hubs.

---

## Key Features

* **Regional Coverage:** Tracks **21 regions** (`Andhra Pradesh`, `Telangana`, and **19 individual districts** including Guntur, Chittoor, Kurnool, Hyderabad, Karimnagar, East Godavari, and more) across **119 qualified commodity-region series** (~18,100 mandi price records).
* **7-Day & 14-Day ML Forecasts:** Separate `HistGradientBoostingRegressor` pipelines trained on percentage returns with L1 (`absolute_error`) loss, chronological out-of-time validation, and price-weighted 14-day training to prevent low-priced vegetables from drowning out high-value crops like Dry Chillies.
* **Weather-Aware Feature Engineering:** Integrates Open-Meteo temperature anomalies and lagged rainfall accumulations (`7d`, `14d`, and `21d` lags) alongside rolling price moving averages, momentum, and intraday spreads.
* **Surge Early-Warning System:** Flags commodities as `NORMAL`, `WATCH` (Z-score $\ge$ 1.5), or `CRITICAL_SURGE` (Z-score $\ge$ 2.0) relative to their 30-day rolling price distribution.
* **Zero-Maintenance Automated Pipeline:** A daily GitHub Actions workflow syncs fresh mandi prices and weather every morning at **7:30 AM IST** and retrains both ML models every **Sunday**, pushing updated artifacts for automatic Render redeployment.

---

## Model Performance (Out-of-Time Test Split)

Evaluated strictly on future unseen dates against a persistence baseline (assuming price remains unchanged):

| Horizon | Baseline MAE (₹/Qtl) | HistGBM MAE (₹/Qtl) | MAE Gain | Baseline MAPE | HistGBM MAPE |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **7-Day Forecast** | ₹928.75 | **₹901.24** | **+2.96%** | 25.17% | **23.96%** |
| **14-Day Forecast** | ₹934.14 | **₹927.52** | **+0.71%** | 26.28% | **25.19%** |

*Core commodity 14-day highlights: **Tomato** (+12.81% MAE gain), **Dry Chillies** (+5.77% MAE gain).*

---

## Architecture

```text
data.gov.in (Agmarknet) + Open-Meteo API
                 │
                 ▼  (Daily 07:30 IST via GitHub Actions)
    backend/sync.py  ──►  SQLite (data/food_price_intelligence.db)
                 │
                 ▼
    backend/features.py  ──►  engineered_features (16,173 rows)
                 │
                 ▼  (Weekly Sunday Retrain)
    backend/train.py  ──►  models/price_forecaster_{7d,14d}.joblib
                 │
                 ▼  (Auto-deploy to Render, DISABLE_LIVE_SYNC=true)
    FastAPI (backend/api.py)  ◄──►  React + Vite SPA (frontend/)
```

---

## Tech Stack

* **Backend & ML:** Python, FastAPI, SQLite, Pandas, NumPy, scikit-learn (`HistGradientBoostingRegressor`), Joblib
* **Frontend:** React, Vite, Recharts, Lucide Icons
* **Automation & Hosting:** GitHub Actions (daily data sync + weekly retraining), Render (web hosting)
* **Testing:** `pytest` (security, SPA path traversal, input validation, and sync status regression tests)

---

## Local Development Setup

### 1. Clone & Install Backend Dependencies

```bash
git clone [https://github.com/doondisatyakrishna/food-price-intelligence.git](https://github.com/doondisatyakrishna/food-price-intelligence.git)
cd food-price-intelligence

python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
DATA_GOV_API_KEY=your_data_gov_in_api_key
# Optional: protect POST /api/sync
SYNC_API_KEY=your_optional_sync_secret
# Set to true in production (Render) to rely on GitHub Actions sync
DISABLE_LIVE_SYNC=false
```

### 3. Run the Data & ML Pipeline (Optional)

The repository already ships with the latest SQLite database and trained `.joblib` artifacts. To refresh data and retrain locally:

```bash
python -m backend.sync
python -m backend.features
python -m backend.train
```

### 4. Start the Backend & Frontend

```bash
# Terminal 1 — FastAPI backend ([http://127.0.0.1:8000](http://127.0.0.1:8000))
uvicorn backend.api:app --reload

# Terminal 2 — React + Vite frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

---

## Testing & Verification

```bash
# Backend security & regression tests
python -m pytest -v

# Commodity & district 14-day error diagnostics
python -m backend.eval_commodities

# Frontend lint & production build
cd frontend
npm run lint
npm run build
```

---

## Production Security & Reliability

* **Read-Only Cloud Runtime:** Render runs with `DISABLE_LIVE_SYNC=true` to avoid shared cloud-IP rate limits (`429`) from Open-Meteo and connection blocks from `data.gov.in`.
* **Restricted CORS & Auth:** Origins are allowlisted via `ALLOWED_ORIGINS`, and `POST /api/sync` supports constant-time `X-Sync-Key` validation.
* **Hardened Serving:** SPA static file serving blocks path traversal, API keys are scrubbed from error responses, and missing ML artifacts fail cleanly with `503`.
