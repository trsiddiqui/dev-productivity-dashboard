import { NextResponse } from 'next/server';
import { getGithubPRsWithStats } from '../../../lib/github';
import { getJiraIssuesUpdated, getIssuePhaseTimes, getJiraIssuePRs } from '../../../lib/jira';
import { aggregateDaily, computeLifecycle } from '../../../lib/aggregate';
import type { StatsResponse, KPIs, JiraIssue, PR, LinkedPR } from '../../../lib/types';
import { requireAuthOr401 } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req); if (auth instanceof Response) return auth;

  const warnings: string[] = [];
  try {
    const { searchParams } = new URL(req.url);
    const login = searchParams.get('login') ?? '';
    const from = searchParams.get('from') ?? '';
    const to   = searchParams.get('to') ?? '';
    const jiraAccountId = searchParams.get('jiraAccountId') ?? undefined;
    const projectKey = searchParams.get('projectKey') ?? undefined;

    if (!login || !from || !to) {
      return NextResponse.json({ error: 'Missing required params: login, from, to' }, { status: 400 });
    }


  const prs = await getGithubPRsWithStats({ login, from, to });


    let jiraIssues: JiraIssue[] = [];
    try {
      jiraIssues = await getJiraIssuesUpdated({ assignee: login, from, to, jiraAccountId, projectKey });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`JIRA fetch skipped: ${msg}`);
      jiraIssues = [];
    }

    // Fetch phase times (includes inProgress) and development PR links
  let phaseTimes: Record<string, { todo?: string; inProgress?: string; review?: string; complete?: string; updatedByActorInWindow?: boolean }> = {};
  let devStatusPRs: Record<string, LinkedPR[]> = {};
    try {
      const issueKeys = jiraIssues.map(i => i.key);
      if (issueKeys.length) {
        phaseTimes = await getIssuePhaseTimes(issueKeys, {
          todo: ['To Do', 'Open', 'Backlog', 'Selected for Development'],
          inProgress: ['In Progress', 'Merged', 'In Development', 'In-Progress', 'Doing', 'Selected for Development'],
          review: ['Reviewed', 'Review', 'In Review'],
          complete: ['Done', 'Approved'],
        }, { from, to, actorAccountId: jiraAccountId });
        const issueIds = jiraIssues.map(i => i.id);
        const linked = await getJiraIssuePRs(issueIds);
        // Build map id->LinkedPR[] simplified
        devStatusPRs = Object.fromEntries(Object.entries(linked).map(([id, arr]) => [id, arr]));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`JIRA phase/dev-status fetch skipped: ${msg}`);
    }

    // Annotate issues with phase times & linked PRs
    for (const issue of jiraIssues) {
      const pt = phaseTimes[issue.key];
      if (pt) {
        issue.inProgressAt = pt.inProgress;
        issue.reviewAt = pt.review;
        issue.todoAt = pt.todo;
        issue.completeAt = pt.complete;
        if (pt.updatedByActorInWindow) issue.updatedBySelectedUserInWindow = true;
      }
      const prsForIssue = devStatusPRs[issue.id];
      if (prsForIssue) {
        issue.linkedPRs = prsForIssue.map(p => ({ url: p.url, title: p.title, source: 'dev-status' }));
      }
    }


    const jiraKeys = new Set<string>(jiraIssues.map(i => i.key));
    // Build PR URL -> earliest linked issue inProgress timestamp
    const workStartedByPrUrl: Record<string, string | undefined> = {};
    const jiraMetaByPrUrl: Record<string, { key?: string; summary?: string; url?: string }> = {};
    const prsLinked: PR[] = prs.map(pr => {
      const titleMatches = [...jiraKeys].filter(k => pr.title.includes(k));

      // Find all issues whose dev-status includes this PR URL
      const linkedIssues = jiraIssues.filter(issue => (issue.linkedPRs ?? []).some(lp => lp.url === pr.url));
      let earliest: string | undefined;
      let earliestIssue: JiraIssue | undefined;
      for (const iss of linkedIssues) {
        const t = iss.inProgressAt;
        if (!t) continue;
        if (!earliest || t < earliest) { earliest = t; earliestIssue = iss; }
      }
      if (earliest) workStartedByPrUrl[pr.url] = earliest;
      if (earliestIssue) {
        jiraMetaByPrUrl[pr.url] = { key: earliestIssue.key, summary: earliestIssue.summary, url: earliestIssue.url };
      } else if (titleMatches.length) {
        const byTitle = jiraIssues.find(i => i.key === titleMatches[0]);
        if (byTitle) {
          jiraMetaByPrUrl[pr.url] = { key: byTitle.key, summary: byTitle.summary, url: byTitle.url };
        }
      }

      return { ...pr, jiraKeys: titleMatches };
    });


    // Only count tickets in one of the allowed active/done-like states for KPIs
    const allowedStatuses = new Set(['In Progress', 'Merged', 'Review', 'Approved', 'Done']);
    const kpiTickets = jiraIssues.filter(i => i.status && allowedStatuses.has(i.status));

    const kpis: KPIs = {
      totalPRs: prsLinked.length,
      totalTicketsDone: kpiTickets.length,
      totalStoryPoints: kpiTickets.reduce<number>((a, i) => a + (i.storyPoints ?? 0), 0),
      totalAdditions: prsLinked.reduce<number>((a, p) => a + (p.additions ?? 0), 0),
      totalDeletions: prsLinked.reduce<number>((a, p) => a + (p.deletions ?? 0), 0),
    };


    const timeseries = aggregateDaily({ from, to, prs: prsLinked, jiraIssues });

  const lifecycle = computeLifecycle(prsLinked, { workStartedByPrUrl, jiraMetaByPrUrl });

    const payload: StatsResponse = {
      from, to, login,
      kpis,
      timeseries,
      prs: prsLinked,
      tickets: jiraIssues,
      warnings: warnings.length ? warnings : undefined,
      lifecycle,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
