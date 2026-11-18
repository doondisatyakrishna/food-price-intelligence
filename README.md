# AgroPulse India — Agricultural Mandi Price Intelligence & Early Warning System

**AgroPulse India** is an end-to-end agricultural market intelligence, weather-lag analytics, and machine learning forecasting platform focused on **Andhra Pradesh**, **Telangana**, and major benchmark supply hubs (**Nashik** and **Kolar**).

It combines multi-year Agmarknet mandi records (`data.gov.in`) with historical and forecast meteorological telemetry (`Open-Meteo`) to detect price volatility surges early, forecast 7-day and 14-day commodity prices, and provide interactive supply-shock simulations through a **Light Green & White Neo-Glassmorphic** React interface.

---

## Key Capabilities

- **Dual-Endpoint Automated Catch-Up Sync (`data.gov.in` + `Open-Meteo`):**
  - Combines `data.gov.in`'s multi-day rolling archive (`35985678-0d79-46b4-9ed6-6f13308a1d24`) with its live daily mandi arrival feed (`9ef84268-d588-465a-a308-a864a43d0070`) using a single permanent API key.
  - Tracks independent per-state and per-region watermarks in SQLite (`WAL` mode) to backfill only missing days on server startup or via a cooldown-protected **Sync Latest Data** trigger.
- **Scale-Invariant 7-Day & 14-Day ML Price Forecasting:**
  - Trains `HistGradientBoostingRegressor` pipelines on percentage returns rather than raw rupee prices so high-value spices (e.g., Dry Chillies at ~₹14,500/Qtl) and daily vegetables (Tomatoes & Onions at ~₹1,800/Qtl) share a unified loss scale.
  - Validated chronologically with a strict temporal embargo gap against a Naive Persistence baseline.
- **30-Day Rolling Z-Score Early-Warning Engine:**
  - Flags abnormal price spikes automatically into `NORMAL` ($Z < 1.5\sigma$), `WATCH` ($1.5\sigma \le Z < 2.0\sigma$), and `CRITICAL_SURGE` ($Z \ge 2.0\sigma$) tiers.
- **Interactive "What-If" Weather & Supply Shock Simulator:**
  - Lets users simulate cumulative 21-day rainfall shocks (`-50 mm` to `+200 mm`) and sudden market price shocks (`-25%` to `+40%`) in memory to inspect real-time shifts in 7-day and 14-day ML forecasts.
- **District & APMC Mandi Price Leaderboard:**
  - Ranks individual reporting mandis on the latest trading day by modal price (₹/Quintal) and calculates inter-mandi price spreads.
- **Standalone Sub-Regional 14-Day Weather Outlook:**
  - Fetches official 14-day forecasts externally from **Open-Meteo** across **6 agro-climatic zones** (*Coastal Andhra*, *Rayalaseema*, *North Telangana*, *South Telangana*, *Nashik*, and *Kolar*) independently of the price ML model to prevent compound forecast error.
- **Production Gateway & Multi-Worker Architecture:**
  - Includes a self-invalidating in-memory TTL cache, sliding-window per-IP rate limiting, worker PID/latency response headers (`X-Worker-PID`, `X-Process-Time-Ms`), and multi-worker load balancing.

---

## System Architecture

```text
food-price-intelligence/
├── backend/
│   ├── __init__.py
│   ├── models.py          # SQLAlchemy ORM schema (markets, commodities, daily_prices, weather_data)
│   ├── sync.py            # Dual data.gov.in + Open-Meteo catch-up sync & 10-min cooldown guard
│   ├── features.py        # Rolling moving averages, 21-day rain lags & Z-score alert engine
│   ├── train.py           # Chronological split + embargo + HistGradientBoosting training
│   ├── api.py             # FastAPI REST endpoints, TTL cache, rate limiter & static React mount
│   ├── load_balancer.py   # Local Windows round-robin proxy across worker ports 8001 & 8002
│   └── requirements.txt   # Backend Python dependencies
├── frontend/
│   ├── public/images/     # Local agricultural & pure-greenery visual assets
│   ├── src/
│   │   ├── api.js         # API client + Load Balancer telemetry header parser
│   │   ├── index.css      # Light Green & White Neo-Glassmorphic design tokens
│   │   ├── App.jsx        # View router, background switcher & sync status poller
│   │   └── components/
│   │       ├── Navbar.jsx
│   │       ├── LandingPage.jsx
│   │       └── DashboardPage.jsx
│   ├── package.json
│   └── vite.config.js
├── data/
│   └── food_price_intelligence.db   # Pre-populated SQLite database (52,600+ raw rows, 74 core series)
├── models/
│   ├── price_forecaster_7d.joblib   # Serialized 7-day forecasting pipeline
│   ├── price_forecaster_14d.joblib  # Serialized 14-day forecasting pipeline
│   └── training_metrics.json        # Out-of-time evaluation report
├── notebooks/             # Exploratory Data Analysis (EDA) notebooks
├── render.yaml            # Render Blueprint for single-service deployment
└── README.md
```

