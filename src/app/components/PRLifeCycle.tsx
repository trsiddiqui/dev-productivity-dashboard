'use client';

import * as React from 'react';
import type { PRLifecycle, LifecycleStats } from '../../lib/types';
import { JSX } from 'react';

function Hrs({ v }: { v?: number | null }): JSX.Element {
  if (v === null || v === undefined) return <span>—</span>;
  if (v >= 48) return <span>{(v / 24).toFixed(1)}d</span>;
  return <span>{v.toFixed(1)}h</span>;
}


function Num({ v }: { v?: number | null }): JSX.Element {
  if (v === null || v === undefined) return <span>0</span>;
  const n = Number.isFinite(v) ? (v as number) : 0;
  return <span>{n.toLocaleString()}</span>;
}


function DateTwoLine({ iso }: { iso?: string | null }): JSX.Element {
  if (!iso) return <span>—</span>;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return <span>—</span>;

  const date = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);

  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(d);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, textAlign: 'right', whiteSpace: 'nowrap' }}>
      <span>{date}</span>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>{time}</span>
    </div>
  );
}

export function PRLifecycleView({
  items,
  stats,
}: {
  items: PRLifecycle[];
  stats: LifecycleStats;
}): JSX.Element {

  const thBase: React.CSSProperties = {
    padding: '10px 12px',
    borderRight: '1px solid #1f2937',
    background: '#0b0b0b',
    color: '#e5e7eb',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };
  const thLeft: React.CSSProperties = { ...thBase, textAlign: 'left' };
  const thRight: React.CSSProperties = { ...thBase, textAlign: 'right' };

  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderRight: '1px solid #1f2937',
    verticalAlign: 'top',
  };

  return (
    <div style={{ background: '#0b0b0b', borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
      <h2 style={{ fontWeight: 600, marginBottom: 12 }}>PR Lifecycle</h2>

      {}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
        <Kpi label="Median Time to Ready" value={<Hrs v={stats.medianTimeToReadyHours} />} />
        <Kpi label="Median Time to First Review" value={<Hrs v={stats.medianTimeToFirstReviewHours} />} />
        <Kpi label="Median Review → Merge" value={<Hrs v={stats.medianReviewToMergeHours} />} />
        <Kpi label="Median Cycle Time" value={<Hrs v={stats.medianCycleTimeHours} />} />
      </div>

      {}
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1f2937' }}>
              <th style={thLeft}>PR</th>
              <th style={thRight}>Additions</th>
              <th style={thRight}>Deletions</th>
              <th style={thRight}>Created</th>
              <th style={thRight}>Ready</th>
              <th style={thRight}>First Review</th>
              <th style={thRight}>Merged</th>
              <th style={thRight}>Closed</th>
              <th style={thLeft}>Status</th>
              <th style={thLeft}>→ Ready</th>
              <th style={thLeft}>→ First Review</th>
              <th style={thLeft}>Review → Merge</th>
              <th style={{ ...thLeft, borderRight: 'none' }}>Cycle</th>
            </tr>
          </thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id} style={{ borderBottom: '1px solid #111827' }}>
                <td style={tdStyle}>
                  <a href={i.url} target="_blank" rel="noreferrer">
                    #{i.number} {i.title}
                  </a>
                </td>

                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <Num v={i.additions} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <Num v={i.deletions} />
                </td>

                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <DateTwoLine iso={i.createdAt} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <DateTwoLine iso={i.readyForReviewAt ?? null} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <DateTwoLine iso={i.firstReviewAt ?? null} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <DateTwoLine iso={i.mergedAt ?? null} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <DateTwoLine iso={i.closedAt ?? null} />
                </td>

                <td style={tdStyle}>
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

                <td style={tdStyle}><Hrs v={i.timeToReadyHours} /></td>
                <td style={tdStyle}><Hrs v={i.timeToFirstReviewHours} /></td>
                <td style={tdStyle}><Hrs v={i.reviewToMergeHours} /></td>
                <td style={{ ...tdStyle, borderRight: 'none' }}><Hrs v={i.cycleTimeHours} /></td>
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
