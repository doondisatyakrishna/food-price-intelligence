# AgroPulse India — Agricultural Mandi Price Intelligence & Early-Warning System

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Render-059669?style=for-the-badge)](https://agropulse-india.onrender.com)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-10b981?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![Automated Sync](https://img.shields.io/badge/Data%20Sync-GitHub%20Actions-065f46?style=for-the-badge&logo=githubactions&logoColor=white)](https://github.com/doondisatyakrishna/food-price-intelligence/actions)

**AgroPulse India** is a full-stack agricultural market intelligence and price forecasting platform built to track APMC mandi prices, detect abnormal price surges, and model weather-driven supply shocks across key Indian horticultural hubs.

**Live Application:** [https://agropulse-india.onrender.com](https://agropulse-india.onrender.com)

---

## Key Capabilities

* **7-Day & 14-Day ML Price Forecasting:** Predicts forward modal prices (`₹/Quintal`) using `joblib`-serialized scikit-learn gradient boosting pipelines trained on lagged price momentum, 30-day rolling volatility, 21-day cumulative rainfall lags, and cyclical day-of-year seasonality.
* **30-Day Surge Early-Warning Engine:** Classifies real-time market conditions into `NORMAL`, `WATCH` ($Z \ge 1.5\sigma$), and `CRITICAL_SURGE` ($Z \ge 2.0\sigma$) based on rolling 30-day volatility Z-scores.
* **Interactive "What-If" Weather & Supply Shock Simulator:** Isolated 60 FPS neomorphic range sliders (`calculate-on-release`) that simulate 21-day cumulative rainfall anomalies (`-50 mm` dry spell to `+200 mm` cyclone rain) and immediate mandi price shocks (`-25%` bumper glut to `+40%` supply crunch) in memory without mutating stored data.
* **14-Day Sub-Regional Meteorological Outlook:** Live weather forecasts via the Open-Meteo API across **6 Indian agro-climatic hubs** (*Coastal Andhra, Rayalaseema, North Telangana, South Telangana, Nashik, and Kolar*), flagging heavy rainfall days ($\ge 25\text{ mm}$) with automatic fallback to historical SQLite baselines.
* **District & APMC Mandi Price Leaderboard:** Ranks individual APMC markets by modal price realization on the latest reporting date, displaying intraday min-to-max price positioning and inter-mandi price spreads (`₹/Qtl`).
* **12-Month Seasonal Harvest & Arrival Cycle:** Visualizes commodity-specific Rabi/Kharif sowing, lean, and peak arrival windows alongside historical price and precipitation trajectories.
* **Automated Weekly Data Synchronization:** Scheduled Sunday GitHub Actions workflow ingests fresh mandi arrivals from `data.gov.in` (Agmarknet) and regional weather observations from Open-Meteo, rebuilds engineered features atomically, and commits the updated SQLite database.

---

## Modular Architecture

```text
food-price-intelligence/
├── .github/
│   └── workflows/                  # Weekly Sunday automated DB sync workflow
├── backend/
│   ├── api.py                      # Slim FastAPI gateway, rate limiter, JSON error handlers & SPA host
│   ├── db.py                       # SQLite WAL connection, 15s busy_timeout & in-memory TTL cache
│   ├── ml_service.py               # Joblib model bundle unwrapper & 7d/14d What-If inference engine
│   ├── weather_service.py          # 6 agro-climatic hubs, Open-Meteo client & SQLite fallback
│   ├── sync_manager.py             # Thread-safe sync state tracker & 10-minute cooldown guard
│   ├── sync.py                     # data.gov.in (Agmarknet) & Open-Meteo ETL ingestion pipeline
│   └── features.py                 # Atomic rolling/lag feature engineering pipeline
├── data/
│   └── food_price_intelligence.db  # Zero-config local SQLite database (WAL mode)
├── frontend/
│   ├── public/
│   │   └── favicon.png             # Custom AgroPulse India branding
│   └── src/
│       ├── api.js                  # REST client with 25s timeout & automatic 502/503 cold-start retry
│       ├── index.css               # Emerald neo-glassmorphic design system & custom sliders
│       └── components/
│           ├── DashboardPage.jsx
│           └── dashboard/
│               ├── WhatIfSimulator.jsx      # Isolated 60 FPS calculate-on-release sliders
│               ├── PriceTrajectoryChart.jsx # Memoized Recharts price & rainfall chart
│               ├── WeatherOutlookCard.jsx   # Sub-regional 14-day weather card
│               ├── CropCalendarCard.jsx     # 12-month seasonal crop arrival grid
│               └── MandiLeaderboard.jsx     # Full-width horizontal APMC leaderboard
├── models/
│   ├── price_forecaster_7d.joblib
│   ├── price_forecaster_14d.joblib
│   └── training_metrics.json
├── render.yaml                     # Single-service Render build & start configuration
└── requirements.txt
```

---

## Production Engineering Highlights

* **Zero-Cost, Single-Service Deployment:** FastAPI serves both the REST API and the compiled React (`frontend/dist`) static bundle from a single Render web service backed by an embedded SQLite database—requiring no external database server.
* **512 MB Memory Optimization:** Defers background catch-up sync by 45 seconds after container boot, runs explicit garbage collection (`gc.collect()`), and uses SQLite `WAL` mode with atomic `DELETE` + `INSERT` feature refreshes so live user queries never collide with background ETL writes.
* **Cold-Start & Upstream Resilience:** Frontend API requests automatically retry transient `502`/`503`/`504` wake-up responses, while the weather service falls back gracefully to cached or observed SQLite records if external weather endpoints throttle shared cloud IPs.

---

## API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Returns database connectivity, loaded ML model status, worker PID, and sync state. |
| `GET` | `/api/catalog` | Lists tracked regions, commodities, date spans, weather hubs, and model MAE metrics. |
| `GET` | `/api/history` | Fetches historical modal prices, 7d/30d moving averages, and daily rainfall (`limit` up to `1500`). |
| `POST` | `/api/forecast` | Runs 7-day and 14-day ML inference with optional `rain_21d_delta_mm` and `price_shock_pct` overrides. |
| `GET` | `/api/weather-forecast` | Returns a 14-day meteorological outlook and heavy-rain risk flags for a selected agro-climatic hub. |
| `GET` | `/api/mandis` | Returns the APMC mandi price leaderboard and inter-mandi price spread (`₹/Qtl`). |
| `GET` | `/api/alerts` | Lists active `CRITICAL_SURGE` and `WATCH` commodities ranked by 30-day volatility Z-score. |
| `POST` | `/api/sync` | Triggers a background catch-up ETL sync (protected by a 10-minute cooldown). |

---

## Local Setup & Development

### 1. Clone & Install Backend Dependencies
```bash
git clone [https://github.com/doondisatyakrishna/food-price-intelligence.git](https://github.com/doondisatyakrishna/food-price-intelligence.git)
cd food-price-intelligence

python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate

pip install -r requirements.txt
```

### 2. Configure Environment Variables (Optional for Live `data.gov.in` Sync)
Create a `.env` file in the project root if you want to run live `data.gov.in` Agmarknet ingestion locally:
```env
DATA_GOV_API_KEY=your_data_gov_in_api_key
```

### 3. Build the Frontend & Start the Server
```bash
cd frontend
npm install
npm run build
cd ..

uvicorn backend.api:app --host 127.0.0.1 --port 8000
```
Open **`http://127.0.0.1:8000`** in your browser to view the dashboard.

---

## Data Sources

* **Agricultural Market Prices:** Open Government Data (OGD) Platform India (`data.gov.in`) — Agmarknet Daily Mandi Price Arrivals.
* **Historical & 14-Day Forecast Weather:** [Open-Meteo](https://open-meteo.com/) Historical Archive & Forecast APIs.