'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import { formatISO, subDays } from 'date-fns';
import { BarChart3, ShieldCheck, TestTube2 } from 'lucide-react';
import { Bar, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from 'recharts';
import { DateRangePicker } from '../components/DateRangePicker';
import { SearchableSelect, type Option } from '../components/SearchableSelect';
import { useUserRuntimeSettings } from '../components/runtime-settings-client';
import { areTestRailRuntimeSettingsComplete } from '@/lib/runtime-settings';
import type {
  GithubUser,
  QaCatalogResponse,
  QaCompareResponse,
  QaMetricDefinition,
  TestRailProjectLite,
  TestRailUserLite,
} from '@/lib/types';

const defaultFrom = formatISO(subDays(new Date(), 14), { representation: 'date' });
const defaultTo = formatISO(new Date(), { representation: 'date' });

const panelStyle: CSSProperties = {
  background: 'var(--panel-bg)',
  color: 'var(--panel-fg)',
  border: '1px solid var(--panel-br)',
  borderRadius: 18,
  padding: 18,
};

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function MetricCard(props: {
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftValue: string;
  rightValue: string;
  helper: string;
}): JSX.Element {
  const { title, leftLabel, rightLabel, leftValue, rightValue, helper } = props;

  return (
    <div style={{ ...panelStyle, display: 'grid', gap: 12 }}>
      <div>
        <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>{title}</div>
        <div style={{ color: 'var(--panel-muted)', fontSize: 13, marginTop: 6 }}>{helper}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 14, padding: 14 }}>
          <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>{leftLabel}</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{leftValue}</div>
        </div>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 14, padding: 14 }}>
          <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>{rightLabel}</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{rightValue}</div>
        </div>
      </div>
    </div>
  );
}

