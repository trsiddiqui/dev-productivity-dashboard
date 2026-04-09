import { NextResponse } from 'next/server';
import {
  DEV_BASE_BRANCH,
  getGithubCommitJiraKeys,
  getGithubPRsWithStats,
  getGithubReviewActivity,
} from '@/lib/github';
import {
  aggregateContributionDaily,
  aggregateContributionWip,
  computeContributionJiraPRTimingSummary,
  computeContributionKpis,
  computeContributionIssueCycleSummary,
  computeContributionPRCycleSummary,
  computeContributionReviewSummary,
  extractJiraKeysFromPRs,
  summarizeRepoContributions,
} from '@/lib/contributions';
import type {
  ContributionIssueLinkSource,
  ContributionLinkedTicket,
  ContributionResponse,
  JiraIssue,
} from '@/lib/types';
import { requireAuthOr401 } from '@/lib/auth';
import { getIssuePhaseTimes, getJiraIssuePRs, getJiraIssuesByKeys } from '@/lib/jira';
import { withCachedRouteResponse } from '@/lib/route-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const linkSourceOrder: Record<ContributionIssueLinkSource, number> = {
  'dev-status': 0,
  'pr-metadata': 1,
  'commit-metadata': 2,
};

function normalizePullUrl(url?: string): string | null {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    const apiMatch = parsed.hostname === 'api.github.com'
      ? parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)/i)
      : null;
    if (apiMatch) return `${apiMatch[1]}/${apiMatch[2]}#${apiMatch[3]}`;

    const webMatch = parsed.hostname.endsWith('github.com')
      ? parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pulls?\/(\d+)/i)
      : null;
    if (webMatch) return `${webMatch[1]}/${webMatch[2]}#${webMatch[3]}`;
  } catch {
    return null;
  }

  return null;
}

function mergeLinkSources(
  existing: ContributionIssueLinkSource[] | undefined,
  next: ContributionIssueLinkSource[] | undefined,
): ContributionIssueLinkSource[] | undefined {
  const merged = new Set<ContributionIssueLinkSource>([...(existing ?? []), ...(next ?? [])]);
  if (merged.size === 0) return undefined;
  return Array.from(merged).sort((left, right) => linkSourceOrder[left] - linkSourceOrder[right]);
}

