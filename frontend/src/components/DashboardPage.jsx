import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CloudRain,
  Calendar,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api';
import WhatIfSimulator from './dashboard/WhatIfSimulator';
import PriceTrajectoryChart from './dashboard/PriceTrajectoryChart';
import WeatherOutlookCard from './dashboard/WeatherOutlookCard';
import CropCalendarCard from './dashboard/CropCalendarCard';
import MandiLeaderboard from './dashboard/MandiLeaderboard';

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

  const [rainDeltaMm, setRainDeltaMm] = useState(0);
  const [priceShockPct, setPriceShockPct] = useState(0);

  const [forecast, setForecast] = useState(null);
  const [completedForecastKey, setCompletedForecastKey] = useState('');
  const [history, setHistory] = useState([]);
  const [mandisData, setMandisData] = useState(null);
  const [weather, setWeather] = useState(null);
  const [weatherError, setWeatherError] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');

  const availableCommodities = useMemo(() => {
    if (!catalog?.series) return ['Tomato', 'Onion', 'Dry Chillies'];
    const filtered = catalog.series
      .filter((s) => s.region_name === selectedRegion)
      .map((s) => s.commodity);
    return filtered.length > 0 ? filtered : ['Tomato'];
  }, [catalog, selectedRegion]);

  // Derived active commodity avoids cascading setState inside useEffect
  const effectiveCommodity = availableCommodities.includes(selectedCommodity)
    ? selectedCommodity
    : availableCommodities[0] || 'Tomato';

  const handleRegionChange = useCallback(
    (newRegion) => {
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
    },
    [catalog]
  );

  const handleCommitShock = useCallback((nextRain, nextPrice) => {
    setRainDeltaMm(nextRain);
    setPriceShockPct(nextPrice);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadMarketData() {
      if (!selectedRegion || !effectiveCommodity) return;
      try {
        const [historyRes, mandisRes, alertsRes] = await Promise.all([
          api.getHistory(selectedRegion, effectiveCommodity, historyLimit, onTelemetry),
          api.getMandiLeaderboard(selectedRegion, effectiveCommodity, onTelemetry),
          api.getAlerts(false, onTelemetry),
        ]);
        if (!active) return;
        setError('');
        setHistory(historyRes?.data || []);
        setMandisData(mandisRes);
        setAlerts(alertsRes?.alerts || []);
      } catch (err) {
        if (active) setError(err.message || 'Failed to load market intelligence.');
      }
    }
    loadMarketData();
    return () => {
      active = false;
    };
  }, [selectedRegion, effectiveCommodity, historyLimit, syncCompletedAt, onTelemetry]);

  const activeForecastKey = `${selectedRegion}|${effectiveCommodity}|${rainDeltaMm}|${priceShockPct}|${syncCompletedAt ?? ''}`;

  useEffect(() => {
    let active = true;
    const isWhatIf = rainDeltaMm !== 0 || priceShockPct !== 0;

    api
      .getForecast(
        selectedRegion,
        effectiveCommodity,
        isWhatIf ? null : onTelemetry,
        { rain_21d_delta_mm: rainDeltaMm, price_shock_pct: priceShockPct }
      )
      .then((res) => {
        if (active) {
          setError('');
          setForecast(res);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Forecast error.');
      })
      .finally(() => {
        if (active) setCompletedForecastKey(activeForecastKey);
      });

    return () => {
      active = false;
    };
  }, [
    selectedRegion,
    effectiveCommodity,
    rainDeltaMm,
    priceShockPct,
    syncCompletedAt,
    onTelemetry,
    activeForecastKey,
  ]);

  useEffect(() => {
    let active = true;
    api
      .getWeatherForecast(selectedWeatherHub, 14, onTelemetry)
      .then((res) => {
        if (active) {
          setWeatherError('');
          setWeather(res);
        }
      })
      .catch((err) => {
        if (active) {
          setWeather(null);
          setWeatherError(err.message || 'Regional weather outlook temporarily unavailable.');
        }
      });
    return () => {
      active = false;
    };
  }, [selectedWeatherHub, onTelemetry]);

  const isWhatIfActive = rainDeltaMm !== 0 || priceShockPct !== 0;
  const isSimulating = isWhatIfActive && completedForecastKey !== activeForecastKey;
  const pred7d = forecast?.forecasts?.find((f) => f.horizon_days === 7);
  const pred14d = forecast?.forecasts?.find((f) => f.horizon_days === 14);
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
      {/* 1. Control & Filter Bar */}
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
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--emerald-primary)', marginBottom: '0.3rem', fontWeight: 800 }}>
              STATE / MANDI HUB
            </label>
            <select className="neo-select" value={selectedRegion} onChange={(e) => handleRegionChange(e.target.value)}>
              {regions.map((reg) => (
                <option key={reg} value={reg}>{reg}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--emerald-primary)', marginBottom: '0.3rem', fontWeight: 800 }}>
              COMMODITY
            </label>
            <select className="neo-select" value={effectiveCommodity} onChange={(e) => setSelectedCommodity(e.target.value)}>
              {availableCommodities.map((comm) => (
                <option key={comm} value={comm}>{comm}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--emerald-primary)', marginBottom: '0.3rem', fontWeight: 800 }}>
              CHART WINDOW
            </label>
            <select className="neo-select" value={historyLimit} onChange={(e) => setHistoryLimit(Number(e.target.value))}>
              <option value={60}>Last 60 Trading Days</option>
              <option value={120}>Last 120 Trading Days</option>
              <option value={250}>Last 1 Year (~250 Days)</option>
              <option value={600}>Full Multi-Year Span</option>
            </select>
          </div>
        </div>

        {forecast && (
          <div className="neo-inset" style={{ padding: '0.72rem 1.15rem', display: 'flex', alignItems: 'center', gap: '1.15rem', fontSize: '0.83rem', flexWrap: 'wrap' }}>
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
        <div className="glass-panel" style={{ padding: '1rem 1.4rem', marginBottom: '1.4rem', color: '#991b1b', fontWeight: 600 }}>
          {error}
        </div>
      )}

      {/* 2. 4 KPI Cards */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.2rem', marginBottom: '1.4rem' }}>
        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 22 }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>
              {isWhatIfActive ? 'SIMULATED BASE PRICE' : 'CURRENT MODAL PRICE'}
            </span>
            <span className="badge-pill badge-watch" style={{ fontSize: '0.65rem', padding: '0.18rem 0.55rem', opacity: isWhatIfActive ? 1 : 0 }}>
              WHAT-IF
            </span>
          </div>
          <div className="mono" style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-forest)', margin: '0.4rem 0', opacity: isSimulating ? 0.55 : 1 }}>
            {!forecast ? '...' : `₹${forecast.current_modal_price_inr.toLocaleString('en-IN')}`}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Per Quintal (100 kg) • {selectedRegion}
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>7-DAY ML FORECAST</div>
          <div className="mono" style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-forest)', margin: '0.4rem 0', opacity: isSimulating ? 0.55 : 1 }}>
            {!pred7d ? '...' : `₹${pred7d.predicted_price_inr.toLocaleString('en-IN')}`}
          </div>
          {pred7d && (
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: pred7d.expected_change_pct >= 0 ? '#059669' : '#dc2626', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {pred7d.expected_change_pct >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              <span>{pred7d.expected_change_pct >= 0 ? '+' : ''}{pred7d.expected_change_pct}% (MAE ±₹{pred7d.model_mae_inr})</span>
            </div>
          )}
        </div>

        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>14-DAY ML FORECAST</div>
          <div className="mono" style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-forest)', margin: '0.4rem 0', opacity: isSimulating ? 0.55 : 1 }}>
            {!pred14d ? '...' : `₹${pred14d.predicted_price_inr.toLocaleString('en-IN')}`}
          </div>
          {pred14d && (
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: pred14d.expected_change_pct >= 0 ? '#059669' : '#dc2626', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {pred14d.expected_change_pct >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              <span>{pred14d.expected_change_pct >= 0 ? '+' : ''}{pred14d.expected_change_pct}% (MAE ±₹{pred14d.model_mae_inr})</span>
            </div>
          )}
        </div>

        <div className="glass-panel" style={{ padding: '1.35rem 1.5rem' }}>
          <div style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 800 }}>30-DAY SURGE ALERT STATUS</div>
          <div style={{ margin: '0.62rem 0' }}>{forecast ? renderAlertBadge(forecast.alert_status) : '...'}</div>
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

      {/* 3. Isolated 60-FPS What-If Simulator */}
      <WhatIfSimulator rainDeltaMm={rainDeltaMm} priceShockPct={priceShockPct} onCommitShock={handleCommitShock} />

      {/* 4. Balanced 2-Column Upper Analytics Deck */}
      <section className="analytics-split-grid">
        <div className="analytics-col">
          <PriceTrajectoryChart history={history} selectedRegion={selectedRegion} selectedCommodity={effectiveCommodity} />
          <CropCalendarCard selectedCommodity={effectiveCommodity} activeMonthIndex={activeMonthIndex} />
        </div>

        <div className="analytics-col">
          <WeatherOutlookCard
            weatherHubs={weatherHubs}
            selectedWeatherHub={selectedWeatherHub}
            onSelectWeatherHub={setSelectedWeatherHub}
            weather={weather}
            weatherError={weatherError}
          />

          <div className="glass-panel" style={{ padding: '1.45rem', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <AlertTriangle size={19} color="#d97706" />
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800 }}>Active Surge Alerts</h3>
              </div>
              <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--emerald-primary)', fontWeight: 700 }}>
                {alerts.length} Flagged
              </span>
            </div>

            {alerts.length === 0 ? (
              <div className="neo-inset" style={{ padding: '1rem', fontSize: '0.84rem', color: 'var(--text-body)', lineHeight: 1.5 }}>
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
                    style={{ padding: '0.7rem 0.9rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-forest)' }}>
                        {item.commodity} <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>({item.region_name})</span>
                      </div>
                      <div className="mono" style={{ fontSize: '0.76rem', color: 'var(--emerald-primary)', fontWeight: 700 }}>
                        ₹{Number(item.median_modal_price).toLocaleString('en-IN')}/Qtl • Z={item.price_zscore_30d}σ
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
      <MandiLeaderboard selectedRegion={selectedRegion} selectedCommodity={effectiveCommodity} mandisData={mandisData} />
    </main>
  );
}
