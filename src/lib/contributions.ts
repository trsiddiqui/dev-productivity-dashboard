import { eachDayOfInterval, formatISO } from 'date-fns';
import type {
  CommitTimeseriesItem,
  ContributionDailyItem,
  ContributionIssueCycleSummary,
  ContributionKpis,
  ContributionPRCycleSummary,
  ContributionRepoItem,
  ContributionReviewSummary,
  ContributionWipItem,
  JiraIssue,
  PR,
} from './types';

type ContributionDateMode = 'created' | 'merged';
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

function eventDateForPR(pr: PR, dateMode: ContributionDateMode): string | null {
  const iso = dateMode === 'merged' ? pr.mergedAt : pr.createdAt;
  return iso ? iso.slice(0, 10) : null;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function round(value: number): number {
  return Number(value.toFixed(1));
}

function diffHours(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, (endMs - startMs) / 36e5);
}

export function extractJiraKeysFromPRs(prs: PR[]): string[] {
  const found = new Set<string>();

  for (const pr of prs) {
    const texts = [pr.title, pr.headRefName].filter(Boolean) as string[];
    for (const text of texts) {
      const matches = text.toUpperCase().match(JIRA_KEY_RE) ?? [];
      for (const match of matches) found.add(match);
    }
  }

  return Array.from(found).sort((left, right) => left.localeCompare(right));
}

