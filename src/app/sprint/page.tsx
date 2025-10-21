// src/app/sprint/page.tsx
"use client";
import React, { JSX, useEffect, useMemo, useRef, useState } from "react";
import type {
  JiraSprintLite,
  SprintStatsResponse,
  CompletedByAssignee,
  JiraIssue,
} from "@/lib/types";
import type { PieLabelRenderProps } from "recharts/types/polar/Pie";
import { SearchableSelect, type Option } from "../components/SearchableSelect";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COMPACT_SWITCH_PX = 480;

/* ===================== Theme-aware tokens ===================== */
/** Use CSS vars so the whole page adapts to [data-theme] */
const t = {
  // surfaces
  appBg: "var(--background)",
  appFg: "var(--foreground)",
  surface: "var(--surface)",
  border: "var(--border)",
  link: "var(--surface-link)",
  faintText: "var(--faint-text)",

  // cards
  cardBg: "var(--card-bg)",
  cardFg: "var(--card-fg)",
  cardBr: "var(--card-br)",

  // general
  muted: "var(--muted)",
};

/* ===================== Palette / helpers ===================== */
const palette = {
  // stages (kept vivid)
  todo: "#94a3b8",
  progress: "#3b82f6",
  review: "#8b5cf6",
  done: "#22c55e",
  blocked: "#f59e0b",

  // type chips
  story: "#6366f1",
  bug: "#ef4444",
  task: "#0ea5e9",
  spike: "#14b8a6",
};

const TODO_STATUS_NAMES = ["To Do", "Open", "Backlog", "Selected for Development"];
const INPROGRESS_STATUS_NAMES = [
  "In Progress",
  "In Development",
  "In-Progress",
  "Doing",
  "Selected for Development",
];
const DEV_STATUS_NAMES = ["Reviewed", "Review", "In Review"];
const COMPLETE_STATUS_NAMES = ["Approved", "Done"];
const BLOCKED_STATUS_NAMES = ["Blocked", "On Hold", "Impeded", "Awaiting", "Hold"];

