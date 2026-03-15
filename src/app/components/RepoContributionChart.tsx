'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ContributionRepoItem } from '@/lib/types';
import { JSX } from 'react';

interface Props {
  items: ContributionRepoItem[];
}

interface TooltipPayloadItem {
  payload?: ContributionRepoItem;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

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
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{row.repo}</div>
      <div style={{ fontSize: 13 }}>Dev PRs: {row.prs}</div>
      <div style={{ fontSize: 13 }}>LOC changed: {row.locChanged.toLocaleString()}</div>
      <div style={{ fontSize: 13 }}>Additions: {row.additions.toLocaleString()}</div>
      <div style={{ fontSize: 13 }}>Deletions: {row.deletions.toLocaleString()}</div>
    </div>
  );
}

export function RepoContributionChart({ items }: Props): JSX.Element {
  const rows = items.slice(0, 6);

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600 }}>Where the Code Landed</h3>
        <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
          A narrow repo mix suggests focused delivery. Very low totals everywhere usually means low contribution volume in the window.
        </p>
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 24, bottom: 8 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis type="number" stroke="#94a3b8" allowDecimals={false} />
            <YAxis type="category" dataKey="repo" stroke="#94a3b8" width={120} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="locChanged" name="LOC changed" fill="#a855f7" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
