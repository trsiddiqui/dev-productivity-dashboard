'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { JSX } from 'react';

export interface ContributionMetricBarItem {
  label: string;
  value: number;
  fill?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  items: ContributionMetricBarItem[];
  valueFormatter?: (value: number) => string;
}

interface TooltipPayloadItem {
  payload?: ContributionMetricBarItem;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

export function ContributionMetricBars({
  title,
  subtitle,
  items,
  valueFormatter = (value) => value.toLocaleString(),
}: Props): JSX.Element {
  const rows = items.filter((item) => Number.isFinite(item.value));

  function CustomTooltip({ active, payload }: TooltipProps): JSX.Element | null {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;

    return (
      <div style={{
        background: 'var(--tooltip-bg)',
        color: 'var(--tooltip-fg)',
        border: '1px solid var(--panel-br)',
        borderRadius: 8,
        padding: '10px 12px',
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{row.label}</div>
        <div style={{ fontSize: 13 }}>{valueFormatter(row.value)}</div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {subtitle && <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>{subtitle}</p>}
      </div>
      <div style={{ width: '100%', height: Math.max(220, rows.length * 42) }}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 8 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis type="number" stroke="#94a3b8" />
            <YAxis type="category" dataKey="label" stroke="#94a3b8" width={140} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {rows.map((item) => (
                <Cell key={item.label} fill={item.fill ?? '#60a5fa'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
