import type { JiraIssue, PR, TimeseriesItem, PRLifecycle, LifecycleStats } from './types';
import { eachDayOfInterval, formatISO } from 'date-fns';

export function aggregateDaily(params: {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  prs: PR[];
  jiraIssues: JiraIssue[];
}): TimeseriesItem[] {
  const { from, to, prs, jiraIssues } = params;

  // Seed every day to zero
  const days = eachDayOfInterval({ start: new Date(from), end: new Date(to) });
  const map = new Map<string, TimeseriesItem>();
  for (const d of days) {
    const k = formatISO(d, { representation: 'date' });
    map.set(k, { date: k, prCount: 0, additions: 0, deletions: 0, tickets: 0, storyPoints: 0 });
  }

  // PRs → bucket by CREATED date now
  for (const p of prs) {
    const k = (p.createdAt ?? '').slice(0, 10);
    if (!map.has(k)) continue;
    const row = map.get(k)!;
    row.prCount += 1;
    row.additions += p.additions ?? 0;
    row.deletions += p.deletions ?? 0;
  }

  // Tickets → keep using resolution date if available, otherwise skip
  for (const t of jiraIssues) {
    const k = (t.resolutiondate ?? '').slice(0, 10);
    if (!k || !map.has(k)) continue;
    const row = map.get(k)!;
    row.tickets += 1;
    row.storyPoints += t.storyPoints ?? 0;
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function diffHours(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.max(0, (t2 - t1) / 36e5);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const arr = [...nums].sort((x, y) => x - y);
  const m = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
}

export function computeLifecycle(prs: PR[]): { items: PRLifecycle[]; stats: LifecycleStats } {
  const items: PRLifecycle[] = prs.map(p => {
    const readyAt = p.readyForReviewAt ?? (p.isDraft ? null : p.createdAt); // if never draft, treat created as ready
    const firstRev = p.firstReviewAt ?? null;
    const mergedAt = p.mergedAt ?? null;
    const closedAt = p.closedAt ?? null;
    const endAt = mergedAt ?? closedAt;

    return {
      id: p.id,
      number: p.number,
      title: p.title,
      url: p.url,
      createdAt: p.createdAt,
      readyForReviewAt: readyAt,
      firstReviewAt: firstRev,
      mergedAt,
      closedAt,
      state: p.state,
      isDraft: p.isDraft,

      // carry LOC deltas into lifecycle rows
      additions: p.additions,
      deletions: p.deletions,

      timeToReadyHours: diffHours(p.createdAt, readyAt),
      timeToFirstReviewHours: diffHours(p.createdAt, firstRev),
      reviewToMergeHours: mergedAt ? diffHours(firstRev ?? readyAt ?? p.createdAt, mergedAt) : null,
      cycleTimeHours: endAt ? diffHours(p.createdAt, endAt) : null,
    };
  });

  const toReady: number[] = items.map(i => i.timeToReadyHours).filter((x): x is number => x !== null && x !== undefined);
  const toFirst: number[] = items.map(i => i.timeToFirstReviewHours).filter((x): x is number => x !== null && x !== undefined);
  const revToMerge: number[] = items.map(i => i.reviewToMergeHours).filter((x): x is number => x !== null && x !== undefined);
  const cycle: number[] = items.map(i => i.cycleTimeHours).filter((x): x is number => x !== null && x !== undefined);

  const stats: LifecycleStats = {
    sampleSize: items.length,
    medianTimeToReadyHours: median(toReady),
    medianTimeToFirstReviewHours: median(toFirst),
    medianReviewToMergeHours: median(revToMerge),
    medianCycleTimeHours: median(cycle),
  };

  return { items, stats };
}
