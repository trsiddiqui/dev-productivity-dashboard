'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ContributionWipItem } from '@/lib/types';
import type { JSX } from 'react';
import { DateAxisTick, weekdayFromYmd } from './ChartDateTick';

interface Props {
  items: ContributionWipItem[];
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
      <div style={{ fontSize: 13 }}>Open dev PRs: {openPRs}</div>
      <div style={{ fontSize: 13 }}>Linked Jira issues in progress: {activeIssues}</div>
    </div>
  );
}

export function ContributionWipChart({ items }: Props): JSX.Element {
  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>Work In Progress Trend</h3>
        <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
          Higher sustained WIP means more work is staying open at once. If WIP stays high while throughput stays low, context switching or review bottlenecks are likely.
        </p>
      </div>
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={items} margin={{ top: 8, right: 16, left: 0, bottom: 28 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#94a3b8" tickMargin={12} height={42} tick={<DateAxisTick color="#94a3b8" />} />
            <YAxis stroke="#94a3b8" allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={(value: string, entry: { color?: string }) => (
                <span style={{ color: entry.color ?? 'var(--panel-fg)' }}>{value}</span>
              )}
            />
            <Line type="monotone" dataKey="openPRs" name="Open dev PRs" stroke="#60a5fa" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="activeIssues" name="Linked Jira issues in progress" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
