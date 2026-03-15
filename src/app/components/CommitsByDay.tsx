'use client';

import { useCallback, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from 'recharts';
import type { CommitTimeseriesItem } from '../../lib/types';
import { JSX } from 'react';
import { DateAxisTick, weekdayFromYmd } from './ChartDateTick';

interface Props {
  items: CommitTimeseriesItem[];
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}

const palette = {
  commits: '#6366f1',
  additions: '#22c55e',
  deletions: '#ef4444',
  grid: '#334155',
  axis: '#94a3b8',
  inactivity: 'rgba(148, 163, 184, 0.18)',
};

function CustomTooltip({ active, payload, label }: TooltipProps): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const prsMerged = payload.find(p => (p as { dataKey?: string }).dataKey === 'commits')?.value ?? 0;
  const additions = payload.find(p => (p as { dataKey?: string }).dataKey === 'additions')?.value ?? 0;
  const deletions = payload.find(p => (p as { dataKey?: string }).dataKey === 'deletions')?.value ?? 0;

  const weekday = typeof label === 'string' ? weekdayFromYmd(label) ?? '' : '';
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
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--panel-muted)', marginBottom: 6 }}>{weekday || '-'}</div>
      <div style={{ fontSize: 13 }}>PRs merged to dev: {prsMerged}</div>
      <div style={{ fontSize: 13 }}>Lines added: {additions}</div>
      <div style={{ fontSize: 13 }}>Lines deleted: {deletions}</div>
    </div>
  );
}

export function CommitsByDay({ items }: Props): JSX.Element {
  const parseLocalYMD = useCallback((s: string): Date => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }, []);

  const weekendBands = useMemo(() => {
    const bands: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < items.length; i++) {
      const d = parseLocalYMD(items[i].date);
      const dow = d.getDay();
      if (dow === 6) {
        const from = items[i].date;
        const to = items[i + 1]?.date ?? from;
        bands.push({ from, to });
      }
      if (dow === 0) {
        const from = items[i].date;
        const to = items[i + 1]?.date ?? from;
        bands.push({ from, to });
      }
    }
    return bands;
  }, [items, parseLocalYMD]);

  const yMax = useMemo(() => {
    const max = items.reduce((acc, it) => Math.max(acc, it.commits || 0, it.additions || 0, it.deletions || 0), 0);
    return max > 0 ? Math.ceil(max * 1.1) : 1;
  }, [items]);

  const inactivityBands = useMemo(() => {
    const bands: Array<{ from: string; to: string }> = [];
    let start: string | null = null;

    items.forEach((item, idx) => {
      const isIdle = (item.commits ?? 0) === 0 && (item.additions ?? 0) === 0 && (item.deletions ?? 0) === 0;
      if (isIdle && !start) start = item.date;
      if (!isIdle && start) {
        bands.push({ from: start, to: item.date });
        start = null;
      }
      const isLast = idx === items.length - 1;
      if (isLast && start) {
        bands.push({ from: start, to: item.date });
      }
    });

    return bands;
  }, [items]);

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', borderRadius: 12, padding: 16, border: '1px solid var(--panel-br)', boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
      <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Merged to Dev by Day</h2>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={items} margin={{ top: 8, right: 16, left: 0, bottom: 28 }}>
            {inactivityBands.map((b, idx) => (
              <ReferenceArea
                key={`idle-${idx}-${b.from}`}
                x1={b.from}
                x2={b.to}
                y1={0}
                y2={yMax}
                ifOverflow="hidden"
                fill={palette.inactivity}
                stroke="rgba(148, 163, 184, 0.45)"
                strokeOpacity={0.55}
              />
            ))}
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
            <XAxis dataKey="date" stroke={palette.axis} tickMargin={12} height={42} tick={<DateAxisTick color={palette.axis} />} />
            <YAxis stroke={palette.axis} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="commits" name="PRs merged" fill={palette.commits} />
            <Bar dataKey="additions" name="Lines added" fill={palette.additions} />
            <Bar dataKey="deletions" name="Lines deleted" fill={palette.deletions} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
