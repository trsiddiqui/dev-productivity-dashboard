'use client';

import type { KPIs } from '../../lib/types';

interface KPIItem { label: string; value: number }

export function KPIsView({ kpis, additionsOverride, deletionsOverride }: { kpis: KPIs; additionsOverride?: number; deletionsOverride?: number }) {
  const items: KPIItem[] = [
    { label: 'PRs', value: kpis.totalPRs },
    // { label: 'Tickets', value: kpis.totalTicketsDone },
    // { label: 'Story Points', value: kpis.totalStoryPoints },
    { label: 'Additions', value: additionsOverride ?? kpis.totalAdditions },
    { label: 'Deletions', value: deletionsOverride ?? kpis.totalDeletions },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            background: 'var(--kpi-bg)',
            color: 'var(--kpi-fg)',
            border: '1px solid var(--kpi-br)',
            borderRadius: 12,
            padding: 16,
            textAlign: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700 }}>{it.value}</div>
          <div style={{ fontSize: 12, color: 'var(--panel-muted)' }}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}
