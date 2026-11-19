import React, { memo } from 'react';
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
import { Activity } from 'lucide-react';

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

export default PriceTrajectoryChart;