export function aggregateContributionDaily(params: {
  from: string;
  to: string;
  prs: PR[];
  dateMode?: ContributionDateMode;
}): ContributionDailyItem[] {
  const { from, to, prs, dateMode = 'merged' } = params;
  const days = eachDayOfInterval({ start: new Date(from), end: new Date(to) });
  const map = new Map<string, ContributionDailyItem>();

  for (const day of days) {
    const key = formatISO(day, { representation: 'date' });
    map.set(key, {
      date: key,
      prCount: 0,
      additions: 0,
      deletions: 0,
      locChanged: 0,
    });
  }

  for (const pr of prs) {
    const key = eventDateForPR(pr, dateMode);
    if (!key || !map.has(key)) continue;
    const row = map.get(key)!;
    const locChanged = (pr.additions ?? 0) + (pr.deletions ?? 0);
    row.prCount += 1;
    row.additions += pr.additions ?? 0;
    row.deletions += pr.deletions ?? 0;
    row.locChanged += locChanged;
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregateContributionPRsByDay(params: {
  from: string;
  to: string;
  prs: PR[];
  dateMode?: ContributionDateMode;
}): CommitTimeseriesItem[] {
  return aggregateContributionDaily(params).map((item) => ({
    date: item.date,
    commits: item.prCount,
    additions: item.additions,
    deletions: item.deletions,
  }));
}

export function summarizeRepoContributions(prs: PR[]): ContributionRepoItem[] {
  const repos = new Map<string, ContributionRepoItem>();

  for (const pr of prs) {
    const repo = `${pr.repository.owner}/${pr.repository.name}`;
    const row = repos.get(repo) ?? {
      repo,
      prs: 0,
      additions: 0,
      deletions: 0,
      locChanged: 0,
    };
    row.prs += 1;
    row.additions += pr.additions ?? 0;
    row.deletions += pr.deletions ?? 0;
    row.locChanged += (pr.additions ?? 0) + (pr.deletions ?? 0);
    repos.set(repo, row);
  }

  return Array.from(repos.values()).sort((a, b) => b.locChanged - a.locChanged || b.prs - a.prs);
}

export function computeContributionKpis(params: {
  from: string;
  to: string;
  prs: PR[];
  dateMode?: ContributionDateMode;
}): ContributionKpis {
  const { prs, dateMode = 'merged' } = params;
  const daily = aggregateContributionDaily(params);
  const totalAdditions = prs.reduce((sum, pr) => sum + (pr.additions ?? 0), 0);
  const totalDeletions = prs.reduce((sum, pr) => sum + (pr.deletions ?? 0), 0);
  const totalLocChanged = totalAdditions + totalDeletions;
  const activeDays = daily.filter((item) => item.locChanged > 0).length;
  const activeDayRate = daily.length > 0 ? (activeDays / daily.length) * 100 : 0;
  const locPerPR = prs.map((pr) => (pr.additions ?? 0) + (pr.deletions ?? 0));
  const eventDates = prs
    .map((pr) => eventDateForPR(pr, dateMode))
    .filter((date): date is string => !!date)
    .sort((a, b) => a.localeCompare(b));

  let longestIdleGapDays = 0;
  let currentIdle = 0;
  for (const item of daily) {
    if (item.locChanged > 0) {
      longestIdleGapDays = Math.max(longestIdleGapDays, currentIdle);
      currentIdle = 0;
    } else {
      currentIdle += 1;
    }
  }
  longestIdleGapDays = Math.max(longestIdleGapDays, currentIdle);

  const burstiestDayShare = totalLocChanged > 0
    ? (Math.max(...daily.map((item) => item.locChanged), 0) / totalLocChanged) * 100
    : 0;

  const gaps: number[] = [];
  for (let index = 1; index < eventDates.length; index += 1) {
    const previous = new Date(eventDates[index - 1]);
    const current = new Date(eventDates[index]);
    const gapMs = current.getTime() - previous.getTime();
    if (Number.isFinite(gapMs) && gapMs >= 0) {
      gaps.push(gapMs / (24 * 60 * 60 * 1000));
    }
  }

  return {
    totalPRs: prs.length,
    totalAdditions,
    totalDeletions,
    totalLocChanged,
    activeDays,
    activeDayRate: round(activeDayRate),
    medianLocPerPR: round(median(locPerPR)),
    avgLocPerPR: prs.length > 0 ? round(totalLocChanged / prs.length) : 0,
    avgLocPerActiveDay: activeDays > 0 ? round(totalLocChanged / activeDays) : 0,
    longestIdleGapDays,
    burstiestDayShare: round(burstiestDayShare),
    avgDaysBetweenPRs: average(gaps) === null ? null : round(average(gaps)!),
  };
}

export function computeContributionReviewSummary(prs: PR[]): ContributionReviewSummary {
  const totalReviews = prs.reduce((sum, pr) => sum + (pr.reviewCount ?? 0), 0);
  const approvals = prs.reduce((sum, pr) => sum + (pr.approvalCount ?? 0), 0);
  const changesRequested = prs.reduce((sum, pr) => sum + (pr.changesRequestedCount ?? 0), 0);
  const comments = prs.reduce((sum, pr) => sum + (pr.commentReviewCount ?? 0), 0);
  const reviewedPRs = prs.filter((pr) => (pr.reviewCount ?? 0) > 0).length;
  const reviewCoveragePct = prs.length > 0 ? (reviewedPRs / prs.length) * 100 : 0;

  return {
    totalReviews,
    approvals,
    changesRequested,
    comments,
    reviewedPRs,
    reviewCoveragePct: round(reviewCoveragePct),
    avgReviewsPerPR: prs.length > 0 ? round(totalReviews / prs.length) : 0,
  };
}

export function computeContributionPRCycleSummary(prs: PR[]): ContributionPRCycleSummary {
  const exactCycle = prs
    .map((pr) => diffHours(pr.firstCommitAt, pr.mergedAt))
    .filter((value): value is number => value !== null);
  const coding = prs
    .map((pr) => diffHours(pr.firstCommitAt, pr.lastCommitAt))
    .filter((value): value is number => value !== null);
  const lastCommitToReview = prs
    .map((pr) => diffHours(pr.lastCommitAt, pr.firstReviewAt))
    .filter((value): value is number => value !== null);
  const reviewToMerge = prs
    .map((pr) => diffHours(pr.firstReviewAt ?? pr.lastCommitAt, pr.mergedAt))
    .filter((value): value is number => value !== null);

  return {
    sampleSize: exactCycle.length,
    medianFirstCommitToMergeHours: exactCycle.length > 0 ? round(median(exactCycle)) : null,
    medianCodingHours: coding.length > 0 ? round(median(coding)) : null,
    medianLastCommitToReviewHours: lastCommitToReview.length > 0 ? round(median(lastCommitToReview)) : null,
    medianReviewToMergeHours: reviewToMerge.length > 0 ? round(median(reviewToMerge)) : null,
  };
}

export function computeContributionIssueCycleSummary(issues: JiraIssue[]): ContributionIssueCycleSummary {
  const completed = issues
    .map((issue) => diffHours(issue.inProgressAt, issue.completeAt))
    .filter((value): value is number => value !== null);

  return {
    sampleSize: issues.length,
    completedCount: completed.length,
    medianCycleTimeHours: completed.length > 0 ? round(median(completed)) : null,
    avgCycleTimeHours: average(completed) === null ? null : round(average(completed)!),
  };
}

export function aggregateContributionWip(params: {
  from: string;
  to: string;
  prs: PR[];
  issues?: JiraIssue[];
}): ContributionWipItem[] {
  const { from, to, prs, issues = [] } = params;
  const days = eachDayOfInterval({ start: new Date(from), end: new Date(to) });

  return days.map((day) => {
    const key = formatISO(day, { representation: 'date' });
    const openPRs = prs.reduce((count, pr) => {
      const start = pr.createdAt?.slice(0, 10);
      const end = (pr.mergedAt ?? pr.closedAt ?? undefined)?.slice(0, 10);
      if (!start || start > key) return count;
      if (end && end <= key) return count;
      return count + 1;
    }, 0);

    const activeIssues = issues.reduce((count, issue) => {
      const start = issue.inProgressAt?.slice(0, 10);
      const end = (issue.completeAt ?? issue.resolutiondate ?? undefined)?.slice(0, 10);
      if (!start || start > key) return count;
      if (end && end <= key) return count;
      return count + 1;
    }, 0);

    return {
      date: key,
      openPRs,
      activeIssues,
    };
  });
}
