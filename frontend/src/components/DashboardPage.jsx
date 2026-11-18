import React, { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CloudRain,
  ThermometerSun,
  Calendar,
  Activity,
  ShieldCheck,
  Sprout,
  MapPin,
  Sliders,
  RotateCcw,
  Store,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api';

// Seasonal crop calendar profiles (Jan = 0 ... Dec = 11) for Indian Kharif/Rabi cycles
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CROP_CALENDARS = {
  Tomato: [
    'Peak Rabi Arrival', 'Peak Rabi Arrival', 'Moderate Supply', 'Summer Lean',
    'Summer Lean', 'Kharif Sowing', 'Growing Phase', 'Early Kharif',
    'Monsoon Risk', 'Late Kharif', 'Peak Arrival', 'Peak Arrival',
  ],
  Onion: [
    'Late Kharif Arrival', 'Rabi Harvest', 'Peak Rabi Arrival', 'Peak Storage',
    'Moderate Supply', 'Kharif Sowing', 'Growing Phase', 'Lean Storage',
    'Lean Storage (Firm)', 'Early Kharif', 'Kharif Arrival', 'Moderate Supply',
  ],
  'Dry Chillies': [
    'New Crop Start', 'Peak Harvest', 'Peak Harvest', 'Cold Storage',
    'Cold Storage', 'Sowing Prep', 'Kharif Sowing', 'Growing Phase',
    'Growing Phase', 'Flowering / Rain Risk', 'Lean Supply', 'Early Picking',
  ],
  Turmeric: [
    'Harvest Prep', 'Peak Harvest', 'Peak Harvest', 'Peak Arrivals',
    'Storage Phase', 'Kharif Planting', 'Growing Phase', 'Growing Phase',
    'Growing Phase', 'Maturation', 'Lean Supply', 'Lean Supply',
  ],
  DEFAULT: [
    'Rabi Arrivals', 'Peak Rabi', 'Moderate Supply', 'Summer Lean',
    'Pre-Monsoon', 'Kharif Sowing', 'Monsoon Growth', 'Monsoon Growth',
    'Late Monsoon', 'Kharif Harvest', 'Peak Arrivals', 'Rabi Sowing',
  ],
};

function getPhaseStyle(phase) {
  if (phase.includes('Peak')) {
    return { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' };
  }
  if (phase.includes('Lean') || phase.includes('Risk')) {
    return { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' };
  }
  return { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' };
}

export default function DashboardPage({ catalog, onTelemetry, syncCompletedAt }) {
  const regions = useMemo(
    () => catalog?.regions || ['Andhra Pradesh', 'Telangana', 'Nashik', 'Kolar'],
    [catalog]
  );

  const weatherHubs = useMemo(
    () =>
      catalog?.weather_hubs || [
        { id: 'Coastal Andhra', label: 'Coastal Andhra (Guntur / Amaravati)', districts: 'Guntur, Krishna, Bapatla, Nellore', lat: 16.31, lon: 80.44 },
        { id: 'Rayalaseema', label: 'Rayalaseema (Kurnool / Madanapalle)', districts: 'Kurnool, Chittoor, Anantapur', lat: 15.83, lon: 78.04 },
        { id: 'North Telangana', label: 'North Telangana (Nizamabad / Warangal)', districts: 'Nizamabad, Warangal, Karimnagar', lat: 18.67, lon: 78.09 },
        { id: 'South Telangana', label: 'South Telangana (Khammam / Nalgonda)', districts: 'Khammam, Nalgonda, Suryapet', lat: 17.25, lon: 80.15 },
        { id: 'Nashik', label: 'Nashik Hub (North Maharashtra)', districts: 'Lasalgaon, Pimpalgaon, Nashik', lat: 20.0, lon: 73.79 },
        { id: 'Kolar', label: 'Kolar Hub (South Karnataka)', districts: 'Kolar, Chikkaballapur', lat: 13.14, lon: 78.13 },
      ],
    [catalog]
  );

  const [selectedRegion, setSelectedRegion] = useState('Andhra Pradesh');
  const [selectedCommodity, setSelectedCommodity] = useState('Tomato');
  const [selectedWeatherHub, setSelectedWeatherHub] = useState('Coastal Andhra');
  const [historyLimit, setHistoryLimit] = useState(120);

  // "What-If" Shock Simulator state
  const [rainDeltaMm, setRainDeltaMm] = useState(0);
  const [priceShockPct, setPriceShockPct] = useState(0);

  const [forecast, setForecast] = useState(null);
  const [history, setHistory] = useState([]);
  const [mandisData, setMandisData] = useState(null);
  const [weather, setWeather] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const availableCommodities = useMemo(() => {
    if (!catalog?.series) return ['Tomato', 'Onion', 'Dry Chillies'];
    const filtered = catalog.series
      .filter((s) => s.region_name === selectedRegion)
      .map((s) => s.commodity);
    return filtered.length > 0 ? filtered : ['Tomato'];
  }, [catalog, selectedRegion]);

  // Keep selectedCommodity valid and auto-align default sub-regional weather hub when region changes
  useEffect(() => {
    if (availableCommodities.length > 0 && !availableCommodities.includes(selectedCommodity)) {
      setSelectedCommodity(availableCommodities[0]);
    }
  }, [availableCommodities, selectedCommodity]);

  const handleRegionChange = (newRegion) => {
    setSelectedRegion(newRegion);
    const mappedHub = catalog?.default_hub_by_region?.[newRegion];
    if (mappedHub) {
      setSelectedWeatherHub(mappedHub);
    } else if (newRegion === 'Telangana') {
      setSelectedWeatherHub('North Telangana');
    } else if (newRegion === 'Andhra Pradesh') {
      setSelectedWeatherHub('Coastal Andhra');
    } else {
      setSelectedWeatherHub(newRegion);
    }
  };

  // Load historical series, mandi leaderboard, and surge alerts
  useEffect(() => {
    let active = true;
    async function loadMarketData() {
      if (!selectedRegion || !selectedCommodity) return;
      setLoading(true);
      setError('');

      try {
        const [historyRes, mandisRes, alertsRes] = await Promise.all([
          api.getHistory(selectedRegion, selectedCommodity, historyLimit, onTelemetry),
          api.getMandiLeaderboard(selectedRegion, selectedCommodity, onTelemetry),
          api.getAlerts(false, onTelemetry),
        ]);

        if (!active) return;
        setHistory(historyRes?.data || []);
        setMandisData(mandisRes);
        setAlerts(alertsRes?.alerts || []);
      } catch (err) {
        if (active) setError(err.message || 'Failed to load market intelligence.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadMarketData();
    return () => {
      active = false;
    };
  }, [selectedRegion, selectedCommodity, historyLimit, syncCompletedAt, onTelemetry]);

  // Load ML Forecast separately so "What-If" sliders update predictions rapidly without reloading charts
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const forecastRes = await api.getForecast(
          selectedRegion,
          selectedCommodity,
          onTelemetry,
          { rain_21d_delta_mm: rainDeltaMm, price_shock_pct: priceShockPct }
        );
        if (active) setForecast(forecastRes);
      } catch (err) {
        if (active) setError(err.message || 'Forecast error.');
      }
    }, 120);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedRegion, selectedCommodity, rainDeltaMm, priceShockPct, syncCompletedAt, onTelemetry]);

  // Load External Open-Meteo 14-Day Weather Forecast for the explicitly chosen Weather Zone
  useEffect(() => {
    let active = true;
    api
      .getWeatherForecast(selectedWeatherHub, 14, onTelemetry)
      .then((res) => {
        if (active) setWeather(res);
      })
      .catch(() => {
        if (active) setWeather(null);
      });
    return () => {
      active = false;
    };
  }, [selectedWeatherHub, onTelemetry]);

  const pred7d = forecast?.forecasts?.find((f) => f.horizon_days === 7);
  const pred14d = forecast?.forecasts?.find((f) => f.horizon_days === 14);

  const seasonalSchedule = CROP_CALENDARS[selectedCommodity] || CROP_CALENDARS.DEFAULT;
  const activeMonthIndex = forecast?.reference_date
    ? new Date(forecast.reference_date).getMonth()
    : new Date().getMonth();

  const renderAlertBadge = (status) => {
    if (status === 'CRITICAL_SURGE') {
      return (
        <span className="badge-pill badge-surge">
          <AlertTriangle size={13} /> CRITICAL SURGE
        </span>
      );
    }
    if (status === 'WATCH') {
      return (
        <span className="badge-pill badge-watch">
          <AlertTriangle size={13} /> WATCH
        </span>
      );
    }
    return (
      <span className="badge-pill badge-normal">
        <ShieldCheck size={13} /> NORMAL
      </span>
    );
  };

  return (
    <main className="container" style={{ paddingTop: '1.2rem', paddingBottom: '3.5rem' }}>
      {/* 1. Neomorphic Control & Filter Bar */}
      <section
        className="glass-panel"
        style={{
          padding: '1.15rem 1.45rem',
          marginBottom: '1.4rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem' }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.72rem',
                color: 'var(--emerald-primary)',
                marginBottom: '0.3rem',
                fontWeight: 800,
              }}
            >
              STATE / MANDI HUB
            </label>
            <select
              className="neo-select"
              value={selectedRegion}
              onChange={(e) => handleRegionChange(e.target.value)}
            >
              {regions.map((reg) => (
                <option key={reg} value={reg}>
                  {reg}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.72rem',
                color: 'var(--emerald-primary)',
                marginBottom: '0.3rem',
                fontWeight: 800,
              }}
            >
              COMMODITY
            </label>
            <select
              className="neo-select"
              value={selectedCommodity}
              onChange={(e) => setSelectedCommodity(e.target.value)}
            >
              {availableCommodities.map((comm) => (
                <option key={comm} value={comm}>
                  {comm}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: '0.72rem',
                color: 'var(--emerald-primary)',
                marginBottom: '0.3rem',
                fontWeight: 800,
              }}
            >
              CHART WINDOW
            </label>
            <select
              className="neo-select"
              value={historyLimit}
              onChange={(e) => setHistoryLimit(Number(e.target.value))}
            >
              <option value={60}>Last 60 Trading Days</option>
              <option value={120}>Last 120 Trading Days</option>
              <option value={250}>Last 1 Year (~250 Days)</option>
              <option value={600}>Full Multi-Year Span</option>
            </select>
          </div>
        </div>

        {/* Reference Date & 21-Day Rainfall Lag Pill */}
        {forecast && (
          <div
            className="neo-inset"
            style={{
              padding: '0.72rem 1.15rem',
              display: 'flex',
              alignItems: 'center',
              gap: '1.15rem',
              fontSize: '0.83rem',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Calendar size={15} color="var(--emerald-primary)" />
              <span style={{ color: 'var(--text-muted)' }}>Latest Quote:</span>
              <strong className="mono">{forecast.reference_date}</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CloudRain size={15} color="var(--emerald-primary)" />
              <span style={{ color: 'var(--text-muted)' }}>21d Lag Rain:</span>
              <strong className="mono">{forecast.rain_lag_21d_mm ?? 0} mm</strong>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div
          className="glass-panel"
          style={{
            padding: '1rem 1.4rem',
            marginBottom: '1.4rem',
            outlineColor: 'rgba(220, 38, 38, 0.5)',
            color: '#991b1b',
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {/* 2. 4 Light Neo-Glass KPI Cards */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.2rem',
          marginBottom: '1.4rem',
        }}
      >
        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>
              {forecast?.is_simulated ? 'SIMULATED BASE PRICE' : 'CURRENT MODAL PRICE'}
            </span>
            {forecast?.is_simulated && (
              <span className="badge-pill badge-watch" style={{ fontSize: '0.65rem', padding: '0.2rem 0.55rem' }}>
                WHAT-IF
              </span>
            )}
          </div>
          <div
            className="mono"
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              color: 'var(--text-forest)',
              margin: '0.4rem 0',
            }}
          >
            {loading || !forecast
              ? '...'
              : `₹${forecast.current_modal_price_inr.toLocaleString('en-IN')}`}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Per Quintal (100 kg) • {selectedRegion}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>
            7-DAY ML FORECAST
          </div>
          <div
            className="mono"
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              color: 'var(--text-forest)',
              margin: '0.4rem 0',
            }}
          >
            {loading || !pred7d
              ? '...'
              : `₹${pred7d.predicted_price_inr.toLocaleString('en-IN')}`}
          </div>
          {pred7d && (
            <div
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: pred7d.expected_change_pct >= 0 ? '#059669' : '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              {pred7d.expected_change_pct >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              <span>
                {pred7d.expected_change_pct >= 0 ? '+' : ''}
                {pred7d.expected_change_pct}% (MAE ±₹{pred7d.model_mae_inr})
              </span>
            </div>
          )}
        </div>

        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>
            14-DAY ML FORECAST
          </div>
          <div
            className="mono"
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              color: 'var(--text-forest)',
              margin: '0.4rem 0',
            }}
          >
            {loading || !pred14d
              ? '...'
              : `₹${pred14d.predicted_price_inr.toLocaleString('en-IN')}`}
          </div>
          {pred14d && (
            <div
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: pred14d.expected_change_pct >= 0 ? '#059669' : '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              {pred14d.expected_change_pct >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              <span>
                {pred14d.expected_change_pct >= 0 ? '+' : ''}
                {pred14d.expected_change_pct}% (MAE ±₹{pred14d.model_mae_inr})
              </span>
            </div>
          )}
        </div>

        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>
            30-DAY SURGE ALERT STATUS
          </div>
          <div style={{ margin: '0.62rem 0' }}>
            {forecast ? renderAlertBadge(forecast.alert_status) : '...'}
          </div>
          <div className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Volatility Z-Score:{' '}
            <strong style={{ color: 'var(--text-forest)' }}>
              {forecast?.price_zscore_30d !== null && forecast?.price_zscore_30d !== undefined
                ? `${forecast.price_zscore_30d > 0 ? '+' : ''}${forecast.price_zscore_30d}σ`
                : 'N/A'}
            </strong>
          </div>
        </div>
      </section>

      {/* 3. Interactive "What-If" Weather & Price Shock Simulator */}
      <section className="glass-panel-mint" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.4rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
            <Sliders size={18} color="var(--emerald-primary)" />
            <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-forest)' }}>
              &ldquo;What-If&rdquo; Weather &amp; Supply Shock Simulator
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              (Test how cyclones or sudden market spikes shift the 7d &amp; 14d ML predictions)
            </span>
          </div>

          {(rainDeltaMm !== 0 || priceShockPct !== 0) && (
            <button
              className="neo-button"
              style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
              onClick={() => {
                setRainDeltaMm(0);
                setPriceShockPct(0);
              }}
            >
              <RotateCcw size={14} />
              <span>Reset to Live Data</span>
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.4rem',
          }}
        >
          <div className="neo-inset" style={{ padding: '0.95rem 1.15rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.82rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
              }}
            >
              <span>21-Day Cumulative Rainfall Shock</span>
              <span className="mono" style={{ color: 'var(--emerald-primary)' }}>
                {rainDeltaMm >= 0 ? `+${rainDeltaMm}` : rainDeltaMm} mm
              </span>
            </div>
            <input
              type="range"
              min="-50"
              max="200"
              step="10"
              value={rainDeltaMm}
              onChange={(e) => setRainDeltaMm(Number(e.target.value))}
              className="neo-slider"
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                marginTop: '0.35rem',
              }}
            >
              <span>-50mm (Dry Spell)</span>
              <span>0mm (Actual)</span>
              <span>+200mm (Cyclone Rain)</span>
            </div>
          </div>

          <div className="neo-inset" style={{ padding: '0.95rem 1.15rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.82rem',
                fontWeight: 700,
                marginBottom: '0.5rem',
              }}
            >
              <span>Immediate Mandi Price Shock</span>
              <span className="mono" style={{ color: 'var(--emerald-primary)' }}>
                {priceShockPct >= 0 ? `+${priceShockPct}` : priceShockPct}%
              </span>
            </div>
            <input
              type="range"
              min="-25"
              max="40"
              step="5"
              value={priceShockPct}
              onChange={(e) => setPriceShockPct(Number(e.target.value))}
              className="neo-slider"
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                marginTop: '0.35rem',
              }}
            >
              <span>-25% (Bumper Glut)</span>
              <span>0% (Actual)</span>
              <span>+40% (Supply Crunch)</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Main Split Deck */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '1.4rem',
          alignItems: 'start',
        }}
      >
        {/* Left Column (Spans 2): Price Chart + Seasonal Calendar + Mandi Leaderboard */}
        <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
          {/* Historical Chart */}
          <div className="glass-panel" style={{ padding: '1.6rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginBottom: '1.2rem',
              }}
            >
              <div>
                <h2 style={{ fontSize: '1.18rem', fontWeight: 800, color: 'var(--text-forest)' }}>
                  {selectedRegion} — {selectedCommodity} Price &amp; Rainfall Trajectory
                </h2>
                <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>
                  Median Modal Price (₹/Qtl) vs. 30-Day Moving Average &amp; Daily Precipitation (mm)
                </p>
              </div>
              <div className="badge-pill badge-normal">
                <Activity size={13} /> {history.length} Trading Days
              </div>
            </div>

            <div style={{ width: '100%', height: 350 }}>
              <ResponsiveContainer>
                <ComposedChart data={history} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(6, 55, 38, 0.1)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#52796a', fontSize: 11, fontWeight: 600 }}
                    minTickGap={32}
                  />
                  <YAxis
                    yAxisId="price"
                    tick={{ fill: '#065f46', fontSize: 11, fontWeight: 700 }}
                    tickFormatter={(val) => `₹${val}`}
                  />
                  <YAxis
                    yAxisId="rain"
                    orientation="right"
                    tick={{ fill: '#0284c7', fontSize: 11, fontWeight: 600 }}
                    tickFormatter={(val) => `${val}mm`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.96)',
                      border: '1px solid #6ee7b7',
                      borderRadius: '14px',
                      color: '#063726',
                      boxShadow: '0 10px 25px rgba(6, 55, 38, 0.12)',
                    }}
                  />
                  <Legend />
                  <Bar
                    yAxisId="rain"
                    dataKey="precipitation_mm"
                    name="Rainfall (mm)"
                    fill="rgba(14, 165, 233, 0.35)"
                    barSize={6}
                  />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="price_ma_30d"
                    name="30d Moving Avg (₹)"
                    stroke="#d97706"
                    strokeWidth={2.2}
                    dot={false}
                  />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="median_modal_price"
                    name="Modal Price (₹/Qtl)"
                    stroke="#059669"
                    strokeWidth={2.8}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 12-Month Seasonal Harvest & Arrival Calendar Strip */}
          <div className="glass-panel" style={{ padding: '1.45rem 1.6rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <Sprout size={19} color="var(--emerald-primary)" />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-forest)' }}>
                  12-Month Seasonal Harvest &amp; Arrival Cycle — {selectedCommodity}
                </h3>
              </div>
              <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Explains seasonal ML drivers (sin/cos day-of-year)
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))',
                gap: '0.5rem',
              }}
            >
              {MONTHS.map((mName, idx) => {
                const phase = seasonalSchedule[idx];
                const st = getPhaseStyle(phase);
                const isCurrent = idx === activeMonthIndex;

                return (
                  <div
                    key={mName}
                    style={{
                      backgroundColor: st.bg,
                      color: st.color,
                      border: isCurrent ? '2px solid #059669' : `1px solid ${st.border}`,
                      borderRadius: '12px',
                      padding: '0.55rem 0.45rem',
                      textAlign: 'center',
                      boxShadow: isCurrent ? '0 4px 12px rgba(5, 150, 105, 0.25)' : 'none',
                    }}
                  >
                    <div className="mono" style={{ fontWeight: 800, fontSize: '0.78rem' }}>
                      {mName} {isCurrent ? '•' : ''}
                    </div>
                    <div style={{ fontSize: '0.66rem', fontWeight: 700, marginTop: '0.2rem', lineHeight: 1.25 }}>
                      {phase}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live District & Mandi Price Leaderboard ("Where to Sell Today") */}
          <div className="glass-panel" style={{ padding: '1.5rem 1.6rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                marginBottom: '1rem',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <Store size={19} color="var(--emerald-primary)" />
                  <h3 style={{ fontSize: '1.08rem', fontWeight: 800, color: 'var(--text-forest)' }}>
                    District &amp; Mandi Price Leaderboard ({selectedRegion} • {selectedCommodity})
                  </h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  Individual APMC realizations on latest reporting date ({mandisData?.latest_date || 'N/A'})
                </p>
              </div>

              {mandisData?.spread_inr > 0 && (
                <div className="badge-pill badge-watch">
                  Mandi Spread: ₹{mandisData.spread_inr.toLocaleString('en-IN')}/Qtl
                </div>
              )}
            </div>

            {!mandisData || mandisData.mandis?.length === 0 ? (
              <div className="neo-inset" style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                No individual APMC breakdown available for this selection.
              </div>
            ) : (
              <div className="neo-inset" style={{ overflowX: 'auto', padding: '0.35rem' }}>
                <table className="mandi-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>APMC Mandi</th>
                      <th>District</th>
                      <th>Min (₹/Qtl)</th>
                      <th>Max (₹/Qtl)</th>
                      <th>Modal Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mandisData.mandis.slice(0, 10).map((m, idx) => (
                      <tr key={`${m.market_name}-${m.district}`}>
                        <td className="mono" style={{ fontWeight: 800, color: 'var(--emerald-primary)' }}>
                          #{idx + 1}
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--text-forest)' }}>{m.market_name}</td>
                        <td>{m.district}</td>
                        <td className="mono">₹{Number(m.min_price_inr).toLocaleString('en-IN')}</td>
                        <td className="mono">₹{Number(m.max_price_inr).toLocaleString('en-IN')}</td>
                        <td className="mono" style={{ fontWeight: 800, color: '#059669' }}>
                          ₹{Number(m.modal_price_inr).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Sub-Regional 14-Day Weather Outlook + Active Surge Alerts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
          {/* Standalone 14-Day Weather Outlook with Explicit Location Selector */}
          <div className="glass-panel" style={{ padding: '1.45rem' }}>
            <img
              src="/images/greenery-harvest.jpg"
              alt="Lush green agricultural expanse without humans"
              style={{
                width: '100%',
                height: 100,
                objectFit: 'cover',
                borderRadius: '14px',
                marginBottom: '1rem',
                border: '1px solid rgba(16, 185, 129, 0.28)',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.65rem' }}>
              <ThermometerSun size={20} color="var(--emerald-primary)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                14-Day Meteorological Outlook
              </h3>
            </div>

            {/* Explicit Sub-Regional Weather Location Selector */}
            <div style={{ marginBottom: '0.85rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.7rem',
                  color: 'var(--emerald-primary)',
                  fontWeight: 800,
                  marginBottom: '0.3rem',
                }}
              >
                <MapPin size={13} />
                <span>WEATHER LOCATION / AGRO-CLIMATIC ZONE</span>
              </label>
              <select
                className="neo-select"
                style={{ width: '100%', fontSize: '0.84rem', padding: '0.58rem 2.2rem 0.58rem 0.85rem' }}
                value={selectedWeatherHub}
                onChange={(e) => setSelectedWeatherHub(e.target.value)}
              >
                {weatherHubs.map((hub) => (
                  <option key={hub.id} value={hub.id}>
                    {hub.label}
                  </option>
                ))}
              </select>
            </div>

            {weather ? (
              <>
                {/* Exact Location & Coordinates Pill */}
                <div
                  className="neo-inset"
                  style={{
                    padding: '0.65rem 0.85rem',
                    marginBottom: '0.85rem',
                    fontSize: '0.76rem',
                    lineHeight: 1.45,
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--text-forest)' }}>
                    Covering: {weather.districts_covered}
                  </div>
                  <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.71rem', marginTop: '0.2rem' }}>
                    Coords: {weather.coordinates?.lat}°N, {weather.coordinates?.lon}°E
                  </div>
                </div>

                <p style={{ fontSize: '0.84rem', color: 'var(--text-body)', marginBottom: '0.9rem', lineHeight: 1.5 }}>
                  {weather.outlook_summary}
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.75rem',
                    marginBottom: '0.9rem',
                  }}
                >
                  <div className="neo-inset" style={{ padding: '0.72rem' }}>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      14-DAY EXPECTED RAIN
                    </div>
                    <div className="mono" style={{ fontSize: '1.12rem', fontWeight: 800 }}>
                      {weather.total_expected_rain_mm} mm
                    </div>
                  </div>
                  <div className="neo-inset" style={{ padding: '0.72rem' }}>
                    <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      HEAVY RAIN (&ge;25mm)
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: '1.12rem',
                        fontWeight: 800,
                        color: weather.heavy_rain_days_count > 0 ? '#d97706' : '#059669',
                      }}
                    >
                      {weather.heavy_rain_days_count} Days
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.75rem' }}>
                  {weather.daily?.slice(0, 5).map((d) => (
                    <div
                      key={d.date}
                      className="neo-inset"
                      style={{
                        padding: '0.5rem 0.85rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                      }}
                    >
                      <span className="mono">{d.date.slice(5)}</span>
                      <span>
                        {d.temp_min_c}°–{d.temp_max_c}°C
                      </span>
                      <span
                        className="mono"
                        style={{
                          color: d.precipitation_mm >= 25 ? '#dc2626' : '#0284c7',
                          fontWeight: 700,
                        }}
                      >
                        {d.precipitation_mm} mm
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    fontSize: '0.71rem',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <ExternalLink size={12} />
                  <span>External forecast via Open-Meteo Meteorological API</span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Loading regional weather forecast...
              </div>
            )}
          </div>

          {/* Pure Greenery Agro-Climatic Context Card (Zero Humans) */}
          <div className="glass-panel-mint" style={{ padding: '1.25rem' }}>
            <img
              src="/images/greenery-sprouts.jpg"
              alt="Fresh green crops with zero humans"
              style={{
                width: '100%',
                height: 95,
                objectFit: 'cover',
                borderRadius: '12px',
                marginBottom: '0.85rem',
                border: '1px solid rgba(16, 185, 129, 0.28)',
              }}
            />
            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-forest)', marginBottom: '0.3rem' }}>
              Why Weather &amp; Price Models Stay Separate
            </div>
            <p style={{ fontSize: '0.8rem', lineHeight: 1.55, color: 'var(--text-body)' }}>
              Our ML price models rely strictly on <strong>observed historical rainfall</strong>{' '}
              (up to 21-day lags), while the 14-day outlook above comes directly from Open-Meteo
              so weather forecast errors never compound into price predictions.
            </p>
          </div>

          {/* Active Early-Warning Surge Alerts */}
          <div className="glass-panel" style={{ padding: '1.45rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.9rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <AlertTriangle size={19} color="#d97706" />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Active Surge Alerts</h3>
              </div>
              <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--emerald-primary)', fontWeight: 700 }}>
                {alerts.length} Flagged
              </span>
            </div>

            {alerts.length === 0 ? (
              <div
                className="neo-inset"
                style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--text-body)' }}
              >
                All tracked commodities are currently within normal 30-day volatility bands.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {alerts.slice(0, 5).map((item) => (
                  <div
                    key={`${item.region_name}-${item.commodity}`}
                    onClick={() => {
                      handleRegionChange(item.region_name);
                      setSelectedCommodity(item.commodity);
                    }}
                    className="neo-inset"
                    style={{
                      padding: '0.75rem 0.95rem',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-forest)' }}>
                        {item.commodity}{' '}
                        <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                          ({item.region_name})
                        </span>
                      </div>
                      <div className="mono" style={{ fontSize: '0.78rem', color: 'var(--emerald-primary)', fontWeight: 700 }}>
                        ₹{Number(item.median_modal_price).toLocaleString('en-IN')}/Qtl • Z=
                        {item.price_zscore_30d}σ
                      </div>
                    </div>
                    {renderAlertBadge(item.alert_status)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}