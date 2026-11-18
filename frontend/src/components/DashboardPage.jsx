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
} from 'lucide-react';
import { api } from '../api';

export default function DashboardPage({ catalog, onTelemetry, syncCompletedAt }) {
  const regions = useMemo(() => catalog?.regions || ['Andhra Pradesh', 'Nashik', 'Kolar'], [catalog]);

  const [selectedRegion, setSelectedRegion] = useState('Andhra Pradesh');
  const [selectedCommodity, setSelectedCommodity] = useState('Tomato');
  const [historyLimit, setHistoryLimit] = useState(120);

  const [forecast, setForecast] = useState(null);
  const [history, setHistory] = useState([]);
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

  useEffect(() => {
    let active = true;
    async function loadIntelligence() {
      if (!selectedRegion || !selectedCommodity) return;
      setLoading(true);
      setError('');

      try {
        const [forecastRes, historyRes, alertsRes] = await Promise.all([
          api.getForecast(selectedRegion, selectedCommodity, onTelemetry),
          api.getHistory(selectedRegion, selectedCommodity, historyLimit, onTelemetry),
          api.getAlerts(false, onTelemetry),
        ]);

        let weatherRes = null;
        try {
          weatherRes = await api.getWeatherForecast(selectedRegion, 14, onTelemetry);
        } catch {
          weatherRes = await api.getWeatherForecast('Andhra Pradesh', 14, onTelemetry).catch(() => null);
        }

        if (!active) return;
        setForecast(forecastRes);
        setHistory(historyRes?.data || []);
        setAlerts(alertsRes?.alerts || []);
        setWeather(weatherRes);
      } catch (err) {
        if (active) setError(err.message || 'Failed to load market intelligence.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadIntelligence();
    return () => {
      active = false;
    };
  }, [selectedRegion, selectedCommodity, historyLimit, syncCompletedAt, onTelemetry]);

  const pred7d = forecast?.forecasts?.find((f) => f.horizon_days === 7);
  const pred14d = forecast?.forecasts?.find((f) => f.horizon_days === 14);

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
      {/* Neomorphic Light Filter Bar */}
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
              onChange={(e) => setSelectedRegion(e.target.value)}
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

      {/* 4 Light Neo-Glass KPI Cards */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.2rem',
          marginBottom: '1.5rem',
        }}
      >
        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>
            CURRENT MODAL PRICE
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
              {pred7d.expected_change_pct >= 0 ? (
                <TrendingUp size={15} />
              ) : (
                <TrendingDown size={15} />
              )}
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
              {pred14d.expected_change_pct >= 0 ? (
                <TrendingUp size={15} />
              ) : (
                <TrendingDown size={15} />
              )}
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

      {/* Main Split Deck */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: '1.4rem',
          alignItems: 'start',
        }}
      >
        {/* Left: Price & Rainfall Trajectory Chart + Pure Greenery Field Strip */}
        <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
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

            <div style={{ width: '100%', height: 370 }}>
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

          {/* Pure Greenery Agro-Climatic Context Card (Zero Humans) */}
          <div
            className="glass-panel-mint"
            style={{
              padding: '1.25rem 1.4rem',
              display: 'grid',
              gridTemplateColumns: '180px 1fr',
              gap: '1.25rem',
              alignItems: 'center',
            }}
          >
            <img
              src="/images/greenery-sprouts.jpg"
              alt="Fresh green agricultural crops with no people"
              style={{
                width: '100%',
                height: 115,
                objectFit: 'cover',
                borderRadius: '14px',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            />
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  fontWeight: 800,
                  fontSize: '0.98rem',
                  color: 'var(--text-forest)',
                  marginBottom: '0.35rem',
                }}
              >
                <Sprout size={18} color="var(--emerald-primary)" />
                <span>How Weather &amp; Price Signals Interact</span>
              </div>
              <p style={{ fontSize: '0.86rem', lineHeight: 1.58, color: 'var(--text-body)' }}>
                The chart above overlays daily precipitation bars against modal mandi prices. When
                cumulative 7-day rainfall spikes, rural harvesting and highway transit slow down—often
                pushing prices upward <strong>14 to 21 days later</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Standalone 14-Day Weather Outlook + Active Surge Alerts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
          <div className="glass-panel" style={{ padding: '1.45rem' }}>
            {/* Pure Greenery Field Header Banner (Zero Humans) */}
            <img
              src="/images/greenery-harvest.jpg"
              alt="Lush green agricultural expanse without humans"
              style={{
                width: '100%',
                height: 105,
                objectFit: 'cover',
                borderRadius: '14px',
                marginBottom: '1rem',
                border: '1px solid rgba(16, 185, 129, 0.28)',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.55rem' }}>
              <ThermometerSun size={20} color="var(--emerald-primary)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                14-Day Weather Outlook (Separate)
              </h3>
            </div>

            {weather ? (
              <>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-body)', marginBottom: '0.95rem', lineHeight: 1.5 }}>
                  {weather.outlook_summary}
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.75rem',
                    marginBottom: '0.95rem',
                  }}
                >
                  <div className="neo-inset" style={{ padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      14-DAY EXPECTED RAIN
                    </div>
                    <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 800 }}>
                      {weather.total_expected_rain_mm} mm
                    </div>
                  </div>
                  <div className="neo-inset" style={{ padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                      HEAVY RAIN (&ge;25mm)
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: '1.15rem',
                        fontWeight: 800,
                        color: weather.heavy_rain_days_count > 0 ? '#d97706' : '#059669',
                      }}
                    >
                      {weather.heavy_rain_days_count} Days
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {weather.daily?.slice(0, 5).map((d) => (
                    <div
                      key={d.date}
                      className="neo-inset"
                      style={{
                        padding: '0.52rem 0.85rem',
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
              </>
            ) : (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Loading regional weather forecast...
              </div>
            )}
          </div>

          {/* Active Surge Alerts Card */}
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
                      setSelectedRegion(item.region_name);
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