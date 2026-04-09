import { cfg } from './config';
import type { TestRailProjectLite, TestRailStatusLite, TestRailUserLite } from './types';

interface TestRailListResponse {
  offset?: number;
  limit?: number;
  size?: number;
  _links?: {
    next?: string | null;
    prev?: string | null;
  };
  [key: string]: unknown;
}

interface TestRailProjectRaw {
  id: number;
  name: string;
  is_completed?: boolean;
  announcement?: string | null;
  show_announcement?: boolean;
}

interface TestRailUserRaw {
  id: number;
  name: string;
  email?: string;
  is_active?: boolean;
  role_id?: number;
}

interface TestRailStatusRaw {
  id: number;
  name: string;
  label: string;
  is_final?: boolean;
  is_untested?: boolean;
  is_system?: boolean;
}

export interface TestRailRunLite {
  id: number;
  name: string;
  assignedToId: number | null;
  createdBy: number | null;
  createdOn: number | null;
  completedOn: number | null;
  url?: string;
}

export interface TestRailResult {
  id: number;
  testId: number;
  createdBy: number;
  createdOn: number;
  assignedToId?: number | null;
  statusId: number;
  comment?: string;
  defects?: string;
  elapsed?: string;
  version?: string;
}

interface TestRailPlanListItem {
  id: number;
  name: string;
  created_on?: number | null;
  completed_on?: number | null;
}

interface TestRailPlanDetail {
  entries?: Array<{
    runs?: Array<{
      id: number;
      name: string;
      assignedto_id?: number | null;
      created_by?: number | null;
      created_on?: number | null;
      completed_on?: number | null;
      url?: string;
    }>;
  }>;
}

function resolveBaseUrl(): string {
  const raw = cfg.testRailBaseUrl?.trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function requireTestRailConfig(): { baseUrl: string; auth: string } {
  const baseUrl = resolveBaseUrl();
  const email = cfg.testRailEmail?.trim();
  const token = cfg.testRailToken?.trim();

  if (!baseUrl || !email || !token) {
    throw new Error('Missing TestRail settings. Configure TestRail base URL, email, and API token.');
  }

  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  return { baseUrl, auth };
}

async function testRailGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const { baseUrl, auth } = requireTestRailConfig();
  const url = new URL(`/index.php?/api/v2/${path}`, baseUrl);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (resp.status === 429 && attempt < 2) {
      const retryAfter = Number(resp.headers.get('retry-after') ?? '1');
      await new Promise((resolve) => setTimeout(resolve, Math.max(1000, retryAfter * 1000)));
      continue;
    }

    if (!resp.ok) {
      let detail = '';
      try {
        detail = await resp.text();
      } catch {
        detail = '';
      }
      throw new Error(`TestRail request failed (${resp.status})${detail ? `: ${detail}` : ''}`);
    }

    return resp.json() as Promise<T>;
  }

  throw new Error('TestRail request failed after retries.');
}

async function listPaged<T>(path: string, key: string, params?: Record<string, string | number | boolean | undefined>): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  const limit = 250;

  while (true) {
    const json = await testRailGet<TestRailListResponse | T[]>(path, {
      ...params,
      limit,
      offset,
    });
    const items = Array.isArray(json)
      ? json
      : ((json[key] as T[] | undefined) ?? []);
    out.push(...items);

    if (items.length < limit) break;
    offset += items.length;
  }

  return out;
}

export async function getTestRailProjects(): Promise<TestRailProjectLite[]> {
  const projects = await listPaged<TestRailProjectRaw>('get_projects', 'projects', { is_completed: 0 });
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    isCompleted: project.is_completed,
    announcement: project.announcement,
    showAnnouncement: project.show_announcement,
  }));
}

export async function getTestRailUsers(projectId: number): Promise<TestRailUserLite[]> {
  const json = await testRailGet<TestRailUserRaw[] | { users?: TestRailUserRaw[] }>(`get_users/${projectId}`);
  let users = Array.isArray(json) ? json : (json.users ?? []);

  // TestRail documents that get_users/{project_id} only returns users with explicit
  // project access and excludes users who only inherit access globally/defaults.
  // Fall back to the global users list when available so shared-access projects still
  // populate QA resource selectors.
  if (users.length === 0) {
    try {
      const globalJson = await testRailGet<TestRailUserRaw[] | { users?: TestRailUserRaw[] }>('get_users');
      users = Array.isArray(globalJson) ? globalJson : (globalJson.users ?? []);
    } catch {
      // Non-admin users may not be allowed to call get_users without a project_id.
      // In that case we keep the project-scoped empty list.
    }
  }

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.is_active,
    roleId: user.role_id,
  }));
}

