'use client';

import { JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { formatISO, subDays } from 'date-fns';
import type {
  CommitTimeseriesItem,
  StatsResponse,
  UsersResponse,
  GithubUser,
  JiraUserLite,
  ProjectsResponse,
  JiraProjectLite,
  KPIs,
  PR,
  TimeseriesItem,
} from '@/lib/types';
import { KPIsView } from '../components/KPIs';
import { LineByDay } from '../components/LineByDay';
import { SearchableSelect, Option } from '../components/SearchableSelect';
import { PRLifecycleView } from '../components/PRLifeCycle';
import { CommitsByDay } from '../components/CommitsByDay';
import { IndividualKpiTrend } from '../components/IndividualKpiTrend';

interface BranchOption {
  key: string;
  repo: string;
  branch: string;
  prs: number;
  mergedPrs: number;
}

interface BranchGroup {
  repo: string;
  prs: number;
  mergedPrs: number;
  branches: BranchOption[];
}

type StoredBranchSelections = Record<string, string[]>;

const BRANCH_SELECTION_STORAGE_KEY = 'dev-productivity-dashboard:individual-branch-selections:v1';

function repoName(pr: PR): string {
  return `${pr.repository.owner}/${pr.repository.name}`;
}

function branchName(pr: PR): string {
  return pr.baseRefName?.trim() || 'Unknown';
}

function branchKey(repo: string, branch: string): string {
  return `${repo}::${branch}`;
}

function branchKeyForPr(pr: PR): string {
  return branchKey(repoName(pr), branchName(pr));
}

function dateKey(value?: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function enumerateDays(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];

  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    out.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function sameNumberMap(left?: Record<string, number>, right?: Record<string, number>): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function buildBranchGroups(prs: PR[]): BranchGroup[] {
  const repos = new Map<string, Map<string, BranchOption>>();
  for (const pr of prs) {
    const repo = repoName(pr);
    const branch = branchName(pr);
    const key = branchKey(repo, branch);
    let branches = repos.get(repo);
    if (!branches) {
      branches = new Map<string, BranchOption>();
      repos.set(repo, branches);
    }
    const current = branches.get(key) ?? { key, repo, branch, prs: 0, mergedPrs: 0 };
    current.prs += 1;
    if (pr.mergedAt) current.mergedPrs += 1;
    branches.set(key, current);
  }

  return Array.from(repos.entries())
    .map(([repo, branches]) => {
      const branchList = Array.from(branches.values()).sort((left, right) => left.branch.localeCompare(right.branch));
      return {
        repo,
        prs: branchList.reduce((total, branch) => total + branch.prs, 0),
        mergedPrs: branchList.reduce((total, branch) => total + branch.mergedPrs, 0),
        branches: branchList,
      };
    })
    .sort((left, right) => left.repo.localeCompare(right.repo));
}

function readStoredBranchSelections(): StoredBranchSelections {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(BRANCH_SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const selections: StoredBranchSelections = {};
    for (const [repo, branches] of Object.entries(parsed)) {
      if (!Array.isArray(branches)) continue;
      const validBranches = branches.filter((branch): branch is string => typeof branch === 'string');
      selections[repo] = validBranches;
    }
    return selections;
  } catch {
    return {};
  }
}

function writeStoredBranchSelections(selections: StoredBranchSelections): void {
  if (typeof window === 'undefined') return;
  try {
    const repos = Object.keys(selections);
    if (repos.length === 0) {
      window.localStorage.removeItem(BRANCH_SELECTION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(BRANCH_SELECTION_STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // Local storage can be unavailable in some browser modes.
  }
}

function branchKeysFromStoredSelections(groups: BranchGroup[]): Set<string> | null {
  const stored = readStoredBranchSelections();
  const selected = new Set<string>();
  let hasStoredRepo = false;

  for (const group of groups) {
    const savedBranches = stored[group.repo];
    if (savedBranches) {
      hasStoredRepo = true;
      const saved = new Set(savedBranches);
      for (const branch of group.branches) {
        if (saved.has(branch.branch)) selected.add(branch.key);
      }
      continue;
    }

    for (const branch of group.branches) {
      selected.add(branch.key);
    }
  }

  return hasStoredRepo ? selected : null;
}

function persistBranchSelections(groups: BranchGroup[], selectedKeys: Set<string> | null): void {
  const next = { ...readStoredBranchSelections() };

  for (const group of groups) {
    if (!selectedKeys) {
      delete next[group.repo];
      continue;
    }

    const selectedBranches = group.branches
      .filter((branch) => selectedKeys.has(branch.key))
      .map((branch) => branch.branch);

    if (selectedBranches.length === group.branches.length) {
      delete next[group.repo];
    } else {
      next[group.repo] = selectedBranches;
    }
  }

  writeStoredBranchSelections(next);
}

function BranchFilterPanel(props: {
  groups: BranchGroup[];
  selectedKeys: Set<string>;
  onToggleBranch: (key: string) => void;
  onToggleRepo: (repo: string, keys: string[]) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}): JSX.Element {
  const { groups, selectedKeys, onToggleBranch, onToggleRepo, onSelectAll, onClearAll } = props;
  const allCount = groups.reduce((total, group) => total + group.branches.length, 0);
  const selectedCount = Array.from(selectedKeys).length;
  const totalPrs = groups.reduce((total, group) => total + group.prs, 0);

  return (
    <details
      open
      style={{
        marginBottom: 12,
        background: 'var(--panel-bg)',
        color: 'var(--panel-fg)',
        border: '1px solid var(--panel-br)',
        borderRadius: 12,
        padding: 14,
        boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
      }}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
        Branch filters ({selectedCount}/{allCount} selected, {totalPrs.toLocaleString()} PRs)
      </summary>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onSelectAll} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--panel-br)', background: 'var(--card-bg)', color: 'var(--card-fg)', fontWeight: 700 }}>
          Select all
        </button>
        <button type="button" onClick={onClearAll} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--panel-br)', background: 'transparent', color: 'var(--panel-fg)', fontWeight: 700 }}>
          Clear all
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        {groups.map((group) => {
          const groupKeys = group.branches.map((branch) => branch.key);
          const selectedInGroup = groupKeys.filter((key) => selectedKeys.has(key)).length;
          return (
            <div key={group.repo} style={{ border: '1px solid var(--panel-br)', borderRadius: 10, padding: 12, background: 'var(--card-bg)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={selectedInGroup === groupKeys.length && groupKeys.length > 0}
                  ref={(node) => {
                    if (node) node.indeterminate = selectedInGroup > 0 && selectedInGroup < groupKeys.length;
                  }}
                  onChange={() => onToggleRepo(group.repo, groupKeys)}
                />
                <span>{group.repo}</span>
              </label>
              <div style={{ color: 'var(--panel-muted)', fontSize: 12, marginTop: 4 }}>
                {group.prs.toLocaleString()} PRs, {group.mergedPrs.toLocaleString()} merged
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {group.branches.map((branch) => (
                  <label key={branch.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(branch.key)}
                        onChange={() => onToggleBranch(branch.key)}
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{branch.branch}</span>
                    </span>
                    <span style={{ color: 'var(--panel-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {branch.prs} PRs / {branch.mergedPrs} merged
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

export default function Page(): JSX.Element {


  const [ghLogin, setGhLogin] = useState<string>('');
  const [jiraAccountId, setJiraAccountId] = useState<string>('');
  const [projectKey, setProjectKey] = useState<string>('');

  const [from, setFrom] = useState<string>(formatISO(subDays(new Date(), 14), { representation: 'date' }));
  const [to, setTo] = useState<string>(formatISO(new Date(), { representation: 'date' }));

  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [projects, setProjects] = useState<ProjectsResponse | null>(null);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Overrides from PR lifecycle selection filtering
  const [filteredAdditions, setFilteredAdditions] = useState<number | undefined>(undefined);
  const [filteredDeletions, setFilteredDeletions] = useState<number | undefined>(undefined);
  const [filteredTouchedStoryPoints, setFilteredTouchedStoryPoints] = useState<number | undefined>(undefined);
  const [filteredTouchedTicketCount, setFilteredTouchedTicketCount] = useState<number | undefined>(undefined);
  const [filteredLifecyclePrIds, setFilteredLifecyclePrIds] = useState<string[] | undefined>(undefined);
  const [filteredLocChangedByPrId, setFilteredLocChangedByPrId] = useState<Record<string, number> | undefined>(undefined);
  const [selectedBranchKeys, setSelectedBranchKeys] = useState<Set<string> | null>(null);


  useEffect(() => {
    (async () => {
      setLoadingUsers(true);
      try {
        const resp = await fetch('/api/users');
        if (!resp.ok) throw new Error(await resp.text());
        const json: UsersResponse = await resp.json();
        setUsers(json);
        if (!ghLogin && json.github.length > 0) setGhLogin(json.github[0].login);
        if (!jiraAccountId && json.jira.length > 0) setJiraAccountId(json.jira[0].accountId);
      } catch {
        // ignore
      } finally {
        setLoadingUsers(false);
      }
    })();
    // Intentionally run only once: we guard assignments with conditionals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    (async () => {
      setLoadingProjects(true);
      try {
        const resp = await fetch('/api/projects');
        if (!resp.ok) throw new Error(await resp.text());
        const json: ProjectsResponse = await resp.json();
        setProjects(json);
      } catch {

      } finally {
        setLoadingProjects(false);
      }
    })();
  }, []);

  const ghOptions: Option[] = useMemo(() => {
    return (users?.github ?? []).map((u: GithubUser) => ({
      value: u.login,
      label: u.name ? `${u.name} (${u.login})` : u.login,
      iconUrl: u.avatarUrl,
    }));
  }, [users]);

  const jiraOptions: Option[] = useMemo(() => {
    return (users?.jira ?? []).map((u: JiraUserLite) => ({
      value: u.accountId,
      label: u.displayName,
      subtitle: u.emailAddress,
    }));
  }, [users]);

  const projectOptions: Option[] = useMemo(() => {
    const list = (projects?.projects ?? []).map((p: JiraProjectLite) => ({
      value: p.key,
      label: `${p.name} (${p.key})`,
    }));
    return [{ value: '', label: 'All projects' }, ...list];
  }, [projects]);

  const branchGroups = useMemo<BranchGroup[]>(() => buildBranchGroups(data?.prs ?? []), [data?.prs]);

  const allBranchKeys = useMemo(() => branchGroups.flatMap((group) => group.branches.map((branch) => branch.key)), [branchGroups]);
  const activeBranchKeys = useMemo(() => selectedBranchKeys ?? new Set(allBranchKeys), [allBranchKeys, selectedBranchKeys]);
  const activeBranchSignature = useMemo(() => Array.from(activeBranchKeys).sort().join('|'), [activeBranchKeys]);

  const prById = useMemo(() => new Map((data?.prs ?? []).map((pr) => [pr.id, pr])), [data?.prs]);
  const branchFilteredLifecycleItems = useMemo(() => (
    (data?.lifecycle?.items ?? []).filter((item) => {
      const pr = prById.get(item.id);
      return pr ? activeBranchKeys.has(branchKeyForPr(pr)) : false;
    })
  ), [activeBranchKeys, data?.lifecycle?.items, prById]);

  const branchFilteredKpis = useMemo<KPIs | null>(() => {
    if (!data) return null;
    const storyPointsByKey = new Map((data.tickets ?? []).map((ticket) => [ticket.key, ticket.storyPoints ?? 0]));
    const linkedKeys = new Set<string>();
    for (const item of branchFilteredLifecycleItems) {
      if (item.jiraKey) linkedKeys.add(item.jiraKey);
    }
    let storyPoints = 0;
    for (const key of linkedKeys) {
      storyPoints += storyPointsByKey.get(key) ?? 0;
    }

    return {
      ...data.kpis,
      totalPRs: branchFilteredLifecycleItems.length,
      totalTicketsDone: linkedKeys.size,
      totalStoryPoints: storyPoints,
      totalAdditions: branchFilteredLifecycleItems.reduce((total, item) => total + (item.additions ?? 0), 0),
      totalDeletions: branchFilteredLifecycleItems.reduce((total, item) => total + (item.deletions ?? 0), 0),
    };
  }, [branchFilteredLifecycleItems, data]);

  const touchedStoryPointSummary = useMemo(() => {
    if (!data?.lifecycle) return null;

    const storyPointsByKey = new Map((data.tickets ?? []).map((ticket) => [ticket.key, ticket.storyPoints ?? 0]));
    const keys = new Set<string>();
    for (const item of branchFilteredLifecycleItems) {
      if (item.jiraKey) keys.add(item.jiraKey);
    }

    let storyPoints = 0;
    for (const key of keys) {
      storyPoints += storyPointsByKey.get(key) ?? 0;
    }

    return {
      storyPoints,
      ticketCount: keys.size,
    };
  }, [branchFilteredLifecycleItems, data]);

  const branchFilteredTimeseries = useMemo<TimeseriesItem[]>(() => {
    if (!data) return [];
    const rows = new Map(enumerateDays(data.from, data.to).map((date) => [date, {
      date,
      prCount: 0,
      additions: 0,
      deletions: 0,
      tickets: 0,
      storyPoints: 0,
    }]));
    for (const item of branchFilteredLifecycleItems) {
      const key = dateKey(item.createdAt);
      const row = key ? rows.get(key) : undefined;
      if (!row) continue;
      row.prCount += 1;
      row.additions += item.additions ?? 0;
      row.deletions += item.deletions ?? 0;
    }
    return Array.from(rows.values());
  }, [branchFilteredLifecycleItems, data]);

  const branchFilteredCommitTimeseries = useMemo<CommitTimeseriesItem[]>(() => {
    if (!data) return [];
    const rows = new Map(enumerateDays(data.from, data.to).map((date) => [date, {
      date,
      commits: 0,
      additions: 0,
      deletions: 0,
    }]));
    for (const item of branchFilteredLifecycleItems) {
      const key = dateKey(item.mergedAt);
      const row = key ? rows.get(key) : undefined;
      if (!row) continue;
      row.commits += 1;
      row.additions += item.additions ?? 0;
      row.deletions += item.deletions ?? 0;
    }
    return Array.from(rows.values());
  }, [branchFilteredLifecycleItems, data]);

  const handleFilteredTotalsChange = useCallback((totals: {
    additions: number;
    deletions: number;
    touchedStoryPoints: number;
    touchedTicketCount: number;
    selectedPrIds: string[];
    locChangedByPrId: Record<string, number>;
  }) => {
    setFilteredAdditions(totals.additions);
    setFilteredDeletions(totals.deletions);
    setFilteredTouchedStoryPoints(totals.touchedStoryPoints);
    setFilteredTouchedTicketCount(totals.touchedTicketCount);
    setFilteredLifecyclePrIds(totals.selectedPrIds);
    setFilteredLocChangedByPrId((current) => (
      sameNumberMap(current, totals.locChangedByPrId) ? current : totals.locChangedByPrId
    ));
  }, []);

  const resetLifecycleSelection = useCallback(() => {
    setFilteredAdditions(undefined);
    setFilteredDeletions(undefined);
    setFilteredTouchedStoryPoints(undefined);
    setFilteredTouchedTicketCount(undefined);
    setFilteredLifecyclePrIds(undefined);
    setFilteredLocChangedByPrId(undefined);
  }, []);

  useEffect(() => {
    resetLifecycleSelection();
  }, [activeBranchSignature, resetLifecycleSelection]);

  const toggleBranch = useCallback((key: string) => {
    const next = new Set(selectedBranchKeys ?? allBranchKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedBranchKeys(next);
    persistBranchSelections(branchGroups, next);
  }, [allBranchKeys, branchGroups, selectedBranchKeys]);

  const toggleRepo = useCallback((_repo: string, keys: string[]) => {
    const next = new Set(selectedBranchKeys ?? allBranchKeys);
    const selectedCount = keys.filter((key) => next.has(key)).length;
    const shouldSelect = selectedCount < keys.length;
    for (const key of keys) {
      if (shouldSelect) next.add(key);
      else next.delete(key);
    }
    setSelectedBranchKeys(next);
    persistBranchSelections(branchGroups, next);
  }, [allBranchKeys, branchGroups, selectedBranchKeys]);

  const selectAllBranches = useCallback(() => {
    setSelectedBranchKeys(null);
    persistBranchSelections(branchGroups, null);
  }, [branchGroups]);

  const clearAllBranches = useCallback(() => {
    const next = new Set<string>();
    setSelectedBranchKeys(next);
    persistBranchSelections(branchGroups, next);
  }, [branchGroups]);

  async function run(): Promise<void> {
    if (!ghLogin) { setError('Select a GitHub user'); return; }
    setError(null);
    setLoading(true);
    try {
      const url = new URL('/api/stats', window.location.origin);
      url.searchParams.set('login', ghLogin);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      if (jiraAccountId) url.searchParams.set('jiraAccountId', jiraAccountId);
      if (projectKey) url.searchParams.set('projectKey', projectKey);

      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error(await resp.text());
      const json: StatsResponse = await resp.json();
      const nextBranchGroups = buildBranchGroups(json.prs ?? []);
      resetLifecycleSelection();
      setSelectedBranchKeys(branchKeysFromStoredSelections(nextBranchGroups));
      setData(json);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Developer Performance Dashboard</h1>
      </header>
      <div style={{ marginBottom: 16, padding: 12, borderRadius: 12, background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)' }}>
        GitHub metrics include all target branches returned for the selected user and date range. Use the branch filter after fetching to narrow the view by repo and merge target.
      </div>

      {}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr 1fr 1fr 1fr', gap: 12, alignItems: 'end', marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>GitHub user</label>
          {ghOptions.length > 0 ? (
            <SearchableSelect
              items={ghOptions}
              value={ghLogin}
              onChange={setGhLogin}
              placeholder="Search GitHub users…"
              disabled={loadingUsers}
            />
          ) : (
            <input
              placeholder="octocat"
              value={ghLogin}
              onChange={e => setGhLogin(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
            />
          )}
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Jira user</label>
          {jiraOptions.length > 0 ? (
            <SearchableSelect
              items={jiraOptions}
              value={jiraAccountId}
              onChange={setJiraAccountId}
              placeholder="Search Jira users…"
              disabled={loadingUsers}
            />
          ) : (
            <input
              placeholder="Paste Jira accountId (or leave blank)"
              value={jiraAccountId}
              onChange={e => setJiraAccountId(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
            />
          )}
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Project</label>
          {projectOptions.length > 0 ? (
            <SearchableSelect
              items={projectOptions}
              value={projectKey}
              onChange={setProjectKey}
              placeholder="Filter by project…"
              disabled={loadingProjects}
            />
          ) : (
            <input
              placeholder="Project key (e.g., PE)"
              value={projectKey}
              onChange={e => setProjectKey(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
            />
          )}
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>From</label>
          <input type="date"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
            value={from} onChange={e => setFrom(e.target.value)} />
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>To</label>
          <input type="date"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
            value={to} onChange={e => setTo(e.target.value)} />
        </div>

        <div>
          <button
            onClick={run}
            disabled={loading || loadingUsers}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: 0, background: '#111', color: '#fff', opacity: (loading || loadingUsers) ? 0.6 : 1 }}
          >
            {loading ? 'Loading…' : 'Fetch'}
          </button>
        </div>
      </div>

      {}
      {users?.warnings && users.warnings.length > 0 && (
        <div style={{ padding: 12, background: '#fff7ed', color: '#7c2d12', borderRadius: 8, marginBottom: 16 }}>
          {users.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}
      {projects?.warnings && projects.warnings.length > 0 && (
        <div style={{ padding: 12, background: '#fff7ed', color: '#7c2d12', borderRadius: 8, marginBottom: 16 }}>
          {projects.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}
      {data?.warnings && data.warnings.length > 0 && (
        <div style={{ padding: 12, background: '#fff7ed', color: '#7c2d12', borderRadius: 8, marginBottom: 16 }}>
          {data.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>
      )}

      {}
      {error && (
        <div style={{ padding: 12, background: '#ffe4e6', color: '#7f1d1d', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {}
      {data && (
        <>
          <BranchFilterPanel
            groups={branchGroups}
            selectedKeys={activeBranchKeys}
            onToggleBranch={toggleBranch}
            onToggleRepo={toggleRepo}
            onSelectAll={selectAllBranches}
            onClearAll={clearAllBranches}
          />
          {data.lifecycle && (
            <>
              <IndividualKpiTrend
                from={data.from}
                to={data.to}
                items={branchFilteredLifecycleItems}
                tickets={data.tickets}
                selectedPrIds={filteredLifecyclePrIds}
                locChangedByPrId={filteredLocChangedByPrId}
              />
              <div style={{ height: 12 }} />
            </>
          )}
          {branchFilteredKpis && (
            <KPIsView
              kpis={branchFilteredKpis}
              additionsOverride={filteredAdditions}
              deletionsOverride={filteredDeletions}
              touchedStoryPoints={filteredTouchedStoryPoints ?? touchedStoryPointSummary?.storyPoints}
              touchedTicketCount={filteredTouchedTicketCount ?? touchedStoryPointSummary?.ticketCount}
            />
          )}
          <div style={{ height: 12 }} />
          <CommitsByDay items={branchFilteredCommitTimeseries} />
          <div style={{ height: 12 }} />
          <LineByDay items={branchFilteredTimeseries} />
          {data.lifecycle && (
            <>
              <div style={{ height: 12 }} />
              <PRLifecycleView
                items={branchFilteredLifecycleItems}
                stats={data.lifecycle.stats}
                tickets={data.tickets}
                onFilteredTotalsChange={handleFilteredTotalsChange}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