function MetricBlueprint(props: { items: QaMetricDefinition[] }): JSX.Element {
  const { items } = props;
  return (
          <div style={{ ...panelStyle, display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldCheck size={18} />
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>How this QA view measures productivity</div>
                <div style={{ color: 'var(--panel-muted)', fontSize: 14 }}>
            The page blends TestRail execution evidence with GitHub automation delivery, engineering, and coverage signals instead of treating raw execution count as the whole story.
                </div>
              </div>
            </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {items.map((item) => (
          <div key={item.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>{item.category}</div>
            <div style={{ fontWeight: 700, marginTop: 6 }}>{item.name}</div>
            <div style={{ color: 'var(--panel-muted)', fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{item.description}</div>
            <div style={{ color: 'var(--panel-muted)', fontSize: 12, marginTop: 8 }}>{item.derivation}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function QaPageClient(props: { username: string }): JSX.Element {
  const { username } = props;
  const { settings, ready } = useUserRuntimeSettings(username);
  const testRailReady = areTestRailRuntimeSettingsComplete(settings);

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [projectId, setProjectId] = useState('');
  const [leftUserId, setLeftUserId] = useState('');
  const [rightUserId, setRightUserId] = useState('');
  const [leftGithubLogin, setLeftGithubLogin] = useState('');
  const [rightGithubLogin, setRightGithubLogin] = useState('');
  const [catalog, setCatalog] = useState<QaCatalogResponse | null>(null);
  const [compare, setCompare] = useState<QaCompareResponse | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectOptions: Option[] = useMemo(() => (
    (catalog?.projects ?? []).map((project: TestRailProjectLite) => ({
      value: String(project.id),
      label: project.name,
    }))
  ), [catalog]);

  const userOptions: Option[] = useMemo(() => (
    (catalog?.users ?? []).map((user: TestRailUserLite) => ({
      value: String(user.id),
      label: user.name,
      subtitle: user.email,
    }))
  ), [catalog]);

  const githubUserOptions: Option[] = useMemo(() => (
    (catalog?.githubUsers ?? []).map((user: GithubUser) => ({
      value: user.login,
      label: user.login,
      subtitle: user.name,
    }))
  ), [catalog]);

  const metricDefinitions = compare?.metricDefinitions ?? [];

  useEffect(() => {
    if (!ready || !testRailReady || catalog) return;
    (async () => {
      setLoadingCatalog(true);
      setError(null);
      try {
        const resp = await fetch('/api/qa/catalog');
        if (!resp.ok) throw new Error(await resp.text());
        const json: QaCatalogResponse = await resp.json();
        setCatalog(json);
        setProjectId((current) => current || (json.projects[0] ? String(json.projects[0].id) : ''));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch TestRail projects');
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [catalog, ready, testRailReady]);

  useEffect(() => {
    if (!projectId || !testRailReady) return;
    (async () => {
      setLoadingCatalog(true);
      setError(null);
      try {
        const url = new URL('/api/qa/catalog', window.location.origin);
        url.searchParams.set('projectId', projectId);
        const resp = await fetch(url.toString());
        if (!resp.ok) throw new Error(await resp.text());
        const json: QaCatalogResponse = await resp.json();
        setCatalog((current) => ({
          projects: current?.projects ?? json.projects,
          statuses: json.statuses,
          users: json.users,
          githubUsers: current?.githubUsers?.length ? current.githubUsers : json.githubUsers,
          warnings: Array.from(new Set([...(current?.warnings ?? []), ...(json.warnings ?? [])])),
        }));
        setLeftUserId((current) => current || (json.users[0] ? String(json.users[0].id) : ''));
        setRightUserId((current) => current || (json.users[1] ? String(json.users[1].id) : ''));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch TestRail users');
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, [projectId, testRailReady]);

  async function runCompare(): Promise<void> {
    if (!projectId || !leftUserId || !rightUserId) {
      setError('Select a project and two QA resources first.');
      return;
    }

    setLoadingCompare(true);
    setError(null);
    try {
      const url = new URL('/api/qa/compare', window.location.origin);
      url.searchParams.set('projectId', projectId);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      url.searchParams.set('leftUserId', leftUserId);
      url.searchParams.set('rightUserId', rightUserId);
      if (leftGithubLogin) url.searchParams.set('leftGithubLogin', leftGithubLogin);
      if (rightGithubLogin) url.searchParams.set('rightGithubLogin', rightGithubLogin);
      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error(await resp.text());
      const json: QaCompareResponse = await resp.json();
      setCompare(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compare QA resources');
    } finally {
      setLoadingCompare(false);
    }
  }

  const leftName = compare?.left.userName ?? 'Left resource';
  const rightName = compare?.right.userName ?? 'Right resource';

  return (
    <div style={{ maxWidth: 1320, margin: '0 auto', padding: 24, display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>QA Comparison</div>
        <h1 style={{ fontSize: 34, lineHeight: 1.08, fontWeight: 700 }}>QA resource performance</h1>
        <p style={{ maxWidth: 860, color: 'var(--panel-muted)', lineHeight: 1.6 }}>
          Compare two QA resources on TestRail execution outcomes and GitHub automation delivery. TestRail stays the source of execution evidence, while GitHub adds automation PR, test asset, framework, and coverage-breadth signals from aligncommerce/test-engineering1.
        </p>
      </div>

      {!ready ? null : !testRailReady ? (
        <div style={{ ...panelStyle, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <TestTube2 size={18} />
            <div style={{ fontSize: 18, fontWeight: 700 }}>Configure TestRail to unlock QA analytics</div>
          </div>
          <div style={{ color: 'var(--panel-muted)', lineHeight: 1.6 }}>
            The QA page uses the official TestRail API with your browser-scoped TestRail base URL, email, and API token. Add those three fields in Settings and then return here.
          </div>
          <div>
            <Link
              href="/settings?next=/qa"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid var(--panel-br)',
                background: 'var(--card-bg)',
                color: 'var(--panel-fg)',
                textDecoration: 'none',
                fontWeight: 700,
              }}
            >
              Open settings
            </Link>
          </div>
        </div>
      ) : (
        <>
          <MetricBlueprint items={metricDefinitions.length > 0 ? metricDefinitions : [
            {
              id: 'results-logged',
              name: 'Results logged',
              category: 'Activity',
              description: 'Execution volume entered by the QA resource in TestRail.',
              derivation: 'Count of results where created_by matches the selected user.',
            },
            {
              id: 'pass-rate',
              name: 'Pass rate',
              category: 'Outcomes',
              description: 'Outcome mix, paired with failure pressure instead of read in isolation.',
              derivation: 'Passed results divided by total results.',
            },
            {
              id: 'failure-pressure',
              name: 'Failure pressure',
              category: 'Risk',
              description: 'Signals instability or bug discovery load from failed and retest outcomes.',
              derivation: '(Failed + Retest) divided by total results.',
            },
            {
              id: 'elapsed-time',
              name: 'Execution time',
              category: 'Efficiency',
              description: 'Reported effort directly from TestRail elapsed fields.',
              derivation: 'Average and median elapsed values from results.',
            },
          ]} />

          <div style={{ ...panelStyle, display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BarChart3 size={18} />
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Comparison controls</div>
                <div style={{ color: 'var(--panel-muted)', fontSize: 14 }}>Pick one TestRail project, one shared date window, and two QA resources.</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(220px, 1fr))', gap: 12, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>TestRail project</label>
                <SearchableSelect
                  items={projectOptions}
                  value={projectId}
                  onChange={(value) => {
                    setProjectId(value);
                    setLeftUserId('');
                    setRightUserId('');
                    setLeftGithubLogin('');
                    setRightGithubLogin('');
                    setCompare(null);
                  }}
                  placeholder="Select project…"
                  disabled={loadingCatalog}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Primary QA</label>
                <SearchableSelect
                  items={userOptions}
                  value={leftUserId}
                  onChange={setLeftUserId}
                  placeholder="Select QA…"
                  disabled={loadingCatalog}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Comparison QA</label>
                <SearchableSelect
                  items={userOptions}
                  value={rightUserId}
                  onChange={setRightUserId}
                  placeholder="Select QA…"
                  disabled={loadingCatalog}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Primary GitHub user</label>
                <SearchableSelect
                  items={githubUserOptions}
                  value={leftGithubLogin}
                  onChange={(value) => {
                    setLeftGithubLogin(value);
                    setCompare(null);
                  }}
                  placeholder="Select GitHub user…"
                  disabled={loadingCatalog}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Comparison GitHub user</label>
                <SearchableSelect
                  items={githubUserOptions}
                  value={rightGithubLogin}
                  onChange={(value) => {
                    setRightGithubLogin(value);
                    setCompare(null);
                  }}
                  placeholder="Select GitHub user…"
                  disabled={loadingCatalog}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Date range</label>
                <DateRangePicker
                  from={from}
                  to={to}
                  onChange={({ from: nextFrom, to: nextTo }) => {
                    setFrom(nextFrom);
                    setTo(nextTo);
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: 'transparent' }}>Run</div>
                <button
                  type="button"
                  onClick={() => { void runCompare(); }}
                  disabled={loadingCompare || loadingCatalog}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: 0,
                    background: 'var(--accent-primary-gradient)',
                    color: '#ffffff',
                    fontWeight: 700,
                    opacity: (loadingCompare || loadingCatalog) ? 0.7 : 1,
                    cursor: 'pointer',
                  }}
                >
                  {loadingCompare ? 'Comparing…' : 'Compare'}
                </button>
              </div>
            </div>
            {(catalog?.warnings?.length ?? 0) > 0 && (
              <div style={{ color: 'var(--accent-secondary-text)', fontSize: 13 }}>{catalog?.warnings?.join(' ')}</div>
            )}
            <div style={{ color: 'var(--panel-muted)', fontSize: 13 }}>
              Map each QA resource to a GitHub user if you want automation metrics from `aligncommerce/test-engineering1`. The TestRail comparison still works without that mapping.
            </div>
          </div>

          {error && (
            <div style={{ ...panelStyle, borderColor: 'var(--accent-danger-border)', color: 'var(--panel-fg)', background: 'color-mix(in srgb, var(--accent-danger-soft) 92%, var(--panel-bg))' }}>
              {error}
            </div>
          )}

          {compare && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                <MetricCard title="Results logged" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.totalResults)} rightValue={formatNumber(compare.right.totalResults)} helper="Execution throughput from TestRail results entered in the selected window." />
                <MetricCard title="Unique tests executed" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.uniqueTests)} rightValue={formatNumber(compare.right.uniqueTests)} helper="Breadth of execution, separating broad coverage from repeated reruns." />
                <MetricCard title="Pass rate" leftLabel={leftName} rightLabel={rightName} leftValue={formatPercent(compare.left.passRate)} rightValue={formatPercent(compare.right.passRate)} helper="Passed results divided by total results." />
                <MetricCard title="Failure pressure" leftLabel={leftName} rightLabel={rightName} leftValue={formatPercent(compare.left.failurePressureRate)} rightValue={formatPercent(compare.right.failurePressureRate)} helper="Failed + retest share, useful for spotting unstable or defect-heavy work." />
                <MetricCard title="Average elapsed" leftLabel={leftName} rightLabel={rightName} leftValue={formatDuration(compare.left.avgElapsedSeconds)} rightValue={formatDuration(compare.right.avgElapsedSeconds)} helper="Average reported execution effort from TestRail elapsed fields." />
                <MetricCard title="Defects linked" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.defectsLinked)} rightValue={formatNumber(compare.right.defectsLinked)} helper="Number of defect IDs linked across the selected tester’s result entries." />
              </div>

              {(compare.warnings?.length ?? 0) > 0 && (
                <div style={{ ...panelStyle, borderColor: 'var(--accent-warning-border)', color: 'var(--panel-fg)', background: 'color-mix(in srgb, var(--accent-warning-soft) 92%, var(--panel-bg))' }}>
                  {compare.warnings?.join(' ')}
                </div>
              )}

              <div style={{ ...panelStyle, display: 'grid', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>GitHub automation delivery</div>
                  <div style={{ color: 'var(--panel-muted)', fontSize: 14, marginTop: 6 }}>
                    Signals are pulled from merged PRs to `main` in `aligncommerce/test-engineering1`, with file-level classification for test assets and shared automation engineering work.
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                  <MetricCard title="Automation PRs merged" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.github?.mergedPrs ?? null)} rightValue={formatNumber(compare.right.github?.mergedPrs ?? null)} helper="Merged PRs to main in the QA automation repository." />
                  <MetricCard title="Test assets changed" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.github?.testAssetFilesChanged ?? null)} rightValue={formatNumber(compare.right.github?.testAssetFilesChanged ?? null)} helper="Changed test code, feature files, and TestNG suites across merged automation PRs." />
                  <MetricCard title="Median LOC / PR" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.github?.medianLocChangedPerPr ?? null)} rightValue={formatNumber(compare.right.github?.medianLocChangedPerPr ?? null)} helper="Median additions + deletions per PR, limited to matched test asset files." />
                  <MetricCard title="Median files / PR" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.github?.medianFilesChangedPerPr ?? null)} rightValue={formatNumber(compare.right.github?.medianFilesChangedPerPr ?? null)} helper="Median number of matched test files changed in each merged PR." />
                  <MetricCard title="Automation engineering" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.github?.engineeringFilesChanged ?? null)} rightValue={formatNumber(compare.right.github?.engineeringFilesChanged ?? null)} helper="Shared harness, framework, CI, and config files changed under src/main/java and build surfaces." />
                  <MetricCard title="Feature coverage breadth" leftLabel={leftName} rightLabel={rightName} leftValue={formatNumber(compare.left.github?.featureCoverageBreadth ?? null)} rightValue={formatNumber(compare.right.github?.featureCoverageBreadth ?? null)} helper="Distinct product or test areas touched across feature files and test code." />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.6fr) minmax(320px, 1fr)', gap: 14 }}>
                <div style={{ ...panelStyle, height: 360 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Daily execution trend</div>
                  <div style={{ color: 'var(--panel-muted)', fontSize: 14, marginBottom: 12 }}>Daily TestRail results logged by each selected QA resource.</div>
                  <ResponsiveContainer width="100%" height="85%">
                    <LineChart data={compare.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-br)" />
                      <XAxis dataKey="date" stroke="var(--panel-muted)" tick={{ fill: 'var(--panel-muted)', fontSize: 12 }} />
                      <YAxis stroke="var(--panel-muted)" tick={{ fill: 'var(--panel-muted)', fontSize: 12 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="leftResults" name={leftName} stroke="var(--accent-primary-strong)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="rightResults" name={rightName} stroke="var(--accent-secondary-strong)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ ...panelStyle, height: 360 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Status mix</div>
                  <div style={{ color: 'var(--panel-muted)', fontSize: 14, marginBottom: 12 }}>How each QA resource’s result outcomes distribute across TestRail statuses.</div>
                  <ResponsiveContainer width="100%" height="85%">
                    <BarChart data={compare.statusBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-br)" />
                      <XAxis dataKey="statusLabel" stroke="var(--panel-muted)" tick={{ fill: 'var(--panel-muted)', fontSize: 12 }} />
                      <YAxis stroke="var(--panel-muted)" tick={{ fill: 'var(--panel-muted)', fontSize: 12 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="leftCount" name={leftName} fill="var(--accent-primary-strong)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="rightCount" name={rightName} fill="var(--accent-secondary-strong)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ ...panelStyle, display: 'grid', gap: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{leftName}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>Runs touched</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{compare.left.runsTouched}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>Active days</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{compare.left.activeDays}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>Comments logged</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{compare.left.commentsLogged}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>Owned completed runs</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{compare.left.completedOwnedRuns}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>GitHub mapping</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, wordBreak: 'break-word' }}>{compare.left.github?.login ?? '—'}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>GitHub test LOC</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{formatNumber(compare.left.github?.totalLocChanged ?? null)}</div>
                    </div>
                  </div>
                </div>
                <div style={{ ...panelStyle, display: 'grid', gap: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{rightName}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>Runs touched</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{compare.right.runsTouched}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>Active days</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{compare.right.activeDays}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>Comments logged</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{compare.right.commentsLogged}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>Owned completed runs</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{compare.right.completedOwnedRuns}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>GitHub mapping</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, wordBreak: 'break-word' }}>{compare.right.github?.login ?? '—'}</div>
                    </div>
                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 12, padding: 12 }}>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>GitHub test LOC</div>
                      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{formatNumber(compare.right.github?.totalLocChanged ?? null)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
