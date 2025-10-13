'use client';

import type React from 'react';
import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import type {
  JiraSprintLite,
  SprintStatsResponse,
  CompletedByAssignee,
  JiraIssue,
} from '../../lib/types';
import { SearchableSelect, type Option } from '../components/SearchableSelect';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';

const COMPACT_SWITCH_PX = 480;

/* ===================== Palette / helpers ===================== */
const palette = {
  // stages
  todo:    '#94a3b8',
  progress:'#3b82f6',
  review:  '#8b5cf6',
  done:    '#22c55e',
  blocked: '#f59e0b',

  // type chips
  story: '#6366f1',
  bug:   '#ef4444',
  task:  '#0ea5e9',
  spike: '#14b8a6',

  // shells
  cardBg:  '#0f172a',
  cardFg:  '#e5e7eb',
  cardBr:  '#1f2937',
  faint:   '#cbd5e1',
};

const TODO_STATUS_NAMES       = ['To Do', 'Open', 'Backlog', 'Selected for Development'];
const INPROGRESS_STATUS_NAMES = ['In Progress', 'In Development', 'In-Progress', 'Doing', 'Selected for Development'];
const DEV_STATUS_NAMES        = ['Reviewed', 'Review', 'In Review'];
const COMPLETE_STATUS_NAMES   = ['Approved', 'Done'];
const BLOCKED_STATUS_NAMES    = ['Blocked', 'On Hold', 'Impeded', 'Awaiting', 'Hold'];

function normalize(s?: string): string { return (s ?? '').trim().toLowerCase(); }

function statusGroup(status?: string):
  'todo'|'progress'|'review'|'done'|'blocked'|'other' {
  const x = normalize(status);
  if (TODO_STATUS_NAMES.map(normalize).includes(x)) return 'todo';
  if (INPROGRESS_STATUS_NAMES.map(normalize).includes(x)) return 'progress';
  if (DEV_STATUS_NAMES.map(normalize).includes(x)) return 'review';
  if (COMPLETE_STATUS_NAMES.map(normalize).includes(x)) return 'done';
  if (BLOCKED_STATUS_NAMES.map(normalize).includes(x)) return 'blocked';
  return 'other';
}

function typeColor(issueType?: string): { bg: string; fg: string; br: string } {
  const t = normalize(issueType);
  const pick = (hex: string) => ({
    bg: `rgba(${hexToRgb(hex)}, 0.18)`,
    fg: '#ffffff',
    br: `rgba(${hexToRgb(hex)}, 0.45)`,
  });
  if (t === 'bug')   return pick(palette.bug);
  if (t === 'task')  return pick(palette.task);
  if (t === 'spike') return pick(palette.spike);
  return pick(palette.story);
}

function statusColor(status?: string): { bg: string; fg: string; br: string } {
  const g = statusGroup(status);
  const hex =
    g === 'todo'    ? palette.todo :
    g === 'progress'? palette.progress :
    g === 'review'  ? palette.review :
    g === 'done'    ? palette.done :
    g === 'blocked' ? palette.blocked :
                      '#64748b';
  return {
    bg: `rgba(${hexToRgb(hex)}, 0.18)`,
    fg: '#ffffff',
    br: `rgba(${hexToRgb(hex)}, 0.45)`,
  };
}

function hexToRgb(hex: string): string {
  const m = hex.replace('#','');
  const bigint = parseInt(m, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >>  8) & 255;
  const b =  bigint        & 255;
  return `${r}, ${g}, ${b}`;
}

/** Return date/time parts in Central Time for two-line display */
function centralParts(iso?: string): { date: string; timeTz: string } {
  if (!iso) return { date: '—', timeTz: '' };
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { date: '—', timeTz: '' };

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', // ✅ Central Time
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(d);

  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const yyyy = get('year');
  const mm   = get('month');
  const dd   = get('day');
  const hh   = get('hour');
  const mi   = get('minute');
  const tz   = get('timeZoneName') || 'CT';

  return { date: `${yyyy}-${mm}-${dd}`, timeTz: `${hh}:${mi} ${tz}` };
}

/* ===================== Small shared UI ===================== */
function Num({ v }: { v: number | undefined }): JSX.Element {
  const n = Number.isFinite(v) ? (v as number) : 0;
  return <span>{n.toLocaleString()}</span>;
}
function Hrs({ v }: { v?: number | null }): JSX.Element {
  if (v === null || v === undefined) return <span>—</span>;
  if (v >= 48) return <span>{(v / 24).toFixed(1)}d</span>;
  return <span>{v.toFixed(1)}h</span>;
}
function Pill({
  children,
  bg,
  br,
  fg = palette.cardFg,
}: { children: React.ReactNode; bg: string; br: string; fg?: string }) {
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        background: bg,
        color: fg,
        border: `1px solid ${br}`,
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </span>
  );
}