async function getContributionsResponse(req: Request): Promise<Response> {
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

    let prsOpenedInWindow = [] as typeof prs;
    let commitIssueKeys: string[] = [];
    let reviewActivity = {
      totalReviews: 0,
      approvals: 0,
      changesRequested: 0,
      comments: 0,
      reviewedPRs: 0,
      reviewComments: 0,
    };

    await Promise.all([
      getGithubPRsWithStats({
        login,
        from,
        to,
        repo,
        baseBranch: DEV_BASE_BRANCH,
        mergedOnly: false,
        dateField: 'created',
      })
        .then((items) => {
          prsOpenedInWindow = items;
        })
        .catch((err) => {
          warnings.push(`Story point PR-open metric unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }),
      getGithubReviewActivity({
        login,
        from,
        to,
        repo,
        baseBranch: DEV_BASE_BRANCH,
      })
        .then((summary) => {
          reviewActivity = summary;
        })
        .catch((err) => {
          warnings.push(`GitHub review activity unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }),
      getGithubCommitJiraKeys({ login, from, to, repo })
        .then((keys) => {
          commitIssueKeys = keys;
        })
        .catch((err) => {
          warnings.push(`Story point commit metric unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }),
    ]);

    const issueKeys = extractJiraKeysFromPRs(prs);
    const openedIssueKeys = extractJiraKeysFromPRs(prsOpenedInWindow);
    const touchedIssueKeys = Array.from(new Set([...openedIssueKeys, ...commitIssueKeys]))
      .sort((left, right) => left.localeCompare(right));
    const linkedIssueKeySet = new Set(issueKeys);
    const touchedIssueKeySet = new Set(touchedIssueKeys);
    const commitIssueKeySet = new Set(commitIssueKeys);
    const allIssueKeys = Array.from(new Set([...issueKeys, ...touchedIssueKeys]))
      .sort((left, right) => left.localeCompare(right));
    const currentPrRefs = new Set(prs.map((pr) => normalizePullUrl(pr.url)).filter((ref): ref is string => !!ref));
    const openedPrRefs = new Set(prsOpenedInWindow.map((pr) => normalizePullUrl(pr.url)).filter((ref): ref is string => !!ref));
    let issues: JiraIssue[] = [];
    let jiraTimingIssues: JiraIssue[] = [];
    let linkedTickets: ContributionLinkedTicket[] = [];
    let touchedTicketStoryPoints = 0;

    if (allIssueKeys.length > 0) {
      try {
        const jiraIssues = await getJiraIssuesByKeys(allIssueKeys);
        const parentKeys = Array.from(new Set(
          jiraIssues
            .filter((issue) => issue.isSubtask && !!issue.parentKey)
            .map((issue) => issue.parentKey as string),
        )).sort((left, right) => left.localeCompare(right));
        const parentIssues = parentKeys.length > 0
          ? await getJiraIssuesByKeys(parentKeys).catch((err) => {
            warnings.push(`Jira parent ticket fetch unavailable: ${err instanceof Error ? err.message : String(err)}`);
            return [] as JiraIssue[];
          })
          : [];
        const parentByKey = new Map(parentIssues.map((issue) => [issue.key, issue]));
        const linkedByIssueId = await getJiraIssuePRs(jiraIssues.map((issue) => issue.id))
          .catch((err) => {
            warnings.push(`Jira dev-status linkage unavailable: ${err instanceof Error ? err.message : String(err)}`);
            return {} as Record<string, NonNullable<JiraIssue['linkedPRs']>>;
          });

        for (const issue of jiraIssues) {
          issue.linkedPRs = linkedByIssueId[issue.id] ?? [];
          const linkSources = new Set<ContributionIssueLinkSource>();
          if ((issue.linkedPRs ?? []).some((pr) => {
            const ref = normalizePullUrl(pr.url);
            return !!ref && currentPrRefs.has(ref);
          })) {
            linkSources.add('dev-status');
          }
          if (linkedIssueKeySet.has(issue.key)) {
            linkSources.add('pr-metadata');
          }
          if (commitIssueKeySet.has(issue.key)) {
            linkSources.add('commit-metadata');
          }
          issue.linkSources = Array.from(linkSources)
            .sort((left, right) => linkSourceOrder[left] - linkSourceOrder[right]);
        }

        const linkedTicketMap = new Map<string, ContributionLinkedTicket>();
        const touchedDisplayKeys = new Set<string>();

        for (const issue of jiraIssues) {
          const displayIssue = issue.isSubtask && issue.parentKey
            ? (parentByKey.get(issue.parentKey) ?? issue)
            : issue;
          const displayKey = displayIssue.key;
          const displayRow = linkedTicketMap.get(displayKey) ?? {
            key: displayIssue.key,
            summary: displayIssue.summary,
            status: displayIssue.status,
            storyPoints: displayIssue.storyPoints,
            url: displayIssue.url,
            issueType: displayIssue.issueType,
            linkSources: [],
            sourceIssueKeys: [],
          };

          displayRow.linkSources = mergeLinkSources(displayRow.linkSources, issue.linkSources) ?? [];
          displayRow.sourceIssueKeys = Array.from(new Set([
            ...(displayRow.sourceIssueKeys ?? []),
            issue.key,
          ])).sort((left, right) => left.localeCompare(right));
          linkedTicketMap.set(displayKey, displayRow);

          const matchedByMetadata = touchedIssueKeySet.has(issue.key);
          const matchedByDevStatus = (issue.linkedPRs ?? []).some((pr) => {
            const ref = normalizePullUrl(pr.url);
            return !!ref && openedPrRefs.has(ref);
          });

          if (matchedByMetadata || matchedByDevStatus) {
            touchedDisplayKeys.add(displayKey);
          }
        }

        linkedTickets = Array.from(linkedTicketMap.values())
          .filter((ticket) => (ticket.linkSources?.length ?? 0) > 0)
          .sort((left, right) => left.key.localeCompare(right.key));

        issues = jiraIssues.filter((issue) => (
          linkedIssueKeySet.has(issue.key)
          || (issue.linkedPRs ?? []).some((pr) => {
            const ref = normalizePullUrl(pr.url);
            return !!ref && currentPrRefs.has(ref);
          })
        ));

        touchedTicketStoryPoints = linkedTickets.reduce((sum, ticket) => (
          touchedDisplayKeys.has(ticket.key) ? sum + (ticket.storyPoints ?? 0) : sum
        ), 0);

        const phaseTimeKeys = Array.from(new Set([
          ...issues.map((issue) => issue.key),
          ...parentIssues.map((issue) => issue.key),
        ])).sort((left, right) => left.localeCompare(right));

        const phaseTimes = await getIssuePhaseTimes(
          phaseTimeKeys,
          {
            todo: ['To Do', 'Open', 'Backlog', 'Selected for Development'],
            inProgress: ['In Progress', 'In Development', 'In-Progress', 'Doing', 'Selected for Development'],
            merged: ['Merged'],
            review: ['Reviewed', 'Review', 'In Review'],
            complete: ['Done', 'Approved'],
          },
        );

        for (const issue of issues) {
          const phase = phaseTimes[issue.key];
          if (!phase) continue;
          issue.todoAt = phase.todo;
          issue.inProgressAt = phase.inProgress;
          issue.mergedAt = phase.merged;
          issue.reviewAt = phase.review;
          issue.completeAt = phase.complete;
        }

        for (const issue of parentIssues) {
          const phase = phaseTimes[issue.key];
          if (!phase) continue;
          issue.todoAt = phase.todo;
          issue.inProgressAt = phase.inProgress;
          issue.mergedAt = phase.merged;
          issue.reviewAt = phase.review;
          issue.completeAt = phase.complete;
        }

        const effectiveIssueByKey = new Map<string, JiraIssue>();
        for (const issue of issues) {
          if (issue.isSubtask && issue.parentKey && parentByKey.has(issue.parentKey)) {
            const parentIssue = parentByKey.get(issue.parentKey)!;
            effectiveIssueByKey.set(issue.key, {
              ...parentIssue,
              key: issue.key,
              url: issue.url,
              parentKey: issue.parentKey,
              isSubtask: issue.isSubtask,
            });
          } else {
            effectiveIssueByKey.set(issue.key, issue);
          }
        }

        for (const parentIssue of parentIssues) {
          effectiveIssueByKey.set(parentIssue.key, parentIssue);
        }
        jiraTimingIssues = Array.from(new Map(
          Array.from(effectiveIssueByKey.values()).map((issue) => [issue.key, issue]),
        ).values()).sort((left, right) => left.key.localeCompare(right.key));
      } catch (err) {
        warnings.push(`Jira issue metrics unavailable: ${err instanceof Error ? err.message : String(err)}`);
        issues = [];
        jiraTimingIssues = [];
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
      kpis: computeContributionKpis({ from, to, prs, dateMode, touchedTicketStoryPoints }),
      daily: aggregateContributionDaily({ from, to, prs, dateMode }),
      repos: summarizeRepoContributions(prs),
      prs,
      issues,
      linkedTickets,
      reviews: computeContributionReviewSummary({ given: reviewActivity, received: prs }),
      prCycle: computeContributionPRCycleSummary(prs),
      jiraPrTiming: computeContributionJiraPRTimingSummary({ prs, issues: jiraTimingIssues }),
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

export async function GET(req: Request) {
  const auth = await requireAuthOr401(req);
  if (auth instanceof Response) return auth;

  return withCachedRouteResponse({
    req,
    authUser: auth,
    namespace: 'contributions',
    handler: () => getContributionsResponse(req),
  });
}
