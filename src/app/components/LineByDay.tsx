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
} from 'recharts';
import type { TimeseriesItem } from '../../lib/types';
import { JSX } from 'react';

type Props = { items: TimeseriesItem[] };

const palette = {
  additions: '#22c55e',     // green
  deletions: '#ef4444',     // red
  prs: '#60a5fa',           // blue
  storyPoints: '#f59e0b',   // amber
  tickets: '#a78bfa',       // violet
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
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        <div><span style={{ color: palette.additions }}>Additions</span> : {formatNum(map.get('Additions') ?? 0)}</div>
        <div><span style={{ color: palette.deletions }}>Deletions</span> : {formatNum(map.get('Deletions') ?? 0)}</div>
        <div><span style={{ color: palette.prs }}>PRs</span> : {formatNum(map.get('PRs') ?? 0)}</div>
        <div><span style={{ color: palette.storyPoints }}>Story Points</span> : {formatNum(map.get('Story Points') ?? 0)}</div>
        <div><span style={{ color: palette.tickets }}>Tickets</span> : {formatNum(map.get('Tickets') ?? 0)}</div>
      </div>
    </div>
  );
};

export function LineByDay({ items }: Props): JSX.Element {
  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', borderRadius: 12, padding: 16, border: '1px solid var(--panel-br)', boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
      <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Daily Activity</h2>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={items} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
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
            <Line
              type="monotone"
              dataKey="storyPoints"
              name="Story Points"
              stroke={palette.storyPoints}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="tickets"
              name="Tickets"
              stroke={palette.tickets}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