/* ===================== Main Page ===================== */
export default function SprintPage(): JSX.Element {
  // Controls
  const [boardId, setBoardId] = useState<string>('');
  const [sprints, setSprints] = useState<JiraSprintLite[]>([]);
  const [sprintId, setSprintId] = useState<string>('');
  const [loadingSprints, setLoadingSprints] = useState<boolean>(false);

  // Data
  const [data, setData] = useState<SprintStatsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // UI state: which assignees are expanded
  const [openAssignees, setOpenAssignees] = useState<Set<string>>(new Set());

  // ---- helpers ----
  const sprintOptions: Option[] = useMemo(() => {
    return sprints.map((s) => ({
      value: String(s.id),
      label: s.name ?? `Sprint ${s.id}`,
      subtitle: s.state ? s.state : undefined,
    }));
  }, [sprints]);

  async function loadSprints(selectedBoardId?: string): Promise<void> {
    const bid = selectedBoardId ?? boardId;
    if (!bid) return;
    setLoadingSprints(true);
    try {
      const resp = await fetch(`/api/sprints?boardId=${encodeURIComponent(bid)}`);
      if (!resp.ok) throw new Error(await resp.text());
      const json: { sprints: JiraSprintLite[]; warnings?: string[] } = await resp.json();

      setWarnings(json.warnings ?? []);

      // Order: latest → oldest
      const pickTime = (s: JiraSprintLite): number => {
        const end = s.endDate ? Date.parse(s.endDate) : Number.NaN;
        const start = s.startDate ? Date.parse(s.startDate) : Number.NaN;
        if (Number.isFinite(end)) return end;
        if (Number.isFinite(start)) return start;
        return -Infinity;
      };
      const ordered = [...(json.sprints ?? [])].sort((a, b) => pickTime(b) - pickTime(a));
      setSprints(ordered);

      if (!sprintId) {
        const active = ordered.find((s) => (s.state ?? '').toLowerCase() === 'active');
        if (active) setSprintId(String(active.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sprints');
      setSprints([]);
    } finally {
      setLoadingSprints(false);
    }
  }

  async function fetchStats(): Promise<void> {
    if (!sprintId) {
      setError('Pick a sprint');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const resp = await fetch(`/api/sprint-stats?sprintId=${encodeURIComponent(sprintId)}`);
      if (!resp.ok) throw new Error(await resp.text());
      const json: SprintStatsResponse = await resp.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sprint stats');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Group issues by assignee
  const issuesByAssignee = useMemo(() => {
    const m = new Map<string, JiraIssue[]>();
    if (!data?.issues) return m;
    for (const it of data.issues) {
      const who = it.assignee && it.assignee.trim() ? it.assignee : 'Unassigned';
      if (!m.has(who)) m.set(who, []);
      m.get(who)!.push(it);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => {
        const aKey = a.reviewAt ?? a.completeAt ?? a.created ?? '';
        const bKey = b.reviewAt ?? b.completeAt ?? b.created ?? '';
        return aKey.localeCompare(bKey);
      });
      m.set(k, arr);
    }
    return m;
  }, [data]);

  // ---- UI bits ----
  const kpiCards = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Committed SP', value: data.kpis.committedSP },
      { label: 'Scope Added SP', value: data.kpis.scopeAddedSP },
      { label: 'Scope Removed SP', value: data.kpis.scopeRemovedSP },

      { label: 'Dev Completed SP', value: data.kpis.devCompletedSP },
      { label: 'Dev Remaining SP', value: data.kpis.devRemainingSP },
      { label: 'Dev Completion %', value: data.kpis.devCompletionPct },

      { label: 'Complete Completed SP', value: data.kpis.completeCompletedSP },
      { label: 'Complete Remaining SP', value: data.kpis.completeRemainingSP },
      { label: 'Complete %', value: data.kpis.completeCompletionPct },

      { label: 'Tickets in QA', value: data.ticketsInQA ?? 0 },
    ];
  }, [data]);

  useEffect(() => {
    if (boardId) void loadSprints(boardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  function toggleAssignee(name: string) {
    setOpenAssignees(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Sprint Dashboard</h1>
      </header>

      {/* Controls */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1.8fr 0.9fr',
          gap: 12,
          alignItems: 'end',
          marginBottom: 16,
        }}
      >
        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Jira Board ID</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              placeholder="e.g., 123"
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd', textAlign: 'right' }}
            />
            <button
              onClick={() => void loadSprints()}
              disabled={!boardId || loadingSprints}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: 0,
                background: '#111',
                color: '#fff',
                opacity: !boardId || loadingSprints ? 0.6 : 1,
              }}
            >
              {loadingSprints ? 'Loading…' : 'Load'}
            </button>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Sprint</label>
          <SearchableSelect
            items={sprintOptions}
            value={sprintId}
            onChange={setSprintId}
            style={{ backgroundColor: 'black' }}
            placeholder={loadingSprints ? 'Loading sprints…' : 'Search sprint…'}
            disabled={loadingSprints || sprintOptions.length === 0}
          />
        </div>

        <div>
          <button
            onClick={() => void fetchStats()}
            disabled={!sprintId || loading}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: 0,
              background: '#111',
              color: '#fff',
              opacity: !sprintId || loading ? 0.6 : 1,
            }}
          >
            {loading ? 'Loading…' : 'Fetch'}
          </button>
        </div>
      </div>

      {/* Warnings & errors */}
      {warnings.length > 0 && (
        <div style={{ padding: 12, background: '#fff7ed', color: '#7c2d12', borderRadius: 8, marginBottom: 16 }}>
          {warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      {error && (
        <div style={{ padding: 12, background: '#ffe4e6', color: '#7f1d1d', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* DATA */}
      {data && (
        <>
          {/* KPIs */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {kpiCards.map((k) => (
              <div
                key={k.label}
                style={{
                  background: palette.cardBg,
                  color: palette.cardFg,
                  borderRadius: 12,
                  padding: 12,
                  border: `1px solid ${palette.cardBr}`,
                }}
              >
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, textAlign: 'right' }}>
                  <Num v={k.value} />
                </div>
              </div>
            ))}
          </div>

          {/* Burn chart */}
          <div style={{ background: '#0b0b0b', borderRadius: 12, padding: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.08)', marginBottom: 16 }}>
            <h2 style={{ fontWeight: 600, marginBottom: 8, color: '#e5e7eb' }}>Sprint Burn</h2>
            <div style={{ width: '100%', height: 340 }}>
              <ResponsiveContainer>
                <LineChart data={data.burn} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#94a3b8" tickMargin={8} />
                  <YAxis stroke="#94a3b8" allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="devRemaining" name="Dev Remaining" stroke="#60a5fa" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="completeRemaining" name="Complete Remaining" stroke="#22c55e" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Completed by Assignee – cards with collapsible ticket timelines */}
          {data.completedByAssignee && data.completedByAssignee.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Completed by Assignee</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {data.completedByAssignee.map((row: CompletedByAssignee) => {
                  const name = row.assignee;
                  const items = issuesByAssignee.get(name) ?? [];
                  const isOpen = openAssignees.has(name);
                  return (
                    <div
                      key={name}
                      style={{
                        border: `1px solid ${palette.cardBr}`,
                        borderRadius: 12,
                        padding: 12,
                        background: palette.cardBg,
                        color: palette.cardFg,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontWeight: 700 }}>{name}</div>
                        <button
                          onClick={() => toggleAssignee(name)}
                          style={{
                            border: `1px solid ${palette.cardBr}`,
                            borderRadius: 8,
                            padding: '6px 10px',
                            background: '#111827',
                            color: palette.cardFg,
                            cursor: 'pointer'
                          }}
                        >
                          {isOpen ? `Hide tickets (${items.length})` : `Show tickets (${items.length})`}
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                        <div style={{ background: 'rgba(59,130,246,0.18)', borderRadius: 8, padding: 10, border: '1px solid rgba(59,130,246,0.45)' }}>
                          <div style={{ fontSize: 12, color: '#93c5fd', marginBottom: 2 }}>(Dev) Completed</div>
                          <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'right' }}>{row.devPoints}</div>
                        </div>
                        <div style={{ background: 'rgba(34,197,94,0.18)', borderRadius: 8, padding: 10, border: '1px solid rgba(34,197,94,0.45)' }}>
                          <div style={{ fontSize: 12, color: '#86efac', marginBottom: 2 }}>(Dev + QA) Completed</div>
                          <div style={{ fontSize: 20, fontWeight: 800, textAlign: 'right' }}>{row.completePoints}</div>
                        </div>
                      </div>

                      {/* Collapsible ticket timelines */}
                      {isOpen && (
                        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {items.map((it) => (
                            <TicketTimeline key={it.key} issue={it} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ===================== Ticket Timeline UI ===================== */
function Dot({ color, active }: { color: string; active: boolean }) {
  return (
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        background: active ? color : 'transparent',
        border: `2px solid ${color}`,
      }}
    />
  );
}
function Connector({ color, active }: { color: string; active: boolean }) {
  return (
    <div
      style={{
        height: 2,
        flex: 1,
        background: color,
        opacity: active ? 1 : 0.25,
      }}
    />
  );
}

function Step({
  label,
  date,
  color,
  active,
  compact = false,
}: {
  label: string;
  date?: string;
  color: string;
  active: boolean;
  compact?: boolean;
}) {
  const icon =
    label === 'To Do' ? '📋' :
    label === 'In Progress' ? '🔧' :
    label === 'Review' ? '👀' :
    label === 'Approved' ? '✅' : '•';

  const parts = centralParts(date);

  return (
    <div
      title={date ? `${label} — ${parts.date} ${parts.timeTz}` : label}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        minWidth: compact ? 44 : 96,
        flex: '0 1 auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Dot color={color} active={active} />
      </div>

      {compact ? (
        <>
          <div style={{ fontSize: 14, marginTop: 6, color, textAlign: 'center' }}>{icon}</div>
          <div style={{ fontSize: 10, color: palette.faint, textAlign: 'center', lineHeight: 1.15, marginTop: 2 }}>
            <div>{parts.date}</div>
            <div>{parts.timeTz}</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, marginTop: 6, color, textAlign: 'right' }}>{label}</div>
          <div style={{ fontSize: 11, color: palette.faint, textAlign: 'right', lineHeight: 1.15 }}>
            <div>{parts.date}</div>
            <div>{parts.timeTz}</div>
          </div>
        </>
      )}
    </div>
  );
}

function TicketTimeline({ issue }: { issue: JiraIssue }) {
  const hasProg   = !!issue.inProgressAt;
  const hasReview = !!issue.reviewAt;
  const hasDone   = !!issue.completeAt;

  const typeSty = typeColor(issue.issueType);
  const statSty = statusColor(issue.status);

  const todoAt = issue.todoAt ?? issue.created;
  const inProg = issue.inProgressAt;
  const revAt  = issue.reviewAt;
  const compAt = issue.completeAt;

  const rowRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setCompact(w < COMPACT_SWITCH_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      style={{
        border: `1px solid ${palette.cardBr}`,
        borderRadius: 10,
        padding: 10,
        background: '#0b1220',
        color: palette.cardFg,
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
          <a href={issue.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: '#bfdbfe' }}>
            {issue.key}
          </a>
          <Pill bg={typeSty.bg} br={typeSty.br}>{issue.issueType ?? 'Ticket'}</Pill>
          {typeof issue.storyPoints === 'number' && (
            <Pill bg="rgba(99,102,241,0.18)" br="rgba(99,102,241,0.4)">{issue.storyPoints} SP</Pill>
          )}
          {issue.status && <Pill bg={statSty.bg} br={statSty.br}>{issue.status}</Pill>}
        </div>
      </div>

      {/* timeline */}
      <div
        ref={rowRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingRight: 16,
          overflow: 'visible'
        }}
      >
        <Step label="To Do"       date={todoAt} color={palette.todo}     active={!!(todoAt)} compact={compact} />
        <Connector color={palette.progress} active={hasProg} />
        <Step label="In Progress" date={inProg} color={palette.progress} active={hasProg} compact={compact} />
        <Connector color={palette.review}   active={hasReview} />
        <Step label="Review"      date={revAt}  color={palette.review}   active={hasReview} compact={compact} />
        <Connector color={palette.done}     active={hasDone} />
        <Step label="Approved"    date={compAt} color={palette.done}     active={hasDone} compact={compact} />
      </div>

      {/* durations */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Pill bg="rgba(59,130,246,0.18)" br="rgba(59,130,246,0.45)">
          In Progress → Review:
          <span style={{ fontWeight: 700, marginLeft: 4 }}>
            <Hrs v={issue.inProgressToReviewHours} />
          </span>
        </Pill>
        <Pill bg="rgba(139,92,246,0.18)" br="rgba(139,92,246,0.45)">
          Review → Approved:
          <span style={{ fontWeight: 700, marginLeft: 4 }}>
            <Hrs v={issue.reviewToCompleteHours} />
          </span>
        </Pill>
      </div>

      {/* summary */}
      <div style={{ marginTop: 8, fontSize: 13, color: '#e2e8f0' }}>
        {issue.summary}
      </div>
    </div>
  );
}
