'use client';

import { JSX, useEffect, useMemo, useState } from 'react';
import { formatISO, subDays } from 'date-fns';
import type {
  JiraIssue,
  StatsResponse,
  UsersResponse,
  GithubUser,
  JiraUserLite,
  ProjectsResponse,
  JiraProjectLite,
} from '@/lib/types';
import { KPIsView } from '../components/KPIs';
import { LineByDay } from '../components/LineByDay';
import { SearchableSelect, Option } from '../components/SearchableSelect';
import { PRLifecycleView } from '../components/PRLifeCycle';

export default function Page(): JSX.Element {

  // selections
  const [ghLogin, setGhLogin] = useState<string>('');
  const [jiraAccountId, setJiraAccountId] = useState<string>('');
  const [projectKey, setProjectKey] = useState<string>('');
  // dates
  const [from, setFrom] = useState<string>(formatISO(subDays(new Date(), 14), { representation: 'date' }));
  const [to, setTo] = useState<string>(formatISO(new Date(), { representation: 'date' }));
  // data
  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [projects, setProjects] = useState<ProjectsResponse | null>(null);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load users once
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
        // Silent
      } finally {
        setLoadingUsers(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load projects once
  useEffect(() => {
    (async () => {
      setLoadingProjects(true);
      try {
        const resp = await fetch('/api/projects');
        if (!resp.ok) throw new Error(await resp.text());
        const json: ProjectsResponse = await resp.json();
        setProjects(json);
      } catch {
        // Silent
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

      {/* Controls */}
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

      {/* warnings */}
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

      {/* errors */}
      {error && (
        <div style={{ padding: 12, background: '#ffe4e6', color: '#7f1d1d', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* dashboard */}
      {data && (
        <>
          <KPIsView kpis={data.kpis} />
          <div style={{ height: 12 }} />
          <LineByDay items={data.timeseries} />
          {data.lifecycle && (
            <>
              <div style={{ height: 12 }} />
              <PRLifecycleView items={data.lifecycle.items} stats={data.lifecycle.stats} />
            </>
          )}

          {/* Tickets */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, marginTop: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
            <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Tickets</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.tickets.map((t: JiraIssue) => (
                <li key={t.id} style={{ marginBottom: 6 }}>
                  <a href={t.url} target="_blank" rel="noreferrer">{t.key}</a>
                  {` — `}
                  {t.status ? <span style={{ padding: '2px 8px', background: '#eef2ff', color: '#3730a3', borderRadius: 999, fontSize: 12, marginRight: 6 }}>{t.status}</span> : null}
                  {t.summary} {t.storyPoints ? ` (${t.storyPoints} SP)` : ''}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
