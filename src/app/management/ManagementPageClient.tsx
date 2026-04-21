'use client';

import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';
import { formatISO, subDays } from 'date-fns';
import { BarChart3, ShieldAlert, TestTube2, Users } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DateRangePicker } from '../components/DateRangePicker';
import { SearchableSelect, type Option } from '../components/SearchableSelect';
import type { ManagementMetricDefinition, ManagementOverviewResponse, TestRailProjectLite } from '@/lib/types';

const defaultFrom = formatISO(subDays(new Date(), 29), { representation: 'date' });
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

function formatHours(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 48) return `${(value / 24).toFixed(1)}d`;
  return `${value.toFixed(1)}h`;
}

function formatNumber(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return Intl.NumberFormat('en-US').format(Math.round(value));
}

function SummaryCard(props: {
  eyebrow: string;
  title: string;
  value: string;
  helper: string;
}): JSX.Element {
  const { eyebrow, title, value, helper } = props;
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 14, padding: 16, display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>{eyebrow}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 800 }}>{value}</div>
      <div style={{ color: 'var(--panel-muted)', fontSize: 13, lineHeight: 1.45 }}>{helper}</div>
    </div>
  );
}

function MetricBlueprint(props: { items: ManagementMetricDefinition[] }): JSX.Element | null {
  const { items } = props;
  if (items.length === 0) return null;
  return (
    <div style={{ ...panelStyle, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Users size={18} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>How this view measures day-to-day productivity</div>
          <div style={{ color: 'var(--panel-muted)', fontSize: 14 }}>
            The dashboard is anchored on flow, review responsiveness, QA handling time, risk, and automation coverage so management sees the work system, not just raw counts.
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {items.map((item) => (
          <div key={item.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--card-br)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>{item.category}</div>
            <div style={{ marginTop: 6, fontWeight: 700 }}>{item.name}</div>
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--panel-muted)', lineHeight: 1.5 }}>{item.description}</div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--panel-muted)' }}>{item.derivation}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ManagementPageClient({ username }: { username: string }): JSX.Element {
  void username;
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [projectId, setProjectId] = useState('');
  const [data, setData] = useState<ManagementOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectOptions: Option[] = useMemo(() => (
    (data?.qaProjects ?? []).map((project: TestRailProjectLite) => ({
      value: String(project.id),
      label: project.name,
    }))
  ), [data?.qaProjects]);

  async function loadOverview(nextProjectId?: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/management/overview', window.location.origin);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      const effectiveProjectId = nextProjectId ?? projectId;
      if (effectiveProjectId) url.searchParams.set('projectId', effectiveProjectId);
      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error(await resp.text());
      const json: ManagementOverviewResponse = await resp.json();
      setData(json);
      if (!effectiveProjectId && json.qa.projectId) {
        setProjectId(String(json.qa.projectId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load management overview');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
    // Intentionally one-time bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: 24, display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>Management</div>
        <h1 style={{ fontSize: 34, lineHeight: 1.08, fontWeight: 700 }}>Engineering and QA operating picture</h1>
        <p style={{ maxWidth: 900, color: 'var(--panel-muted)', lineHeight: 1.6 }}>
          This page aggregates the tracked developer roster and QA roster in this repo, then blends GitHub delivery flow, Jira workflow signals, TestRail execution evidence, and QA automation work so upper management can see throughput with the matching quality and risk context.
        </p>
      </div>

      <div style={{ ...panelStyle, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BarChart3 size={18} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Controls</div>
            <div style={{ color: 'var(--panel-muted)', fontSize: 14 }}>Refresh the current view for a date range and QA project.</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(260px, 1fr) 180px', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>QA project</label>
            <SearchableSelect
              items={projectOptions}
              value={projectId}
              onChange={(value) => setProjectId(value)}
              placeholder="Use roster default"
              disabled={loading || projectOptions.length === 0}
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
          <button
            type="button"
            onClick={() => { void loadOverview(); }}
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 10,
              border: 0,
              background: 'var(--accent-primary-gradient)',
              color: '#ffffff',
              fontWeight: 700,
              opacity: loading ? 0.7 : 1,
              cursor: 'pointer',
            }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {data && (
          <div style={{ color: 'var(--panel-muted)', fontSize: 13 }}>
            Timezone for weekend-risk calculations: <code>{data.timezone}</code>.
          </div>
        )}
      </div>

      {(data?.warnings?.length ?? 0) > 0 && (
        <div style={{ ...panelStyle, borderColor: 'var(--accent-warning-border)', background: 'color-mix(in srgb, var(--accent-warning-soft) 90%, var(--panel-bg))' }}>
          {data?.warnings?.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}

      {error && (
        <div style={{ ...panelStyle, borderColor: 'var(--accent-danger-border)', background: 'color-mix(in srgb, var(--accent-danger-soft) 90%, var(--panel-bg))' }}>
          {error}
        </div>
      )}

      <MetricBlueprint items={data?.metricDefinitions ?? []} />

      {data && (
        <>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Users size={18} />
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>Engineering</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <SummaryCard eyebrow="Delivery" title="Merged PRs" value={formatNumber(data.engineering.mergedPrs)} helper="Tracked-base PRs merged by the developer roster in the selected window." />
              <SummaryCard eyebrow="Delivery" title="Touched Ticket SP" value={formatNumber(data.engineering.touchedTicketStoryPoints)} helper="Unique Jira story points touched by PR-open or commit-linked work." />
              <SummaryCard eyebrow="Flow" title="Median Lead Time" value={formatHours(data.engineering.medianLeadTimeHours)} helper="Median first-commit to merge duration." />
              <SummaryCard eyebrow="Collaboration" title="Median Review Response" value={formatHours(data.engineering.medianReviewResponseHours)} helper="Median last-commit to first-review wait." />
              <SummaryCard eyebrow="Collaboration" title="Review SLA Hit Rate" value={formatPercent(data.engineering.reviewSlaHitRate)} helper="PRs reviewed within 24 hours of ready state or creation." />
              <SummaryCard eyebrow="Risk" title="Aging Open PRs" value={formatNumber(data.engineering.agingOpenPrCount)} helper="Open PRs older than three days as of the selected end date." />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TestTube2 size={18} />
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>QA</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <SummaryCard eyebrow="Execution" title="Results Logged" value={formatNumber(data.qa.totalResults)} helper="All TestRail results entered by the QA roster in the selected window." />
              <SummaryCard eyebrow="Execution" title="Unique Tests" value={formatNumber(data.qa.uniqueTests)} helper="Distinct tests executed across the selected QA team." />
              <SummaryCard eyebrow="Quality" title="Failure Pressure" value={formatPercent(data.qa.failurePressureRate)} helper="Failed plus retest share across QA execution." />
              <SummaryCard eyebrow="QA" title="Median Queue Wait" value={formatHours(data.qa.medianQueueWaitHours)} helper="Median review-to-QA assignment/start gap." />
              <SummaryCard eyebrow="QA" title="Median QA Cycle" value={formatHours(data.qa.medianQaCycleHours)} helper="Median QA handling time from assignment/review to complete." />
              <SummaryCard eyebrow="Automation" title="Automation Breadth" value={formatNumber(data.qa.automationCoverageBreadth)} helper="Distinct feature areas touched in QA automation changes." />
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ShieldAlert size={18} />
              <h2 style={{ fontSize: 22, fontWeight: 700 }}>Risk</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <SummaryCard eyebrow="Risk" title="Aging Active Issues" value={formatNumber(data.risk.agingActiveIssueCount)} helper="Issues still active and older than five days at the end of the selected window." />
              <SummaryCard eyebrow="Quality" title="Reopened Issues" value={formatNumber(data.risk.reopenedIssueCount)} helper="Unique issues that exited a completed state and had to be reopened." />
              <SummaryCard eyebrow="Quality" title="QA Bounce Issues" value={formatNumber(data.risk.qaBounceIssueCount)} helper="Issues that bounced from review/completed back into active work." />
              <SummaryCard eyebrow="Quality" title="Rejected Defects" value={formatNumber(data.risk.rejectedDefectCount)} helper="Closed TestRail-linked defects ending in duplicate, invalid, or wont-fix outcomes." />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 14 }}>
            <div style={{ ...panelStyle, height: 360 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Daily delivery and execution</div>
              <div style={{ color: 'var(--panel-muted)', fontSize: 14, marginBottom: 12 }}>Engineering merges versus QA execution and linked defects.</div>
              <ResponsiveContainer width="100%" height="85%">
                <LineChart data={data.deliveryDaily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-br)" />
                  <XAxis dataKey="date" stroke="var(--panel-muted)" tick={{ fill: 'var(--panel-muted)', fontSize: 12 }} />
                  <YAxis stroke="var(--panel-muted)" tick={{ fill: 'var(--panel-muted)', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="mergedPrs" name="Merged PRs" stroke="var(--accent-primary-strong)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="qaResults" name="QA Results" stroke="var(--accent-secondary-strong)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="defectsLinked" name="Linked Defects" stroke="#f97316" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{ ...panelStyle, height: 360 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Aging and backflow</div>
              <div style={{ color: 'var(--panel-muted)', fontSize: 14, marginBottom: 12 }}>Risk signals across open PRs, active issues, reopen events, and QA bounce events.</div>
              <ResponsiveContainer width="100%" height="85%">
                <BarChart data={data.riskDaily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-br)" />
                  <XAxis dataKey="date" stroke="var(--panel-muted)" tick={{ fill: 'var(--panel-muted)', fontSize: 12 }} />
                  <YAxis stroke="var(--panel-muted)" tick={{ fill: 'var(--panel-muted)', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="agingOpenPrs" name="Aging Open PRs" fill="var(--accent-primary-strong)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="agingActiveIssues" name="Aging Active Issues" fill="var(--accent-secondary-strong)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="reopenedIssues" name="Reopened Events" fill="#f97316" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="qaBounceIssues" name="QA Bounce Events" fill="#eab308" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ ...panelStyle, overflow: 'auto' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Developer roster</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  {['Developer', 'Merged PRs', 'Touched SP', 'Lead Time', 'Review Response', 'Changes Requested', 'Aging Open PRs', 'Reopened Issues', 'Reviews Given'].map((label) => (
                    <th key={label} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--panel-br)', color: 'var(--panel-muted)' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.engineeringMembers.map((member) => (
                  <tr key={member.alias}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>
                      <div style={{ fontWeight: 700 }}>{member.name}</div>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>{member.githubLogin}</div>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.mergedPrs)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.touchedTicketStoryPoints)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatHours(member.medianLeadTimeHours)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatHours(member.medianReviewResponseHours)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatPercent(member.changesRequestedRate)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.agingOpenPrCount)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.reopenedIssueCount)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.totalReviewsGiven)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ ...panelStyle, overflow: 'auto' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>QA roster</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  {['QA', 'Results', 'Unique Tests', 'Failure Pressure', 'Assigned SP', 'Queue Wait', 'QA Cycle', 'Bounce Issues', 'Automation Breadth'].map((label) => (
                    <th key={label} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--panel-br)', color: 'var(--panel-muted)' }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.qaMembers.map((member) => (
                  <tr key={member.alias}>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>
                      <div style={{ fontWeight: 700 }}>{member.name}</div>
                      <div style={{ color: 'var(--panel-muted)', fontSize: 12 }}>{member.testRailUserName ?? member.githubLogin ?? 'Unmapped'}</div>
                    </td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.totalResults)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.uniqueTests)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatPercent(member.failurePressureRate)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.assignedStoryPoints)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatHours(member.medianQueueWaitHours)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatHours(member.medianQaCycleHours)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.qaBounceIssueCount)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--panel-br)' }}>{formatNumber(member.automationCoverageBreadth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
