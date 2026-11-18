import React from 'react';
import {
  ArrowRight,
  CloudRain,
  Database,
  TrendingUp,
  Leaf,
  CheckCircle2,
  ThermometerSun,
  History,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

const HISTORICAL_EVENTS = [
  {
    year: '2013',
    region: 'Coastal AP & Rayalaseema',
    title: 'Cyclones Phailin & Helen Horticulture Shock',
    type: 'WEATHER LOSS',
    badgeClass: 'badge-surge',
    summary:
      'Back-to-back cyclonic storms inundated standing paddy and vegetable belts across Godavari and Guntur districts, triggering a 2-to-3-week supply bottleneck across South Indian mandis.',
  },
  {
    year: '2019–20',
    region: 'Deccan, Kurnool & Telangana',
    title: 'Unseasonal Late-Monsoon Onion & Chilli Surge',
    type: '21-DAY LAG SHOCK',
    badgeClass: 'badge-watch',
    summary:
      'Extended October rainfall damaged stored Kharif bulbs and delayed fresh arrivals, driving modal onion prices past ₹6,500/Quintal—the exact 21-day lag signature AgroPulse detects.',
  },
  {
    year: '2021–22',
    region: 'Guntur, Khammam & Nizamabad',
    title: 'Record Dry Chilli & Turmeric Harvest Boom',
    type: 'BUMPER HARVEST',
    badgeClass: 'badge-normal',
    summary:
      'Favorable post-monsoon soil moisture paired with strong export demand lifted Guntur Teja chilli and Nizamabad turmeric realizations to multi-year highs without supply collapse.',
  },
  {
    year: 'Dec 2023',
    region: 'Nellore, Bapatla & Krishna (AP)',
    title: 'Cyclone Michaung Coastal Arrival Disruption',
    type: 'WEATHER LOSS',
    badgeClass: 'badge-surge',
    summary:
      'Extreme December precipitation submerged coastal vegetable and paddy fields, causing sharp intraday mandi spreads (max vs. min price dispersion) across Andhra Pradesh hubs.',
  },
];

export default function LandingPage({ onLaunchDashboard, catalog, syncStatus }) {
  const totalSeries = catalog?.series?.length || 21;
  const totalTradingDays =
    catalog?.series?.reduce((acc, item) => acc + (item.trading_days || 0), 0) || 18615;
  const model14dEdge = catalog?.model_metrics?.['14d']?.improvement_pct ?? 6.35;

  return (
    <main className="container" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
      {/* 1. Light Frosted Hero Section */}
      <section
        className="glass-panel"
        style={{
          padding: '2.8rem 2.6rem',
          maxWidth: '1080px',
          margin: '0 auto 2.2rem auto',
        }}
      >
        <div className="badge-pill badge-normal" style={{ marginBottom: '1.1rem' }}>
          <Leaf size={14} />
          <span>Andhra Pradesh &amp; Telangana Agro-Climatic Intelligence</span>
        </div>

        <h1
          style={{
            fontSize: 'clamp(1.95rem, 3.8vw, 3rem)',
            fontWeight: 800,
            lineHeight: 1.15,
            color: 'var(--text-forest)',
            marginBottom: '1.1rem',
            letterSpacing: '-0.02em',
          }}
        >
          Transparent Mandi Price Forecasts &amp;{' '}
          <span style={{ color: 'var(--emerald-primary)' }}>Weather Shock Alerts</span>
        </h1>

        <p
          style={{
            fontSize: '1.06rem',
            lineHeight: 1.7,
            color: 'var(--text-body)',
            maxWidth: '820px',
            marginBottom: '1.8rem',
          }}
        >
          Every season, farmers and local markets across Andhra Pradesh and Telangana face sudden
          price swings triggered by cyclonic rain, heatwaves, and mandi arrival gaps.{' '}
          <strong>AgroPulse India</strong> unifies daily <strong>data.gov.in</strong> Agmarknet
          records with <strong>Open-Meteo</strong> weather telemetry to deliver 7-day and 14-day ML
          price forecasts, Z-score surge alerts, and standalone 14-day rainfall outlooks.
        </p>

        {/* Primary CTA + Live Sync Pill */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
          <button
            className="neo-button neo-button-primary"
            style={{ padding: '0.9rem 1.8rem', fontSize: '1rem' }}
            onClick={onLaunchDashboard}
          >
            <span>Explore Live Dashboard</span>
            <ArrowRight size={18} />
          </button>

          <div
            className="neo-inset"
            style={{
              padding: '0.68rem 1.1rem',
              fontSize: '0.84rem',
              color: 'var(--text-body)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <CheckCircle2 size={17} color="var(--emerald-primary)" />
            <span>{syncStatus?.last_message || 'Auto catch-up pipeline active'}</span>
          </div>
        </div>

        {/* 3 Light Neomorphic KPI Summary Tiles */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1.1rem',
            marginTop: '2.2rem',
            paddingTop: '1.8rem',
            borderTop: '1px solid rgba(16, 185, 129, 0.2)',
          }}
        >
          <div className="neo-inset" style={{ padding: '1.1rem 1.25rem' }}>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              VERIFIED MANDI RECORDS
            </div>
            <div
              className="mono"
              style={{
                fontSize: '1.55rem',
                fontWeight: 800,
                color: 'var(--text-forest)',
                marginTop: '0.2rem',
              }}
            >
              52,600+
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Multi-year APMC modal prices
            </div>
          </div>

          <div className="neo-inset" style={{ padding: '1.1rem 1.25rem' }}>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              CORE TRACKED SERIES
            </div>
            <div
              className="mono"
              style={{
                fontSize: '1.55rem',
                fontWeight: 800,
                color: 'var(--text-forest)',
                marginTop: '0.2rem',
              }}
            >
              {totalSeries} Pairs
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {totalTradingDays.toLocaleString()} daily feature rows
            </div>
          </div>

          <div className="neo-inset" style={{ padding: '1.1rem 1.25rem' }}>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 700 }}>
              14-DAY FORECAST ACCURACY
            </div>
            <div
              className="mono"
              style={{
                fontSize: '1.55rem',
                fontWeight: 800,
                color: 'var(--emerald-primary)',
                marginTop: '0.2rem',
              }}
            >
              +{model14dEdge}%
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              MAE improvement vs. baseline
            </div>
          </div>
        </div>
      </section>

      {/* 2. Visual Platform Pillars (Includes Local Farmer & Harvest Photography) */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))',
          gap: '1.4rem',
          maxWidth: '1080px',
          margin: '0 auto 2.4rem auto',
        }}
      >
        {/* Pillar 1: Field & Farmer Crop Monitoring */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <img
            src="/images/farmers-crop.jpg"
            alt="Farmer inspecting healthy green crops"
            className="photo-card-img"
            style={{ marginBottom: '1.1rem' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.45rem' }}>
            <Database size={19} color="var(--emerald-primary)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Dual-Feed Mandi Tracking</h3>
          </div>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.62, color: 'var(--text-body)' }}>
            Combines <strong>data.gov.in</strong>&apos;s multi-year rolling archive with today&apos;s
            live Agmarknet arrival tape across Guntur, Kurnool, Warangal, Nizamabad, and Nashik so
            no trading day is lost.
          </p>
        </div>

        {/* Pillar 2: Harvest & Market Price Forecasting */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <img
            src="/images/farmers-mandi.jpg"
            alt="Fresh harvested produce at agricultural market"
            className="photo-card-img"
            style={{ marginBottom: '1.1rem' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.45rem' }}>
            <TrendingUp size={19} color="var(--emerald-primary)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>7-Day &amp; 14-Day ML Forecasts</h3>
          </div>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.62, color: 'var(--text-body)' }}>
            <strong>HistGradientBoosting</strong> models predict percentage returns across both
            high-value spices (Dry Chillies at ₹14,500/Qtl) and daily vegetables (Tomatoes &amp;
            Onions) with 30-day Z-score surge alerts.
          </p>
        </div>

        {/* Pillar 3: Dedicated External Weather Outlook & Rainfall Lag Intelligence */}
        <div className="glass-panel-mint" style={{ padding: '1.5rem' }}>
          <div
            className="neo-inset"
            style={{
              height: 170,
              marginBottom: '1.1rem',
              padding: '1.2rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="badge-pill badge-normal">
                <CloudRain size={13} /> EXTERNAL OPEN-METEO API
              </span>
              <ThermometerSun size={24} color="var(--emerald-primary)" />
            </div>
            <div>
              <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-forest)' }}>
                6 Agro-Climatic Zones
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-body)', marginTop: '0.25rem' }}>
                Observed <strong>21-day rain lag</strong> feeds our price ML, while live 14-day
                weather forecasts are sourced externally from <strong>Open-Meteo</strong>.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.45rem' }}>
            <CloudRain size={19} color="var(--emerald-primary)" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>
              External 14-Day Weather Intelligence
            </h3>
          </div>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.62, color: 'var(--text-body)' }}>
            Rather than generating our own weather predictions and compounding errors, AgroPulse
            fetches official 14-day forecasts directly from <strong>Open-Meteo</strong> across
            Coastal Andhra, Rayalaseema, North &amp; South Telangana, Nashik, and Kolar.
          </p>
        </div>
      </section>

      {/* 3. Historical Agricultural Events & Weather Shocks Timeline */}
      <section
        className="glass-panel"
        style={{
          padding: '2.2rem 2.4rem',
          maxWidth: '1080px',
          margin: '0 auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1.6rem',
          }}
        >
          <div>
            <div className="badge-pill badge-watch" style={{ marginBottom: '0.6rem' }}>
              <History size={13} />
              <span>Why Early-Warning Systems Matter</span>
            </div>
            <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-forest)' }}>
              Past Harvest Booms &amp; Cyclone Shocks in AP &amp; Telangana
            </h2>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '340px' }}>
            Historical events that shaped how AgroPulse models delayed rainfall shocks and intraday
            mandi price volatility.
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '1.15rem',
          }}
        >
          {HISTORICAL_EVENTS.map((ev) => (
            <div
              key={ev.title}
              className="neo-inset"
              style={{
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '0.75rem',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.65rem',
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontWeight: 800,
                      fontSize: '0.92rem',
                      color: 'var(--emerald-primary)',
                    }}
                  >
                    {ev.year}
                  </span>
                  <span className={`badge-pill ${ev.badgeClass}`} style={{ fontSize: '0.68rem' }}>
                    {ev.type === 'BUMPER HARVEST' ? (
                      <Sparkles size={11} />
                    ) : (
                      <AlertTriangle size={11} />
                    )}
                    {ev.type}
                  </span>
                </div>
                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  {ev.region}
                </div>
                <h4 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-forest)', marginBottom: '0.45rem' }}>
                  {ev.title}
                </h4>
                <p style={{ fontSize: '0.84rem', lineHeight: 1.55, color: 'var(--text-body)' }}>
                  {ev.summary}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}