import type { JiraIssue, PR, TimeseriesItem, PRLifecycle, LifecycleStats } from './types';
import { eachDayOfInterval, formatISO } from 'date-fns';

export function aggregateDaily(params: {
  from: string;
  to: string;
  prs: PR[];
  jiraIssues: JiraIssue[];
}): TimeseriesItem[] {
  const { from, to, prs, jiraIssues } = params;


  const days = eachDayOfInterval({ start: new Date(from), end: new Date(to) });
  const map = new Map<string, TimeseriesItem>();
  for (const d of days) {
    const k = formatISO(d, { representation: 'date' });
    map.set(k, { date: k, prCount: 0, additions: 0, deletions: 0, tickets: 0, storyPoints: 0 });
  }


  for (const p of prs) {
    const k = (p.createdAt ?? '').slice(0, 10);
    if (!map.has(k)) continue;
    const row = map.get(k)!;
    row.prCount += 1;
    row.additions += p.additions ?? 0;
    row.deletions += p.deletions ?? 0;
  }


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

// Optionally pass a map from PR URL to linked Jira "work started" timestamp (inProgressAt)
export function computeLifecycle(
  prs: PR[],
  opts?: {
    workStartedByPrUrl?: Record<string, string | undefined | null>;
    jiraMetaByPrUrl?: Record<string, { key?: string; summary?: string; url?: string } | undefined>;
  }
): { items: PRLifecycle[]; stats: LifecycleStats } {
  const workStartedMap = opts?.workStartedByPrUrl ?? {};
  const jiraMetaMap = opts?.jiraMetaByPrUrl ?? {};
  const items: PRLifecycle[] = prs.map(p => {
    const readyAt = p.readyForReviewAt ?? (p.isDraft ? null : p.createdAt);
    const firstRev = p.firstReviewAt ?? null;
    const mergedAt = p.mergedAt ?? null;
    const closedAt = p.closedAt ?? null;
    const endAt = mergedAt ?? closedAt;
    const workStartedAt = workStartedMap[p.url] ?? null;
    const meta = jiraMetaMap[p.url] ?? {};

    return {
      id: p.id,
      number: p.number,
      title: p.title,
      url: p.url,
      headRefName: p.headRefName,
      createdAt: p.createdAt,
      workStartedAt,
      jiraKey: meta.key,
      jiraSummary: meta.summary,
      jiraUrl: meta.url,
      readyForReviewAt: readyAt,
      firstReviewAt: firstRev,
      mergedAt,
      closedAt,
      state: p.state,
      isDraft: p.isDraft,


      additions: p.additions,
      deletions: p.deletions,

      timeToReadyHours: diffHours(p.createdAt, readyAt),
      timeToFirstReviewHours: diffHours(p.createdAt, firstRev),
      reviewToMergeHours: mergedAt ? diffHours(firstRev ?? readyAt ?? p.createdAt, mergedAt) : null,
      cycleTimeHours: endAt ? diffHours(p.createdAt, endAt) : null,
      inProgressToCreatedHours: workStartedAt ? diffHours(workStartedAt, p.createdAt) : null,
    };
  });

  const toReady: number[] = items.map(i => i.timeToReadyHours).filter((x): x is number => x !== null && x !== undefined);
  const toFirst: number[] = items.map(i => i.timeToFirstReviewHours).filter((x): x is number => x !== null && x !== undefined);
  const revToMerge: number[] = items.map(i => i.reviewToMergeHours).filter((x): x is number => x !== null && x !== undefined);
  const cycle: number[] = items.map(i => i.cycleTimeHours).filter((x): x is number => x !== null && x !== undefined);
  const inProgToCreated: number[] = items.map(i => i.inProgressToCreatedHours).filter((x): x is number => x !== null && x !== undefined);

  const stats: LifecycleStats = {
    sampleSize: items.length,
    medianTimeToReadyHours: median(toReady),
    medianTimeToFirstReviewHours: median(toFirst),
    medianReviewToMergeHours: median(revToMerge),
    medianCycleTimeHours: median(cycle),
    medianInProgressToCreatedHours: median(inProgToCreated),
  };

  return { items, stats };
}
