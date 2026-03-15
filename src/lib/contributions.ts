import { eachDayOfInterval, formatISO } from 'date-fns';
import type {
  CommitTimeseriesItem,
  ContributionDailyItem,
  ContributionKpis,
  ContributionRepoItem,
  PR,
} from './types';

type ContributionDateMode = 'created' | 'merged';

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
