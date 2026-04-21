import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DEV_BASE_BRANCH = 'dev';
const WEBSITE_STAGING_REPO = 'aligncommerce/website';
const WEBSITE_STAGING_BRANCH = 'staging';
const ENGINEERING_LOOKBACK_DAYS = 180;
const ENGINEERING_PR_AGE_DAYS = 3;

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) out[key] = 'true';
    else {
      out[key] = next;
      index += 1;
    }
  }
  return out;
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const rawValue = trimmed.slice(idx + 1).trim();
      const normalizedRawValue =
        rawValue.startsWith('"') || rawValue.startsWith("'")
          ? rawValue
          : rawValue.split('#', 1)[0].trimEnd();
      const value = ((normalizedRawValue.startsWith('"') && normalizedRawValue.endsWith('"')) || (normalizedRawValue.startsWith("'") && normalizedRawValue.endsWith("'")))
        ? normalizedRawValue.slice(1, -1)
        : normalizedRawValue;
      process.env[key] = value;
    }
  } catch {
    // ignore missing env files
  }
}

function splitCsv(value) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function getTrackedBaseBranchForRepo(repoFullName) {
  return repoFullName === WEBSITE_STAGING_REPO ? WEBSITE_STAGING_BRANCH : DEV_BASE_BRANCH;
}

function matchesTrackedBaseBranch(repository, baseRefName) {
  const fullName = `${repository.owner.login}/${repository.name}`.toLowerCase();
  return (baseRefName ?? '').trim().toLowerCase() === getTrackedBaseBranchForRepo(fullName);
}

function matchesRepositoryScope(repository, env) {
  const fullName = `${repository.owner.login}/${repository.name}`.toLowerCase();
  if (env.githubRepos.length > 0) {
    return env.githubRepos.some((candidate) => candidate.toLowerCase() === fullName);
  }
  if (env.githubOrg) {
    return repository.owner.login.toLowerCase() === env.githubOrg.toLowerCase();
  }
  return true;
}

