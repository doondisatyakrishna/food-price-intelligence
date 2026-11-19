import { memo } from 'react';
import { ThermometerSun, MapPin, ExternalLink } from 'lucide-react';

const WeatherOutlookCard = memo(function WeatherOutlookCard({
  weatherHubs,
  selectedWeatherHub,
  onSelectWeatherHub,
  weather,
  weatherError,
}) {
  return (
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
          style={{
            width: '100%',
            fontSize: '0.84rem',
            padding: '0.55rem 2.2rem 0.55rem 0.85rem',
          }}
          value={selectedWeatherHub}
          onChange={(e) => onSelectWeatherHub(e.target.value)}
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

            <div
              className="mono"
              style={{
                color: 'var(--text-muted)',
                fontSize: '0.7rem',
                marginTop: '0.15rem',
              }}
            >
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
              <div
                style={{
                  fontSize: '0.65rem',
                  color: 'var(--text-muted)',
                  fontWeight: 700,
                }}
              >
                14-DAY EXPECTED RAIN
              </div>

              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                {weather.total_expected_rain_mm} mm
              </div>
            </div>

            <div className="neo-inset" style={{ padding: '0.68rem' }}>
              <div
                style={{
                  fontSize: '0.65rem',
                  color: 'var(--text-muted)',
                  fontWeight: 700,
                }}
              >
                HEAVY RAIN (&ge;25mm)
              </div>

              <div
                className="mono"
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 800,
                  color:
                    weather.heavy_rain_days_count > 0
                      ? '#d97706'
                      : '#059669',
                }}
              >
                {weather.heavy_rain_days_count} Days
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4rem',
              marginBottom: '0.7rem',
            }}
          >
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
                    color:
                      d.precipitation_mm >= 25
                        ? '#dc2626'
                        : '#0284c7',
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
            <span>
              {weather.source || 'External forecast via Open-Meteo API'}
            </span>
          </div>
        </>
      ) : weatherError ? (
        <div
          className="neo-inset"
          style={{
            padding: '0.85rem',
            fontSize: '0.82rem',
            color: '#991b1b',
            fontWeight: 600,
          }}
        >
          {weatherError}
        </div>
      ) : (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Loading regional weather forecast...
        </div>
      )}
    </div>
  );
});

export default WeatherOutlookCard;
