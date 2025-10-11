'use client';

import type { KPIs } from '../../lib/types';

interface KPIItem { label: string; value: number }

export function KPIsView({ kpis }: { kpis: KPIs }) {
  const items: KPIItem[] = [
    { label: 'PRs', value: kpis.totalPRs },
    { label: 'Tickets', value: kpis.totalTicketsDone },
    { label: 'Story Points', value: kpis.totalStoryPoints },
    { label: 'Additions', value: kpis.totalAdditions },
    { label: 'Deletions', value: kpis.totalDeletions },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
      {items.map((it) => (
        <div
          key={it.label}
          style={{ background: 'white', borderRadius: 12, padding: 16, textAlign: 'center', boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}
        >
          <div style={{ fontSize: 22, fontWeight: 700 }}>{it.value}</div>
          <div style={{ fontSize: 12, color: '#555' }}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}
