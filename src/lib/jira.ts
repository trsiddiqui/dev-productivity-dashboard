import { cfg } from './config';
import type { JiraIssue, JiraUserLite, JiraProjectLite } from './types';

interface JiraUser { accountId: string; displayName: string; emailAddress?: string }
interface JiraStatus { name?: string }
interface JiraIssueFields {
  summary: string;
  assignee?: JiraUser;
  resolutiondate?: string;
  status?: JiraStatus;
  [key: string]: unknown;
}
interface JiraIssueRaw { id: string; key: string; fields: JiraIssueFields }

interface SearchJQLResponse {
  isLast: boolean;
  nextPageToken?: string;
  issues: JiraIssueRaw[];
}

function normalizedBase(): string {
  try {
    const u = new URL(cfg.jiraBaseUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return cfg.jiraBaseUrl.replace(/\/(jira|wiki|confluence)\/?$/i, '');
  }
}

async function runJQL(params: {
  jql: string;
  fields: string[];
  auth: string;
  base: string;
  maxResults?: number;
}): Promise<JiraIssueRaw[]> {
  const { jql, fields, auth, base, maxResults = 100 } = params;
  const out: JiraIssueRaw[] = [];
  let nextPageToken: string | undefined;

  do {
    const resp = await fetch(`${base}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, fieldsByKeys: true, maxResults, nextPageToken }),
    });
    if (!resp.ok) {
      let detail = '';
      try {
        const e = await resp.json() as { errorMessages?: string[]; errors?: Record<string, unknown> };
        const msgs = [
          ...(e.errorMessages ?? []),
          ...(e.errors ? [JSON.stringify(e.errors)] : []),
        ].filter(Boolean);
        detail = msgs.join('; ');
      } catch {
        try { detail = await resp.text(); } catch { /* ignore */ }
      }
      throw new Error(`JIRA enhanced search failed with ${resp.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = (await resp.json()) as SearchJQLResponse;
    out.push(...(data.issues ?? []));
    nextPageToken = data.isLast ? undefined : data.nextPageToken;
  } while (nextPageToken);

  return out;
}

/** Fetch Jira projects for the dropdown. Tries /project/search, falls back to /project. */
export async function getJiraProjects(): Promise<JiraProjectLite[]> {
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return [];
  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  // Try the paginated search endpoint first
  const projects: JiraProjectLite[] = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const url = new URL(`${base}/rest/api/3/project/search`);
    url.searchParams.set('startAt', String(startAt));
    url.searchParams.set('maxResults', String(maxResults));
    const resp = await fetch(url.toString(), { headers: { Authorization: auth, Accept: 'application/json' } });

    if (resp.ok) {
      // Typical shape: { values: [{ key, name, ... }], total, startAt, maxResults, isLast }
      const data = await resp.json() as { values?: Array<{ key: string; name: string }>; isLast?: boolean; startAt?: number; maxResults?: number };
      const vals = data.values ?? [];
      projects.push(...vals.map(p => ({ key: p.key, name: p.name })));
      if (vals.length < maxResults || data.isLast) break;
      startAt += maxResults;
      continue;
    }

    // Fallback to legacy list (no pagination)
    if (resp.status === 404 || resp.status === 400) {
      const resp2 = await fetch(`${base}/rest/api/3/project`, { headers: { Authorization: auth, Accept: 'application/json' } });
      if (!resp2.ok) return projects;
      const arr = await resp2.json() as Array<{ key: string; name: string }>;
      projects.push(...arr.map(p => ({ key: p.key, name: p.name })));
      break;
    }

    // Other error: degrade quietly
    return projects;
  }

  // Sort by name for UX
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

export async function getJiraDoneIssues(params: {
  assignee: string;           // human string (only used when no accountId)
  from: string;
  to: string;
  jiraAccountId?: string;     // precise assignee
  projectKey?: string;        // NEW: filter by selected project key
}): Promise<JiraIssue[]> {
  const { assignee, from, to, jiraAccountId, projectKey } = params;
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return [];

  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  // include 'status' so we can show it
  const fields: string[] = ['summary', 'assignee', 'resolutiondate', 'status', cfg.jiraStoryPointsField];

  // Scope by selected projectKey if present, else optional env projects
  const envProjects = (process.env.JIRA_PROJECTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const projectFilter = projectKey
    ? `AND project = ${projectKey}` // keys have no spaces; names would need quotes
    : (envProjects.length ? `AND project in (${envProjects.join(',')})` : '');

  // Exact assignee by accountId (correct syntax for Cloud)
  const assigneeExact = jiraAccountId ? `AND assignee in "${jiraAccountId}"` : '';

  // 1) Status changed during window (broad, covers transitions)
  const jql1 = [
    `status CHANGED DURING ("${from}","${to}")`,
    projectFilter,
    assigneeExact,
  ].filter(Boolean).join(' ');

  // 2) Updated during window (very common signal)
  const jql2 = [
    `updated >= "${from}" AND updated <= "${to}"`,
    projectFilter,
    assigneeExact,
  ].filter(Boolean).join(' AND ');

  // 3) Created during window (fallback)
  const jql3 = [
    `created >= "${from}" AND created <= "${to}"`,
    projectFilter,
    assigneeExact,
  ].filter(Boolean).join(' AND ');

  const raw1 = await runJQL({ jql: jql1, fields, auth, base }).catch(() => [] as JiraIssueRaw[]);
  const raw2 = raw1.length ? [] : await runJQL({ jql: jql2, fields, auth, base }).catch(() => [] as JiraIssueRaw[]);
  const raw3 = (raw1.length || raw2.length) ? [] : await runJQL({ jql: jql3, fields, auth, base }).catch(() => [] as JiraIssueRaw[]);

  const picked = [...raw1, ...raw2, ...raw3];
  const byId = new Map<string, JiraIssue>();

  for (const issue of picked) {
    const spUnknown = issue.fields[cfg.jiraStoryPointsField];
    const storyPoints = typeof spUnknown === 'number' ? spUnknown : undefined;

    const assigneeField = issue.fields.assignee;
    const assigneeName = assigneeField?.displayName ?? assigneeField?.emailAddress ?? '';

    // If no exact accountId filter, keep a soft match on the assignee string
    if (!jiraAccountId) {
      const matches = assigneeName.toLowerCase().includes(assignee.toLowerCase());
      if (!matches) continue;
    }

    byId.set(issue.id, {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      assignee: assigneeField?.displayName,
      resolutiondate: issue.fields.resolutiondate,
      storyPoints,
      status: issue.fields.status?.name ?? undefined,
      url: `${base}/browse/${issue.key}`,
    });
  }

  return Array.from(byId.values());
}

/** List users (unchanged) */
export async function getJiraUsers(): Promise<JiraUserLite[]> {
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return [];
  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  const out: JiraUserLite[] = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const url = new URL(`${base}/rest/api/3/users/search`);
    url.searchParams.set('startAt', String(startAt));
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('query', '');

    const resp = await fetch(url.toString(), {
      headers: { Authorization: auth, Accept: 'application/json' },
    });

    if (resp.status === 400) {
      url.searchParams.set('query', 'a');
      const resp2 = await fetch(url.toString(), {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!resp2.ok) return out;
      const arr2 = (await resp2.json()) as JiraUser[];
      if (arr2.length === 0) break;
      out.push(...arr2.map(u => ({ accountId: u.accountId, displayName: u.displayName, emailAddress: u.emailAddress })));
      if (arr2.length < maxResults) break;
      startAt += maxResults;
      continue;
    }

    if (!resp.ok) return out;

    const arr = (await resp.json()) as JiraUser[];
    if (arr.length === 0) break;
    out.push(...arr.map(u => ({ accountId: u.accountId, displayName: u.displayName, emailAddress: u.emailAddress })));
    if (arr.length < maxResults) break;
    startAt += maxResults;
  }

  return out;
}
