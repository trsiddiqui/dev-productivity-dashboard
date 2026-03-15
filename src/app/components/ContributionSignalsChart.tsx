'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { JSX } from 'react';

export interface ContributionSignalDatum {
  metric: string;
  primary: number;
  secondary: number;
}

interface Props {
  title: string;
  subtitle?: string;
  primaryLabel: string;
  secondaryLabel: string;
  items: ContributionSignalDatum[];
}

export function ContributionSignalsChart({
  title,
  subtitle,
  primaryLabel,
  secondaryLabel,
  items,
}: Props): JSX.Element {
  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {subtitle && <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>{subtitle}</p>}
      </div>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer>
          <BarChart data={items} layout="vertical" margin={{ top: 8, right: 16, left: 48, bottom: 8 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis type="number" stroke="#94a3b8" allowDecimals={false} />
            <YAxis type="category" dataKey="metric" stroke="#94a3b8" width={150} />
            <Tooltip />
            <Legend
              formatter={(value: string, entry: { color?: string }) => (
                <span style={{ color: entry.color ?? 'var(--panel-fg)' }}>{value}</span>
              )}
            />
            <Bar dataKey="primary" name={primaryLabel} fill="#60a5fa" radius={[0, 4, 4, 0]} />
            <Bar dataKey="secondary" name={secondaryLabel} fill="#f59e0b" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
