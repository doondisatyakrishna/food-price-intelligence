import React, { memo } from 'react';
import { Store } from 'lucide-react';

const MandiLeaderboard = memo(function MandiLeaderboard({
  selectedRegion,
  selectedCommodity,
  mandisData,
}) {
  return (
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

        {mandisData?.spread_inr > 0 && (
          <div className="badge-pill badge-watch">
            Inter-Mandi Spread: ₹{mandisData.spread_inr.toLocaleString('en-IN')}/Qtl
          </div>
        )}
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
  );
});

export default MandiLeaderboard;