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

type ComparisonMode = 'developer' | 'date';
type ColumnKey = 'left' | 'right';

interface ComparisonColumnState {
  login: string;
  from: string;
  to: string;
}

const defaultFrom = formatISO(subDays(new Date(), 14), { representation: 'date' });
const defaultTo = formatISO(new Date(), { representation: 'date' });

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--panel-br)',
  background: 'var(--card-bg)',
  color: 'var(--card-fg)',
};

const panelStyle: CSSProperties = {
  background: 'var(--panel-bg)',
  color: 'var(--panel-fg)',
  border: '1px solid var(--panel-br)',
  borderRadius: 16,
  padding: 16,
};

function rangeSummary(from: string, to: string): string {
  return `${from} to ${to}`;
}

function columnLabel(column: ColumnKey): string {
  return column === 'left' ? 'Left side' : 'Right side';
}

function maskedDeveloperLabel(column: ColumnKey): string {
  return column === 'left' ? 'Developer A' : 'Developer B';
}

function buildProfileTitle(params: {
  column: ColumnKey;
  data: ContributionResponse;
  from: string;
  to: string;
  comparisonMode: ComparisonMode;
  hideDeveloperName: boolean;
}): string {
  const {
    column,
    data,
    from,
    to,
    comparisonMode,
    hideDeveloperName,
  } = params;
  const developer = hideDeveloperName ? maskedDeveloperLabel(column) : data.login;

  if (comparisonMode === 'date') {
    return `${column === 'left' ? 'Range A' : 'Range B'} | ${developer} | ${rangeSummary(from, to)}`;
  }

  return `${developer} | ${rangeSummary(from, to)}`;
}

