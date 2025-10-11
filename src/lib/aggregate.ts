import type { JiraIssue, PR, TimeseriesItem } from './types';
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