async function githubGraphQL(env, query, variables) {
  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json();
  if (!resp.ok || json.errors) {
    throw new Error(`GitHub GraphQL failed: ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.data;
}

async function fetchTrackedPullRequests(env, { login, from, to, dateField = 'created', mergedOnly = false }) {
  const scope = env.githubRepos.length > 0
    ? env.githubRepos.map((repo) => `repo:${repo}`).join(' ')
    : env.githubOrg ? `org:${env.githubOrg}` : '';
  const q = [
    'is:pr',
    `author:${login}`,
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
              number
              url
              baseRefName
              createdAt
              mergedAt
              closedAt
              state
              repository { name owner { login } }
            }
          }
        }
      }
    }
  `;

  const out = [];
  let after = null;
  let hasNext = true;
  while (hasNext) {
    const data = await githubGraphQL(env, query, { q, first: 50, after });
    for (const edge of data.search.edges) {
      const pr = edge.node;
      if (!matchesRepositoryScope(pr.repository, env)) continue;
      if (!matchesTrackedBaseBranch(pr.repository, pr.baseRefName)) continue;
      if (mergedOnly && !pr.mergedAt) continue;
      out.push(pr);
    }
    hasNext = data.search.pageInfo.hasNextPage;
    after = data.search.pageInfo.endCursor;
  }
  return out;
}

async function fetchReviewActivityCount(env, { login, from, to }) {
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!, $first: Int!, $after: String) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          pullRequestReviewContributions(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              pullRequest {
                baseRefName
                repository { name owner { login } }
                author { login }
              }
              pullRequestReview { state }
            }
          }
        }
      }
    }
  `;
  let total = 0;
  let after = null;
  let hasNext = true;
  while (hasNext) {
    const data = await githubGraphQL(env, query, {
      login,
      from: `${from}T00:00:00Z`,
      to: `${to}T23:59:59Z`,
      first: 100,
      after,
    });
    const connection = data.user?.contributionsCollection?.pullRequestReviewContributions;
    for (const node of connection?.nodes ?? []) {
      const pr = node.pullRequest;
      if (!pr) continue;
      if (!matchesRepositoryScope(pr.repository, env)) continue;
      if (!matchesTrackedBaseBranch(pr.repository, pr.baseRefName)) continue;
      if ((pr.author?.login ?? '').trim().toLowerCase() === login.trim().toLowerCase()) continue;
      total += 1;
    }
    hasNext = connection?.pageInfo?.hasNextPage ?? false;
    after = connection?.pageInfo?.endCursor ?? null;
  }
  return total;
}

async function jiraSearch(env, jql, fields) {
  const issues = [];
  let nextPageToken;
  do {
    const resp = await fetch(`${env.jiraBaseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.jiraEmail}:${env.jiraToken}`).toString('base64')}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql,
        fields,
        fieldsByKeys: true,
        maxResults: 100,
        nextPageToken,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(`Jira search failed: ${JSON.stringify(json)}`);
    issues.push(...(json.issues ?? []));
    nextPageToken = json.isLast ? undefined : json.nextPageToken;
  } while (nextPageToken);
  return issues;
}

async function fetchJiraUsers(env) {
  const url = new URL(`${env.jiraBaseUrl}/rest/api/3/users/search`);
  url.searchParams.set('query', 'a');
  url.searchParams.set('maxResults', '100');
  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.jiraEmail}:${env.jiraToken}`).toString('base64')}`,
      Accept: 'application/json',
    },
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`Jira users failed: ${JSON.stringify(json)}`);
  return json;
}

function mapJiraUser(jiraUsers, member) {
  const email = (member.jiraEmail ?? member.email ?? '').trim().toLowerCase();
  if (email) {
    const emailMatch = jiraUsers.find((user) => (user.emailAddress ?? '').trim().toLowerCase() === email);
    if (emailMatch) return emailMatch;
  }
  const displayName = (member.jiraDisplayName ?? member.name ?? '').trim().toLowerCase();
  return jiraUsers.find((user) => user.displayName.trim().toLowerCase() === displayName);
}

async function fetchJiraIssuesByKeys(env, keys) {
  if (keys.length === 0) return [];
  const chunks = [];
  for (let index = 0; index < keys.length; index += 50) chunks.push(keys.slice(index, index + 50));
  const out = [];
  for (const chunk of chunks) {
    const issues = await jiraSearch(env, `key in (${chunk.map((key) => `"${key}"`).join(',')})`, [
      'summary',
      'status',
      'resolutiondate',
      'resolution',
      env.jiraStoryPointsField,
      'issuetype',
      'parent',
    ]);
    out.push(...issues);
  }
  return out;
}

async function fetchQaAssignedTicketTotals(env, qaRoster) {
  const jiraUsers = await fetchJiraUsers(env);
  const qaFieldJqlName = env.jiraQaAssigneeField.startsWith('customfield_')
    ? `cf[${env.jiraQaAssigneeField.replace('customfield_', '')}]`
    : `"${env.jiraQaAssigneeField}"`;
  const canonical = new Map();

  for (const member of qaRoster.members) {
    const jiraUser = mapJiraUser(jiraUsers, member);
    if (!jiraUser?.accountId) continue;
    const issues = await jiraSearch(
      env,
      `updated >= "${env.from}" AND updated <= "${env.to}" AND ${qaFieldJqlName} = "${jiraUser.accountId}"`,
      ['summary', 'status', 'resolutiondate', 'issuetype', 'parent', env.jiraStoryPointsField],
    );
    const parentKeys = [...new Set(issues
      .filter((issue) => issue.fields?.issuetype?.subtask && issue.fields?.parent?.key)
      .map((issue) => issue.fields.parent.key))];
    const parents = parentKeys.length > 0 ? await fetchJiraIssuesByKeys(env, parentKeys) : [];
    const parentByKey = new Map(parents.map((issue) => [issue.key, issue]));

    for (const issue of issues) {
      if (issue.fields?.issuetype?.subtask && issue.fields?.parent?.key && parentByKey.has(issue.fields.parent.key)) {
        canonical.set(issue.fields.parent.key, parentByKey.get(issue.fields.parent.key));
      } else {
        canonical.set(issue.key, issue);
      }
    }
  }

  let assignedStoryPoints = 0;
  for (const issue of canonical.values()) {
    assignedStoryPoints += typeof issue.fields?.[env.jiraStoryPointsField] === 'number' ? issue.fields[env.jiraStoryPointsField] : 0;
  }
  return { assignedTicketCount: canonical.size, assignedStoryPoints };
}

async function testRailGet(env, pathName, params = {}) {
  const url = new URL(`/index.php?/api/v2/${pathName}`, env.testRailBaseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const resp = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.testRailEmail}:${env.testRailToken}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`TestRail request failed: ${JSON.stringify(json)}`);
  return json;
}

async function listPagedTestRail(env, pathName, key, params = {}) {
  const out = [];
  let offset = 0;
  const limit = 250;
  while (true) {
    const json = await testRailGet(env, pathName, { ...params, offset, limit });
    const items = Array.isArray(json) ? json : (json[key] ?? []);
    out.push(...items);
    if (items.length < limit) break;
    offset += items.length;
  }
  return out;
}

async function fetchTestRailVerification(env, qaRoster, projectId) {
  const users = await testRailGet(env, `get_users/${projectId}`);
  const userList = Array.isArray(users) ? users : (users.users ?? []);
  const createdByIds = qaRoster.members
    .map((member) => userList.find((user) => (user.email ?? '').trim().toLowerCase() === (member.email ?? '').trim().toLowerCase())?.id)
    .filter((value) => typeof value === 'number');

  const directRuns = await listPagedTestRail(env, `get_runs/${projectId}`, 'runs', { created_before: env.toTimestamp });
  const plans = await listPagedTestRail(env, `get_plans/${projectId}`, 'plans', { created_before: env.toTimestamp });
  const planRuns = [];
  for (const plan of plans) {
    const detail = await testRailGet(env, `get_plan/${plan.id}`);
    for (const entry of detail.entries ?? []) {
      for (const run of entry.runs ?? []) planRuns.push(run);
    }
  }

  const runs = new Map();
  for (const run of [...directRuns, ...planRuns]) {
    const createdOn = run.created_on ?? 0;
    const completedOn = run.completed_on ?? null;
    const relevant = createdOn <= env.toTimestamp && (
      completedOn === null
      || completedOn >= env.fromTimestamp
      || createdOn >= env.fromTimestamp
    );
    if (!relevant) continue;
    runs.set(run.id, run);
  }

  let totalResults = 0;
  const uniqueTests = new Set();
  let defectsLinked = 0;
  for (const run of runs.values()) {
    const results = await listPagedTestRail(env, `get_results_for_run/${run.id}`, 'results', {
      created_after: env.fromTimestamp,
      created_before: env.toTimestamp,
      created_by: createdByIds.join(','),
    });
    for (const result of results) {
      totalResults += 1;
      uniqueTests.add(result.test_id);
      defectsLinked += parseDefectKeys(result.defects).length;
    }
  }
  return { totalResults, uniqueTests: uniqueTests.size, defectsLinked };
}

async function loginToLocalApp(baseUrl, accountsRaw) {
  const firstAccount = (accountsRaw ?? '').split(',').map((item) => item.trim()).find(Boolean);
  if (!firstAccount || !firstAccount.includes(':')) {
    throw new Error('USER_ACCOUNTS is missing or invalid; cannot authenticate to local dashboard.');
  }
  const idx = firstAccount.indexOf(':');
  const username = firstAccount.slice(0, idx);
  const password = firstAccount.slice(idx + 1);
  const resp = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!resp.ok) {
    throw new Error(`Local login failed with ${resp.status}: ${await resp.text()}`);
  }
  const cookie = resp.headers.get('set-cookie');
  if (!cookie) throw new Error('Local login did not return a session cookie.');
  return cookie;
}

function compareMetric(name, actual, expected) {
  const pass = actual === expected;
  return { name, actual, expected, pass };
}

function isTestRailConfigured(env) {
  return Boolean(env.testRailBaseUrl && env.testRailEmail && env.testRailToken);
}

async function main() {
  await loadEnvFile(path.join(repoRoot, '.env'));
  await loadEnvFile(path.join(repoRoot, '.env.local'));

  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args['base-url'] ?? 'http://localhost:3000';
  const to = args.to ?? new Date().toISOString().slice(0, 10);
  const from = args.from ?? new Date(Date.now() - (29 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const devRoster = JSON.parse(await fs.readFile(path.join(repoRoot, 'testing', 'data', 'dev-team.json'), 'utf8'));
  const qaRoster = JSON.parse(await fs.readFile(path.join(repoRoot, 'testing', 'data', 'qa-team.json'), 'utf8'));

  const env = {
    githubToken: process.env.GITHUB_TOKEN,
    githubOrg: process.env.GITHUB_ORG ?? '',
    githubRepos: splitCsv(process.env.GITHUB_REPOS),
    jiraBaseUrl: process.env.JIRA_BASE_URL,
    jiraEmail: process.env.JIRA_EMAIL,
    jiraToken: process.env.JIRA_API_TOKEN,
    jiraStoryPointsField: process.env.JIRA_STORY_POINTS_FIELD ?? 'customfield_11125',
    jiraQaAssigneeField: process.env.JIRA_QA_ASSIGNEE_FIELD ?? 'customfield_11370',
    testRailBaseUrl: process.env.TESTRAIL_BASE_URL,
    testRailEmail: process.env.TESTRAIL_EMAIL,
    testRailToken: process.env.TESTRAIL_API_TOKEN,
    from,
    to,
    fromTimestamp: Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000),
    toTimestamp: Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000),
  };

  const cookie = await loginToLocalApp(baseUrl, process.env.USER_ACCOUNTS);
  const overviewResp = await fetch(`${baseUrl}/api/management/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    headers: { Cookie: cookie },
  });
  if (!overviewResp.ok) {
    throw new Error(`Management overview failed with ${overviewResp.status}: ${await overviewResp.text()}`);
  }
  const overview = await overviewResp.json();
  let mergedPrs = 0;
  let totalReviewsGiven = 0;
  let agingOpenPrCount = 0;
  const lookbackFrom = new Date(new Date(`${from}T00:00:00Z`).getTime() - (ENGINEERING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  for (const member of devRoster.members) {
    const merged = await fetchTrackedPullRequests(env, {
      login: member.githubLogin,
      from,
      to,
      dateField: 'merged',
      mergedOnly: true,
    });
    const lookback = await fetchTrackedPullRequests(env, {
      login: member.githubLogin,
      from: lookbackFrom,
      to,
      dateField: 'created',
      mergedOnly: false,
    });
    mergedPrs += merged.length;
    totalReviewsGiven += await fetchReviewActivityCount(env, { login: member.githubLogin, from, to });
    agingOpenPrCount += lookback.filter((pr) => {
      const createdAt = new Date(pr.createdAt).getTime();
      const endAt = new Date(`${to}T23:59:59Z`).getTime();
      const isOpenAtEnd = createdAt <= endAt && (!pr.mergedAt && !pr.closedAt || new Date(pr.mergedAt ?? pr.closedAt).getTime() > endAt);
      const ageDays = (endAt - createdAt) / (24 * 60 * 60 * 1000);
      return isOpenAtEnd && ageDays >= ENGINEERING_PR_AGE_DAYS;
    }).length;
  }

  const jiraAssigned = await fetchQaAssignedTicketTotals(env, qaRoster);

  const checks = [
    compareMetric('engineering.mergedPrs', overview.engineering.mergedPrs, mergedPrs),
    compareMetric('engineering.totalReviewsGiven', overview.engineering.totalReviewsGiven, totalReviewsGiven),
    compareMetric('engineering.agingOpenPrCount', overview.engineering.agingOpenPrCount, agingOpenPrCount),
    compareMetric('qa.assignedTicketCount', overview.qa.assignedTicketCount, jiraAssigned.assignedTicketCount),
    compareMetric('qa.assignedStoryPoints', overview.qa.assignedStoryPoints, jiraAssigned.assignedStoryPoints),
  ];

  if (isTestRailConfigured(env) && overview.qa.projectId) {
    const testRail = await fetchTestRailVerification(env, qaRoster, overview.qa.projectId);
    checks.push(
      compareMetric('qa.totalResults', overview.qa.totalResults, testRail.totalResults),
      compareMetric('qa.uniqueTests', overview.qa.uniqueTests, testRail.uniqueTests),
      compareMetric('qa.defectsLinked', overview.qa.defectsLinked, testRail.defectsLinked),
    );
  } else {
    console.log('Skipping direct TestRail verification because TestRail credentials or project selection are unavailable.');
  }

  console.log(`Verification window: ${from} -> ${to}`);
  console.table(checks.map((check) => ({
    metric: check.name,
    actual: check.actual,
    expected: check.expected,
    pass: check.pass,
  })));

  const failed = checks.filter((check) => !check.pass);
  if (failed.length > 0) {
    process.exitCode = 1;
    throw new Error(`Verification failed for: ${failed.map((check) => check.name).join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