---

## Local Setup & Development

### 1. Prerequisites
- Python 3.11+
- Node.js 18+ and npm
- A free API key from [data.gov.in](https://data.gov.in/)

### 2. Backend Setup
```bash
# Create and activate virtual environment
python -m venv .venv
# Windows PowerShell:
.venv\Scripts\Activate.ps1
# Linux / macOS:
source .venv/bin/activate

# Install Python dependencies
pip install -r backend/requirements.txt
```

Create a `.env` file in the project root:
```env
DATA_GOV_API_KEY="your_data_gov_api_key_here"
```

Start the multi-worker backend:
```bash
# On Windows (runs Round-Robin Load Balancer on :8000 across workers :8001 & :8002):
python backend/load_balancer.py

# On Linux / macOS:
uvicorn backend.api:app --host 127.0.0.1 --port 8000 --workers 2
```

### 3. Frontend Setup (Development Mode)
```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser. Vite automatically proxies `/api/*` and `/health` requests to `[http://127.0.0.1:8000](http://127.0.0.1:8000)`.

### 4. Bi-Weekly (14-Day) Database Update & Retraining
```bash
# 1. Sync latest AP, Telangana, Nashik & Kolar prices + weather and rebuild features
python backend/sync.py

# 2. Flush SQLite WAL journal into the main .db file
python -c "import sqlite3; c = sqlite3.connect('data/food_price_intelligence.db'); c.execute('PRAGMA wal_checkpoint(TRUNCATE);'); c.close()"

# 3. (Optional) Retrain 7-day and 14-day HistGradientBoosting models
python backend/train.py

# 4. Push updated database snapshot to GitHub
git add data/food_price_intelligence.db models/
git commit -m "Bi-weekly sync: update AP & Telangana mandi records"
git push origin main
```

---

## Zero-Cost Deployment on Render

This repository includes a `render.yaml` Blueprint configured to deploy both the React static bundle and the multi-worker FastAPI server inside **one free Render Web Service**:

1. Push this repository to GitHub.
2. Log in to [Render](https://render.com/) and select **New + → Blueprint**.
3. Connect your GitHub repository (`food-price-intelligence`).
4. When prompted for `DATA_GOV_API_KEY`, enter your `data.gov.in` key and click **Apply**.

> **Note on Ephemeral Disk Persistence:** Render's free tier resets local disk writes after 15 minutes of inactivity. On every startup, `backend/api.py` automatically runs a background catch-up sync from the database watermark committed in Git. Running `python backend/sync.py` locally roughly once every 2 weeks and pushing `data/food_price_intelligence.db` keeps your historical baseline continuous inside `data.gov.in`'s rolling archive window.

---

## REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Returns server status, worker PID, model readiness, and sync state |
| `GET` | `/api/catalog` | Returns tracked regions, commodities, date ranges, weather hubs, and ML metrics |
| `GET` | `/api/alerts` | Returns active `CRITICAL_SURGE` and `WATCH` alerts across all series |
| `GET` | `/api/history` | Returns time-series modal prices, moving averages, Z-scores, and rainfall |
| `GET` | `/api/mandis` | Returns individual APMC mandi rankings and inter-mandi price spread for the latest date |
| `GET` | `/api/weather-forecast` | Fetches external 14-day Open-Meteo forecast for a selected agro-climatic hub |
| `POST` | `/api/forecast` | Generates 7-day & 14-day ML price forecasts (supports `What-If` shock parameters) |
| `POST` | `/api/sync` | Triggers a cooldown-protected background catch-up sync |
| `GET` | `/api/sync/status` | Polls live background sync progress and cooldown timer |
