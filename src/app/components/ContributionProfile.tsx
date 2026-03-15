'use client';

import type { ContributionResponse, JiraIssue, PR } from '@/lib/types';
import { JSX, useMemo } from 'react';
import { ContributionMetricBars, type ContributionMetricBarItem } from './ContributionMetricBars';
import { ContributionTrendChart } from './ContributionTrendChart';
import { ContributionWipChart } from './ContributionWipChart';
import { RepoContributionChart } from './RepoContributionChart';

interface Props {
  data: ContributionResponse;
  title?: string;
}

function metricValue(value: number | null, suffix = ''): string {
  if (value === null) return '-';
  return `${value.toLocaleString()}${suffix}`;
}

function weekdayLabelFromDate(dateText: string): string | null {
  const parts = dateText.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = parts;
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
}

function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (value >= 48) return `${(value / 24).toFixed(1)}d`;
  return `${value.toFixed(1)}h`;
}

function diffHours(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, (endMs - startMs) / 36e5);
}

function eventDate(pr: PR, dateMode: ContributionResponse['dateMode']): string {
  return (dateMode === 'merged' ? pr.mergedAt : pr.createdAt)?.slice(0, 10) ?? '-';
}

function DateWithWeekday({ date }: { date: string }): JSX.Element {
  const weekday = weekdayLabelFromDate(date);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, whiteSpace: 'nowrap' }}>
      <span>{date}</span>
      <span style={{ fontSize: 12, color: 'var(--panel-muted)' }}>{weekday ?? '-'}</span>
    </div>
  );
}

function buildSignalNotes(data: ContributionResponse): string[] {
  const notes: string[] = [];
  const { kpis, reviews, issueCycle, prCycle, wip } = data;
  const peakWip = wip.reduce((max, item) => Math.max(max, item.openPRs, item.activeIssues), 0);

  if (kpis.activeDayRate < 25) {
    notes.push(`Contributions only landed on ${kpis.activeDayRate}% of the days in this window.`);
  }
  if (kpis.longestIdleGapDays >= 4) {
    notes.push(`The longest idle stretch is ${kpis.longestIdleGapDays} days, which can point to blockers or thin delivery cadence.`);
  }
  if (kpis.burstiestDayShare >= 45) {
    notes.push(`${kpis.burstiestDayShare}% of all LOC landed in one day, which usually means work is batching up.`);
  }
  if (reviews.reviewCoveragePct < 70 && data.prs.length > 0) {
    notes.push(`Only ${reviews.reviewCoveragePct}% of dev PRs show recorded review activity, which may mean reviews are being skipped or not landing quickly.`);
  }
  if ((prCycle.medianLastCommitToReviewHours ?? 0) >= 24) {
    notes.push(`Median wait from last commit to first review is ${formatHours(prCycle.medianLastCommitToReviewHours)}, which suggests review pickup may be the bottleneck.`);
  }
  if ((issueCycle.medianCycleTimeHours ?? 0) >= 72) {
    notes.push(`Linked Jira issues take a median of ${formatHours(issueCycle.medianCycleTimeHours)} from in progress to done, so issue flow may be dragging.`);
  }
  if (peakWip >= 4 && kpis.totalPRs <= 2) {
    notes.push(`WIP peaks at ${peakWip} items while only ${kpis.totalPRs} dev PRs landed, which can be a sign of too much work staying open.`);
  }
  if (!notes.length) {
    notes.push('Delivery is relatively steady in this window, with no obvious cadence, review, or WIP warning signal.');
  }

  return notes;
}

function EmptyPanel({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
      <div style={{ fontSize: 14, color: 'var(--panel-muted)' }}>{text}</div>
    </div>
  );
}

function ReviewStatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ background: 'var(--kpi-bg)', border: '1px solid var(--kpi-br)', borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--panel-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--kpi-fg)' }}>{value}</div>
    </div>
  );
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

  const slowestIssues = useMemo(
    () => [...data.issues]
      .map((issue) => ({
        issue,
        cycleHours: diffHours(issue.inProgressAt, issue.completeAt),
      }))
      .filter((item): item is { issue: JiraIssue; cycleHours: number } => item.cycleHours !== null)
      .sort((left, right) => right.cycleHours - left.cycleHours)
      .slice(0, 6),
    [data.issues],
  );

  const slowestPRs = useMemo(
    () => [...data.prs]
      .map((pr) => ({
        pr,
        cycleHours: diffHours(pr.firstCommitAt, pr.mergedAt),
      }))
      .filter((item): item is { pr: PR; cycleHours: number } => item.cycleHours !== null)
      .sort((left, right) => right.cycleHours - left.cycleHours)
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

  const prCycleItems: ContributionMetricBarItem[] = [
    { label: 'First commit -> merge', value: data.prCycle.medianFirstCommitToMergeHours ?? 0, fill: '#60a5fa' },
    { label: 'Coding window', value: data.prCycle.medianCodingHours ?? 0, fill: '#22c55e' },
    { label: 'Last commit -> review', value: data.prCycle.medianLastCommitToReviewHours ?? 0, fill: '#f59e0b' },
    { label: 'Review -> merge', value: data.prCycle.medianReviewToMergeHours ?? 0, fill: '#ef4444' },
  ];

  const issueCycleItems: ContributionMetricBarItem[] = slowestIssues.map(({ issue, cycleHours }) => ({
    label: issue.key,
    value: cycleHours,
    fill: '#a855f7',
  }));

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

      <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>PR Reviews and Review Activity</h3>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
            Low review coverage or long waits for first review usually highlight either review bottlenecks or a lack of reviewer engagement.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <ReviewStatCard label="Total Reviews" value={metricValue(data.reviews.totalReviews)} />
          <ReviewStatCard label="Reviewed PRs" value={`${data.reviews.reviewedPRs}/${data.kpis.totalPRs}`} />
          <ReviewStatCard label="Review Coverage" value={metricValue(data.reviews.reviewCoveragePct, '%')} />
          <ReviewStatCard label="Avg Reviews / PR" value={metricValue(data.reviews.avgReviewsPerPR)} />
          <ReviewStatCard label="Approvals" value={metricValue(data.reviews.approvals)} />
          <ReviewStatCard label="Change Requests" value={metricValue(data.reviews.changesRequested)} />
          <ReviewStatCard label="Comment Reviews" value={metricValue(data.reviews.comments)} />
          <ReviewStatCard label="Median Review Wait" value={formatHours(data.prCycle.medianLastCommitToReviewHours)} />
        </div>
      </div>

      {data.prCycle.sampleSize > 0 ? (
        <ContributionMetricBars
          title="Exact PR Cycle Time Breakdown"
          subtitle="Large last-commit-to-review time means work is waiting on reviewers. Large review-to-merge time often points to rework or slow approvals."
          items={prCycleItems}
          valueFormatter={formatHours}
        />
      ) : (
        <EmptyPanel
          title="Exact PR Cycle Time Breakdown"
          text="No merged dev PRs in this window have enough commit history to calculate exact PR cycle times."
        />
      )}

      {slowestPRs.length > 0 && (
        <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>Slowest Dev PR Cycles</h3>
            <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
              These are the merged dev PRs with the longest span from first commit to merge.
            </p>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>PR</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>Cycle</th>
                </tr>
              </thead>
              <tbody>
                {slowestPRs.map(({ pr, cycleHours }) => (
                  <tr key={pr.id}>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)' }}>
                      <a href={pr.url} target="_blank" rel="noreferrer">
                        #{pr.number} {pr.title}
                      </a>
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>
                        {pr.repository.owner}/{pr.repository.name}
                      </div>
                    </td>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatHours(cycleHours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ContributionWipChart items={data.wip} />

      {data.issueCycle.completedCount > 0 ? (
        <>
          <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600 }}>Issue Cycle Time</h3>
              <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
                Uses linked Jira issues and measures the time from <code>In Progress</code> to <code>Done/Approved</code>.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
              <ReviewStatCard label="Linked Issues" value={metricValue(data.issueCycle.sampleSize)} />
              <ReviewStatCard label="Completed Issues" value={metricValue(data.issueCycle.completedCount)} />
              <ReviewStatCard label="Median Cycle Time" value={formatHours(data.issueCycle.medianCycleTimeHours)} />
              <ReviewStatCard label="Avg Cycle Time" value={formatHours(data.issueCycle.avgCycleTimeHours)} />
            </div>
          </div>
          {issueCycleItems.length > 0 ? (
            <ContributionMetricBars
              title="Slowest Linked Issue Cycles"
              subtitle="If the slowest issues are much larger than the median, delivery may be stalling in QA, waiting, or rework."
              items={issueCycleItems}
              valueFormatter={formatHours}
            />
          ) : null}
        </>
      ) : (
        <EmptyPanel
          title="Issue Cycle Time"
          text="No linked Jira issues in this window have both In Progress and completion timestamps, so issue cycle time cannot be calculated yet."
        />
      )}

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
                      <DateWithWeekday date={eventDate(pr, data.dateMode)} />
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
