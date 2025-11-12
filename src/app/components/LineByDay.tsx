'use client';

import * as React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Tooltip,
  ReferenceArea,
} from 'recharts';
import type { TimeseriesItem } from '../../lib/types';
import { JSX } from 'react';

type Props = { items: TimeseriesItem[] };

const palette = {
  additions: '#22c55e',     // green
  deletions: '#ef4444',     // red
  prs: '#60a5fa',           // blue
  // Removed storyPoints and tickets from chart per new requirement
  grid: '#334155',
  axis: '#94a3b8',
};

interface TPItem {
  value: number;
  name: string;
  color?: string;
}
interface TProps {
  active?: boolean;
  payload?: TPItem[];
  label?: string;
}

function formatNum(n: number): string {
  return Number.isFinite(n) ? n.toString() : '0';
}

const CustomTooltip = ({ active, payload, label }: TProps): JSX.Element | null => {
  if (!active || !payload || payload.length === 0) return null;
  const map = new Map<string, number>();
  payload.forEach(p => {
    if (typeof p.value === 'number') map.set(p.name, p.value);
  });

  // Derive local weekday name from YYYY-MM-DD label (fallback to label if parsing fails)
  let weekday = '';
  if (typeof label === 'string') {
    const parts = label.split('-').map(Number);
    if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
      const [y, m, d] = parts;
      const dt = new Date(y, (m || 1) - 1, d || 1);
      weekday = dt.toLocaleDateString(undefined, { weekday: 'short' }); // e.g. Mon
    }
  }
  const displayLabel = weekday ? `${weekday}, ${label}` : label;

  return (
    <div
      style={{
        background: 'var(--tooltip-bg)',
        color: 'var(--tooltip-fg)',
        border: '1px solid var(--panel-br)',
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
      }}
    >
  <div style={{ fontWeight: 600, marginBottom: 6 }}>{displayLabel}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <div><span style={{ color: palette.additions }}>Additions</span> : {formatNum(map.get('Additions') ?? 0)}</div>
        <div><span style={{ color: palette.deletions }}>Deletions</span> : {formatNum(map.get('Deletions') ?? 0)}</div>
        <div><span style={{ color: palette.prs }}>PRs</span> : {formatNum(map.get('PRs') ?? 0)}</div>
  {/* Story Points and Tickets removed from tooltip */}
      </div>
    </div>
  );
};

export function LineByDay({ items }: Props): JSX.Element {
  // Helper to parse YYYY-MM-DD as a LOCAL date (avoid UTC shift)
  const parseLocalYMD = React.useCallback((s: string): Date => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }, []);
  // Compute weekend bands (Saturday/Sunday) to shade background
  const weekendBands = React.useMemo(() => {
    const bands: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < items.length; i++) {
      const d = parseLocalYMD(items[i].date);
      const dow = d.getDay(); // 0=Sun, 6=Sat
      if (dow === 6) {
        const from = items[i].date; // Saturday
        const to = items[i + 1]?.date ?? from; // shade Saturday only
        bands.push({ from, to });
      }
      if (dow === 0) {
        const from = items[i].date; // Sunday
        const to = items[i + 1]?.date ?? from; // shade Sunday only
        bands.push({ from, to });
      }
    }
    return bands;
  }, [items, parseLocalYMD]);
  // Concrete y-range for ReferenceArea (dataMin/dataMax not reliably supported)
  const yMax = React.useMemo(() => {
    let max = 0;
    for (const it of items) {
      max = Math.max(max, it.additions || 0, it.deletions || 0, it.prCount || 0);
    }
    return max > 0 ? Math.ceil(max * 1.05) : 1; // headroom so overlay covers full chart height
  }, [items]);
  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', borderRadius: 12, padding: 16, border: '1px solid var(--panel-br)', boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
      <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Daily Activity</h2>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={items} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            {/* Weekend shading (stronger contrast, theme-independent color) */}
            {weekendBands.map((b) => (
              <ReferenceArea
                key={b.from}
                x1={b.from}
                x2={b.to}
                y1={0}
                y2={yMax}
                ifOverflow="hidden"
                fill="rgba(120,120,120,0.20)"
                stroke="rgba(120,120,120,0.35)"
                strokeOpacity={0.7}
              />
            ))}
            <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke={palette.axis} tickMargin={8} />
            <YAxis stroke={palette.axis} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              iconType="line"
              formatter={(value: string, entry: { color?: string }) => (
                <span style={{ color: entry.color ?? '#e5e7eb' }}>{value}</span>
              )}
            />

            {}
            <Line
              type="monotone"
              dataKey="additions"
              name="Additions"
              stroke={palette.additions}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="deletions"
              name="Deletions"
              stroke={palette.deletions}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="prCount"
              name="PRs"
              stroke={palette.prs}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            {/* Removed Story Points and Tickets lines */}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