export default function ContributionsPage(): JSX.Element {
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>('developer');
  const [leftColumn, setLeftColumn] = useState<ComparisonColumnState>({
    login: '',
    from: defaultFrom,
    to: defaultTo,
  });
  const [rightColumn, setRightColumn] = useState<ComparisonColumnState>({
    login: '',
    from: defaultFrom,
    to: defaultTo,
  });
  const [repo, setRepo] = useState('');
  const [dateMode, setDateMode] = useState<'created' | 'merged'>('merged');
  const [mergedOnly, setMergedOnly] = useState(true);
  const [gapMode, setGapMode] = useState<ContributionGapMode>('weekdays');
  const [maskedColumn, setMaskedColumn] = useState<ColumnKey | null>(null);

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
        if (!leftColumn.login && json.github.length > 0) {
          setLeftColumn((current) => ({ ...current, login: json.github[0].login }));
        }
        if (!rightColumn.login && json.github.length > 1) {
          setRightColumn((current) => ({ ...current, login: json.github[1].login }));
        }
      } catch {
        // Ignore selector bootstrap failures and keep manual entry fallback.
      } finally {
        setLoadingUsers(false);
      }
    })();
    // Intentionally run once and only set defaults when the fields are empty.
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

  const effectiveRightColumn = useMemo<ComparisonColumnState>(() => ({
    login: comparisonMode === 'date' ? leftColumn.login : rightColumn.login,
    from: comparisonMode === 'developer' ? leftColumn.from : rightColumn.from,
    to: comparisonMode === 'developer' ? leftColumn.to : rightColumn.to,
  }), [comparisonMode, leftColumn, rightColumn]);

  const hideSharedDeveloperIdentity = comparisonMode === 'date' && maskedColumn !== null;
  const leftMaskIdentity = maskedColumn === 'left';
  const rightMaskIdentity = maskedColumn === 'right';
  const leftHideDeveloperName = hideSharedDeveloperIdentity || leftMaskIdentity;
  const rightHideDeveloperName = hideSharedDeveloperIdentity || rightMaskIdentity;

  async function fetchContribution(selection: ComparisonColumnState): Promise<ContributionResponse> {
    const url = new URL('/api/contributions', window.location.origin);
    url.searchParams.set('login', selection.login);
    url.searchParams.set('from', selection.from);
    url.searchParams.set('to', selection.to);
    url.searchParams.set('dateMode', dateMode);
    url.searchParams.set('mergedOnly', String(mergedOnly));
    if (repo.trim()) url.searchParams.set('repo', repo.trim());

    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json();
  }

  function validateSelection(selection: ComparisonColumnState, label: string): string | null {
    if (!selection.login) return `${label}: select a GitHub user.`;
    if (!selection.from || !selection.to) return `${label}: choose both start and end dates.`;
    if (selection.from > selection.to) return `${label}: the start date must be on or before the end date.`;
    return null;
  }

  async function run(): Promise<void> {
    const primarySelection = leftColumn;
    const secondarySelection = effectiveRightColumn;

    const validationError = [
      validateSelection(primarySelection, 'Left side'),
      validateSelection(secondarySelection, 'Right side'),
    ].find(Boolean);

    if (validationError) {
      setError(validationError ?? 'Invalid comparison inputs.');
      return;
    }

    if (comparisonMode === 'developer' && primarySelection.login === secondarySelection.login) {
      setError('Developer comparison requires two different GitHub users.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const [primary, secondary] = await Promise.all([
        fetchContribution(primarySelection),
        fetchContribution(secondarySelection),
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
    () => Array.from(new Set([
      ...(users?.warnings ?? []),
      ...(primaryData?.warnings ?? []),
      ...(secondaryData?.warnings ?? []),
    ])),
    [primaryData, secondaryData, users],
  );

  const primarySignalLabel = comparisonMode === 'date'
    ? 'Range A'
    : (leftHideDeveloperName ? maskedDeveloperLabel('left') : (primaryData?.login ?? 'Left side'));
  const secondarySignalLabel = comparisonMode === 'date'
    ? 'Range B'
    : (rightHideDeveloperName ? maskedDeveloperLabel('right') : (secondaryData?.login ?? 'Right side'));

  function renderDeveloperSelect(params: {
    column: ColumnKey;
    effectiveValue: string;
    rawValue: string;
    disabled: boolean;
    onChange: (value: string) => void;
    hidden: boolean;
    helperText?: string;
  }): JSX.Element {
    const {
      effectiveValue,
      rawValue,
      disabled,
      onChange,
      hidden,
      helperText,
    } = params;

    return (
      <div>
        <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>GitHub user</label>
        {ghOptions.length > 0 ? (
          <SearchableSelect
            items={ghOptions}
            value={effectiveValue}
            onChange={onChange}
            placeholder="Search GitHub users..."
            disabled={loadingUsers || disabled}
            displayValueOverride={hidden && effectiveValue ? 'Selected developer hidden' : undefined}
          />
        ) : (
          <input
            value={disabled ? effectiveValue : rawValue}
            onChange={(event) => onChange(event.target.value)}
            style={{
              ...inputStyle,
              fontStyle: hidden && effectiveValue ? 'italic' : 'normal',
            }}
            placeholder="octocat"
            disabled={disabled}
          />
        )}
        {helperText ? (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--panel-muted)' }}>{helperText}</div>
        ) : null}
      </div>
    );
  }

  function renderDateRangeInputs(params: {
    effectiveFrom: string;
    effectiveTo: string;
    rawFrom: string;
    rawTo: string;
    disabled: boolean;
    onFromChange: (value: string) => void;
    onToChange: (value: string) => void;
    helperText?: string;
  }): JSX.Element {
    const {
      effectiveFrom,
      effectiveTo,
      rawFrom,
      rawTo,
      disabled,
      onFromChange,
      onToChange,
      helperText,
    } = params;

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>From</label>
            <input
              type="date"
              value={disabled ? effectiveFrom : rawFrom}
              onChange={(event) => onFromChange(event.target.value)}
              style={inputStyle}
              disabled={disabled}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>To</label>
            <input
              type="date"
              value={disabled ? effectiveTo : rawTo}
              onChange={(event) => onToChange(event.target.value)}
              style={inputStyle}
              disabled={disabled}
            />
          </div>
        </div>
        {helperText ? (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--panel-muted)' }}>{helperText}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1480, margin: '0 auto', padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Individual Contribution Dashboard</h1>
        <p style={{ marginTop: 6, color: 'var(--panel-muted)' }}>
          Focuses only on PRs that land in <code>dev</code>, so QA and production promotion PRs do not inflate the numbers.
        </p>
      </header>

      <div style={{ ...panelStyle, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>What This Represents</h2>
        <div style={{ display: 'grid', gap: 6, marginTop: 8, fontSize: 14 }}>
          <div>- This view treats the first PR into <code>dev</code> as the engineer&apos;s real code contribution.</div>
          <div>- <code>Touched Ticket SP</code> sums unique Jira story points for tickets with a dev PR opened or a commit made during the selected window, using Jira dev-status links where available and rolling subtasks up to parent ticket points.</div>
          <div>- Long flat activity stretches often point to blockers or low delivery cadence.</div>
          <div>- Large one-day spikes usually mean work is batching up instead of landing steadily.</div>
          <div>- Low active-day rate plus low PR volume is the quickest signal that output may be thin.</div>
        </div>
      </div>

      <div style={{ ...panelStyle, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>
              Comparison Mode
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
              {comparisonMode === 'developer' ? 'Developer comparison' : 'Date comparison'}
            </h2>
          </div>
          <div
            style={{
              display: 'inline-grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 6,
              padding: 6,
              borderRadius: 999,
              background: 'linear-gradient(135deg, rgba(96,165,250,0.16), rgba(245,158,11,0.16))',
              border: '1px solid rgba(148,163,184,0.24)',
            }}
          >
            {([
              { value: 'developer', label: 'Developer Comparison' },
              { value: 'date', label: 'Date Comparison' },
            ] as const).map((mode) => {
              const active = comparisonMode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setComparisonMode(mode.value)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 999,
                    border: active ? '1px solid rgba(255,255,255,0.18)' : '1px solid transparent',
                    background: active ? 'linear-gradient(135deg, #0f172a, #1d4ed8)' : 'transparent',
                    color: active ? '#fff' : 'var(--panel-fg)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: active ? '0 10px 24px rgba(15,23,42,0.28)' : 'none',
                  }}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--panel-muted)' }}>
          {comparisonMode === 'developer'
            ? 'Both columns share the same date range so you can compare two developers over one window.'
            : 'Both columns share the same developer so you can compare one developer across two different date ranges.'}
        </p>
      </div>

      <div style={{ ...panelStyle, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
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
            <button
              onClick={run}
              disabled={loading || loadingUsers}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: 0,
                background: 'linear-gradient(135deg, #0f172a, #2563eb)',
                color: '#fff',
                fontWeight: 700,
                opacity: (loading || loadingUsers) ? 0.6 : 1,
                cursor: (loading || loadingUsers) ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Loading...' : 'Fetch comparison'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>
                Left Column
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{columnLabel('left')}</h3>
            </div>
            <div style={{ padding: '6px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.14)', color: '#bfdbfe', fontSize: 12, fontWeight: 700 }}>
              {rangeSummary(leftColumn.from, leftColumn.to)}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {renderDeveloperSelect({
              column: 'left',
              effectiveValue: leftColumn.login,
              rawValue: leftColumn.login,
              disabled: false,
              onChange: (value) => setLeftColumn((current) => ({ ...current, login: value })),
              hidden: leftHideDeveloperName,
            })}
            {renderDateRangeInputs({
              effectiveFrom: leftColumn.from,
              effectiveTo: leftColumn.to,
              rawFrom: leftColumn.from,
              rawTo: leftColumn.to,
              disabled: false,
              onFromChange: (value) => setLeftColumn((current) => ({ ...current, from: value })),
              onToChange: (value) => setLeftColumn((current) => ({ ...current, to: value })),
            })}
          </div>
        </div>

        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>
                Right Column
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{columnLabel('right')}</h3>
            </div>
            <div style={{ padding: '6px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.14)', color: '#fde68a', fontSize: 12, fontWeight: 700 }}>
              {rangeSummary(effectiveRightColumn.from, effectiveRightColumn.to)}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {renderDeveloperSelect({
              column: 'right',
              effectiveValue: effectiveRightColumn.login,
              rawValue: rightColumn.login,
              disabled: comparisonMode === 'date',
              onChange: (value) => setRightColumn((current) => ({ ...current, login: value })),
              hidden: rightHideDeveloperName,
              helperText: comparisonMode === 'date'
                ? 'Locked to the left side so both columns compare the same developer.'
                : undefined,
            })}
            {renderDateRangeInputs({
              effectiveFrom: effectiveRightColumn.from,
              effectiveTo: effectiveRightColumn.to,
              rawFrom: rightColumn.from,
              rawTo: rightColumn.to,
              disabled: comparisonMode === 'developer',
              onFromChange: (value) => setRightColumn((current) => ({ ...current, from: value })),
              onToChange: (value) => setRightColumn((current) => ({ ...current, to: value })),
              helperText: comparisonMode === 'developer'
                ? 'Locked to the left side so both columns compare the same date range.'
                : undefined,
            })}
          </div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
            {(['left', 'right'] as const).map((column) => {
              const active = maskedColumn === column;
              return (
                <div key={column} style={{ ...panelStyle, padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--panel-muted)' }}>
                        {column === 'left' ? 'Left column' : 'Right column'}
                      </div>
                      <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 6 }}>Identity Visibility</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMaskedColumn((current) => current === column ? null : column)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 999,
                        border: active ? '1px solid rgba(15,23,42,0.45)' : '1px solid rgba(148,163,184,0.22)',
                        background: active
                          ? 'linear-gradient(135deg, #111827, #334155)'
                          : 'rgba(148,163,184,0.10)',
                        color: active ? '#fff' : 'var(--panel-fg)',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {active ? 'Masked' : 'Visible'}
                    </button>
                  </div>
                  <p style={{ marginTop: 10, fontSize: 13, color: 'var(--panel-muted)' }}>
                    Hide the developer name plus PR, ticket, and repo identifiers on this side. Only one column can be masked at a time.
                  </p>
                  {comparisonMode === 'date' && maskedColumn !== null ? (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#bfdbfe' }}>
                      Developer selectors on both sides are obfuscated because date comparison uses the same developer in each column.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div style={{ marginBottom: 16 }}>
            <ContributionSignalsChart
              title={comparisonMode === 'developer' ? 'Head-to-Head Developer Signals' : 'Date-Range Contribution Signals'}
              subtitle={comparisonMode === 'developer'
                ? 'Higher is usually better except for issue cycle hours and idle gap days. When those two climb while active-day rate is low, output is usually thin or blocked.'
                : `Comparing ${rangeSummary(primaryData.from, primaryData.to)} against ${rangeSummary(secondaryData.from, secondaryData.to)} for the same developer.`}
              primaryLabel={primarySignalLabel}
              secondaryLabel={secondarySignalLabel}
              items={comparisonSignals}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
            <ContributionProfile
              data={primaryData}
              title={buildProfileTitle({
                column: 'left',
                data: primaryData,
                from: primaryData.from,
                to: primaryData.to,
                comparisonMode,
                hideDeveloperName: leftHideDeveloperName,
              })}
              gapMode={gapMode}
              maskIdentity={leftMaskIdentity}
            />
            <ContributionProfile
              data={secondaryData}
              title={buildProfileTitle({
                column: 'right',
                data: secondaryData,
                from: secondaryData.from,
                to: secondaryData.to,
                comparisonMode,
                hideDeveloperName: rightHideDeveloperName,
              })}
              gapMode={gapMode}
              maskIdentity={rightMaskIdentity}
            />
          </div>
        </>
      )}
    </div>
  );
}