const normalize = (s?: string) => (s ?? "").trim().toLowerCase();
const toSlug = (s?: string) =>
  (s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .trim();

function statusGroup(
  status?: string
): "todo" | "progress" | "review" | "done" | "blocked" | "other" {
  const x = normalize(status);
  if (TODO_STATUS_NAMES.map(normalize).includes(x)) return "todo";
  if (INPROGRESS_STATUS_NAMES.map(normalize).includes(x)) return "progress";
  if (DEV_STATUS_NAMES.map(normalize).includes(x)) return "review";
  if (COMPLETE_STATUS_NAMES.map(normalize).includes(x)) return "done";
  if (BLOCKED_STATUS_NAMES.map(normalize).includes(x)) return "blocked";
  return "other";
}

function typeColor(issueType?: string): { bg: string; fg: string; br: string } {
  const tName = normalize(issueType);
  const pick = (hex: string) => ({ bg: `rgba(${hexToRgb(hex)}, 0.14)`, fg: t.cardFg, br: `rgba(${hexToRgb(hex)}, 0.35)` });
  if (tName === "bug") return pick(palette.bug);
  if (tName === "task") return pick(palette.task);
  if (tName === "spike") return pick(palette.spike);
  return pick(palette.story);
}
function statusColor(status?: string): { bg: string; fg: string; br: string } {
  const g = statusGroup(status);
  const hex =
    g === "todo"
      ? palette.todo
      : g === "progress"
      ? palette.progress
      : g === "review"
      ? palette.review
      : g === "done"
      ? palette.done
      : g === "blocked"
      ? palette.blocked
      : "#64748b";
  return { bg: `rgba(${hexToRgb(hex)}, 0.14)`, fg: t.cardFg, br: `rgba(${hexToRgb(hex)}, 0.35)` };
}
function hexToRgb(hex: string): string {
  const m = hex.replace("#", "");
  const bigint = parseInt(m, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

/** Return date/time parts in Central Time for two-line display */
function centralParts(iso?: string): { date: string; timeTz: string } {
  if (!iso) return { date: "—", timeTz: "" };
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { date: "—", timeTz: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const hh = get("hour");
  const mi = get("minute");
  const tz = get("timeZoneName") || "CT";
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
  fg = t.cardFg,
}: {
  children: React.ReactNode;
  bg: string;
  br: string;
  fg?: string;
}) {
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        background: bg,
        color: fg,
        border: `1px solid ${br}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* ===================== Main Page ===================== */
export default function SprintPage(): JSX.Element {
  // Controls
  const [boardId, setBoardId] = useState<string>("");
  const [sprints, setSprints] = useState<JiraSprintLite[]>([]);
  const [sprintId, setSprintId] = useState<string>("");
  const [loadingSprints, setLoadingSprints] = useState<boolean>(false);

  // Data
  const [data, setData] = useState<SprintStatsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // progress (SSE)
  const [pct, setPct] = useState<number>(0);
  const [stage, setStage] = useState<string>("");
  const esRef = useRef<EventSource | null>(null);

  // UI state: expanded people
  const [openAssignees, setOpenAssignees] = useState<Set<string>>(new Set());

  const sprintOptions: Option[] = useMemo(
    () =>
      sprints.map((s) => ({
        value: String(s.id),
        label: s.name ?? `Sprint ${s.id}`,
        subtitle: s.state ? s.state : undefined,
      })),
    [sprints]
  );

  async function loadSprints(selectedBoardId?: string): Promise<void> {
    const bid = selectedBoardId ?? boardId;
    if (!bid) return;
    setLoadingSprints(true);
    try {
      const resp = await fetch(`/api/sprints?boardId=${encodeURIComponent(bid)}`);
      if (!resp.ok) throw new Error(await resp.text());
      const json: { sprints: JiraSprintLite[]; warnings?: string[] } = await resp.json();

      setWarnings(json.warnings ?? []);
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
        const active = ordered.find((s) => (s.state ?? "").toLowerCase() === "active");
        if (active) setSprintId(String(active.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sprints");
      setSprints([]);
    } finally {
      setLoadingSprints(false);
    }
  }

  // Group issues by assignee
  const issuesByAssignee = useMemo(() => {
    const m = new Map<string, JiraIssue[]>();
    if (!data?.issues) return m;
    for (const it of data.issues) {
      const who = it.assignee && it.assignee.trim() ? it.assignee : "Unassigned";
      if (!m.has(who)) m.set(who, []);
      m.get(who)!.push(it);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => {
        const aKey = a.reviewAt ?? a.completeAt ?? a.created ?? "";
        const bKey = b.reviewAt ?? b.completeAt ?? b.created ?? "";
        return aKey.localeCompare(bKey);
      });
      m.set(k, arr);
    }
    return m;
  }, [data]);

  // Assigned story points per assignee → for pie
  const assignedPointsByAssignee = useMemo(() => {
    const mp = new Map<string, number>();
    if (!data?.issues) return mp;
    for (const it of data.issues) {
      const who = it.assignee && it.assignee.trim() ? it.assignee : "Unassigned";
      const pts = typeof it.storyPoints === "number" ? it.storyPoints : 0;
      mp.set(who, (mp.get(who) ?? 0) + pts);
    }
    return mp;
  }, [data]);

  const pieData = useMemo(
    () =>
      Array.from(assignedPointsByAssignee.entries())
        .map(([name, value]) => ({ name, value }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value),
    [assignedPointsByAssignee]
  );
  const pieColors = [
    "#60a5fa",
    "#34d399",
    "#f472b6",
    "#f59e0b",
    "#a78bfa",
    "#f87171",
    "#10b981",
    "#c084fc",
    "#22d3ee",
    "#fb7185",
    "#93c5fd",
  ];

  const kpiCards = useMemo(() => {
    if (!data) return [];
    return [
      { label: "Committed SP", value: data.kpis.committedSP },
      { label: "Scope Added SP", value: data.kpis.scopeAddedSP },
      { label: "Scope Removed SP", value: data.kpis.scopeRemovedSP },
      { label: "Dev Completed SP", value: data.kpis.devCompletedSP },
      { label: "Dev Remaining SP", value: data.kpis.devRemainingSP },
      { label: "Dev Completion %", value: data.kpis.devCompletionPct },
      { label: "Complete Completed SP", value: data.kpis.completeCompletedSP },
      { label: "Complete Remaining SP", value: data.kpis.completeRemainingSP },
      { label: "Complete %", value: data.kpis.completeCompletionPct },
      { label: "Tickets in QA", value: data.ticketsInQA ?? 0 },
      { label: "PR Lines Added", value: data.kpis.totalPRAdditions ?? 0 },
      { label: "PR Lines Deleted", value: data.kpis.totalPRDeletions ?? 0 },
    ];
  }, [data]);

  // Fetch with streaming progress (SSE). Falls back to JSON fetch if it fails.
  async function fetchStats(): Promise<void> {
    if (!sprintId) {
      setError("Pick a sprint");
      return;
    }
    setError(null);
    setLoading(true);
    setPct(0);
    setStage("Starting…");

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    try {
      const es = new EventSource(`/api/sprint-stats/stream?sprintId=${encodeURIComponent(sprintId)}`);
      esRef.current = es;

      let gotResult = false;

      es.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          if (payload?.type === "progress") {
            setPct(payload.pct ?? 0);
            setStage(payload.label ?? "Working…");
          } else if (payload?.type === "done") {
            gotResult = true;
            setData(payload.result as SprintStatsResponse);
            setPct(100);
            setStage("Done");
            setLoading(false);
            es.close();
            esRef.current = null;
          } else if (payload?.type === "error") {
            setError(payload.message || "Failed while computing stats");
            setLoading(false);
            es.close();
            esRef.current = null;
          }
        } catch {
          /* ignore malformed chunks */
        }
      };

      es.onerror = () => {
        if (!gotResult) {
          es.close();
          esRef.current = null;
          fallbackFetch();
        }
      };
    } catch {
      await fallbackFetch();
    }
  }

  async function fallbackFetch() {
    try {
      const resp = await fetch(`/api/sprint-stats?sprintId=${encodeURIComponent(sprintId)}`);
      if (!resp.ok) throw new Error(await resp.text());
      const json: SprintStatsResponse = await resp.json();
      setData(json);
      setPct(100);
      setStage("Done");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to fetch stats";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSprints();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleAssignee(name: string) {
    setOpenAssignees((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24, color: t.appFg }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Sprint Dashboard</h1>
      </header>

      {/* Controls */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1.8fr 0.9fr",
          gap: 12,
          alignItems: "end",
          marginBottom: 16,
        }}
      >
        <div>
          <label style={{ fontSize: 12, display: "block", marginBottom: 4, color: t.muted }}>
            Jira Board ID
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              placeholder="e.g., 126 for PE, 97 for PC"
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${t.border}`,
                background: t.cardBg,
                color: t.appFg,
                textAlign: "right",
              }}
            />
            <button
              onClick={() => void loadSprints()}
              disabled={!boardId || loadingSprints}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${t.border}`,
                background: t.cardBg,
                color: t.cardFg,
                boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                opacity: !boardId || loadingSprints ? 0.6 : 1,
                cursor: !boardId || loadingSprints ? "not-allowed" : "pointer",
              }}
            >
              {loadingSprints ? "Loading…" : "Load"}
            </button>
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, display: "block", marginBottom: 4, color: t.muted }}>
            Sprint
          </label>
          <SearchableSelect
            items={sprintOptions}
            value={sprintId}
            onChange={setSprintId}
            placeholder={loadingSprints ? "Loading sprints…" : "Search sprint…"}
            disabled={loadingSprints || sprintOptions.length === 0}
          />
        </div>

        <div>
          <button
            onClick={() => void fetchStats()}
            disabled={!sprintId || loading}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${t.border}`,
              background: t.cardBg,
              color: t.cardFg,
              boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
              opacity: !sprintId || loading ? 0.6 : 1,
              cursor: !sprintId || loading ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {loading ? "Loading…" : "Fetch"}
          </button>
        </div>
      </div>

      {/* Optional quick actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        {/* <button
          onClick={fetchStats}
          disabled={loading || !sprintId}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: t.surface,
            color: t.appFg,
            opacity: loading || !sprintId ? 0.6 : 1,
          }}
        >
          Fetch
        </button> */}
        {loading && (
          <button
            onClick={() => {
              if (esRef.current) esRef.current.close();
              esRef.current = null;
              setLoading(false);
              setStage("Canceled");
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${t.border}`,
              background: "transparent",
              color: t.muted,
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress UI */}
      {loading && (
        <div style={{ marginTop: 12, maxWidth: 560 }}>
          <div style={{ height: 10, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8 }}>
            <div
              style={{
                height: 10,
                width: `${pct}%`,
                background: palette.progress,
                borderRadius: 8,
                transition: "width 200ms linear",
              }}
            />
          </div>
          <div
            style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: t.muted }}
          >
            <span>{stage}</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}

      {/* Warnings / errors */}
      {!!error && (
        <div
          style={{
            marginTop: 10,
            border: `1px solid ${t.border}`,
            background: "rgba(239, 68, 68, 0.12)",
            color: "#b91c1c",
            padding: 10,
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}
      {!!warnings?.length && (
        <div style={{ marginTop: 10 }}>
          {warnings.map((w, i) => (
            <div
              key={i}
              style={{
                color: "#92400e",
                background: "rgba(245, 158, 11, 0.12)",
                border: `1px solid ${t.border}`,
                padding: 8,
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              ⚠️ {w}
            </div>
          ))}
        </div>
      )}

      {/* DATA */}
      {data && (
        <>
          {/* KPIs */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              marginBottom: 16,
            }}
          >
            {kpiCards.map((k) => (
              <div
                key={k.label}
                style={{
                  background: t.cardBg,
                  color: t.cardFg,
                  borderRadius: 12,
                  padding: 12,
                  border: `1px solid ${t.cardBr}`,
                  boxShadow: "0 2px 14px rgba(0,0,0,0.12)",
                }}
              >
                <div style={{ fontSize: 12, color: t.muted, marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, textAlign: "right" }}>
                  <Num v={k.value} />
                </div>
              </div>
            ))}
          </div>

          {/* Burn + Story-point distribution */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
              marginBottom: 16,
            }}
          >
            {/* Burn chart */}
            <div
              style={{
                background: t.cardBg,
                color: t.cardFg,
                borderRadius: 12,
                padding: 16,
                border: `1px solid ${t.cardBr}`,
                boxShadow: "0 2px 14px rgba(0,0,0,0.12)",
              }}
            >
              <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Sprint Burn</h2>
              <div style={{ width: "100%", height: 340 }}>
                <ResponsiveContainer>
                  <LineChart data={data.burn} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke={t.muted} tickMargin={8} />
                    <YAxis stroke={t.muted} allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="devRemaining" name="Dev Remaining" stroke="#60a5fa" dot={false} strokeWidth={2} />
                    <Line
                      type="monotone"
                      dataKey="completeRemaining"
                      name="Complete Remaining"
                      stroke="#22c55e"
                      dot={false}
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Pie: SP distribution by assignee */}
            <div
              style={{
                background: t.cardBg,
                color: t.cardFg,
                borderRadius: 12,
                padding: 16,
                border: `1px solid ${t.cardBr}`,
                boxShadow: "0 2px 14px rgba(0,0,0,0.12)",
              }}
            >
              <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Story Points by Assignee</h2>
              <div style={{ width: "100%", height: 340 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      dataKey="value"
                      nameKey="name"
                      data={pieData}
                      innerRadius="50%"
                      outerRadius="80%"
                      labelLine={false}
                      label={(p: PieLabelRenderProps) => String(p.value)}
                    >
                      {pieData.map((_, idx) => (
                        <Cell key={idx} fill={pieColors[idx % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Completed by Assignee */}
          {data.completedByAssignee && data.completedByAssignee.length > 0 && (
            <div
              style={{
                background: t.surface,
                color: t.appFg,
                borderRadius: 12,
                padding: 16,
                border: `1px solid ${t.border}`,
                boxShadow: "0 2px 14px rgba(0,0,0,0.08)",
                marginBottom: 16,
              }}
            >
              <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Completed by Assignee</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 12,
                }}
              >
                {data.completedByAssignee.map((row: CompletedByAssignee) => {
                  const name = row.assignee;
                  const items = issuesByAssignee.get(name) ?? [];

                  const locChanged = items.reduce(
                    (acc, it) => acc + (it.prAdditions ?? 0) + (it.prDeletions ?? 0),
                    0
                  );
                  const assignedSP = items.reduce((acc, it) => acc + (it.storyPoints ?? 0), 0);
                  const locPerSP = assignedSP > 0 ? locChanged / assignedSP : 0;

                  const isOpen = openAssignees.has(name);
                  return (
                    <div
                      key={name}
                      style={{
                        border: `1px solid ${t.cardBr}`,
                        borderRadius: 12,
                        padding: 12,
                        background: t.cardBg,
                        color: t.cardFg,
                        boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <div style={{ fontWeight: 800 }}>{name}</div>
                        <button
                          onClick={() => toggleAssignee(name)}
                          style={{
                            border: `1px solid ${t.cardBr}`,
                            borderRadius: 8,
                            padding: "6px 10px",
                            background: t.surface,
                            color: t.cardFg,
                            cursor: "pointer",
                          }}
                        >
                          {isOpen ? `Hide tickets (${items.length})` : `Show tickets (${items.length})`}
                        </button>
                      </div>

                      {/* three quick stats */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <MiniStat label="(Dev) Completed" value={row.devPoints} tint={palette.progress} />
                        <MiniStat label="(Dev + QA) Completed" value={row.completePoints} tint={palette.done} />
                        <MiniStat label="LOC Changed" value={locChanged} tint={palette.todo} />
                      </div>

                      {/* SP & ratios */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(2, 1fr)",
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <MiniStat label="Assigned SP" value={assignedSP} tint={palette.story} />
                        <MiniStat
                          label="LOC / SP"
                          value={assignedSP > 0 ? Number(locPerSP.toFixed(1)) : 0}
                          tint={palette.story}
                        />
                      </div>

                      {/* Collapsible ticket timelines */}
                      {isOpen && (
                        <div
                          style={{
                            marginTop: 12,
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                          }}
                        >
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

/* ===================== Little helpers ===================== */
function MiniStat({ label, value, tint }: { label: string; value?: number; tint: string }) {
  return (
    <div
      style={{
        background: `rgba(${hexToRgb(tint)}, 0.10)`,
        borderRadius: 10,
        padding: 10,
        border: `1px solid rgba(${hexToRgb(tint)}, 0.35)`,
      }}
    >
      <div style={{ fontSize: 12, color: t.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, textAlign: "right" }}>
        <Num v={value ?? 0} />
      </div>
    </div>
  );
}

function Dot({ color, active }: { color: string; active: boolean }) {
  return (
    <div
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        background: active ? color : "transparent",
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
    label === "To Do" ? "📋" : label === "In Progress" ? "🔧" : label === "Review" ? "👀" : label === "Approved" ? "✅" : "•";
  const parts = centralParts(date);

  return (
    <div
      title={date ? `${label} — ${parts.date} ${parts.timeTz}` : `${label}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        minWidth: compact ? 44 : 96,
        flex: "0 1 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Dot color={color} active={active} />
      </div>
      {compact ? (
        <>
          <div style={{ fontSize: 14, marginTop: 6, color, textAlign: "center" }}>{icon}</div>
          <div style={{ fontSize: 10, color: t.muted, textAlign: "center", lineHeight: 1.15, marginTop: 2 }}>
            <div>{parts.date}</div>
            <div>{parts.timeTz}</div>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, marginTop: 6, color, textAlign: "right" }}>{label}</div>
          <div style={{ fontSize: 11, color: t.muted, textAlign: "right", lineHeight: 1.15 }}>
            <div>{parts.date}</div>
            <div>{parts.timeTz}</div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <div
      style={{
        background: t.surface,
        border: `1px solid ${t.cardBr}`,
        borderRadius: 8,
        padding: "6px 8px",
        minWidth: 90,
      }}
    >
      <div style={{ fontSize: 11, color: t.muted }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, textAlign: "right" }}>
        <Num v={value ?? 0} />
      </div>
    </div>
  );
}

function TicketTimeline({ issue }: { issue: JiraIssue }) {
  const hasProg = !!issue.inProgressAt;
  const hasReview = !!issue.reviewAt;
  const hasDone = !!issue.completeAt;

  const typeSty = typeColor(issue.issueType);
  const statSty = statusColor(issue.status);

  const todoAt = issue.todoAt ?? issue.created;
  const inProg = issue.inProgressAt;
  const revAt = issue.reviewAt;
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

  // make status class slug so CSS in globals.css like ".in-progress-card" applies
    const sg = statusGroup(issue.status);
    const statusSlug =
      sg === "other"
        ? toSlug(issue.status)
        : toSlug(
            {
              todo: "todo",
              progress: "in-progress",
              review: "review",
              done: "done",
              blocked: "impeded",
            }[sg]
          );

  return (
    <div
      style={{
        border: `1px solid ${t.cardBr}`,
        borderRadius: 12,
        padding: 12,
        background: t.surface,
      }}
      className={`${statusSlug}-card`}
    >
      {/* header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            minWidth: 0,
            flexWrap: "wrap",
          }}
        >
          <a href={issue.url} target="_blank" rel="noreferrer" style={{ fontWeight: 800, color: t.link }}>
            {issue.key}
          </a>
          <Pill bg={typeSty.bg} br={typeSty.br}>
            {issue.issueType ?? "Ticket"}
          </Pill>
          {typeof issue.storyPoints === "number" && (
            <Pill bg={`rgba(${hexToRgb(palette.story)}, 0.14)`} br={`rgba(${hexToRgb(palette.story)}, 0.35)`}>
              {issue.storyPoints} SP
            </Pill>
          )}
          {issue.status && (
            <Pill bg={statSty.bg} br={statSty.br}>
              {issue.status}
            </Pill>
          )}
        </div>
      </div>

      {/* LOC + review counts mini cards */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 8,
          justifyContent: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <StatCard label="Lines Added" value={issue.prAdditions ?? 0} />
        <StatCard label="Lines Deleted" value={issue.prDeletions ?? 0} />
        <StatCard label="Review Cmts" value={issue.prReviewComments ?? 0} />
      </div>

      {/* timeline */}
      <div
        ref={rowRef}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingRight: 16,
          overflow: "visible",
        }}
      >
        <Step label="To Do" date={todoAt} color={palette.todo} active={!!todoAt} compact={compact} />
        <Connector color={palette.progress} active={hasProg} />
        <Step label="In Progress" date={inProg} color={palette.progress} active={hasProg} compact={compact} />
        <Connector color={palette.review} active={hasReview} />
        <Step label="Review" date={revAt} color={palette.review} active={hasReview} compact={compact} />
        <Connector color={palette.done} active={hasDone} />
        <Step label="Approved" date={compAt} color={palette.done} active={hasDone} compact={compact} />
      </div>

      {/* durations */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 8,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        <Pill bg={`rgba(${hexToRgb(palette.progress)}, 0.14)`} br={`rgba(${hexToRgb(palette.progress)}, 0.35)`}>
          In Progress → Review:
          <span style={{ fontWeight: 700, marginLeft: 4 }}>
            <Hrs v={issue.inProgressToReviewHours} />
          </span>
        </Pill>
        <Pill bg={`rgba(${hexToRgb(palette.review)}, 0.14)`} br={`rgba(${hexToRgb(palette.review)}, 0.35)`}>
          Review → Approved:
          <span style={{ fontWeight: 700, marginLeft: 4 }}>
            <Hrs v={issue.reviewToCompleteHours} />
          </span>
        </Pill>
      </div>

      {/* summary */}
      <div style={{ marginTop: 8, fontSize: 13, color: t.appFg }}>{issue.summary}</div>
    </div>
  );
}
