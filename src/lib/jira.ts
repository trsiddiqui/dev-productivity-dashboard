import { cfg } from './config';
import type {
  JiraIssue,
  JiraUserLite,
  JiraProjectLite,
  JiraIssue as JiraIssueModel,
  JiraSprintLite,
  LinkedPR,
} from './types';



interface JiraUser { accountId: string; displayName: string; emailAddress?: string }
interface JiraStatus { name?: string }
interface JiraIssueFields {
  summary: string;
  assignee?: JiraUser;
  resolutiondate?: string;
  status?: JiraStatus;
  updated?: string;
  created?: string;
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
    const url = `${base}/rest/api/3/search/jql`;
    console.log(`[API FETCH START] POST ${url} (maxResults=${maxResults}, nextPageToken=${nextPageToken ?? 'none'})`);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, fieldsByKeys: true, maxResults, nextPageToken }),
    });
    console.log(`[API FETCH END] POST ${url} -> ${resp.status}`);

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
        try { detail = await resp.text(); } catch {  }
      }
      throw new Error(`JIRA enhanced search failed with ${resp.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = (await resp.json()) as SearchJQLResponse;
    out.push(...(data.issues ?? []));
    nextPageToken = data.isLast ? undefined : data.nextPageToken;
  } while (nextPageToken);

  return out;
}

export async function getJiraProjects(): Promise<JiraProjectLite[]> {
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return [];
  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  const projects: JiraProjectLite[] = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const url = new URL(`${base}/rest/api/3/project/search`);
    url.searchParams.set('startAt', String(startAt));
    url.searchParams.set('maxResults', String(maxResults));
    console.log(`[API FETCH START] GET ${url.toString()}`);
    const resp = await fetch(url.toString(), { headers: { Authorization: auth, Accept: 'application/json' } });
    console.log(`[API FETCH END] GET ${url.toString()} -> ${resp.status}`);

    if (resp.ok) {
      const data = await resp.json() as { values?: Array<{ key: string; name: string }>; isLast?: boolean; startAt?: number; maxResults?: number };
      const vals = data.values ?? [];
      projects.push(...vals.map(p => ({ key: p.key, name: p.name })));
      if (vals.length < maxResults || data.isLast) break;
      startAt += maxResults;
      continue;
    }

    if (resp.status === 404 || resp.status === 400) {
      const url2 = `${base}/rest/api/3/project`;
      console.log(`[API FETCH START] GET ${url2} (fallback)`);
      const resp2 = await fetch(url2, { headers: { Authorization: auth, Accept: 'application/json' } });
      console.log(`[API FETCH END] GET ${url2} -> ${resp2.status}`);
      if (!resp2.ok) return projects;
      const arr = await resp2.json() as Array<{ key: string; name: string }>;
      projects.push(...arr.map(p => ({ key: p.key, name: p.name })));
      break;
    }

    return projects;
  }

  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

export async function getJiraDoneIssues(params: {
  assignee: string;
  from: string;
  to: string;
  jiraAccountId?: string;
  projectKey?: string;
}): Promise<JiraIssue[]> {
  const { assignee, from, to, jiraAccountId, projectKey } = params;
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return [];

  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  const fields: string[] = ['summary', 'assignee', 'resolutiondate', 'status', cfg.jiraStoryPointsField];

  const envProjects = (process.env.JIRA_PROJECTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const projectFilter = projectKey
    ? `AND project = ${projectKey}`
    : (envProjects.length ? `AND project in (${envProjects.join(',')})` : '');

  const assigneeExact = jiraAccountId ? `AND assignee in "${jiraAccountId}"` : '';

  const issueTypes = ['Story', 'Task', 'Bug', 'Epic'];
  const issueTypeFilter = issueTypes.length ? `AND issuetype in (${issueTypes.join(',')})` : '';

  const jql1 = [
    `status CHANGED DURING ("${from}","${to}")`,
    projectFilter,
    assigneeExact,
    issueTypeFilter,
  ].filter(Boolean).join(' ');

  const jql2 = [
    `updated >= "${from}" AND updated <= "${to}"`,
    projectFilter,
    assigneeExact,
    issueTypeFilter,
  ].filter(Boolean).join(' AND ');

  const jql3 = [
    `created >= "${from}" AND created <= "${to}"`,
    projectFilter,
    assigneeExact,
    issueTypeFilter,
  ].filter(Boolean).join(' AND ');

  console.log(`[API CALL START] runJQL (done-issues jql1)`);
  const raw1 = await runJQL({ jql: jql1, fields, auth, base }).catch(() => [] as JiraIssueRaw[]);
  console.log(`[API CALL END] runJQL (done-issues jql1) -> items=${raw1.length}`);

  console.log(`[API CALL START] runJQL (done-issues jql2)`);
  const raw2 = raw1.length ? [] : await runJQL({ jql: jql2, fields, auth, base }).catch(() => [] as JiraIssueRaw[]);
  console.log(`[API CALL END] runJQL (done-issues jql2) -> items=${raw2.length}`);

  console.log(`[API CALL START] runJQL (done-issues jql3)`);
  const raw3 = (raw1.length || raw2.length) ? [] : await runJQL({ jql: jql3, fields, auth, base }).catch(() => [] as JiraIssueRaw[]);
  console.log(`[API CALL END] runJQL (done-issues jql3) -> items=${raw3.length}`);

  const picked = [...raw1, ...raw2, ...raw3];
  const byId = new Map<string, JiraIssue>();

  for (const issue of picked) {
    const spUnknown = issue.fields[cfg.jiraStoryPointsField];
    const storyPoints = typeof spUnknown === 'number' ? spUnknown : undefined;

    const assigneeField = issue.fields.assignee;
    const assigneeName = assigneeField?.displayName ?? assigneeField?.emailAddress ?? '';

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

    console.log(`[API FETCH START] GET ${url.toString()}`);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    console.log(`[API FETCH END] GET ${url.toString()} -> ${resp.status}`);

    if (resp.status === 400) {
      url.searchParams.set('query', 'a');
      console.log(`[API FETCH START] GET ${url.toString()} (fallback query='a')`);
      const resp2 = await fetch(url.toString(), {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      console.log(`[API FETCH END] GET ${url.toString()} -> ${resp2.status}`);
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

interface JiraSprintValue {
  id: number;
  name: string;
  state?: string;
  startDate?: string;
  endDate?: string;
}
interface JiraSprintsResp { values?: JiraSprintValue[]; isLast?: boolean }

interface JiraAgileIssueFields {
  summary: string;
  assignee?: { displayName?: string };
  status?: { name?: string };
  issuetype?: { name?: string; subtask?: boolean };
  created?: string;
  parent?: { key?: string };
  [key: string]: unknown;
}

interface JiraAgileIssue {
  id: string;
  key: string;
  fields: JiraAgileIssueFields;
}

function jiraAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');
}

function jiraBase(): string { return normalizedBase(); }

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

    console.log(`[API FETCH START] GET ${url.toString()}`);
    const resp = await fetch(url.toString(), { headers: { Authorization: auth, Accept: 'application/json' } });
    console.log(`[API FETCH END] GET ${url.toString()} -> ${resp.status}`);
    if (!resp.ok) break;

    const data = (await resp.json()) as JiraSprintsResp;
    const vals = data.values ?? [];

    out.push(...vals.map(v => ({
      id: v.id,
      name: v.name,
      state: v.state ?? 'unknown',
      startDate: v.startDate,
      endDate: v.endDate,
    })));

    if (vals.length < maxRes || data.isLast) break;
    startAt += maxRes;
  }

  return out;
}

export async function getJiraSprintMeta(
  sprintId: number
): Promise<{ id: number; name: string; state?: string; startDate?: string; endDate?: string } | null> {
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return null;
  const base = jiraBase();
  const auth = jiraAuthHeader();

  const url = `${base}/rest/agile/1.0/sprint/${sprintId}`;
  console.log(`[API FETCH START] GET ${url}`);
  const resp = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  console.log(`[API FETCH END] GET ${url} -> ${resp.status}`);
  if (!resp.ok) return null;

  const d = (await resp.json()) as { id: number; name: string; state?: string; startDate?: string; endDate?: string };
  return { id: d.id, name: d.name, state: d.state, startDate: d.startDate, endDate: d.endDate };
}

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
    'customfield_10014', // Epic Link
    'resolutiondate',
    'description',
    ...(cfg.jiraQAAssigneeField ? [cfg.jiraQAAssigneeField] : []),
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

    console.log(`[API FETCH START] GET ${url.toString()}`);
    const resp = await fetch(url.toString(), { headers: { Authorization: auth, Accept: 'application/json' } });
    console.log(`[API FETCH END] GET ${url.toString()} -> ${resp.status}`);
    if (!resp.ok) break;

    const data = (await resp.json()) as { issues?: Array<{
      id: string; key: string; fields: any;
    }> };
    const list = data.issues ?? [];

    for (const it of list) {
      const typeName = it.fields.issuetype?.name?.toLowerCase() ?? '';
      if (!allowed.has(typeName)) continue;

      const spVal = (it.fields as Record<string, unknown>)[cfg.jiraStoryPointsField];
      const storyPoints = typeof spVal === 'number' ? spVal : undefined;
      const epicKey = (it.fields as Record<string, unknown>)['customfield_10014'] as string | undefined;

      const qaAssignees = cfg.jiraQAAssigneeField ? parseQAAssignees((it.fields as any)[cfg.jiraQAAssigneeField]) : undefined;
      const description = adfToPlain(it.fields.description);

      out.push({
        id: it.id,
        key: it.key,
        summary: it.fields.summary,
        assignee: it.fields.assignee?.displayName,
        status: it.fields.status?.name,
        created: it.fields.created,
        storyPoints,
        url: `${base}/browse/${it.key}`,
        issueType: it.fields.issuetype?.name,
        parentKey: it.fields.parent?.key,
        epicKey,
        resolutiondate: it.fields.resolutiondate as (string | undefined),

        qaAssignees,
        description,
      });
    }

    if (list.length < maxRes) break;
    startAt += maxRes;
  }

  return out;
}

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
    const m = text.match(/\bid\s*=\s*(\d+)\b/);
    return !!(m && m[1] === String(sprintId));
    }

  for (const key of issueKeys) {
    try {
      const url = `${base}/rest/api/3/issue/${encodeURIComponent(key)}?expand=changelog&fields=none`;
      console.log(`[API FETCH START] GET ${url}`);
      const resp = await fetch(url, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      console.log(`[API FETCH END] GET ${url} -> ${resp.status}`);
      if (!resp.ok) continue;
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
            if (!(Number.isFinite(startMs) && Number.isFinite(when) && when > startMs)) {
              wasInAtStart = true;
            }
          }
        }
      }

      if (addedAfterStart) result[key] = 'added';
      else if (wasInAtStart) result[key] = 'committed';
      else result[key] = 'committed';
    } catch {

    }
  }

  return result;
}

export async function getIssuePhaseTimes(
  issueKeys: string[],
  stages: { todo: string[]; inProgress: string[]; review: string[]; complete: string[] }
): Promise<Record<string, { todo?: string; inProgress?: string; review?: string; complete?: string }>> {
  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  const norm = (s?: string) => (s ?? '').trim().toLowerCase();
  const todoSet = new Set(stages.todo.map(norm));
  const inProgSet = new Set(stages.inProgress.map(norm));
  const reviewSet = new Set(stages.review.map(norm));
  const completeSet = new Set(stages.complete.map(norm));

  const out: Record<string, { todo?: string; inProgress?: string; review?: string; complete?: string }> = {};

  for (const key of issueKeys) {
    try {
      const url = `${base}/rest/api/3/issue/${encodeURIComponent(key)}?expand=changelog&fields=created,status`;
      console.log(`[API FETCH START] GET ${url}`);
      const resp = await fetch(url, {
        headers: { Authorization: auth, Accept: 'application/json' },
      });
      console.log(`[API FETCH END] GET ${url} -> ${resp.status}`);

      if (!resp.ok) continue;
      const data = await resp.json() as {
        fields?: { created?: string; status?: { name?: string } };
        changelog?: { histories?: Array<{ created?: string; items?: Array<{ field?: string; toString?: string }> }> };
      };

      let todoFirst: string | undefined = data.fields?.created;
      let inProgFirst: string | undefined;
      let reviewFirst: string | undefined;
      let completeFirst: string | undefined;

      for (const h of (data.changelog?.histories ?? [])) {
        const when = h.created;
        for (const it of (h.items ?? [])) {
          if (it.field !== 'status' || !it.toString) continue;
          const to = norm(it.toString);
          if (!inProgFirst && inProgSet.has(to)) inProgFirst = when;
          if (!reviewFirst && reviewSet.has(to)) reviewFirst = when;
          if (!completeFirst && completeSet.has(to)) completeFirst = when;
          if (!todoFirst && todoSet.has(to)) todoFirst = when;
        }
      }

      out[key] = { todo: todoFirst, inProgress: inProgFirst, review: reviewFirst, complete: completeFirst };
    } catch {

    }
  }
  return out;
}

export async function getJiraIssuePRs(issueIds: string[]): Promise<Record<string, LinkedPR[]>> {
  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  type DevStatusPR = { url?: string; self?: string; name?: string; title?: string; id?: number | string };
  type DevStatusDetail = { pullRequests?: DevStatusPR[] };
  type DevStatusResponse = { detail?: DevStatusDetail[] };

  const result: Record<string, LinkedPR[]> = {};
  for (const id of issueIds) {
    try {
      const url = `${base}/rest/dev-status/1.0/issue/detail?issueId=${encodeURIComponent(id)}&applicationType=GitHub&dataType=pullrequest`;
      console.log(`[API FETCH START] GET ${url}`);
      const resp = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
      console.log(`[API FETCH END] GET ${url} -> ${resp.status}`);

      if (!resp.ok) { result[id] = []; continue; }

      const raw: unknown = await resp.json();
      const data: DevStatusResponse = (raw && typeof raw === 'object') ? (raw as DevStatusResponse) : {};

      const prs: LinkedPR[] = (data.detail ?? [])
        .flatMap((d) => d.pullRequests ?? [])
        .map((p) => {
          const urlVal = p.url ?? p.self ?? '';
          if (!urlVal) return null;
          return {
            url: urlVal,
            title: p.name ?? p.title ?? undefined,
            id: p.id !== undefined ? String(p.id) : undefined,
            source: 'dev-status',
          } as LinkedPR;
        })
        .filter((x): x is LinkedPR => !!x);

      result[id] = prs;
    } catch {
      result[id] = [];
    }
  }
  return result;
}


export async function getJiraSubtaskIds(parentKeys: string[]): Promise<Record<string, string[]>> {
  if (parentKeys.length === 0) return {};
  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  const jql = `parent in (${parentKeys.map(k => `"${k}"`).join(',')})`;
  console.log(`[API CALL START] runJQL (subtasks)`);
  const issues = await runJQL({ jql, fields: ['parent'], auth, base }).catch(() => [] as JiraIssueRaw[]);
  console.log(`[API CALL END] runJQL (subtasks) -> items=${issues.length}`);

  type IssueWithParent = JiraIssueRaw & { fields: JiraIssueFields & { parent?: { key?: string } } };

  const map: Record<string, string[]> = {};
  for (const it of issues as IssueWithParent[]) {
    const parent = it.fields?.parent?.key ?? '';
    if (!parent) continue;
    if (!map[parent]) map[parent] = [];
    map[parent].push(it.id);
  }
  return map;
}


export async function getJiraIssuesUpdated(params: {
  assignee: string;
  from: string;
  to: string;
  jiraAccountId?: string;
  projectKey?: string;
}): Promise<JiraIssue[]> {
  const { assignee, from, to, jiraAccountId, projectKey } = params;
  if (!cfg.jiraBaseUrl || !cfg.jiraEmail || !cfg.jiraToken) return [];

  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');

  const fields: string[] = [
    'summary',
    'assignee',
    'status',
    'updated',
    'created',
    'resolutiondate',
    cfg.jiraStoryPointsField,
  ];

  const envProjects = (process.env.JIRA_PROJECTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const projectFilter = projectKey
    ? `AND project = ${projectKey}`
    : (envProjects.length ? `AND project in (${envProjects.join(',')})` : '');


  const assigneeExact = jiraAccountId ? `AND assignee in "${jiraAccountId}"` : '';

  const issueTypes = ['Story', 'Task', 'Bug', 'Epic'];
  const issueTypeFilter = issueTypes.length ? `AND issuetype in (${issueTypes.join(',')})` : '';

  const jql = [
    `updated >= "${from}" AND updated <= "${to}"`,
    projectFilter,
    assigneeExact,
    issueTypeFilter,
  ].filter(Boolean).join(' ');

  console.log(`[API CALL START] runJQL (issues-updated)`);
  const raw = await runJQL({ jql, fields, auth, base }).catch(() => [] as JiraIssueRaw[]);
  console.log(`[API CALL END] runJQL (issues-updated) -> items=${raw.length}`);

  const byId = new Map<string, JiraIssue>();
  for (const issue of raw) {
    const spUnknown = issue.fields[cfg.jiraStoryPointsField];
    const storyPoints = typeof spUnknown === 'number' ? spUnknown : undefined;

    const assigneeField = issue.fields.assignee;
    const assigneeName = assigneeField?.displayName ?? assigneeField?.emailAddress ?? '';


    if (!jiraAccountId) {
      const matches = assigneeName.toLowerCase().includes(assignee.toLowerCase());
      if (!matches) continue;
    }

    byId.set(issue.id, {
      id: issue.id,
      key: issue.key,
      summary: issue.fields.summary,
      assignee: assigneeField?.displayName,
      status: issue.fields.status?.name ?? undefined,
      storyPoints,
      url: `${base}/browse/${issue.key}`,

      updated: issue.fields.updated,
      created: issue.fields.created,
      resolutiondate: issue.fields.resolutiondate,
    });
  }

  return Array.from(byId.values());
}

export async function getQAAssignmentTimesAll(
  items: Array<{ key: string; qa: Array<{ id?: string; name: string }> }>,
  qaFieldId: string
): Promise<Record<string, Record<string, string | undefined>>> {
  const base = normalizedBase();
  const auth = 'Basic ' + Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64');
  const out: Record<string, Record<string, string | undefined>> = {};
  const norm = (s?: string) => (s ?? '').trim().toLowerCase();
  const keyOf = (q: { id?: string; name: string }) => (q.id ? `id:${q.id}` : `name:${norm(q.name)}`);

  const parseList = (txt?: string): string[] =>
    (txt ?? '')
      .split(/[,;]+/)
      .map(s => norm(s))
      .filter(Boolean);

  for (const row of items) {
    out[row.key] = {};
    try {
      const url = `${base}/rest/api/3/issue/${encodeURIComponent(row.key)}?expand=changelog&fields=none`;
      console.log(`[API FETCH START] GET ${url}`);
      const resp = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
      console.log(`[API FETCH END] GET ${url} -> ${resp.status}`);
      if (!resp.ok) continue;

      const data = await resp.json() as {
        changelog?: { histories?: Array<{
          created?: string;
          items?: Array<{ field?: string; fieldId?: string; to?: string; from?: string; toString?: string; fromString?: string }>;
        }> };
      };

      const targets = new Set(row.qa.map(keyOf));
      const histories = (data.changelog?.histories ?? []).sort((a, b) => (a.created ?? '').localeCompare(b.created ?? ''));

      for (const h of histories) {
        for (const it of (h.items ?? [])) {
          const isQAField = (it.fieldId && it.fieldId === qaFieldId) || (it.field && norm(it.field) === 'qa assignee');
          if (!isQAField) continue;

          const toNames = new Set(parseList(it.toString));
          const fromNames = new Set(parseList(it.fromString));

          for (const nm of toNames) {
            if (!fromNames.has(nm)) {
              const k = `name:${nm}`;
              if (targets.has(k) && !out[row.key][k]) out[row.key][k] = h.created;
            }
          }

          const toIds = new Set((it.to ?? '').toString().split(/[,;]+/).map(s => s.trim()).filter(Boolean));
          const fromIds = new Set((it.from ?? '').toString().split(/[,;]+/).map(s => s.trim()).filter(Boolean));
          for (const id of toIds) {
            if (!fromIds.has(id)) {
              const k = `id:${id}`;
              if (targets.has(k) && !out[row.key][k]) out[row.key][k] = h.created;
            }
          }
        }
      }
    } catch {

    }
  }
  return out;
}


function parseQAAssignees(val: unknown): Array<{ id?: string; name: string }> | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) {
    const arr = val
      .map((v: any) => {
        if (v && typeof v === 'object') {
          return { id: v.accountId as string | undefined, name: (v.displayName || v.name || '').toString() };
        }
        if (typeof v === 'string') return { name: v };
        return null;
      })
      .filter((x): x is { id?: string; name: string } => !!x && !!x.name);
    return arr.length ? arr : undefined;
  }
  if (typeof val === 'object') {
    const o = val as any;
    if (o.displayName || o.name) return [{ id: o.accountId as string | undefined, name: (o.displayName || o.name).toString() }];
  }
  if (typeof val === 'string') {
    const parts = val.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    return parts.length ? parts.map(name => ({ name })) : undefined;
  }
  return undefined;
}

function adfToPlain(input: unknown): string | undefined {
  if (!input) return undefined;
  if (typeof input === 'string') return input;
  try {
    const walk = (n: any): string => {
      if (!n) return '';
      if (typeof n === 'string') return n;
      if (Array.isArray(n)) return n.map(walk).join('');
      if (typeof n === 'object') {
        const type = n.type;
        if (type === 'text' && typeof n.text === 'string') return n.text;
        const content = Array.isArray(n.content) ? n.content.map(walk).join('') : '';
        if (type === 'paragraph') return content + '\n';
        return content;
      }
      return '';
    };
    const s = walk(input).replace(/\n{3,}/g, '\n\n').trim();
    return s || undefined;
  } catch {
    return undefined;
  }
}