'use client';

import * as React from 'react';
import type { PRLifecycle, LifecycleStats } from '../../lib/types';
import { JSX } from 'react';

function Hrs({ v }: { v?: number | null }): JSX.Element {
  if (v === null || v === undefined) return <span>—</span>;
  // show hours (rounded 1 decimal); show days if > 48h for readability
  if (v >= 48) return <span>{(v / 24).toFixed(1)}d</span>;
  return <span>{v.toFixed(1)}h</span>;
}

export function PRLifecycleView({
  items,
  stats,
}: {
  items: PRLifecycle[];
  stats: LifecycleStats;
}): JSX.Element {
  return (
    <div style={{ background: '#0b0b0b', borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
      <h2 style={{ fontWeight: 600, marginBottom: 12 }}>PR Lifecycle</h2>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
        <Kpi label="Median Time to Ready" value={<Hrs v={stats.medianTimeToReadyHours} />} />
        <Kpi label="Median Time to First Review" value={<Hrs v={stats.medianTimeToFirstReviewHours} />} />
        <Kpi label="Median Review → Merge" value={<Hrs v={stats.medianReviewToMergeHours} />} />
        <Kpi label="Median Cycle Time" value={<Hrs v={stats.medianCycleTimeHours} />} />
      </div>

      {/* Table */}
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
              <th style={{ padding: '8px 0' }}>PR</th>
              <th>Created</th>
              <th>Ready</th>
              <th>First Review</th>
              <th>Merged</th>
              <th>Closed</th>
              <th>Status</th>
              <th>→ Ready</th>
              <th>→ First Review</th>
              <th>Review → Merge</th>
              <th>Cycle</th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id} style={{ borderBottom: '1px solid #111827' }}>
                <td><a href={i.url} target="_blank" rel="noreferrer">#{i.number} {i.title}</a></td>
                <td>{i.createdAt?.slice(0, 10)}</td>
                <td>{i.readyForReviewAt?.slice(0, 10) ?? '—'}</td>
                <td>{i.firstReviewAt?.slice(0, 10) ?? '—'}</td>
                <td>{i.mergedAt?.slice(0, 10) ?? '—'}</td>
                <td>{i.closedAt?.slice(0, 10) ?? '—'}</td>
                <td>
                  {i.state === 'MERGED' ? (
                    <span style={{ padding: '2px 8px', background: '#ecfdf5', color: '#065f46', borderRadius: 999, fontSize: 12 }}>
                      Merged
                    </span>
                  ) : i.state === 'CLOSED' ? (
                    <span style={{ padding: '2px 8px', background: '#fef2f2', color: '#991b1b', borderRadius: 999, fontSize: 12 }}>
                      Closed
                    </span>
                  ) : i.isDraft ? (
                    <span style={{ padding: '2px 8px', background: '#eef2ff', color: '#3730a3', borderRadius: 999, fontSize: 12 }}>
                      Draft
                    </span>
                  ) : (
                    <span style={{ padding: '2px 8px', background: '#eff6ff', color: '#1e40af', borderRadius: 999, fontSize: 12 }}>
                      Open
                    </span>
                  )}
                </td>
                <td><Hrs v={i.timeToReadyHours} /></td>
                <td><Hrs v={i.timeToFirstReviewHours} /></td>
                <td><Hrs v={i.reviewToMergeHours} /></td>
                <td><Hrs v={i.cycleTimeHours} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div style={{ background: '#0f172a', borderRadius: 12, padding: 12, border: '1px solid #1f2937' }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e5e7eb' }}>{value}</div>
    </div>
  );
}
