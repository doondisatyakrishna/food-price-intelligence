import React, { memo } from 'react';
import { Sprout } from 'lucide-react';

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
  if (phase.includes('Peak')) return { bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' };
  if (phase.includes('Lean') || phase.includes('Risk')) {
    return { bg: '#fef3c7', color: '#92400e', border: '#fcd34d' };
  }
  return { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' };
}

const CropCalendarCard = memo(function CropCalendarCard({ selectedCommodity, activeMonthIndex }) {
  const seasonalSchedule = CROP_CALENDARS[selectedCommodity] || CROP_CALENDARS.DEFAULT;

  return (
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
  );
});

export default CropCalendarCard;