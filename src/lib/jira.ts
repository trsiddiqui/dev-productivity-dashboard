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

  // Issue Type
  const issueTypes = ['Story', 'Task', 'Bug', 'Epic'];
  const issueTypeFilter = issueTypes.length ? `AND issuetype in (${issueTypes.join(',')})` : '';

  // 1) Status changed during window (broad, covers transitions)
  const jql1 = [
    `status CHANGED DURING ("${from}","${to}")`,
    projectFilter,
    assigneeExact,
    issueTypeFilter,
  ].filter(Boolean).join(' ');

  // 2) Updated during window (very common signal)
  const jql2 = [
    `updated >= "${from}" AND updated <= "${to}"`,
    projectFilter,
    assigneeExact,
    issueTypeFilter,
  ].filter(Boolean).join(' AND ');

  // 3) Created during window (fallback)
  const jql3 = [
    `created >= "${from}" AND created <= "${to}"`,
    projectFilter,
    assigneeExact,
    issueTypeFilter,
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

/* ================== Agile API helpers (Sprints) ================== */

import type { JiraIssue as JiraIssueModel, JiraSprintLite } from './types';

interface JiraBoard { id: number; name: string; type?: string }

interface JiraSprintValue {
  id: number;
  name: string;
  state?: string;               // Jira returns "active" | "future" | "closed" (string union loosely)
  startDate?: string;
  endDate?: string;
}
interface JiraSprintsResp {
  values?: JiraSprintValue[];
  isLast?: boolean;
}

// Shape of fields we read from Agile "issue" responses
interface JiraAgileIssueFields {
  summary: string;
  assignee?: { displayName?: string };
  status?: { name?: string };
  issuetype?: { name?: string; subtask?: boolean };
  created?: string;
  parent?: { key?: string };
  // dynamic bag for custom fields like story points & epic link
  [key: string]: unknown;
}
interface JiraAgileIssue {
  id: string;
  key: string;
  fields: JiraAgileIssueFields;
}

function jiraAuthHeader(): string {
  return 'Basic ' + Buffer
    .from(`${cfg.jiraEmail}:${cfg.jiraToken}`)
    .toString('base64');
}

function jiraBase(): string {
  // reuse your existing normalizedBase() from earlier in this file
  return normalizedBase();
}

/** List sprints for a board (uses Agile API). */
export async function getJiraSprints(boardId: number): Promise<JiraSprintLite[]> {
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return [];
  const base = jiraBase();
  const auth = jiraAuthHeader();

  const out: JiraSprintLite[] = [];
  let startAt = 0;
  const maxRes = 50;

  while (true) {
    const url = new URL(`${base}/rest/agile/1.0/board/${boardId}/sprint`);
    url.searchParams.set('startAt', String(startAt));
    url.searchParams.set('maxResults', String(maxRes));

    const resp = await fetch(url.toString(), {
      headers: { Authorization: auth, Accept: 'application/json' }
    });
    if (!resp.ok) break;

    const data = (await resp.json()) as JiraSprintsResp;
    const vals = data.values ?? [];

    out.push(
      ...vals.map((v): JiraSprintLite => ({
        id: v.id,
        name: v.name,
        state: v.state ?? 'unknown',
        startDate: v.startDate,
        endDate: v.endDate,
      }))
    );

    if (vals.length < maxRes || data.isLast) break;
    startAt += maxRes;
  }

  return out;
}

/** Get sprint meta (start/end/state/name). */
export async function getJiraSprintMeta(
  sprintId: number
): Promise<{ id: number; name: string; state?: string; startDate?: string; endDate?: string } | null> {
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return null;
  const base = jiraBase();
  const auth = jiraAuthHeader();

  const resp = await fetch(`${base}/rest/agile/1.0/sprint/${sprintId}`, {
    headers: { Authorization: auth, Accept: 'application/json' }
  });
  if (!resp.ok) return null;

  const d = (await resp.json()) as {
    id: number; name: string; state?: string; startDate?: string; endDate?: string;
  };
  return { id: d.id, name: d.name, state: d.state, startDate: d.startDate, endDate: d.endDate };
}

/** Issues currently in a sprint. Normalizes to your JiraIssue shape and filters to Story/Bug/Task/Spike. */
export async function getJiraSprintIssues(sprintId: number): Promise<JiraIssueModel[]> {
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return [];
  const base = jiraBase();
  const auth = jiraAuthHeader();

  const fields = [
    'summary',
    'assignee',
    'status',
    'issuetype',
    'created',
    'parent',
    cfg.jiraStoryPointsField,
    'customfield_10014',      // Epic Link (common default key on Cloud)
    'resolutiondate'
  ];
  const allowed = new Set(['story', 'bug', 'task', 'spike']);

  const out: JiraIssueModel[] = [];
  let startAt = 0;
  const maxRes = 50;

  while (true) {
    const url = new URL(`${base}/rest/agile/1.0/sprint/${sprintId}/issue`);
    url.searchParams.set('startAt', String(startAt));
    url.searchParams.set('maxResults', String(maxRes));
    url.searchParams.set('fields', fields.join(','));

    const resp = await fetch(url.toString(), {
      headers: { Authorization: auth, Accept: 'application/json' }
    });
    if (!resp.ok) break;

    const data = (await resp.json()) as { issues?: JiraAgileIssue[] };
    const list = data.issues ?? [];

    for (const it of list) {
      const typeName = it.fields.issuetype?.name?.toLowerCase() ?? '';
      if (!allowed.has(typeName)) continue;

      const spVal = (it.fields as Record<string, unknown>)[cfg.jiraStoryPointsField];
      const storyPoints = typeof spVal === 'number' ? spVal : undefined;
      const epicKey = (it.fields as Record<string, unknown>)['customfield_10014'] as string | undefined;

      out.push({
        id: it.id,
        key: it.key,
        summary: it.fields.summary,
        assignee: it.fields.assignee?.displayName,
        status: it.fields.status?.name,
        created: it.fields.created,               // now typed on JiraIssue
        storyPoints,
        url: `${base}/browse/${it.key}`,
        issueType: it.fields.issuetype?.name,     // now typed on JiraIssue
        parentKey: it.fields.parent?.key,         // now typed on JiraIssue
        epicKey,                                  // now typed on JiraIssue
        resolutiondate: it.fields.resolutiondate as (string | undefined),
      });
    }

    if (list.length < maxRes) break;
    startAt += maxRes;
  }

  return out;
}

/** Determine scope changes by inspecting changelogs for "Sprint" field transitions. */
export async function getJiraSprintScopeChanges(
  sprintId: number,
  issueKeys: string[],
  sprintStart?: string
): Promise<Record<string, 'added' | 'removed' | 'committed'>> {
  const base = jiraBase();
  const auth = jiraAuthHeader();
  const result: Record<string, 'added' | 'removed' | 'committed'> = {};

  const startMs = sprintStart ? new Date(sprintStart).getTime() : NaN;

  function containsSprintId(text?: string): boolean {
    if (!text) return false;
    // Cloud "toString" often contains the sprint id like "...[id=123]..."
    const m = text.match(/\bid\s*=\s*(\d+)\b/);
    return !!(m && m[1] === String(sprintId));
  }

  for (const key of issueKeys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(key)}?expand=changelog&fields=none`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!resp.ok) continue;
      // eslint-disable-next-line no-await-in-loop
      const data = (await resp.json()) as {
        changelog?: {
          histories?: Array<{
            created?: string;
            items?: Array<{ field?: string; fromString?: string; toString?: string }>;
          }>;
        };
      };

      let addedAfterStart = false;
      let wasInAtStart = false;

      for (const h of (data.changelog?.histories ?? [])) {
        const when = h.created ? new Date(h.created).getTime() : NaN;
        for (const ch of (h.items ?? [])) {
          if (ch.field !== 'Sprint') continue;
          const toHas = containsSprintId(ch.toString);
          const fromHas = containsSprintId(ch.fromString);

          if (!fromHas && toHas) {
            if (Number.isFinite(startMs) && Number.isFinite(when) && when > startMs) addedAfterStart = true;
            else wasInAtStart = true;
          }
          if (fromHas && !toHas) {
            // left sprint; if left before/at start, mark as was in at start
            if (!(Number.isFinite(startMs) && Number.isFinite(when) && when > startMs)) {
              wasInAtStart = true;
            }
          }
        }
      }

      if (addedAfterStart) result[key] = 'added';
      else if (wasInAtStart) result[key] = 'committed';
      else result[key] = 'committed'; // conservative default
    } catch {
      // ignore per-issue failures
    }
  }

  return result;
}

/** First time each issue reached a target status name (case-insensitive). */
export async function getIssueFirstReachedStatusDates(
  issueKeys: string[],
  targets: { dev: string[]; complete: string[] }
): Promise<Record<string, { dev?: string; complete?: string }>> {
  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  const norm = (s?: string) => (s ?? '').trim().toLowerCase();
  const devSet = new Set(targets.dev.map(norm));
  const completeSet = new Set(targets.complete.map(norm));

  const out: Record<string, { dev?: string; complete?: string }> = {};

  for (const key of issueKeys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(key)}?expand=changelog&fields=none`, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      if (!resp.ok) continue;
      // eslint-disable-next-line no-await-in-loop
      const data = await resp.json() as {
        changelog?: { histories?: Array<{ created?: string; items?: Array<{ field?: string; toString?: string }> }> };
      };

      let devFirst: string | undefined;
      let completeFirst: string | undefined;

      for (const h of (data.changelog?.histories ?? [])) {
        const when = h.created;
        for (const it of (h.items ?? [])) {
          if (it.field !== 'status' || !it.toString) continue;
          const to = norm(it.toString);
          if (!devFirst && devSet.has(to)) devFirst = when;
          if (!completeFirst && completeSet.has(to)) completeFirst = when;
        }
      }
      if (devFirst || completeFirst) out[key] = { dev: devFirst, complete: completeFirst };
    } catch {
      // ignore one-off failures
    }
  }
  return out;
}
