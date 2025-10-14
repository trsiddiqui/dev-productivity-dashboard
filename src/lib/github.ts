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

      // earliest non-null review submission time
      let firstReviewAt: string | null = null;
      for (const r of n.reviews.nodes) {
        if (r.submittedAt) {
          if (!firstReviewAt || r.submittedAt < firstReviewAt) firstReviewAt = r.submittedAt;
        }
      }

      // earliest "ready for review" event time
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


/** New: list members of a GitHub org (needs read:org token) */
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
    console.log(resp)
    if (!resp.ok) throw new Error(`GitHub members failed with ${resp.status}`);
    const list = (await resp.json()) as Array<{ login: string; avatar_url?: string }>;
    if (list.length === 0) break;
    out.push(...list.map(m => ({ login: m.login, avatarUrl: m.avatar_url })));
    page += 1;
  }
  return out;
}
