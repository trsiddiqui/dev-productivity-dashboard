'use client';

import type {
  ContributionGapMode,
  ContributionIssueLinkSource,
  ContributionResponse,
  JiraIssue,
  PR,
} from '@/lib/types';
import { JSX, useEffect, useMemo, useState } from 'react';
import { ContributionMetricBars, type ContributionMetricBarItem } from './ContributionMetricBars';
import { ContributionTrendChart } from './ContributionTrendChart';
import { RepoContributionChart } from './RepoContributionChart';

interface Props {
  data: ContributionResponse;
  title?: string;
  gapMode: ContributionGapMode;
  maskIdentity?: boolean;
}

export interface ContributionProfileSection {
  id: string;
  node: JSX.Element | null;
}

const sourceLabel: Record<ContributionIssueLinkSource, string> = {
  'dev-status': 'Dev status',
  'pr-metadata': 'PR metadata',
  'commit-metadata': 'Commit metadata',
};

const sourceStyle: Record<ContributionIssueLinkSource, { background: string; color: string; border: string }> = {
  'dev-status': { background: 'rgba(59, 130, 246, 0.16)', color: '#93c5fd', border: 'rgba(59, 130, 246, 0.28)' },
  'pr-metadata': { background: 'rgba(34, 197, 94, 0.16)', color: '#86efac', border: 'rgba(34, 197, 94, 0.28)' },
  'commit-metadata': { background: 'rgba(245, 158, 11, 0.16)', color: '#fcd34d', border: 'rgba(245, 158, 11, 0.28)' },
};

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

function isWeekendDate(dateText: string): boolean {
  const parts = dateText.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return false;
  const [year, month, day] = parts;
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
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

function averageValue(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function medianValue(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number(raw.toFixed(1));
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

function DateTimeWithWeekday({ iso }: { iso?: string | null }): JSX.Element {
  if (!iso) {
    return <span>-</span>;
  }

  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return <span>-</span>;
  }

  const dateText = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const timeText = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, whiteSpace: 'nowrap' }}>
      <span>{`${dateText} ${timeText}`}</span>
      <span style={{ fontSize: 12, color: 'var(--panel-muted)' }}>{weekday}</span>
    </div>
  );
}

function countsAsGapDay(dateText: string, gapMode: ContributionGapMode): boolean {
  return gapMode === 'calendar' || !isWeekendDate(dateText);
}

function gapUnitLabelPlural(gapMode: ContributionGapMode): string {
  return gapMode === 'calendar' ? 'calendar days' : 'weekdays';
}

function maskedEntityLabel(prefix: 'PR' | 'Ticket' | 'Repository', index: number): string {
  return `${prefix} ${index + 1}`;
}

function SourceBadges(props: {
  sources?: ContributionIssueLinkSource[];
  selectedSource?: ContributionIssueLinkSource | null;
  onToggleSource?: (source: ContributionIssueLinkSource) => void;
  marginTop?: number;
}): JSX.Element | null {
  const {
    sources,
    selectedSource,
    onToggleSource,
    marginTop = 6,
  } = props;

  if (!sources || sources.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop }}>
      {sources.map((source) => (
        <button
          key={source}
          type="button"
          onClick={onToggleSource ? () => onToggleSource(source) : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            background: sourceStyle[source].background,
            color: sourceStyle[source].color,
            border: `1px solid ${sourceStyle[source].border}`,
            cursor: onToggleSource ? 'pointer' : 'default',
            opacity: selectedSource && selectedSource !== source ? 0.65 : 1,
            boxShadow: selectedSource === source ? '0 0 0 1px rgba(255,255,255,0.18) inset' : 'none',
            outline: 'none',
          }}
        >
          {sourceLabel[source]}
        </button>
      ))}
    </div>
  );
}

