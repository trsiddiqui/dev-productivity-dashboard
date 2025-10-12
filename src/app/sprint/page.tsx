'use client';

import { JSX, useEffect, useMemo, useState } from 'react';
import type {
  JiraSprintLite,
  SprintStatsResponse,
  CompletedByAssignee,
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

// Small number renderer
function Num({ v }: { v: number | undefined }): JSX.Element {
  const n = Number.isFinite(v) ? (v as number) : 0;
  return <span>{n.toLocaleString()}</span>;
}

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

      // Order: latest → oldest (by endDate then startDate)
      const pickTime = (s: JiraSprintLite): number => {
        const end = s.endDate ? Date.parse(s.endDate) : Number.NaN;
        const start = s.startDate ? Date.parse(s.startDate) : Number.NaN;
        if (Number.isFinite(end)) return end;
        if (Number.isFinite(start)) return start;
        return -Infinity;
      };
      const ordered = [...(json.sprints ?? [])].sort((a, b) => pickTime(b) - pickTime(a));
      setSprints(ordered);

      // Auto-select active sprint if nothing chosen
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

  // ---- Effects ----
  // If a boardId is prefilled (from URL or localStorage, etc.), auto-load sprints
  useEffect(() => {
    if (boardId) void loadSprints(boardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

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
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #ddd' }}
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
                  background: '#0f172a',
                  color: '#e5e7eb',
                  borderRadius: 12,
                  padding: 12,
                  border: '1px solid #1f2937',
                }}
              >
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  <Num v={k.value} />
                </div>
              </div>
            ))}
          </div>

          {/* Forecast dates (if available) */}
          {data.forecast && (data.forecast.devCompletionDate || data.forecast.completeCompletionDate) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div style={{ background: '#0f172a', color: '#e5e7eb', borderRadius: 12, padding: 12, border: '1px solid #1f2937' }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Forecast Dev Done</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{data.forecast.devCompletionDate ?? '—'}</div>
              </div>
              <div style={{ background: '#0f172a', color: '#e5e7eb', borderRadius: 12, padding: 12, border: '1px solid #1f2937' }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Forecast Complete Done</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{data.forecast.completeCompletionDate ?? '—'}</div>
              </div>
            </div>
          )}

          {/* Burn chart with forecast */}
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

                  {/* Actuals (solid) */}
                  <Line type="monotone" dataKey="devRemaining" name="Dev Remaining" stroke="#60a5fa" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="completeRemaining" name="Complete Remaining" stroke="#22c55e" dot={false} strokeWidth={2} />

                  {/* Forecast (dashed) */}
                  <Line
                    type="monotone"
                    dataKey="devForecastRemaining"
                    name="Dev Remaining (forecast)"
                    stroke="#60a5fa"
                    dot={false}
                    strokeWidth={2}
                    strokeDasharray="6 6"
                  />
                  <Line
                    type="monotone"
                    dataKey="completeForecastRemaining"
                    name="Complete Remaining (forecast)"
                    stroke="#22c55e"
                    dot={false}
                    strokeWidth={2}
                    strokeDasharray="6 6"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Completed by Assignee – cards */}
          {data.completedByAssignee && data.completedByAssignee.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontWeight: 600, marginBottom: 8 }}>Completed by Assignee</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {data.completedByAssignee.map((row: CompletedByAssignee) => (
                  <div
                    key={row.assignee}
                    style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff' }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>{row.assignee}</div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ background: '#eff6ff', borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 12, color: '#1e40af', marginBottom: 2 }}>(Dev) Completed</div>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{row.devPoints}</div>
                      </div>

                      <div style={{ background: '#ecfdf5', borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 12, color: '#065f46', marginBottom: 2 }}>(Dev + QA) Completed</div>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{row.completePoints}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
