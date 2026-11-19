import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Sliders, RotateCcw } from 'lucide-react';

const WhatIfSimulator = memo(function WhatIfSimulator({
  rainDeltaMm,
  priceShockPct,
  onCommitShock,
}) {
  const [draftRain, setDraftRain] = useState(rainDeltaMm);
  const [draftPrice, setDraftPrice] = useState(priceShockPct);
  const settleTimerRef = useRef(null);

  useEffect(() => setDraftRain(rainDeltaMm), [rainDeltaMm]);
  useEffect(() => setDraftPrice(priceShockPct), [priceShockPct]);

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

  const hasChanges =
    draftRain !== 0 || draftPrice !== 0 || rainDeltaMm !== 0 || priceShockPct !== 0;

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

export default WhatIfSimulator;