function buildSignalNotes(data: ContributionResponse, gapMode: ContributionGapMode): string[] {
  const notes: string[] = [];
  const { kpis, reviews, issueCycle, prCycle, wip } = data;
  const peakWip = wip.reduce((max, item) => Math.max(max, item.openPRs, item.activeIssues), 0);
  const daysWithoutActiveTicket = wip.filter((item) => countsAsGapDay(item.date, gapMode) && item.activeIssues === 0).length;
  let longestNoTicketGapDays = 0;
  let currentNoTicketGap = 0;
  for (const item of wip) {
    if (countsAsGapDay(item.date, gapMode) && item.activeIssues === 0) {
      currentNoTicketGap += 1;
      longestNoTicketGapDays = Math.max(longestNoTicketGapDays, currentNoTicketGap);
    } else {
      currentNoTicketGap = 0;
    }
  }

  if (kpis.activeDayRate < 25) {
    notes.push(`Contributions only landed on ${kpis.activeDayRate}% of the days in this window.`);
  }
  if (kpis.longestIdleGapDays >= 4) {
    notes.push(`The longest idle stretch is ${kpis.longestIdleGapDays} days, which can point to blockers or thin delivery cadence.`);
  }
  if (kpis.burstiestDayShare >= 45) {
    notes.push(`${kpis.burstiestDayShare}% of all LOC landed in one day, which usually means work is batching up.`);
  }
  if (reviews.given.reviewedPRs === 0) {
    notes.push('No reviews were recorded on other developers\' PRs in this window.');
  } else if (reviews.given.reviewComments === 0) {
    notes.push(`Reviewed ${reviews.given.reviewedPRs} PRs in this window without leaving threaded review comments.`);
  }
  if (reviews.received.reviewedPRs === 0 && data.prs.length > 0) {
    notes.push('None of this developer\'s tracked-base PRs show recorded review activity in this window.');
  }
  if ((prCycle.medianLastCommitToReviewHours ?? 0) >= 24) {
    notes.push(`Median wait from last commit to first review is ${formatHours(prCycle.medianLastCommitToReviewHours)}, which suggests review pickup may be the bottleneck.`);
  }
  if ((issueCycle.medianCycleTimeHours ?? 0) >= 72) {
    notes.push(`Linked Jira issues take a median of ${formatHours(issueCycle.medianCycleTimeHours)} from in progress to done, so issue flow may be dragging.`);
  }
  if (peakWip >= 4 && kpis.totalPRs <= 2) {
    notes.push(`WIP peaks at ${peakWip} items while only ${kpis.totalPRs} tracked-base PRs landed, which can be a sign of too much work staying open.`);
  }
  if (longestNoTicketGapDays >= 2) {
    notes.push(`${daysWithoutActiveTicket} ${gapUnitLabelPlural(gapMode)} in this window have no active Jira subtask, including a longest gap of ${longestNoTicketGapDays} ${gapUnitLabelPlural(gapMode)}.`);
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

function ReviewSummaryGroup(props: {
  title: string;
  subtitle: string;
  emphasisLabel: string;
  emphasisValue: string;
  secondaryLabel: string;
  secondaryValue: string;
  summary: ContributionResponse['reviews']['given'];
  tone: 'blue' | 'amber';
}): JSX.Element {
  const accent = props.tone === 'blue'
    ? {
      bg: 'rgba(96,165,250,0.12)',
      border: 'rgba(96,165,250,0.20)',
      text: '#dbeafe',
      muted: '#bfdbfe',
    }
    : {
      bg: 'rgba(245,158,11,0.12)',
      border: 'rgba(245,158,11,0.20)',
      text: '#ffedd5',
      muted: '#fde68a',
    };

  return (
    <div style={{ background: accent.bg, border: `1px solid ${accent.border}`, borderRadius: 14, padding: 14, display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: accent.text }}>{props.title}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>{props.subtitle}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(15,23,42,0.18)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: accent.muted, fontWeight: 700 }}>
            {props.emphasisLabel}
          </div>
          <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800 }}>{props.emphasisValue}</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(15,23,42,0.18)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: accent.muted, fontWeight: 700 }}>
            {props.secondaryLabel}
          </div>
          <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800 }}>{props.secondaryValue}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
        <ReviewStatCard label="Total Reviews" value={metricValue(props.summary.totalReviews)} />
        <ReviewStatCard label="Avg Reviews / PR" value={metricValue(props.summary.avgReviewsPerPR)} />
        <ReviewStatCard label="Approvals" value={metricValue(props.summary.approvals)} />
        <ReviewStatCard label="Change Requests" value={metricValue(props.summary.changesRequested)} />
      </div>
    </div>
  );
}

