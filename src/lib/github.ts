import { cfg } from './config';
import type { CommitTimeseriesItem, GithubUser, PR } from './types';
import { eachDayOfInterval, formatISO } from 'date-fns';

export const DEV_BASE_BRANCH = 'dev';

type GithubPRDateField = 'created' | 'merged';

interface GHRepoOwner { login: string }
interface GHRepo { name: string; owner: GHRepoOwner }
interface GHReviewNode { submittedAt: string | null; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING' }
interface GHReadyEvent { __typename: 'ReadyForReviewEvent'; createdAt: string }
interface GHTimeline {
  nodes: Array<GHReadyEvent>;
}
interface GHPullRequestNode {
  id: string;
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: { totalCount: number };
  repository: GHRepo;
  reviews: { nodes: GHReviewNode[] };
  timelineItems: GHTimeline;
}
interface GHSearchEdge { node: GHPullRequestNode }
interface GHSearchPageInfo { hasNextPage: boolean; endCursor: string | null }
interface GHSearchData { search: { pageInfo: GHSearchPageInfo; edges: GHSearchEdge[] } }
interface GHResponse { data: GHSearchData; errors?: unknown }

export async function getGithubPRsWithStats(params: {
  login: string;
  from: string;
  to: string;
  baseBranch?: string;
  repo?: string;
  mergedOnly?: boolean;
  dateField?: GithubPRDateField;
}): Promise<PR[]> {
  const {
    login,
    from,
    to,
    baseBranch = DEV_BASE_BRANCH,
    repo,
    mergedOnly = false,
    dateField = 'created',
  } = params;
  if (!cfg.githubToken) throw new Error('Missing GITHUB_TOKEN');

  const scope = buildScopeFilter(repo);
  const q = [
    'is:pr',
    `author:${login}`,
    `base:${baseBranch}`,
    scope,
    dateField === 'merged' ? 'is:merged' : mergedOnly ? 'is:merged' : '',
    dateField === 'merged' ? `merged:${from}..${to}` : `created:${from}..${to}`,
  ].filter(Boolean).join(' ');

  const query = `
    query($q: String!, $first: Int!, $after: String) {
      search(query: $q, type: ISSUE, first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            ... on PullRequest {
              id
              number
              title
              url
              headRefName
              baseRefName
              createdAt
              mergedAt
              closedAt
              state
              isDraft
              additions
              deletions
              changedFiles
              commits(first: 1) {
                totalCount
              }
              repository { name owner { login } }

              reviews(first: 50) {
                nodes { submittedAt state }
              }

              timelineItems(itemTypes: READY_FOR_REVIEW_EVENT, first: 10) {
                nodes {
                  __typename
                  ... on ReadyForReviewEvent { createdAt }
                }
              }
            }
          }
        }
      }
    }
  `;

  const headers: HeadersInit = {
    Authorization: `Bearer ${cfg.githubToken}`,
    'Content-Type': 'application/json',
  };

  const out: PR[] = [];
  let after: string | null = null;
  let hasNext = true;

  while (hasNext && out.length < 600) {
    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables: { q, first: 50, after } }),
    });
    const json = (await resp.json()) as GHResponse;
    if (!resp.ok || json.errors) {
      throw new Error(`GitHub GraphQL error: ${JSON.stringify(json.errors ?? json)}`);
    }
    const data = json.data.search;

    for (const edge of data.edges) {
      const n = edge.node;
      if (!isMatchingBaseBranch(n.baseRefName, baseBranch)) continue;
      if (mergedOnly && !n.mergedAt) continue;


      let firstReviewAt: string | null = null;
      for (const r of n.reviews.nodes) {
        if (r.submittedAt) {
          if (!firstReviewAt || r.submittedAt < firstReviewAt) firstReviewAt = r.submittedAt;
        }
      }


      let readyForReviewAt: string | null = null;
      for (const ev of n.timelineItems.nodes) {
        if (ev.__typename === 'ReadyForReviewEvent') {
          if (!readyForReviewAt || ev.createdAt < readyForReviewAt) {
            readyForReviewAt = ev.createdAt;
          }
        }
      }

      out.push({
        id: n.id,
        number: n.number,
        title: n.title,
        url: n.url,
        headRefName: n.headRefName,
        baseRefName: n.baseRefName,
        createdAt: n.createdAt,
        mergedAt: n.mergedAt,
        closedAt: n.closedAt,
        state: n.state,
        isDraft: n.isDraft,
        additions: n.additions,
        deletions: n.deletions,
        changedFiles: n.changedFiles,
        commitCount: n.commits.totalCount,
        repository: { owner: n.repository.owner.login, name: n.repository.name },
        firstReviewAt,
        readyForReviewAt,
      });
    }

    hasNext = data.pageInfo.hasNextPage;
    after = data.pageInfo.endCursor;
  }

  return out.sort((a, b) => {
    const left = dateField === 'merged' ? (a.mergedAt ?? a.createdAt) : a.createdAt;
    const right = dateField === 'merged' ? (b.mergedAt ?? b.createdAt) : b.createdAt;
    return left.localeCompare(right);
  });
}