export async function getTestRailStatuses(): Promise<TestRailStatusLite[]> {
  const statuses = await testRailGet<TestRailStatusRaw[]>('get_statuses');
  return statuses.map((status) => ({
    id: status.id,
    name: status.name,
    label: status.label,
    isFinal: !!status.is_final,
    isUntested: !!status.is_untested,
    isSystem: !!status.is_system,
  }));
}

async function getTestRailPlans(projectId: number, createdBefore: number): Promise<TestRailPlanListItem[]> {
  return listPaged<TestRailPlanListItem>(`get_plans/${projectId}`, 'plans', { created_before: createdBefore });
}

async function getTestRailPlan(planId: number): Promise<TestRailPlanDetail> {
  return testRailGet<TestRailPlanDetail>(`get_plan/${planId}`);
}

async function getTestRailRuns(projectId: number, createdBefore: number): Promise<TestRailRunLite[]> {
  const runs = await listPaged<Record<string, unknown>>(`get_runs/${projectId}`, 'runs', { created_before: createdBefore });
  return runs.map((run) => ({
    id: Number(run.id),
    name: String(run.name ?? `Run ${run.id}`),
    assignedToId: typeof run.assignedto_id === 'number' ? run.assignedto_id : null,
    createdBy: typeof run.created_by === 'number' ? run.created_by : null,
    createdOn: typeof run.created_on === 'number' ? run.created_on : null,
    completedOn: typeof run.completed_on === 'number' ? run.completed_on : null,
    url: typeof run.url === 'string' ? run.url : undefined,
  }));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await task(items[current]);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function getTestRailCandidateRuns(params: {
  projectId: number;
  fromTimestamp: number;
  toTimestamp: number;
}): Promise<TestRailRunLite[]> {
  const { projectId, fromTimestamp, toTimestamp } = params;
  const directRuns = await getTestRailRuns(projectId, toTimestamp);
  const planRuns = new Map<number, TestRailRunLite>();
  const plans = await getTestRailPlans(projectId, toTimestamp);
  const detailedPlans = await mapWithConcurrency(plans, 4, (plan) => getTestRailPlan(plan.id));

  for (const plan of detailedPlans) {
    for (const entry of plan.entries ?? []) {
      for (const run of entry.runs ?? []) {
        planRuns.set(run.id, {
          id: run.id,
          name: run.name,
          assignedToId: typeof run.assignedto_id === 'number' ? run.assignedto_id : null,
          createdBy: typeof run.created_by === 'number' ? run.created_by : null,
          createdOn: typeof run.created_on === 'number' ? run.created_on : null,
          completedOn: typeof run.completed_on === 'number' ? run.completed_on : null,
          url: run.url,
        });
      }
    }
  }

  const merged = new Map<number, TestRailRunLite>();
  for (const run of [...directRuns, ...planRuns.values()]) {
    const createdOn = run.createdOn ?? 0;
    const completedOn = run.completedOn ?? null;
    const relevant = createdOn <= toTimestamp && (
      completedOn === null
      || completedOn >= fromTimestamp
      || createdOn >= fromTimestamp
    );
    if (!relevant) continue;
    merged.set(run.id, run);
  }

  return Array.from(merged.values()).sort((left, right) => (right.createdOn ?? 0) - (left.createdOn ?? 0));
}

export async function getTestRailResultsForRun(params: {
  runId: number;
  fromTimestamp: number;
  toTimestamp: number;
  createdByIds?: number[];
}): Promise<TestRailResult[]> {
  const { runId, fromTimestamp, toTimestamp, createdByIds } = params;
  const results = await listPaged<Record<string, unknown>>(`get_results_for_run/${runId}`, 'results', {
    created_after: fromTimestamp,
    created_before: toTimestamp,
    created_by: createdByIds && createdByIds.length > 0 ? createdByIds.join(',') : undefined,
  });

  return results.map((result) => ({
    id: Number(result.id),
    testId: Number(result.test_id),
    createdBy: Number(result.created_by),
    createdOn: Number(result.created_on),
    assignedToId: typeof result.assignedto_id === 'number' ? result.assignedto_id : null,
    statusId: Number(result.status_id),
    comment: typeof result.comment === 'string' ? result.comment : '',
    defects: typeof result.defects === 'string' ? result.defects : '',
    elapsed: typeof result.elapsed === 'string' ? result.elapsed : '',
    version: typeof result.version === 'string' ? result.version : '',
  }));
}

export function parseTestRailTimespanToSeconds(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const matches = Array.from(trimmed.matchAll(/(\d+)\s*(h|m|s)/gi));
  if (matches.length === 0) return null;

  let total = 0;
  for (const match of matches) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount)) continue;
    if (unit === 'h') total += amount * 3600;
    if (unit === 'm') total += amount * 60;
    if (unit === 's') total += amount;
  }

  return total > 0 ? total : null;
}