export function useContributionProfileSections({ data, title, gapMode, maskIdentity = false }: Props): ContributionProfileSection[] {
  const [selectedLinkSource, setSelectedLinkSource] = useState<ContributionIssueLinkSource | null>(null);

  const availableLinkSources = useMemo(
    () => Array.from(new Set(
      data.linkedTickets.flatMap((ticket) => ticket.linkSources ?? []),
    )),
    [data.linkedTickets],
  );

  useEffect(() => {
    if (selectedLinkSource && !availableLinkSources.includes(selectedLinkSource)) {
      setSelectedLinkSource(null);
    }
  }, [availableLinkSources, selectedLinkSource]);

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

  const workingTicketRows = useMemo(
    () => [...data.issues]
      .map((issue) => ({
        issue,
        workHours: diffHours(issue.inProgressAt, issue.mergedAt),
      }))
      .filter((item): item is { issue: JiraIssue; workHours: number } => item.workHours !== null)
      .sort((left, right) => right.workHours - left.workHours),
    [data.issues],
  );

  const avgWorkingTicketHours = useMemo(
    () => averageValue(workingTicketRows.map((item) => item.workHours)),
    [workingTicketRows],
  );

  const medianWorkingTicketHours = useMemo(
    () => medianValue(workingTicketRows.map((item) => item.workHours)),
    [workingTicketRows],
  );

  const daysWithoutActiveTicket = useMemo(
    () => data.wip.filter((item) => countsAsGapDay(item.date, gapMode) && item.activeIssues === 0).length,
    [data.wip, gapMode],
  );

  const longestNoTicketGapDays = useMemo(() => {
    let longest = 0;
    let current = 0;

    for (const item of data.wip) {
      if (countsAsGapDay(item.date, gapMode) && item.activeIssues === 0) {
        current += 1;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
    }

    return longest;
  }, [data.wip, gapMode]);

  const notes = useMemo(() => buildSignalNotes(data, gapMode), [data, gapMode]);

  const stats = [
    { label: 'Dev PRs', value: metricValue(data.kpis.totalPRs) },
    { label: 'LOC Changed', value: metricValue(data.kpis.totalLocChanged) },
    { label: 'Touched Ticket SP', value: metricValue(data.kpis.touchedTicketStoryPoints) },
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

  const jiraPrTimingItems: ContributionMetricBarItem[] = [
    {
      label: 'Time Spent in Coding',
      subtitle: data.jiraPrTiming.codingSampleSize > 0 ? `${data.jiraPrTiming.codingSampleSize} PRs` : undefined,
      value: data.jiraPrTiming.avgCodingHours ?? 0,
      fill: '#38bdf8',
    },
    {
      label: 'Cycle Time',
      subtitle: data.jiraPrTiming.cycleSampleSize > 0 ? `${data.jiraPrTiming.cycleSampleSize} tickets` : undefined,
      value: data.jiraPrTiming.avgCycleTimeHours ?? 0,
      fill: '#34d399',
    },
  ];

  const issueCycleItems: ContributionMetricBarItem[] = slowestIssues.map(({ issue, cycleHours }, index) => ({
    label: maskIdentity ? maskedEntityLabel('Ticket', index) : issue.key,
    subtitle: [
      issue.status?.trim() || 'Status unknown',
      issue.storyPoints !== undefined ? `${issue.storyPoints} SP` : null,
    ].filter(Boolean).join(' - '),
    value: cycleHours,
    fill: '#a855f7',
  }));

  const repoItems = useMemo(
    () => maskIdentity
      ? data.repos.map((repo, index) => ({
        ...repo,
        repo: maskedEntityLabel('Repository', index),
      }))
      : data.repos,
    [data.repos, maskIdentity],
  );

  const filteredLinkedIssues = useMemo(
    () => [...data.linkedTickets]
      .filter((ticket) => !selectedLinkSource || (ticket.linkSources ?? []).includes(selectedLinkSource))
      .sort((left, right) => left.key.localeCompare(right.key)),
    [data.linkedTickets, selectedLinkSource],
  );

  function toggleLinkSource(source: ContributionIssueLinkSource): void {
    setSelectedLinkSource((current) => current === source ? null : source);
  }

  return [
    {
      id: 'summary',
      node: (
        <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>{title ?? `${data.login} Contribution Snapshot`}</h2>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
            Measures code that first lands in the tracked base branch, which is usually <code>dev</code> and <code>staging</code> for <code>aligncommerce/website</code>, ignoring later promotions into QA and production.
          </p>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
            <code>Touched Ticket SP</code> sums unique Jira story points where a dev PR was opened or a commit referenced the ticket during this window, using Jira dev-status links where available and rolling linked subtasks up to their parent ticket points.
          </p>
          {maskIdentity ? (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.28)', color: '#cbd5f5', fontSize: 12, fontWeight: 600 }}>
              Identity masking is on. Developer names, PR references, ticket references, and repo labels are hidden in the detailed sections below.
            </div>
          ) : null}
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
      ),
    },
    {
      id: 'patterns',
      node: (
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
      ),
    },
    {
      id: 'contribution-pattern',
      node: (
        <ContributionTrendChart
          items={data.daily}
          title="Contribution Pattern Signal"
          subtitle="Long flat stretches usually mean low output or blockers. Tall one-day spikes often mean the work is landing in batches instead of steadily."
        />
      ),
    },
    {
      id: 'reviews',
      node: (
        <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>PR Reviews and Review Activity</h3>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
            This view separates reviews given by the selected developer from reviews received on the selected developer&apos;s own tracked-base PRs. Median review wait still measures how long their own PRs waited for first review.
          </p>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <ReviewSummaryGroup
              title="Reviews Given"
              subtitle="Review activity this developer authored on other people&apos;s PRs."
              emphasisLabel="PRs Reviewed"
              emphasisValue={metricValue(data.reviews.given.reviewedPRs)}
              secondaryLabel="Comments Left"
              secondaryValue={metricValue(data.reviews.given.reviewComments)}
              summary={data.reviews.given}
              tone="blue"
            />
            <ReviewSummaryGroup
              title="Reviews Received"
              subtitle="Review activity other people recorded on this developer&apos;s tracked-base PRs."
              emphasisLabel="Own PRs Reviewed"
              emphasisValue={metricValue(data.reviews.received.reviewedPRs)}
              secondaryLabel="Comments Received"
              secondaryValue={metricValue(data.reviews.received.reviewComments)}
              summary={data.reviews.received}
              tone="amber"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <ReviewStatCard label="Comment Reviews Given" value={metricValue(data.reviews.given.comments)} />
            <ReviewStatCard label="Comment Reviews Received" value={metricValue(data.reviews.received.comments)} />
            <ReviewStatCard label="Median Review Wait" value={formatHours(data.prCycle.medianLastCommitToReviewHours)} />
          </div>
        </div>
      </div>
      ),
    },
    {
      id: 'pr-cycle',
      node: data.prCycle.sampleSize > 0 ? (
        <ContributionMetricBars
          title="Exact PR Cycle Time Breakdown"
          subtitle="Large last-commit-to-review time means work is waiting on reviewers. Large review-to-merge time often points to rework or slow approvals."
          items={prCycleItems}
          valueFormatter={formatHours}
        />
      ) : (
        <EmptyPanel
          title="Exact PR Cycle Time Breakdown"
          text="No merged tracked-base PRs in this window have enough commit history to calculate exact PR cycle times."
        />
      ),
    },
    {
      id: 'jira-to-pr',
      node: (data.jiraPrTiming.codingSampleSize > 0 || data.jiraPrTiming.cycleSampleSize > 0) ? (
        <ContributionMetricBars
          title="Jira to PR Timing Breakdown"
          subtitle="Average timings based on the Jira ticket linked in the PR title or branch name. If the linked issue is a subtask, the parent ticket's Jira timestamps are used."
          items={jiraPrTimingItems}
          valueFormatter={formatHours}
        />
      ) : (
        <EmptyPanel
          title="Jira to PR Timing Breakdown"
          text="No linked Jira tickets in this window have enough phase history to calculate average coding and cycle timings."
        />
      ),
    },
    {
      id: 'slowest-prs',
      node: slowestPRs.length > 0 ? (
        <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
          <div style={{ marginBottom: 8 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>Slowest Dev PR Cycles</h3>
            <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
              These are the merged tracked-base PRs with the longest span from first commit to merge.
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
                {slowestPRs.map(({ pr, cycleHours }, index) => (
                  <tr key={pr.id}>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)' }}>
                      {maskIdentity ? (
                        <div>
                          <div>{maskedEntityLabel('PR', index)}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>
                            Repository hidden
                          </div>
                        </div>
                      ) : (
                        <>
                          <a href={pr.url} target="_blank" rel="noreferrer">
                            #{pr.number} {pr.title}
                          </a>
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>
                            {pr.repository.owner}/{pr.repository.name}
                          </div>
                        </>
                      )}
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
      ) : null,
    },
    {
      id: 'linked-tickets',
      node: data.linkedTickets.length > 0 ? (
        <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>Linked Jira Tickets</h3>
            <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
              Source badges show how each Jira ticket was linked into this dashboard: Jira dev-status PR association, ticket key in a tracked-base PR title or branch, or ticket key found in commit messages in the selected window. When the linked item is a subtask, this table rolls it up to the parent Story, Bug, or Task and uses the parent status and story points. Click a badge to narrow this table to one link source.
            </p>
          </div>
          {availableLinkSources.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setSelectedLinkSource(null)}
                style={{
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: `1px solid ${selectedLinkSource ? 'var(--panel-br)' : 'rgba(255,255,255,0.18)'}`,
                  background: selectedLinkSource ? 'transparent' : 'rgba(148, 163, 184, 0.18)',
                  color: 'var(--panel-fg)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                All sources
              </button>
              <SourceBadges
                sources={availableLinkSources}
                selectedSource={selectedLinkSource}
                onToggleSource={toggleLinkSource}
                marginTop={0}
              />
            </div>
          ) : null}
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>Ticket</th>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>SP</th>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>Link Sources</th>
                </tr>
              </thead>
              <tbody>
                {filteredLinkedIssues.map((issue, index) => (
                    <tr key={`link-${issue.key}`}>
                      <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)' }}>
                        {maskIdentity ? (
                          <span>{maskedEntityLabel('Ticket', index)}</span>
                        ) : (
                          <a href={issue.url} target="_blank" rel="noreferrer">
                            {issue.key} {issue.summary}
                          </a>
                        )}
                        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>
                          {issue.issueType ?? 'Ticket'}
                          {!maskIdentity && issue.sourceIssueKeys && issue.sourceIssueKeys.some((key) => key !== issue.key)
                            ? ` - linked via ${issue.sourceIssueKeys.filter((key) => key !== issue.key).join(', ')}`
                            : ''}
                        </div>
                      </td>
                      <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)' }}>
                        {issue.status ?? 'Status unknown'}
                      </td>
                      <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {issue.storyPoints?.toLocaleString() ?? '-'}
                      </td>
                      <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)' }}>
                        <SourceBadges
                          sources={issue.linkSources}
                          selectedSource={selectedLinkSource}
                          onToggleSource={toggleLinkSource}
                        />
                      </td>
                    </tr>
                  ))}
                {filteredLinkedIssues.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '12px 0', color: 'var(--panel-muted)' }}>
                      No linked Jira tickets match the selected source filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null,
    },
    {
      id: 'ticket-working-time',
      node: workingTicketRows.length > 0 ? (
        <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>Ticket Working Time (In Progress - Merged)</h3>
            <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
              Useful during active delivery tracking: this isolates the engineering execution window from the first Jira move into <code>In Progress</code> until the Jira ticket reaches <code>Merged</code>. Rising averages or long {gapMode === 'calendar' ? 'calendar-day' : 'weekday'} zero-subtask gaps usually mean work is waiting to start, batching up, or getting blocked before merge.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
            <ReviewStatCard label="Tickets with Merged Status" value={metricValue(workingTicketRows.length)} />
            <ReviewStatCard label="Avg Working Time" value={formatHours(avgWorkingTicketHours)} />
            <ReviewStatCard label="Median Working Time" value={formatHours(medianWorkingTicketHours)} />
            <ReviewStatCard label={`${gapUnitLabelPlural(gapMode)} with No Active Subtask`} value={metricValue(daysWithoutActiveTicket)} />
            <ReviewStatCard label={gapMode === 'calendar' ? 'Longest Calendar-Day Subtask Gap' : 'Longest Weekday Subtask Gap'} value={metricValue(longestNoTicketGapDays, 'd')} />
          </div>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>Ticket</th>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>In Progress</th>
                  <th style={{ textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>Merged</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>Work Time</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', borderBottom: '1px solid var(--panel-br)' }}>SP</th>
                </tr>
              </thead>
              <tbody>
                {workingTicketRows.map(({ issue, workHours }, index) => (
                  <tr key={issue.key}>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)' }}>
                      {maskIdentity ? (
                        <span>{maskedEntityLabel('Ticket', index)}</span>
                      ) : (
                        <a href={issue.url} target="_blank" rel="noreferrer">
                          {issue.key} {issue.summary}
                        </a>
                      )}
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>
                        {issue.status ?? 'Status unknown'}
                      </div>
                      <SourceBadges sources={issue.linkSources} />
                    </td>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', whiteSpace: 'nowrap' }}>
                      <DateTimeWithWeekday iso={issue.inProgressAt} />
                    </td>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', whiteSpace: 'nowrap' }}>
                      <DateTimeWithWeekday iso={issue.mergedAt} />
                    </td>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatHours(workHours)}
                    </td>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {issue.storyPoints?.toLocaleString() ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyPanel
          title="Ticket Working Time (In Progress - Merged)"
          text="No linked Jira tickets in this window have both an In Progress timestamp and a Jira Merged timestamp yet, so active working time cannot be calculated."
        />
      ),
    },
    {
      id: 'issue-cycle',
      node: data.issueCycle.completedCount > 0 ? (
        <>
          <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 600 }}>Issue Cycle Time</h3>
              <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
                Uses linked Jira issues and measures the full ticket flow from <code>In Progress</code> to <code>Done/Approved</code>, after matching tickets through Jira dev-status PR links plus PR and commit metadata.
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
              subtitle="Technical details: this uses Jira changelog timestamps, measuring from the first move into In Progress to the first move into Done or Approved. Ticket linkage is tightened with Jira dev-status PR associations, then supplemented with tracked-base PR metadata and commit references when available. Large outliers usually mean QA wait time, blocked work, or rework."
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
      ),
    },
    {
      id: 'repo-contribution',
      node: <RepoContributionChart items={repoItems} />,
    },
    {
      id: 'largest-prs',
      node: (
        <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>Largest Dev PRs in the Window</h3>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--panel-muted)' }}>
            Useful for checking whether the output is spread across several PRs or concentrated in one or two large drops.
          </p>
        </div>
        {topPRs.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--panel-muted)' }}>No matching tracked-base PRs landed in this window.</div>
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
                {topPRs.map((pr, index) => (
                  <tr key={pr.id}>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)', whiteSpace: 'nowrap' }}>
                      <DateWithWeekday date={eventDate(pr, data.dateMode)} />
                    </td>
                    <td style={{ padding: '10px 0', borderBottom: '1px solid var(--panel-br)' }}>
                      {maskIdentity ? (
                        <div>
                          <div>{maskedEntityLabel('PR', index)}</div>
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>
                            Repository and branch hidden
                          </div>
                        </div>
                      ) : (
                        <>
                          <a href={pr.url} target="_blank" rel="noreferrer">
                            #{pr.number} {pr.title}
                          </a>
                          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--panel-muted)' }}>
                            {pr.repository.owner}/{pr.repository.name}
                            {pr.headRefName ? ` - ${pr.headRefName}` : ''}
                          </div>
                        </>
                      )}
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
      ),
    },
  ];
}

export function ContributionProfile(props: Props): JSX.Element {
  const sections = useContributionProfileSections(props);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {sections.map((section) => section.node ? <div key={section.id}>{section.node}</div> : null)}
    </div>
  );
}
