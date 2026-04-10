'use client';

import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ContributionDailyItem } from '@/lib/types';
import { JSX } from 'react';
import { DateAxisTick, weekdayFromYmd } from './ChartDateTick';

interface Props {
  items: ContributionDailyItem[];
  title: string;
  subtitle?: string;
}

interface TooltipPayloadItem {
  dataKey?: string;
  value?: number;
  payload?: ContributionDailyItem;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

const palette = {
  loc: 'var(--accent-primary-strong)',
  prs: 'var(--accent-success)',
  additions: 'var(--accent-success)',
  deletions: 'var(--accent-danger)',
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  weekend: 'var(--chart-weekend-fill)',
  weekendStroke: 'var(--chart-weekend-stroke)',
};

function CustomTooltip({ active, payload, label }: TooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const prCount = payload.find((item) => item.dataKey === 'prCount')?.value ?? 0;
  const locChanged = payload.find((item) => item.dataKey === 'locChanged')?.value ?? 0;
  const row = payload[0]?.payload;
  const additions = row?.additions ?? 0;
  const deletions = row?.deletions ?? 0;
  const weekday = weekdayFromYmd(typeof label === 'string' ? label : undefined);

  return (
    <div style={{
      background: 'var(--tooltip-bg)',
      color: 'var(--tooltip-fg)',
      border: '1px solid var(--panel-br)',
      borderRadius: 8,
      padding: '10px 12px',
      boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
    }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--panel-muted)', marginBottom: 6 }}>{weekday ?? '-'}</div>
      <div style={{ fontSize: 13 }}>Dev PRs: {prCount}</div>
      <div style={{ fontSize: 13 }}>LOC changed: {Number(locChanged).toLocaleString()}</div>
      <div style={{ fontSize: 13 }}>Additions: {Number(additions).toLocaleString()}</div>
      <div style={{ fontSize: 13 }}>Deletions: {Number(deletions).toLocaleString()}</div>
    </div>
  );
}

export function ContributionTrendChart({ items, title, subtitle }: Props): JSX.Element {
  const weekendBands = useMemo(() => {
    const bands: Array<{ from: string; to: string }> = [];
    for (let index = 0; index < items.length; index += 1) {
      const [year, month, day] = items[index].date.split('-').map(Number);
      const date = new Date(year, (month ?? 1) - 1, day ?? 1);
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        bands.push({
          from: items[index].date,
          to: items[index + 1]?.date ?? items[index].date,
        });
      }
    }
    return bands;
  }, [items]);

  const maxLoc = useMemo(
    () => Math.max(...items.map((item) => item.locChanged), 0),
    [items],
  );

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h3>
        {subtitle && <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>{subtitle}</p>}
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={items} margin={{ top: 8, right: 12, left: 0, bottom: 28 }}>
            {weekendBands.map((band, index) => (
              <ReferenceArea
                key={`${band.from}-${index}`}
                x1={band.from}
                x2={band.to}
                y1={0}
                y2={Math.max(1, Math.ceil(maxLoc * 1.1))}
                fill={palette.weekend}
                stroke={palette.weekendStroke}
                strokeOpacity={0.7}
                ifOverflow="hidden"
              />
            ))}
            <CartesianGrid stroke={palette.grid} strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke={palette.axis} tickMargin={12} height={42} tick={<DateAxisTick color={palette.axis} />} />
            <YAxis yAxisId="loc" stroke={palette.axis} allowDecimals={false} />
            <YAxis yAxisId="prs" orientation="right" stroke={palette.axis} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value: string, entry: { color?: string }) => (
                <span style={{ color: entry.color ?? 'var(--panel-fg)' }}>{value}</span>
              )}
            />
            <Bar yAxisId="loc" dataKey="locChanged" name="LOC changed" fill={palette.loc} radius={[4, 4, 0, 0]} />
            <Line yAxisId="prs" type="monotone" dataKey="prCount" name="Dev PRs" stroke={palette.prs} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
