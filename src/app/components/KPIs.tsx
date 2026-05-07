'use client';

import type { KPIs } from '../../lib/types';

interface KPIItem { label: string; value: number }

export function KPIsView({
  kpis,
  additionsOverride,
  deletionsOverride,
  touchedStoryPoints,
  touchedTicketCount,
}: {
  kpis: KPIs;
  additionsOverride?: number;
  deletionsOverride?: number;
  touchedStoryPoints?: number;
  touchedTicketCount?: number;
}) {
  const items: KPIItem[] = [
    { label: 'PRs', value: kpis.totalPRs },
    // { label: 'Tickets', value: kpis.totalTicketsDone },
    // { label: 'Story Points', value: kpis.totalStoryPoints },
    ...(touchedStoryPoints === undefined ? [] : [{ label: 'Touched Story Points', value: touchedStoryPoints }]),
    { label: 'Additions', value: additionsOverride ?? kpis.totalAdditions },
    { label: 'Deletions', value: deletionsOverride ?? kpis.totalDeletions },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
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
          {it.label === 'Touched Story Points' && touchedTicketCount !== undefined && (
            <div style={{ fontSize: 11, color: 'var(--panel-muted)', marginTop: 4 }}>
              {touchedTicketCount.toLocaleString()} tickets with PRs
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