export async function getGithubCommitsByDay(params: {
  login: string;
  from: string;
  to: string;
}): Promise<CommitTimeseriesItem[]> {
  const { login, from, to } = params;
  if (!cfg.githubToken) throw new Error('Missing GITHUB_TOKEN');

  // GitHub commit search returns at most 1,000 results; bail out once we hit the cap
  const SEARCH_LIMIT = 1000;
  const PER_PAGE = 100;
  const scope = buildScopeFilter();
  const q = `author:${login} committer-date:${from}..${to} ${scope}`.trim();

  const headers: HeadersInit = {
    Authorization: `Bearer ${cfg.githubToken}`,
    Accept: 'application/vnd.github.cloak-preview',
  };

  const commitCounts = new Map<string, number>();
  const additionCounts = new Map<string, number>();
  const deletionCounts = new Map<string, number>();
  let page = 1;
  let fetched = 0;
  while (true) {
    const url = new URL('https://api.github.com/search/commits');
    url.searchParams.set('q', q);
    url.searchParams.set('sort', 'committer-date');
    url.searchParams.set('order', 'asc');
    url.searchParams.set('per_page', PER_PAGE.toString());
    url.searchParams.set('page', page.toString());

    const resp = await fetch(url.toString(), { headers });
    const json = await resp.json();
    if (!resp.ok) {
      throw new Error(`GitHub commit search error: ${JSON.stringify(json)}`);
    }

    const items: Array<{ commit?: { author?: { date?: string } }; url?: string }> = json.items ?? [];
    for (const item of items) {
      const date = (item.commit?.author?.date ?? '').slice(0, 10);
      if (!date) continue;
      commitCounts.set(date, (commitCounts.get(date) ?? 0) + 1);

      const commitUrl = item.url;
      if (commitUrl) {
        try {
          const detailResp = await fetch(commitUrl, { headers });
          const detail = await detailResp.json() as { stats?: { additions?: number; deletions?: number } };
          if (detailResp.ok) {
            const adds = Number(detail.stats?.additions ?? 0);
            const dels = Number(detail.stats?.deletions ?? 0);
            additionCounts.set(date, (additionCounts.get(date) ?? 0) + adds);
            deletionCounts.set(date, (deletionCounts.get(date) ?? 0) + dels);
          }
        } catch (err) {
          // Swallow per-commit errors to avoid failing the entire stats fetch
          console.warn('Skipping commit stats fetch', err);
        }
      }
    }

    fetched += items.length;
    if (items.length < PER_PAGE || fetched >= SEARCH_LIMIT) break;
    page += 1;
  }

  const days = eachDayOfInterval({ start: new Date(from), end: new Date(to) });
  const series: CommitTimeseriesItem[] = days.map(d => {
    const date = formatISO(d, { representation: 'date' });
    return {
      date,
      commits: commitCounts.get(date) ?? 0,
      additions: additionCounts.get(date) ?? 0,
      deletions: deletionCounts.get(date) ?? 0,
    };
  });

  return series;
}

