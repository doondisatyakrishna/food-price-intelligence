import React, { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
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

/**
 * Isolated Simulator Component:
 * Keeps slider dragging strictly inside local component state so the rest of
 * the dashboard performs ZERO re-renders while gliding, and commits the
 * calculation the moment the user lets go of the slider.
 */
const WhatIfSimulator = memo(function WhatIfSimulator({
  rainDeltaMm,
  priceShockPct,
  onCommitShock,
}) {
  const [draftRain, setDraftRain] = useState(rainDeltaMm);
  const [draftPrice, setDraftPrice] = useState(priceShockPct);
  const settleTimerRef = useRef(null);

  useEffect(() => {
    setDraftRain(rainDeltaMm);
  }, [rainDeltaMm]);

  useEffect(() => {
    setDraftPrice(priceShockPct);
  }, [priceShockPct]);

  const flushCommit = useCallback(
    (nextRain, nextPrice) => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      onCommitShock(nextRain, nextPrice);
    },
    [onCommitShock]
  );

  // Fallback timer only in case keyboard or accessibility input is used without pointer release
  const scheduleFallbackCommit = (nextRain, nextPrice) => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      onCommitShock(nextRain, nextPrice);
    }, 450);
  };

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  const hasChanges = draftRain !== 0 || draftPrice !== 0 || rainDeltaMm !== 0 || priceShockPct !== 0;

  return (
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
            (Drag and release either slider to recalculate 7d &amp; 14d ML predictions)
          </span>
        </div>

        {hasChanges && (
          <button
            className="neo-button"
            style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
            onClick={() => {
              setDraftRain(0);
              setDraftPrice(0);
              flushCommit(0, 0);
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
              marginBottom: '0.55rem',
            }}
          >
            <span>21-Day Cumulative Rainfall Shock</span>
            <span className="mono" style={{ color: 'var(--emerald-primary)' }}>
              {draftRain >= 0 ? `+${draftRain}` : draftRain} mm
            </span>
          </div>
          <input
            type="range"
            min="-50"
            max="200"
            step="1"
            value={draftRain}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDraftRain(val);
              scheduleFallbackCommit(val, draftPrice);
            }}
            onPointerUp={() => flushCommit(draftRain, draftPrice)}
            onKeyUp={() => flushCommit(draftRain, draftPrice)}
            className="neo-slider"
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              marginTop: '0.4rem',
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
              marginBottom: '0.55rem',
            }}
          >
            <span>Immediate Mandi Price Shock</span>
            <span className="mono" style={{ color: 'var(--emerald-primary)' }}>
              {draftPrice >= 0 ? `+${draftPrice}` : draftPrice}%
            </span>
          </div>
          <input
            type="range"
            min="-25"
            max="40"
            step="1"
            value={draftPrice}
            onChange={(e) => {
              const val = Number(e.target.value);
              setDraftPrice(val);
              scheduleFallbackCommit(draftRain, val);
            }}
            onPointerUp={() => flushCommit(draftRain, draftPrice)}
            onKeyUp={() => flushCommit(draftRain, draftPrice)}
            className="neo-slider"
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              marginTop: '0.4rem',
            }}
          >
            <span>-25% (Bumper Glut)</span>
            <span>0% (Actual)</span>
            <span>+40% (Supply Crunch)</span>
          </div>
        </div>
      </div>
    </section>
  );
});

