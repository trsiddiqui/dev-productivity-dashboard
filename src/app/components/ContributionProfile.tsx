'use client';

import type { ContributionResponse, PR } from '@/lib/types';
import { JSX, useMemo } from 'react';
import { ContributionTrendChart } from './ContributionTrendChart';
import { RepoContributionChart } from './RepoContributionChart';

interface Props {
  data: ContributionResponse;
  title?: string;
}

function metricValue(value: number | null, suffix = ''): string {
  if (value === null) return '-';
  return `${value.toLocaleString()}${suffix}`;
}

function eventDate(pr: PR, dateMode: ContributionResponse['dateMode']): string {
  return (dateMode === 'merged' ? pr.mergedAt : pr.createdAt)?.slice(0, 10) ?? '-';
}

function buildSignalNotes(data: ContributionResponse): string[] {
  const notes: string[] = [];
  const { kpis } = data;

  if (kpis.activeDayRate < 25) {
    notes.push(`Contributions only landed on ${kpis.activeDayRate}% of the days in this window.`);
  }
  if (kpis.longestIdleGapDays >= 4) {
    notes.push(`The longest idle stretch is ${kpis.longestIdleGapDays} days, which can point to blockers or thin delivery cadence.`);
  }
  if (kpis.burstiestDayShare >= 45) {
    notes.push(`${kpis.burstiestDayShare}% of all LOC landed in one day, which usually means work is batching up.`);
  }
  if (kpis.avgDaysBetweenPRs !== null && kpis.avgDaysBetweenPRs > 3) {
    notes.push(`Average spacing between dev PRs is ${kpis.avgDaysBetweenPRs} days, so throughput is landing slowly.`);
  }
  if (!notes.length) {
    notes.push('Delivery is relatively steady in this window, with no obvious idle-gap or batching signal.');
  }

  return notes;
}

export function ContributionProfile({ data, title }: Props): JSX.Element {
  const topPRs = useMemo(
    () => [...data.prs]
      .sort((left, right) => {
        const leftLoc = (left.additions ?? 0) + (left.deletions ?? 0);
        const rightLoc = (right.additions ?? 0) + (right.deletions ?? 0);
        return rightLoc - leftLoc;
      })
      .slice(0, 6),
    [data.prs],
  );

  const notes = useMemo(() => buildSignalNotes(data), [data]);

  const stats = [
    { label: 'Dev PRs', value: metricValue(data.kpis.totalPRs) },
    { label: 'LOC Changed', value: metricValue(data.kpis.totalLocChanged) },
    { label: 'Active Days', value: metricValue(data.kpis.activeDays) },
    { label: 'Active Day Rate', value: metricValue(data.kpis.activeDayRate, '%') },
    { label: 'Median PR Size', value: metricValue(data.kpis.medianLocPerPR, ' LOC') },
    { label: 'Longest Idle Gap', value: metricValue(data.kpis.longestIdleGapDays, 'd') },
  ];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>{title ?? `${data.login} Contribution Snapshot`}</h2>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
            Measures code that first lands in <code>dev</code>, ignoring later promotions into QA and production.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          {stats.map((item) => (
            <div key={item.label} style={{ background: 'var(--kpi-bg)', border: '1px solid var(--kpi-br)', borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--panel-muted)', marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--kpi-fg)' }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Patterns to Watch</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {notes.map((note) => (
            <div key={note} style={{ fontSize: 14, color: 'var(--panel-fg)' }}>
              - {note}
            </div>
          ))}
        </div>
      </div>

      <ContributionTrendChart
        items={data.daily}
        title="Contribution Pattern Signal"
        subtitle="Long flat stretches usually mean low output or blockers. Tall one-day spikes often mean the work is landing in batches instead of steadily."
      />

      <RepoContributionChart items={data.repos} />

      <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>Largest Dev PRs in the Window</h3>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
            Useful for checking whether the output is spread across several PRs or concentrated in one or two large drops.
          </p>
        </div>
        {topPRs.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--panel-muted)' }}>No matching dev PRs landed in this window.</div>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>PR</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>LOC</th>
                </tr>
              </thead>
              <tbody>
                {topPRs.map((pr) => (
                  <tr key={pr.id}>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', whiteSpace: 'nowrap' }}>
                      {eventDate(pr, data.dateMode)}
                    </td>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)' }}>
                      <a href={pr.url} target="_blank" rel="noreferrer">
                        #{pr.number} {pr.title}
                      </a>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>
                        {pr.repository.owner}/{pr.repository.name}
                        {pr.headRefName ? ` - ${pr.headRefName}` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {((pr.additions ?? 0) + (pr.deletions ?? 0)).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
