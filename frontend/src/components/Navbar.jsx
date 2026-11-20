
import { Sprout, LayoutDashboard, Home, RefreshCw, Server } from 'lucide-react';

export default function Navbar({
  activePage,
  onNavigate,
  syncStatus,
  onTriggerSync,
  telemetry,
}) {
  const isSyncing = syncStatus?.is_syncing;
  const cooldown = syncStatus?.cooldown_remaining_sec || 0;

  return (
    <header style={{ paddingTop: '1.1rem', paddingBottom: '0.5rem' }}>
      <div
        className="container glass-panel"
        style={{
          padding: '0.85rem 1.4rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
        }}
      >
        {/* Brand Identity */}
        <div
          onClick={() => onNavigate('landing')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.8rem',
            cursor: 'pointer',
          }}
        >
          <div
            className="neo-inset"
            style={{
              width: 44,
              height: 44,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--emerald-primary)',
            }}
          >
            <Sprout size={24} />
          </div>
          <div>
            <div
              style={{
                fontWeight: 800,
                fontSize: '1.12rem',
                color: 'var(--text-forest)',
                letterSpacing: '-0.01em',
              }}
            >
              AgroPulse <span style={{ color: 'var(--emerald-primary)' }}>India</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              AP &amp; Telangana Mandi &amp; Weather Intelligence
            </div>
          </div>
        </div>

        {/* Navigation + Live Load Balancer Telemetry + Sync Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {telemetry && (
            <div
              className="neo-inset mono"
              title="Active Uvicorn Load-Balanced Worker PID & Endpoint Latency"
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.76rem',
                color: 'var(--text-body)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              <Server size={14} color="var(--emerald-primary)" />
              <span>Worker #{telemetry.workerPid}</span>
              <span style={{ opacity: 0.4 }}>|</span>
              <span>{telemetry.latencyMs}ms</span>
            </div>
          )}

          <button
            className={`neo-button ${activePage === 'landing' ? 'neo-button-primary' : ''}`}
            onClick={() => onNavigate('landing')}
          >
            <Home size={16} />
            <span>Overview</span>
          </button>

          <button
            className={`neo-button ${activePage === 'dashboard' ? 'neo-button-primary' : ''}`}
            onClick={() => onNavigate('dashboard')}
          >
            <LayoutDashboard size={16} />
            <span>Live Dashboard</span>
          </button>

          {syncStatus?.live_sync_disabled ? (
            <span
              className="badge-pill"
              title="Database & ML models update automatically every Sunday via GitHub Actions"
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.35rem 0.75rem',
                color: 'var(--text-muted)',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                whiteSpace: 'nowrap',
              }}
            >
              Auto-Sync: Sundays
            </span>
          ) : (
            <button
              className="neo-button"
              onClick={onTriggerSync}
              disabled={isSyncing}
              title={syncStatus?.last_message || 'Catch up missing days from data.gov.in & Open-Meteo'}
            >
              <RefreshCw size={16} className={isSyncing ? 'spin' : ''} color="var(--emerald-primary)" />
              <span>
                {isSyncing
                  ? 'Syncing...'
                  : cooldown > 0
                    ? `Synced (${Math.ceil(cooldown / 60)}m)`
                    : 'Sync Latest Data'}
              </span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