function buildScopeFilter(repo?: string): string {
  if (repo) {
    const scopedRepo = repo.includes('/') ? repo : (cfg.githubOrg ? `${cfg.githubOrg}/${repo}` : repo);
    return `repo:${scopedRepo}`;
  }
  const parts: string[] = [];
  if (cfg.githubOrg) parts.push(`org:${cfg.githubOrg}`);
  if (cfg.githubRepos.length) parts.push(cfg.githubRepos.map(r => `repo:${r}`).join(' '));
  return parts.join(' ');
}

function isMatchingBaseBranch(actual?: string | null, expected = DEV_BASE_BRANCH): boolean {
  return (actual ?? '').trim().toLowerCase() === expected.trim().toLowerCase();
}


export async function getGithubOrgMembers(): Promise<GithubUser[]> {
  if (!cfg.githubToken) throw new Error('Missing GITHUB_TOKEN');
  if (!cfg.githubOrg) return [];

  const headers: HeadersInit = {
    Authorization: `Bearer ${cfg.githubToken}`,
    Accept: 'application/vnd.github+json',
  };

  const out: GithubUser[] = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/orgs/${encodeURIComponent(cfg.githubOrg)}/members?per_page=100&page=${page}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`GitHub members failed with ${resp.status}`);
    const list = (await resp.json()) as Array<{ login: string; avatar_url?: string }>;
    if (list.length === 0) break;
    out.push(...list.map(m => ({ login: m.login, avatarUrl: m.avatar_url })));
    page += 1;
  }
  return out;
}





type PullRef = { owner: string; repo: string; number: number; url: string };


function parsePullUrl(url: string): PullRef | null {
  try {
    const u = new URL(url);

    const apiMatch = u.hostname === 'api.github.com'
      ? u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)/i)
      : null;
    if (apiMatch) {
      return { owner: apiMatch[1], repo: apiMatch[2], number: Number(apiMatch[3]), url };
    }

    const webMatch = u.hostname.endsWith('github.com')
      ? u.pathname.match(/^\/([^/]+)\/([^/]+)\/pulls?\/(\d+)/i)
      : null;
    if (webMatch) {
      return { owner: webMatch[1], repo: webMatch[2], number: Number(webMatch[3]), url };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getGithubPRStatsByUrls(
  urls: string[],
  params?: { baseBranch?: string }
): Promise<Record<string, { additions: number; deletions: number; reviewComments?: number }>> {
  if (!cfg.githubToken) return {};
  const baseBranch = params?.baseBranch ?? DEV_BASE_BRANCH;
  const refs = urls
    .map(parsePullUrl)
    .filter((x): x is PullRef => !!x);

  const headers: HeadersInit = {
    Authorization: `Bearer ${cfg.githubToken}`,
    'Content-Type': 'application/json',
  };

  const out: Record<string, { additions: number; deletions: number; reviewComments?: number }> = {};
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          number
          url
          baseRefName
          additions
          deletions
          reviewThreads(first: 100) {
            nodes {
              comments { totalCount }
            }
          }
        }
      }
    }
  `;


  const chunks: PullRef[][] = [];
  const size = 10;
  for (let i = 0; i < refs.length; i += size) chunks.push(refs.slice(i, i + size));

  for (const batch of chunks) {
    await Promise.all(
      batch.map(async (ref) => {
        try {
          const resp = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables: { owner: ref.owner, name: ref.repo, number: ref.number } }),
          });
          type PRStatsResponse = {
            data?: {
              repository?: {
                pullRequest?: {
                  number: number;
                  url: string;
                  baseRefName: string;
                  additions: number;
                  deletions: number;
                  reviewThreads?: {
                    nodes?: Array<{ comments?: { totalCount?: number } }>;
                  } | null;
                } | null;
              } | null;
            };
          };
          const json = await resp.json() as PRStatsResponse;
          const pr = json?.data?.repository?.pullRequest;
          if (
            pr &&
            isMatchingBaseBranch(pr.baseRefName, baseBranch) &&
            typeof pr.additions === 'number' &&
            typeof pr.deletions === 'number'
          ) {
            const commentSum =
              pr.reviewThreads?.nodes?.reduce((acc, n) => acc + (n.comments?.totalCount ?? 0), 0) ?? 0;

            out[ref.url] = { additions: pr.additions, deletions: pr.deletions, reviewComments: commentSum };
          }
        } catch {

        }
      })
    );
  }

  return out;
}
