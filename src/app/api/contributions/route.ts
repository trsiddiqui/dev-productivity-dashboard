import { NextResponse } from 'next/server';
import { DEV_BASE_BRANCH, getGithubPRsWithStats } from '@/lib/github';
import {
  aggregateContributionDaily,
  aggregateContributionWip,
  computeContributionKpis,
  computeContributionIssueCycleSummary,
  computeContributionPRCycleSummary,
  computeContributionReviewSummary,
  extractJiraKeysFromPRs,
  summarizeRepoContributions,
} from '@/lib/contributions';
import type { ContributionResponse, JiraIssue } from '@/lib/types';
import { requireAuthOr401 } from '@/lib/auth';
import { getIssuePhaseTimes, getJiraIssuesByKeys } from '@/lib/jira';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req);
  if (auth instanceof Response) return auth;

  try {
    const warnings: string[] = [];
    const { searchParams } = new URL(req.url);
    const login = searchParams.get('login') ?? '';
    const from = searchParams.get('from') ?? '';
    const to = searchParams.get('to') ?? '';
    const repo = (searchParams.get('repo') ?? '').trim() || undefined;
    const dateMode = searchParams.get('dateMode') === 'created' ? 'created' : 'merged';
    const mergedOnly = dateMode === 'merged'
      ? true
      : (searchParams.get('mergedOnly') ?? 'true') !== 'false';

    if (!login || !from || !to) {
      return NextResponse.json({ error: 'Missing required params: login, from, to' }, { status: 400 });
    }

    const prs = await getGithubPRsWithStats({
      login,
      from,
      to,
      repo,
      baseBranch: DEV_BASE_BRANCH,
      mergedOnly,
      dateField: dateMode,
    });

    const issueKeys = extractJiraKeysFromPRs(prs);
    let issues: JiraIssue[] = [];

    if (issueKeys.length > 0) {
      try {
        issues = await getJiraIssuesByKeys(issueKeys);
        const phaseTimes = await getIssuePhaseTimes(
          issues.map((issue) => issue.key),
          {
            todo: ['To Do', 'Open', 'Backlog', 'Selected for Development'],
            inProgress: ['In Progress', 'Merged', 'In Development', 'In-Progress', 'Doing', 'Selected for Development'],
            review: ['Reviewed', 'Review', 'In Review'],
            complete: ['Done', 'Approved'],
          },
        );

        for (const issue of issues) {
          const phase = phaseTimes[issue.key];
          if (!phase) continue;
          issue.todoAt = phase.todo;
          issue.inProgressAt = phase.inProgress;
          issue.reviewAt = phase.review;
          issue.completeAt = phase.complete;
        }
      } catch (err) {
        warnings.push(`Jira issue metrics unavailable: ${err instanceof Error ? err.message : String(err)}`);
        issues = [];
      }
    }

    const payload: ContributionResponse = {
      from,
      to,
      login,
      baseBranch: DEV_BASE_BRANCH,
      dateMode,
      mergedOnly,
      repo,
      kpis: computeContributionKpis({ from, to, prs, dateMode }),
      daily: aggregateContributionDaily({ from, to, prs, dateMode }),
      repos: summarizeRepoContributions(prs),
      prs,
      issues,
      reviews: computeContributionReviewSummary(prs),
      prCycle: computeContributionPRCycleSummary(prs),
      issueCycle: computeContributionIssueCycleSummary(issues),
      wip: aggregateContributionWip({ from, to, prs, issues }),
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
