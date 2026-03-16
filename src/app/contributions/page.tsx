'use client';

import type { CSSProperties, JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { formatISO, subDays } from 'date-fns';
import type { ContributionGapMode, ContributionResponse, GithubUser, UsersResponse } from '@/lib/types';
import { SearchableSelect, type Option } from '../components/SearchableSelect';
import { ContributionProfile } from '../components/ContributionProfile';
import {
  ContributionSignalsChart,
  type ContributionSignalDatum,
} from '../components/ContributionSignalsChart';

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--panel-br)',
  background: 'var(--card-bg)',
  color: 'var(--card-fg)',
};

export default function ContributionsPage(): JSX.Element {
  const [ghLogin, setGhLogin] = useState('');
  const [compareLogin, setCompareLogin] = useState('');
  const [repo, setRepo] = useState('');
  const [dateMode, setDateMode] = useState<'created' | 'merged'>('merged');
  const [mergedOnly, setMergedOnly] = useState(true);
  const [gapMode, setGapMode] = useState<ContributionGapMode>('weekdays');
  const [from, setFrom] = useState(formatISO(subDays(new Date(), 14), { representation: 'date' }));
  const [to, setTo] = useState(formatISO(new Date(), { representation: 'date' }));

  const [users, setUsers] = useState<UsersResponse | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [primaryData, setPrimaryData] = useState<ContributionResponse | null>(null);
  const [secondaryData, setSecondaryData] = useState<ContributionResponse | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingUsers(true);
      try {
        const resp = await fetch('/api/users');
        if (!resp.ok) throw new Error(await resp.text());
        const json: UsersResponse = await resp.json();
        setUsers(json);
        if (!ghLogin && json.github.length > 0) setGhLogin(json.github[0].login);
      } catch {
        // Ignore selector bootstrap failures and keep manual entry fallback.
      } finally {
        setLoadingUsers(false);
      }
    })();
    // Intentionally run once and only set the default selection when it is empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (dateMode === 'merged') setMergedOnly(true);
  }, [dateMode]);

  const ghOptions: Option[] = useMemo(
    () => (users?.github ?? []).map((user: GithubUser) => ({
      value: user.login,
      label: user.name ? `${user.name} (${user.login})` : user.login,
      iconUrl: user.avatarUrl,
    })),
    [users],
  );

  const compareOptions: Option[] = useMemo(
    () => [{ value: '', label: 'No comparison' }, ...ghOptions],
    [ghOptions],
  );

  async function fetchContribution(login: string): Promise<ContributionResponse> {
    const url = new URL('/api/contributions', window.location.origin);
    url.searchParams.set('login', login);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('dateMode', dateMode);
    url.searchParams.set('mergedOnly', String(mergedOnly));
    if (repo.trim()) url.searchParams.set('repo', repo.trim());

    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  }

  async function run(): Promise<void> {
    if (!ghLogin) {
      setError('Select a GitHub user.');
      return;
    }
    if (compareLogin && compareLogin === ghLogin) {
      setError('Choose a different GitHub user for comparison.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const [primary, secondary] = await Promise.all([
        fetchContribution(ghLogin),
        compareLogin ? fetchContribution(compareLogin) : Promise.resolve(null),
      ]);
      setPrimaryData(primary);
      setSecondaryData(secondary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch contribution data.');
      setPrimaryData(null);
      setSecondaryData(null);
    } finally {
      setLoading(false);
    }
  }

  const comparisonSignals: ContributionSignalDatum[] = useMemo(() => {
    if (!primaryData || !secondaryData) return [];
    return [
      { metric: 'Dev PRs', primary: primaryData.kpis.totalPRs, secondary: secondaryData.kpis.totalPRs },
      { metric: 'LOC changed', primary: primaryData.kpis.totalLocChanged, secondary: secondaryData.kpis.totalLocChanged },
      {
        metric: 'Touched ticket SP',
        primary: primaryData.kpis.touchedTicketStoryPoints,
        secondary: secondaryData.kpis.touchedTicketStoryPoints,
      },
      { metric: 'Active days', primary: primaryData.kpis.activeDays, secondary: secondaryData.kpis.activeDays },
      { metric: 'Active day %', primary: primaryData.kpis.activeDayRate, secondary: secondaryData.kpis.activeDayRate },
      { metric: 'Review coverage %', primary: primaryData.reviews.reviewCoveragePct, secondary: secondaryData.reviews.reviewCoveragePct },
      {
        metric: 'Issue cycle (h)',
        primary: primaryData.issueCycle.medianCycleTimeHours ?? 0,
        secondary: secondaryData.issueCycle.medianCycleTimeHours ?? 0,
      },
      { metric: 'LOC / day', primary: primaryData.kpis.avgLocPerActiveDay, secondary: secondaryData.kpis.avgLocPerActiveDay },
      { metric: 'Idle gap (d)', primary: primaryData.kpis.longestIdleGapDays, secondary: secondaryData.kpis.longestIdleGapDays },
    ];
  }, [primaryData, secondaryData]);

  const warnings = useMemo(
    () => [
      ...(users?.warnings ?? []),
      ...(primaryData?.warnings ?? []),
      ...(secondaryData?.warnings ?? []),
    ],
    [primaryData, secondaryData, users],
  );

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Individual Contribution Dashboard</h1>
        <p style={{ marginTop: 6, color: 'var(--panel-muted)' }}>
          Focuses only on PRs that land in <code>dev</code>, so QA and production promotion PRs do not inflate the numbers.
        </p>
      </header>

      <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', border: '1px solid var(--panel-br)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>What This Represents</h2>
        <div style={{ display: 'grid', gap: 6, marginTop: 8, fontSize: 14 }}>
          <div>- This view treats the first PR into <code>dev</code> as the engineer&apos;s real code contribution.</div>
          <div>- <code>Touched Ticket SP</code> sums unique Jira story points for tickets with a dev PR opened or a commit made during the selected window, using Jira dev-status links where available and rolling subtasks up to parent ticket points.</div>
          <div>- Long flat activity stretches often point to blockers or low delivery cadence.</div>
          <div>- Large one-day spikes usually mean work is batching up instead of landing steadily.</div>
          <div>- Low active-day rate plus low PR volume is the quickest signal that output may be thin.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1.5fr 1.2fr 1.2fr 1.2fr 1fr 1fr 1fr', gap: 12, alignItems: 'end', marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>GitHub user</label>
          {ghOptions.length > 0 ? (
            <SearchableSelect
              items={ghOptions}
              value={ghLogin}
              onChange={setGhLogin}
              placeholder="Search GitHub users..."
              disabled={loadingUsers}
            />
          ) : (
            <input value={ghLogin} onChange={(event) => setGhLogin(event.target.value)} style={inputStyle} placeholder="octocat" />
          )}
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Compare user</label>
          <SearchableSelect
            items={compareOptions}
            value={compareLogin}
            onChange={setCompareLogin}
            placeholder="Optional comparison..."
            disabled={loadingUsers}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Repository</label>
          <input
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            style={inputStyle}
            placeholder="owner/repo (optional)"
          />
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Date mode</label>
          <select value={dateMode} onChange={(event) => setDateMode(event.target.value === 'created' ? 'created' : 'merged')} style={inputStyle}>
            <option value="merged">Merged to dev</option>
            <option value="created">PR created</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>PR scope</label>
          <select
            value={mergedOnly ? 'merged' : 'all'}
            onChange={(event) => setMergedOnly(event.target.value !== 'all')}
            style={inputStyle}
            disabled={dateMode === 'merged'}
          >
            <option value="merged">Merged only</option>
            <option value="all">All dev PRs</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Gap mode</label>
          <select value={gapMode} onChange={(event) => setGapMode(event.target.value === 'calendar' ? 'calendar' : 'weekdays')} style={inputStyle}>
            <option value="weekdays">Weekdays only</option>
            <option value="calendar">All calendar days</option>
          </select>
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>From</label>
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={inputStyle} />
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>To</label>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={inputStyle} />
        </div>

        <div>
          <button
            onClick={run}
            disabled={loading || loadingUsers}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: 0, background: '#111', color: '#fff', opacity: (loading || loadingUsers) ? 0.6 : 1 }}
          >
            {loading ? 'Loading...' : 'Fetch'}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div style={{ padding: 12, background: '#fff7ed', color: '#7c2d12', borderRadius: 8, marginBottom: 16 }}>
          {warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: '#ffe4e6', color: '#7f1d1d', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {primaryData && secondaryData && (
        <>
          <div style={{ marginBottom: 16 }}>
            <ContributionSignalsChart
              title="Head-to-Head Contribution Signals"
              subtitle="Higher is usually better except for issue cycle hours and idle gap days. When those two climb while active-day rate is low, output is usually thin or blocked."
              primaryLabel={primaryData.login}
              secondaryLabel={secondaryData.login}
              items={comparisonSignals}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <ContributionProfile data={primaryData} title={`${primaryData.login} - Dev Contribution View`} gapMode={gapMode} />
            <ContributionProfile data={secondaryData} title={`${secondaryData.login} - Dev Contribution View`} gapMode={gapMode} />
          </div>
        </>
      )}

      {primaryData && !secondaryData && (
        <ContributionProfile data={primaryData} gapMode={gapMode} />
      )}
    </div>
  );
}
