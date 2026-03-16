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
  subtitle?: string;
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

interface AxisTickProps {
  x?: number;
  y?: number;
  index?: number;
  payload?: { value?: string | number; index?: number };
}

export function ContributionMetricBars({
  title,
  subtitle,
  items,
  valueFormatter = (value) => value.toLocaleString(),
}: Props): JSX.Element {
  const rows = items.filter((item) => Number.isFinite(item.value));
  const hasSubtitles = rows.some((item) => !!item.subtitle);
  const rowHeight = hasSubtitles ? 54 : 42;

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
        {row.subtitle ? (
          <div style={{ fontSize: 12, color: 'var(--panel-muted)', marginBottom: 6 }}>{row.subtitle}</div>
        ) : null}
        <div style={{ fontSize: 13 }}>{valueFormatter(row.value)}</div>
      </div>
    );
  }

  function CategoryTick({ x = 0, y = 0, index, payload }: AxisTickProps): JSX.Element {
    const rowIndex = typeof index === 'number'
      ? index
      : (typeof payload?.index === 'number' ? payload.index : -1);
    const row = rows[rowIndex] ?? rows.find((item) => item.label === String(payload?.value ?? ''));

    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={4} textAnchor="end" fill="#e2e8f0" fontSize={12}>
          <tspan x={0}>{row?.label ?? String(payload?.value ?? '')}</tspan>
          {row?.subtitle ? (
            <tspan x={0} dy={14} fontSize={11} fill="#94a3b8">
              {row.subtitle}
            </tspan>
          ) : null}
        </text>
      </g>
    );
  }

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {subtitle && <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>{subtitle}</p>}
      </div>
      <div style={{ width: '100%', height: Math.max(220, rows.length * rowHeight) }}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis type="number" stroke="#94a3b8" />
            <YAxis
              type="category"
              dataKey="label"
              stroke="#94a3b8"
              width={hasSubtitles ? 190 : 140}
              interval={0}
              tick={<CategoryTick />}
            />
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
