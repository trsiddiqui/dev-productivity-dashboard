import { cfg } from './config';
import type { GithubUser, PR } from './types';

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
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  additions: number;
  deletions: number;
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
}): Promise<PR[]> {
  const { login, from, to } = params;
  if (!cfg.githubToken) throw new Error('Missing GITHUB_TOKEN');

  const scope = buildScopeFilter();
  const q = `is:pr author:${login} created:${from}..${to} ${scope}`.trim();

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
              createdAt
              mergedAt
              closedAt
              state
              isDraft
              additions
              deletions
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
        createdAt: n.createdAt,
        mergedAt: n.mergedAt,
        closedAt: n.closedAt,
        state: n.state,
        isDraft: n.isDraft,
        additions: n.additions,
        deletions: n.deletions,
        repository: { owner: n.repository.owner.login, name: n.repository.name },
        firstReviewAt,
        readyForReviewAt,
      });
    }

    hasNext = data.pageInfo.hasNextPage;
    after = data.pageInfo.endCursor;
  }

  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function buildScopeFilter(): string {
  const parts: string[] = [];
  if (cfg.githubOrg) parts.push(`org:${cfg.githubOrg}`);
  if (cfg.githubRepos.length) parts.push(cfg.githubRepos.map(r => `repo:${r}`).join(' '));
  return parts.join(' ');
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
  urls: string[]
): Promise<Record<string, { additions: number; deletions: number; reviewComments?: number }>> {
  if (!cfg.githubToken) return {};
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
          if (pr && typeof pr.additions === 'number' && typeof pr.deletions === 'number') {
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
