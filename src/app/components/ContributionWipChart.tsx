'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ContributionGapMode, ContributionWipItem } from '@/lib/types';
import { useMemo, type JSX } from 'react';
import { DateAxisTick, weekdayFromYmd } from './ChartDateTick';

interface Props {
  items: ContributionWipItem[];
  gapMode: ContributionGapMode;
}

interface TooltipPayloadItem {
  dataKey?: string;
  value?: number;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string;
}

function isWeekendDate(dateText: string): boolean {
  const parts = dateText.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return false;
  const [year, month, day] = parts;
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function countsAsGapDay(dateText: string, gapMode: ContributionGapMode): boolean {
  return gapMode === 'calendar' || !isWeekendDate(dateText);
}

function CustomTooltip({ active, payload, label }: TooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null;
  const openPRs = payload.find((item) => item.dataKey === 'openPRs')?.value ?? 0;
  const activeIssues = payload.find((item) => item.dataKey === 'activeIssues')?.value ?? 0;
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
      <div style={{ fontSize: 13 }}>Open tracked-base PRs: {openPRs}</div>
      <div style={{ fontSize: 13 }}>Linked Jira subtasks in progress: {activeIssues}</div>
    </div>
  );
}

export function ContributionWipChart({ items, gapMode }: Props): JSX.Element {
  const zeroActiveBands = useMemo(() => {
    const bands: Array<{ from: string; to: string }> = [];
    let start: string | null = null;

    items.forEach((item, index) => {
      const noActiveTickets = countsAsGapDay(item.date, gapMode) && (item.activeIssues ?? 0) === 0;
      if (noActiveTickets && !start) start = item.date;
      if (!noActiveTickets && start) {
        bands.push({ from: start, to: item.date });
        start = null;
      }

      if (index === items.length - 1 && start) {
        bands.push({ from: start, to: item.date });
      }
    });

    return bands;
  }, [gapMode, items]);

  const yMax = useMemo(() => {
    const max = items.reduce(
      (acc, item) => Math.max(acc, item.openPRs ?? 0, item.activeIssues ?? 0),
      0,
    );
    return max > 0 ? Math.ceil(max * 1.1) : 1;
  }, [items]);

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>Work In Progress Trend</h3>
        <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
          Use this while tracking execution load. The orange line counts linked Jira subtasks from <code>In Progress</code> until <code>Merged</code>, and the red shading highlights {gapMode === 'calendar' ? 'calendar-day' : 'weekday'} stretches where the developer had no active subtask in build status.
        </p>
      </div>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={items} margin={{ top: 8, right: 16, left: 0, bottom: 28 }}>
            {zeroActiveBands.map((band, index) => (
              <ReferenceArea
                key={`${band.from}-${index}`}
                x1={band.from}
                x2={band.to}
                y1={0}
                y2={yMax}
                fill="rgba(239, 68, 68, 0.14)"
                stroke="rgba(239, 68, 68, 0.28)"
                ifOverflow="hidden"
              />
            ))}
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#94a3b8" tickMargin={12} height={42} tick={<DateAxisTick color="#94a3b8" />} />
            <YAxis stroke="#94a3b8" allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value: string, entry: { color?: string }) => (
                <span style={{ color: entry.color ?? 'var(--panel-fg)' }}>{value}</span>
              )}
            />
            <Line type="monotone" dataKey="openPRs" name="Open tracked-base PRs" stroke="#60a5fa" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="activeIssues" name="Linked Jira subtasks in progress" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
