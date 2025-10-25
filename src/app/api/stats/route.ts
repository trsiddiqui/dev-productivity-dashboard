import { NextResponse } from 'next/server';
import { getGithubPRsWithStats } from '../../../lib/github';
import { getJiraIssuesUpdated } from '../../../lib/jira';
import { aggregateDaily, computeLifecycle } from '../../../lib/aggregate';
import type { StatsResponse, KPIs, JiraIssue, PR } from '../../../lib/types';
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


    const jiraKeys = new Set<string>(jiraIssues.map(i => i.key));
    const prsLinked: PR[] = prs.map(pr => ({
      ...pr,
      jiraKeys: [...jiraKeys].filter(k => pr.title.includes(k)),
    }));


    const kpis: KPIs = {
      totalPRs: prsLinked.length,
      totalTicketsDone: jiraIssues.length,
      totalStoryPoints: jiraIssues.reduce<number>((a, i) => a + (i.storyPoints ?? 0), 0),
      totalAdditions: prsLinked.reduce<number>((a, p) => a + (p.additions ?? 0), 0),
      totalDeletions: prsLinked.reduce<number>((a, p) => a + (p.deletions ?? 0), 0),
    };


    const timeseries = aggregateDaily({ from, to, prs: prsLinked, jiraIssues });

    const lifecycle = computeLifecycle(prsLinked);

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
