'use client';

import * as React from 'react';
import type { PRLifecycle, LifecycleStats, JiraIssue } from '../../lib/types';
import { JSX } from 'react';

function Hrs({ v }: { v?: number | null }): JSX.Element {
  if (v === null || v === undefined) return <span>—</span>;
  if (v >= 48) return <span>{(v / 24).toFixed(1)}d</span>;
  return <span>{v.toFixed(1)}h</span>;
}


function Num({ v }: { v?: number | null }): JSX.Element {
  if (v === null || v === undefined) return <span>0</span>;
  const n = Number.isFinite(v) ? (v as number) : 0;
  return <span>{n.toLocaleString()}</span>;
}


function DateTwoLine({ iso }: { iso?: string | null }): JSX.Element {
  if (!iso) return <span>—</span>;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return <span>—</span>;

  const date = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);

  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(d);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, textAlign: 'right', whiteSpace: 'nowrap' }}>
      <span>{date}</span>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>{time}</span>
    </div>
  );
}

export function PRLifecycleView({
  items,
  stats,
  tickets = [],
  onFilteredTotalsChange,
}: {
  items: PRLifecycle[];
  stats: LifecycleStats;
  tickets?: JiraIssue[];
  // Callback to bubble up filtered additions/deletions totals based on user selection
  onFilteredTotalsChange?: (totals: { additions: number; deletions: number }) => void;
}): JSX.Element {

  // Lookup maps for Jira fields and parent resolution
  const jiraMaps = React.useMemo(() => {
    const storyPoints = new Map<string, number | null | undefined>();
    const status = new Map<string, string | undefined>();
    const byKey = new Map<string, JiraIssue>();
    for (const t of tickets) {
      storyPoints.set(t.key, t.storyPoints);
      status.set(t.key, t.status);
      byKey.set(t.key, t);
    }
    const getParent = (key?: string): { key: string; summary?: string; url?: string } | undefined => {
      if (!key) return undefined;
      const child = byKey.get(key);
      const parentKey = child?.parentKey || child?.epicKey;
      if (!parentKey) return undefined;
      const parentSummary = byKey.get(parentKey)?.summary;
      let url: string | undefined;
      if (child?.url && child.url.includes('/browse/')) url = child.url.replace(key, parentKey);
      return { key: parentKey, summary: parentSummary, url };
    };
    return { storyPoints, status, getParent };
  }, [tickets]);

  const thBase: React.CSSProperties = {
    padding: '10px 12px',
    borderRight: '1px solid var(--panel-br)',
    background: 'var(--panel-bg)',
    color: 'var(--panel-fg)',
    position: 'sticky',
    top: 0,
    zIndex: 1,
  };
  const thLeft: React.CSSProperties = { ...thBase, textAlign: 'left' };
  const thRight: React.CSSProperties = { ...thBase, textAlign: 'right' };

  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderRight: '1px solid var(--panel-br)',
    verticalAlign: 'top',
  };

  // Sorting state for primary PR table and secondary ticket-only table
  const [sortMain, setSortMain] = React.useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'PR Created', dir: 'desc' });
  const [sortTickets, setSortTickets] = React.useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'Work Started', dir: 'desc' });

  const toggleSort = (setter: React.Dispatch<React.SetStateAction<{ col: string; dir: 'asc' | 'desc' }>>, current: { col: string; dir: 'asc' | 'desc' }, col: string) => {
    setter(current.col === col ? { col, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };

  function cmpNumber(a: number | null | undefined, b: number | null | undefined): number {
    const av = Number.isFinite(a as number) ? (a as number) : -Infinity;
    const bv = Number.isFinite(b as number) ? (b as number) : -Infinity;
    return av - bv;
  }
  function cmpString(a?: string | null, b?: string | null): number {
    return (a ?? '').localeCompare(b ?? '');
  }
  function cmpDate(a?: string | null, b?: string | null): number {
    const av = a ? new Date(a).getTime() : 0;
    const bv = b ? new Date(b).getTime() : 0;
    return av - bv;
  }
  const dirMult = (dir: 'asc' | 'desc') => (dir === 'asc' ? 1 : -1);

  // Weekend-aware working time since start (In Progress tickets only)
  function workingDurationHours(fromIso?: string | null): number | null {
    if (!fromIso) return null;
    const start = new Date(fromIso);
    const end = new Date();
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
    // Count weekend days
    let weekendDays = 0;
    const cursor = new Date(start.getTime());
    while (cursor <= end) {
      const day = cursor.getDay();
      if (day === 0 || day === 6) weekendDays += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    const msTotal = end.getTime() - start.getTime();
    const msWeekend = weekendDays * 24 * 3600 * 1000;
    return Math.max(0, (msTotal - msWeekend) / 36e5);
  }
  function formatWorking(fromIso?: string | null, status?: string): JSX.Element {
    if (!fromIso || status !== 'In Progress') return <span>—</span>;
    const hrs = workingDurationHours(fromIso);
    if (hrs === null) return <span>—</span>;
    if (hrs >= 48) return <span>{(hrs / 24).toFixed(1)}d</span>;
    return <span>{hrs.toFixed(1)}h</span>;
  }

  const sortedItems = React.useMemo(() => {
    const list = [...items];
    list.sort((a, b) => {
      switch (sortMain.col) {
        case 'Jira Ticket': return cmpString(a.jiraKey, b.jiraKey) * dirMult(sortMain.dir);
        case 'Parent': {
          const pa = jiraMaps.getParent(a.jiraKey)?.key;
          const pb = jiraMaps.getParent(b.jiraKey)?.key;
          return cmpString(pa, pb) * dirMult(sortMain.dir);
        }
        case 'PR': return (a.number - b.number) * dirMult(sortMain.dir);
        case 'LOC Changed': return cmpNumber((a.additions ?? 0) + (a.deletions ?? 0), (b.additions ?? 0) + (b.deletions ?? 0)) * dirMult(sortMain.dir);
        case 'Story Points': return cmpNumber(jiraMaps.storyPoints.get(a.jiraKey ?? '') ?? 0, jiraMaps.storyPoints.get(b.jiraKey ?? '') ?? 0) * dirMult(sortMain.dir);
        case 'Work Started': return cmpDate(a.workStartedAt, b.workStartedAt) * dirMult(sortMain.dir);
        case 'PR Created': return cmpDate(a.createdAt, b.createdAt) * dirMult(sortMain.dir);
        case 'PR Merged': return cmpDate(a.mergedAt, b.mergedAt) * dirMult(sortMain.dir);
        case 'Status': return cmpString(jiraMaps.status.get(a.jiraKey ?? ''), jiraMaps.status.get(b.jiraKey ?? '')) * dirMult(sortMain.dir);
        default: return 0;
      }
    });
    return list;
  }, [items, sortMain, jiraMaps]);

  // Selection state (all selected by default)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set(items.map(i => i.id)));

  // Keep selection in sync if items array changes (e.g., refetch)
  React.useEffect(() => {
    setSelectedIds(new Set(items.map(i => i.id)));
  }, [items]);

  const toggleSelected = React.useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Filtered list for totals (LOC changed & story points)
  const filteredItems = React.useMemo(() => items.filter(i => selectedIds.has(i.id)), [items, selectedIds]);

  // Totals for main table (PRs) considering selection
  const totalLocChanged = React.useMemo(() => filteredItems.reduce((a, i) => a + (i.additions ?? 0) + (i.deletions ?? 0), 0), [filteredItems]);
  const totalStoryPointsMain = React.useMemo(() => filteredItems.reduce((a, i) => a + (jiraMaps.storyPoints.get(i.jiraKey ?? '') ?? 0), 0), [filteredItems, jiraMaps]);

  // Bubble up additions/deletions for KPI overrides
  const filteredAdditions = React.useMemo(() => filteredItems.reduce((a, i) => a + (i.additions ?? 0), 0), [filteredItems]);
  const filteredDeletions = React.useMemo(() => filteredItems.reduce((a, i) => a + (i.deletions ?? 0), 0), [filteredItems]);
  React.useEffect(() => {
    onFilteredTotalsChange?.({ additions: filteredAdditions, deletions: filteredDeletions });
  }, [filteredAdditions, filteredDeletions, onFilteredTotalsChange]);

  const ticketOnly = React.useMemo(() => tickets.filter(t => !(t.linkedPRs ?? []).length && !!t.updatedBySelectedUserInWindow), [tickets]);
  const sortedTicketOnly = React.useMemo(() => {
    const list = [...ticketOnly];
    list.sort((a, b) => {
      switch (sortTickets.col) {
        case 'Jira Ticket': return cmpString(a.key, b.key) * dirMult(sortTickets.dir);
        case 'Story Points': return cmpNumber(a.storyPoints ?? 0, b.storyPoints ?? 0) * dirMult(sortTickets.dir);
        case 'Work Started': return cmpDate(a.inProgressAt, b.inProgressAt) * dirMult(sortTickets.dir);
        case 'Time Since Work Started': return cmpNumber(workingDurationHours(a.inProgressAt), workingDurationHours(b.inProgressAt)) * dirMult(sortTickets.dir);
        case 'Status': return cmpString(a.status, b.status) * dirMult(sortTickets.dir);
        default: return 0;
      }
    });
    return list;
  }, [ticketOnly, sortTickets]);

  // Totals for ticket-only table
  const totalStoryPointsTickets = React.useMemo(() => ticketOnly.reduce((a, t) => a + (t.storyPoints ?? 0), 0), [ticketOnly]);

  const SortIndicator = ({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) => active ? <span style={{ marginLeft: 4 }}>{dir === 'asc' ? '▲' : '▼'}</span> : null;

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', borderRadius: 12, padding: 16, border: '1px solid var(--panel-br)', boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
      <h2 style={{ fontWeight: 600, marginBottom: 12 }}>PR Lifecycle</h2>

      {}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
        <Kpi label="Median Time to Ready" value={<Hrs v={stats.medianTimeToReadyHours} />} />
        <Kpi label="Median Time to First Review" value={<Hrs v={stats.medianTimeToFirstReviewHours} />} />
        <Kpi label="Median Review → Merge" value={<Hrs v={stats.medianReviewToMergeHours} />} />
        <Kpi label="Median Cycle Time" value={<Hrs v={stats.medianCycleTimeHours} />} />
        <Kpi label="Median In Progress → Created" value={<Hrs v={stats.medianInProgressToCreatedHours} />} />
      </div>

      {}
      <div style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--panel-br)' }}>
              <th style={{ ...thLeft }}></th>
              <th style={{ ...thLeft, cursor: 'pointer' }} onClick={() => toggleSort(setSortMain, sortMain, 'Jira Ticket')}>Jira Ticket<SortIndicator active={sortMain.col==='Jira Ticket'} dir={sortMain.dir} /></th>
              <th style={{ ...thLeft, cursor: 'pointer' }} onClick={() => toggleSort(setSortMain, sortMain, 'Parent')}>Parent<SortIndicator active={sortMain.col==='Parent'} dir={sortMain.dir} /></th>
              <th style={{ ...thLeft, cursor: 'pointer' }} onClick={() => toggleSort(setSortMain, sortMain, 'PR')}>PR<SortIndicator active={sortMain.col==='PR'} dir={sortMain.dir} /></th>
              <th style={{ ...thRight, cursor: 'pointer' }} onClick={() => toggleSort(setSortMain, sortMain, 'LOC Changed')}>LOC Changed<SortIndicator active={sortMain.col==='LOC Changed'} dir={sortMain.dir} /></th>
              <th style={{ ...thRight, cursor: 'pointer' }} onClick={() => toggleSort(setSortMain, sortMain, 'Story Points')}>Story Points<SortIndicator active={sortMain.col==='Story Points'} dir={sortMain.dir} /></th>
              <th style={{ ...thRight, cursor: 'pointer' }} onClick={() => toggleSort(setSortMain, sortMain, 'Work Started')}>Work Started<SortIndicator active={sortMain.col==='Work Started'} dir={sortMain.dir} /></th>
              <th style={{ ...thRight, cursor: 'pointer' }} onClick={() => toggleSort(setSortMain, sortMain, 'PR Created')}>PR Created<SortIndicator active={sortMain.col==='PR Created'} dir={sortMain.dir} /></th>
              <th style={{ ...thRight, cursor: 'pointer' }} onClick={() => toggleSort(setSortMain, sortMain, 'PR Merged')}>PR Merged<SortIndicator active={sortMain.col==='PR Merged'} dir={sortMain.dir} /></th>
              <th style={{ ...thLeft, cursor: 'pointer', borderRight: 'none' }} onClick={() => toggleSort(setSortMain, sortMain, 'Status')}>Status<SortIndicator active={sortMain.col==='Status'} dir={sortMain.dir} /></th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map(i => (
              <tr key={i.id} style={{ borderBottom: '1px solid var(--panel-br)' }}>
                <td style={tdStyle}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(i.id)}
                    onChange={() => toggleSelected(i.id)}
                    aria-label={`Include PR #${i.number}`}
                  />
                </td>
                <td style={tdStyle}>
                  {i.jiraUrl ? (
                    <a
                      href={i.jiraUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={i.jiraSummary ? `${i.jiraKey} — ${i.jiraSummary}` : i.jiraKey || ''}
                      style={{
                        display: 'inline-block',
                        maxWidth: 280,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        verticalAlign: 'top'
                      }}
                    >
                      {i.jiraKey} {i.jiraSummary ? `— ${i.jiraSummary}` : ''}
                    </a>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td style={tdStyle}>
                  {(() => {
                    const p = jiraMaps.getParent(i.jiraKey);
                    if (!p) return <span>—</span>;
                    return p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer">{p.key}{p.summary ? ` — ${p.summary}` : ''}</a>
                    ) : (
                      <span>{p.key}{p.summary ? ` — ${p.summary}` : ''}</span>
                    );
                  })()}
                </td>
                <td style={tdStyle}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <a
                      href={i.url}
                      target="_blank"
                      rel="noreferrer"
                      title={`#${i.number} ${i.title}`}
                      style={{
                        fontWeight: 500,
                        display: 'inline-block',
                        maxWidth: 280,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      #{i.number} {i.title}
                    </a>
                    {i.headRefName && (
                      <span style={{ fontSize: 11, color: 'var(--panel-muted)', fontFamily: 'monospace' }}>{i.headRefName}</span>
                    )}
                  </div>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <Num v={(i.additions ?? 0) + (i.deletions ?? 0)} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  {i.jiraKey && jiraMaps.storyPoints.has(i.jiraKey) ? (
                    <Num v={jiraMaps.storyPoints.get(i.jiraKey) ?? 0} />
                  ) : (
                    <span>—</span>
                  )}
                </td>

                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <DateTwoLine iso={i.workStartedAt ?? null} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <DateTwoLine iso={i.createdAt} />
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <DateTwoLine iso={i.mergedAt ?? null} />
                </td>

                <td style={{ ...tdStyle, borderRight: 'none' }}>
                  {i.jiraKey && jiraMaps.status.has(i.jiraKey) ? (
                    <span style={{ padding: '2px 8px', background: 'var(--card-bg)', color: 'var(--card-fg)', border: '1px solid var(--card-br)', borderRadius: 999, fontSize: 12 }}>
                      {jiraMaps.status.get(i.jiraKey)}
                    </span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
              </tr>
            ))}
            {/* Total row (not part of sorting) */}
            <tr style={{ background: 'var(--panel-bg-alt, #1e293b)' }}>
              <td style={tdStyle}><strong>Total</strong></td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>—</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}><strong><Num v={totalLocChanged} /></strong></td>
              <td style={{ ...tdStyle, textAlign: 'right' }}><strong><Num v={totalStoryPointsMain} /></strong></td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>—</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>—</td>
              <td style={{ ...tdStyle, textAlign: 'right' }}>—</td>
              <td style={{ ...tdStyle, borderRight: 'none' }}>—</td>
            </tr>
          </tbody>
        </table>
      </div>
      {sortedTicketOnly.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>JIRA Tickets with No PRs yet (but Updated by the author during the window)</h3>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', fontSize: 14, borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--panel-br)' }}>
                  <th style={{ ...thLeft, cursor: 'pointer' }} onClick={() => toggleSort(setSortTickets, sortTickets, 'Jira Ticket')}>Jira Ticket<SortIndicator active={sortTickets.col==='Jira Ticket'} dir={sortTickets.dir} /></th>
                  <th style={{ ...thRight, cursor: 'pointer' }} onClick={() => toggleSort(setSortTickets, sortTickets, 'Story Points')}>Story Points<SortIndicator active={sortTickets.col==='Story Points'} dir={sortTickets.dir} /></th>
                  <th style={{ ...thRight, cursor: 'pointer' }} onClick={() => toggleSort(setSortTickets, sortTickets, 'Work Started')}>Work Started<SortIndicator active={sortTickets.col==='Work Started'} dir={sortTickets.dir} /></th>
                  <th style={{ ...thRight, cursor: 'pointer' }} onClick={() => toggleSort(setSortTickets, sortTickets, 'Time Since Work Started')}>Time Since Work Started<SortIndicator active={sortTickets.col==='Time Since Work Started'} dir={sortTickets.dir} /></th>
                  <th style={{ ...thLeft, cursor: 'pointer' }} onClick={() => toggleSort(setSortTickets, sortTickets, 'Status')}>Status<SortIndicator active={sortTickets.col==='Status'} dir={sortTickets.dir} /></th>
                </tr>
              </thead>
              <tbody>
                {sortedTicketOnly.map(t => {
                  const parentKey = t.parentKey || t.epicKey;
                  const parentUrl = (parentKey && t.url && t.url.includes('/browse/')) ? t.url.replace(t.key, parentKey) : undefined;
                  return (
                    <tr key={`ticket-only:${t.key}`} style={{ borderBottom: '1px solid var(--panel-br)' }}>
                      <td style={tdStyle}>
                        <a href={t.url} target="_blank" rel="noreferrer">{t.key} — {t.summary}</a>
                        {parentKey && (
                          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                            Parent: {parentUrl ? <a href={parentUrl} target="_blank" rel="noreferrer">{parentKey}</a> : parentKey}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{t.storyPoints ?? '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}><DateTwoLine iso={t.inProgressAt ?? null} /></td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{formatWorking(t.inProgressAt ?? null, t.status)}</td>
                      <td style={tdStyle}>
                        <span style={{ padding: '2px 8px', background: 'var(--card-bg)', color: 'var(--card-fg)', border: '1px solid var(--card-br)', borderRadius: 999, fontSize: 12 }}>
                          {t.status ?? '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {/* Total row for ticket-only table */}
                <tr style={{ background: 'var(--panel-bg-alt, #1e293b)' }}>
                  <td style={tdStyle}><strong>Total</strong></td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}><strong><Num v={totalStoryPointsTickets} /></strong></td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>—</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>—</td>
                  <td style={tdStyle}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div style={{ background: 'var(--kpi-bg)', borderRadius: 12, padding: 12, border: '1px solid var(--kpi-br)' }}>
      <div style={{ fontSize: 12, color: 'var(--panel-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--kpi-fg)' }}>{value}</div>
    </div>
  );
}