const PriceTrajectoryChart = memo(function PriceTrajectoryChart({
  history,
  selectedRegion,
  selectedCommodity,
}) {
  return (
    <div className="glass-panel" style={{ padding: '1.55rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1.1rem',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.16rem', fontWeight: 800, color: 'var(--text-forest)' }}>
            {selectedRegion} — {selectedCommodity} Price &amp; Rainfall Trajectory
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            Median Modal Price (₹/Qtl) vs. 30-Day Moving Average &amp; Daily Precipitation (mm)
          </p>
        </div>
        <div className="badge-pill badge-normal">
          <Activity size={13} /> {history.length} Trading Days
        </div>
      </div>

      <div style={{ width: '100%', height: 355 }}>
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
              isAnimationActive={false}
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="median_modal_price"
              name="Modal Price (₹/Qtl)"
              stroke="#059669"
              strokeWidth={2.8}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

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

  // Committed "What-If" Shock Simulator values (updated only when slider is released)
  const [rainDeltaMm, setRainDeltaMm] = useState(0);
  const [priceShockPct, setPriceShockPct] = useState(0);

  const [forecast, setForecast] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

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

  const handleCommitShock = useCallback((nextRain, nextPrice) => {
    setRainDeltaMm(nextRain);
    setPriceShockPct(nextPrice);
  }, []);

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

  // Run ML Forecast once whenever region, commodity, or released slider values change
  useEffect(() => {
    let active = true;
    const isWhatIf = rainDeltaMm !== 0 || priceShockPct !== 0;
    if (isWhatIf) setIsSimulating(true);

    api
      .getForecast(
        selectedRegion,
        selectedCommodity,
        isWhatIf ? null : onTelemetry,
        { rain_21d_delta_mm: rainDeltaMm, price_shock_pct: priceShockPct }
      )
      .then((forecastRes) => {
        if (active) setForecast(forecastRes);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Forecast error.');
      })
      .finally(() => {
        if (active) setIsSimulating(false);
      });

    return () => {
      active = false;
    };
  }, [selectedRegion, selectedCommodity, rainDeltaMm, priceShockPct, syncCompletedAt, onTelemetry]);

  // Load External Open-Meteo 14-Day Weather Forecast
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

  const isWhatIfActive = rainDeltaMm !== 0 || priceShockPct !== 0;
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 22 }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>
              {isWhatIfActive ? 'SIMULATED BASE PRICE' : 'CURRENT MODAL PRICE'}
            </span>
            <span
              className="badge-pill badge-watch"
              style={{
                fontSize: '0.65rem',
                padding: '0.18rem 0.55rem',
                opacity: isWhatIfActive ? 1 : 0,
                transition: 'opacity 0.15s ease',
              }}
            >
              WHAT-IF
            </span>
          </div>
          <div
            className="mono"
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              color: 'var(--text-forest)',
              margin: '0.4rem 0',
              opacity: isSimulating ? 0.55 : 1,
              transition: 'opacity 0.15s ease',
            }}
          >
            {!forecast
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
              opacity: isSimulating ? 0.55 : 1,
              transition: 'opacity 0.15s ease',
            }}
          >
            {!pred7d ? '...' : `₹${pred7d.predicted_price_inr.toLocaleString('en-IN')}`}
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
              opacity: isSimulating ? 0.55 : 1,
              transition: 'opacity 0.15s ease',
            }}
          >
            {!pred14d ? '...' : `₹${pred14d.predicted_price_inr.toLocaleString('en-IN')}`}
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

      {/* 3. Isolated 60-FPS What-If Simulator (Calculates on Release) */}
      <WhatIfSimulator
        rainDeltaMm={rainDeltaMm}
        priceShockPct={priceShockPct}
        onCommitShock={handleCommitShock}
      />

      {/* 4. Balanced 2-Column Upper Analytics Deck */}
      <section className="analytics-split-grid">
        <div className="analytics-col">
          <PriceTrajectoryChart
            history={history}
            selectedRegion={selectedRegion}
            selectedCommodity={selectedCommodity}
          />

          <div className="glass-panel" style={{ padding: '1.45rem 1.6rem', flex: 1 }}>
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
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Seasonal drivers (sin/cos day-of-year)
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
                gap: '0.55rem',
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
                      padding: '0.6rem 0.45rem',
                      textAlign: 'center',
                      boxShadow: isCurrent ? '0 4px 12px rgba(5, 150, 105, 0.25)' : 'none',
                    }}
                  >
                    <div className="mono" style={{ fontWeight: 800, fontSize: '0.78rem' }}>
                      {mName} {isCurrent ? '•' : ''}
                    </div>
                    <div style={{ fontSize: '0.66rem', fontWeight: 700, marginTop: '0.22rem', lineHeight: 1.25 }}>
                      {phase}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="analytics-col">
          <div className="glass-panel" style={{ padding: '1.45rem' }}>
            <img
              src="/images/greenery-harvest.jpg"
              alt="Lush green agricultural expanse without humans"
              style={{
                width: '100%',
                height: 88,
                objectFit: 'cover',
                borderRadius: '14px',
                marginBottom: '0.9rem',
                border: '1px solid rgba(16, 185, 129, 0.28)',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.6rem' }}>
              <ThermometerSun size={20} color="var(--emerald-primary)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                14-Day Meteorological Outlook
              </h3>
            </div>

            <div style={{ marginBottom: '0.8rem' }}>
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
                style={{ width: '100%', fontSize: '0.84rem', padding: '0.55rem 2.2rem 0.55rem 0.85rem' }}
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
                <div
                  className="neo-inset"
                  style={{
                    padding: '0.6rem 0.85rem',
                    marginBottom: '0.8rem',
                    fontSize: '0.75rem',
                    lineHeight: 1.45,
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--text-forest)' }}>
                    Covering: {weather.districts_covered}
                  </div>
                  <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.15rem' }}>
                    Coords: {weather.coordinates?.lat}°N, {weather.coordinates?.lon}°E
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.7rem',
                    marginBottom: '0.8rem',
                  }}
                >
                  <div className="neo-inset" style={{ padding: '0.68rem' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      14-DAY EXPECTED RAIN
                    </div>
                    <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                      {weather.total_expected_rain_mm} mm
                    </div>
                  </div>
                  <div className="neo-inset" style={{ padding: '0.68rem' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      HEAVY RAIN (&ge;25mm)
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: '1.1rem',
                        fontWeight: 800,
                        color: weather.heavy_rain_days_count > 0 ? '#d97706' : '#059669',
                      }}
                    >
                      {weather.heavy_rain_days_count} Days
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.7rem' }}>
                  {weather.daily?.slice(0, 5).map((d) => (
                    <div
                      key={d.date}
                      className="neo-inset"
                      style={{
                        padding: '0.48rem 0.85rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.79rem',
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
                  <span>External forecast via Open-Meteo API</span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Loading regional weather forecast...
              </div>
            )}
          </div>

          <div className="glass-panel" style={{ padding: '1.45rem', flex: 1 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.85rem',
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
                style={{ padding: '1rem', fontSize: '0.84rem', color: 'var(--text-body)', lineHeight: 1.5 }}
              >
                All tracked commodities are currently within normal 30-day volatility bands.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {alerts.slice(0, 4).map((item) => (
                  <div
                    key={`${item.region_name}-${item.commodity}`}
                    onClick={() => {
                      handleRegionChange(item.region_name);
                      setSelectedCommodity(item.commodity);
                    }}
                    className="neo-inset"
                    style={{
                      padding: '0.7rem 0.9rem',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-forest)' }}>
                        {item.commodity}{' '}
                        <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                          ({item.region_name})
                        </span>
                      </div>
                      <div className="mono" style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 700 }}>
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

      {/* 5. Full-Width Horizontal District & Mandi Price Leaderboard */}
      <section className="glass-panel" style={{ padding: '1.6rem 1.8rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginBottom: '1.1rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              <Store size={20} color="var(--emerald-primary)" />
              <h3 style={{ fontSize: '1.14rem', fontWeight: 800, color: 'var(--text-forest)' }}>
                District &amp; Mandi Price Leaderboard ({selectedRegion} • {selectedCommodity})
              </h3>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Individual APMC realizations on latest reporting date ({mandisData?.latest_date || 'N/A'}) •{' '}
              {mandisData?.mandi_count || 0} active markets reporting
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {mandisData?.spread_inr > 0 && (
              <div className="badge-pill badge-watch">
                Inter-Mandi Spread: ₹{mandisData.spread_inr.toLocaleString('en-IN')}/Qtl
              </div>
            )}
          </div>
        </div>

        {!mandisData || mandisData.mandis?.length === 0 ? (
          <div className="neo-inset" style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            No individual APMC breakdown available for this selection.
          </div>
        ) : (
          <div className="neo-inset" style={{ overflowX: 'auto', padding: '0.5rem' }}>
            <table className="mandi-table">
              <thead>
                <tr>
                  <th style={{ width: '70px' }}>Rank</th>
                  <th>APMC Mandi</th>
                  <th>District</th>
                  <th>Min (₹/Qtl)</th>
                  <th>Max (₹/Qtl)</th>
                  <th>Intraday Position</th>
                  <th style={{ textAlign: 'right' }}>Modal Price</th>
                </tr>
              </thead>
              <tbody>
                {mandisData.mandis.slice(0, 12).map((m, idx) => {
                  const minP = Number(m.min_price_inr);
                  const maxP = Number(m.max_price_inr);
                  const modP = Number(m.modal_price_inr);
                  const pctPos =
                    maxP > minP ? Math.min(95, Math.max(5, ((modP - minP) / (maxP - minP)) * 100)) : 50;

                  return (
                    <tr key={`${m.market_name}-${m.district}`}>
                      <td className="mono" style={{ fontWeight: 800, color: 'var(--emerald-primary)' }}>
                        #{idx + 1}
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--text-forest)' }}>{m.market_name}</td>
                      <td style={{ fontWeight: 600 }}>{m.district}</td>
                      <td className="mono">₹{minP.toLocaleString('en-IN')}</td>
                      <td className="mono">₹{maxP.toLocaleString('en-IN')}</td>
                      <td>
                        <div className="range-track" title={`Modal ₹${modP} within ₹${minP}–₹${maxP}`}>
                          <div className="range-dot" style={{ left: `${pctPos}%` }} />
                        </div>
                      </td>
                      <td
                        className="mono"
                        style={{ textAlign: 'right', fontWeight: 800, color: '#059669', fontSize: '0.92rem' }}
                      >
                        ₹{modP.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}