'use client';

import { useMemo, useRef, useState, type JSX, type MouseEvent } from 'react';
import type { JiraIssue, PRLifecycle } from '@/lib/types';

type GroupMode = 'week' | 'month';

interface Props {
  from: string;
  to: string;
  items: PRLifecycle[];
  tickets: JiraIssue[];
  selectedPrIds?: string[];
  locChangedByPrId?: Record<string, number>;
}

interface ChartRow {
  key: string;
  label: string;
  prs: number;
  additions: number;
  deletions: number;
  locChanged: number;
  locTrend: number;
  touchedStoryPoints: number;
  touchedStoryPointsTrend: number;
  touchedTicketCount: number;
}

const palette = {
  prs: '#60a5fa',
  touchedStoryPoints: '#a78bfa',
  touchedStoryPointsTrend: '#7c3aed',
  locChanged: '#22c55e',
  locTrend: '#15803d',
  grid: '#334155',
  axis: '#94a3b8',
};

const chartHeight = 300;
const margin = { top: 18, right: 52, bottom: 70, left: 56 };

function parseYmd(value: string): Date | null {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - mondayOffset);
  return copy;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function formatMonth(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(date);
}

function bucketForDate(date: Date, mode: GroupMode): { key: string; label: string } {
  if (mode === 'month') {
    const start = startOfMonth(date);
    return { key: formatYmd(start), label: formatMonth(start) };
  }

  const start = startOfWeek(date);
  const end = addDays(start, 6);
  return {
    key: formatYmd(start),
    label: `${formatShortDate(start)}-${formatShortDate(end)}`,
  };
}

function makeBuckets(from: string, to: string, mode: GroupMode): Map<string, ChartRow & { ticketKeys: Set<string> }> {
  const startRaw = parseYmd(from);
  const endRaw = parseYmd(to);
  const buckets = new Map<string, ChartRow & { ticketKeys: Set<string> }>();
  if (!startRaw || !endRaw) return buckets;

  let cursor = mode === 'month' ? startOfMonth(startRaw) : startOfWeek(startRaw);
  const end = mode === 'month' ? startOfMonth(endRaw) : startOfWeek(endRaw);

  while (cursor <= end) {
    const { key, label } = bucketForDate(cursor, mode);
    buckets.set(key, {
      key,
      label,
      prs: 0,
      additions: 0,
      deletions: 0,
      locChanged: 0,
      locTrend: 0,
      touchedStoryPoints: 0,
      touchedStoryPointsTrend: 0,
      touchedTicketCount: 0,
      ticketKeys: new Set<string>(),
    });
    cursor = mode === 'month' ? addMonths(cursor, 1) : addDays(cursor, 7);
  }

  return buckets;
}

function formatNumber(value: number | undefined): string {
  return Number.isFinite(value) ? Number(value).toLocaleString() : '0';
}

function rawLocChanged(item: PRLifecycle): number {
  return (item.additions ?? 0) + (item.deletions ?? 0);
}

function trendValue(rows: ChartRow[], index: number, key: 'touchedStoryPoints' | 'locChanged'): number {
  const start = Math.max(0, index - 2);
  const window = rows.slice(start, index + 1);
  const average = window.reduce((total, item) => total + item[key], 0) / Math.max(1, window.length);
  return Math.round(average);
}

function LegendItem(props: { color: string; label: string; line?: boolean }): JSX.Element {
  const { color, label, line = false } = props;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color }}>
      {line ? (
        <svg width="22" height="10" aria-hidden="true">
          <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth="2.5" />
          <circle cx="11" cy="5" r="3" fill={color} />
        </svg>
      ) : (
        <span style={{ width: 12, height: 12, borderRadius: 2, background: color, display: 'inline-block' }} />
      )}
      {label}
    </span>
  );
}

export function IndividualKpiTrend({ from, to, items, tickets, selectedPrIds, locChangedByPrId }: Props): JSX.Element {
  const [groupMode, setGroupMode] = useState<GroupMode>('week');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  const chartData = useMemo(() => {
    const storyPointsByKey = new Map(tickets.map((ticket) => [ticket.key, ticket.storyPoints ?? 0]));
    const selectedSet = selectedPrIds ? new Set(selectedPrIds) : null;
    const buckets = makeBuckets(from, to, groupMode);

    for (const item of items) {
      if (selectedSet && !selectedSet.has(item.id)) continue;

      const created = parseYmd(item.createdAt);
      if (!created) continue;

      const { key, label } = bucketForDate(created, groupMode);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          label,
          prs: 0,
          additions: 0,
          deletions: 0,
          locChanged: 0,
          locTrend: 0,
          touchedStoryPoints: 0,
          touchedStoryPointsTrend: 0,
          touchedTicketCount: 0,
          ticketKeys: new Set<string>(),
        };
        buckets.set(key, bucket);
      }

      const locChanged = locChangedByPrId?.[item.id] ?? rawLocChanged(item);
      bucket.prs += 1;
      bucket.additions += item.additions ?? 0;
      bucket.deletions += item.deletions ?? 0;
      bucket.locChanged += locChanged;
      if (item.jiraKey) bucket.ticketKeys.add(item.jiraKey);
    }

    const rows = [...buckets.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((bucket) => {
        let touchedStoryPoints = 0;
        for (const key of bucket.ticketKeys) {
          touchedStoryPoints += storyPointsByKey.get(key) ?? 0;
        }

        return {
          key: bucket.key,
          label: bucket.label,
          prs: bucket.prs,
          additions: bucket.additions,
          deletions: bucket.deletions,
          locChanged: bucket.locChanged,
          locTrend: bucket.locChanged,
          touchedStoryPoints,
          touchedStoryPointsTrend: touchedStoryPoints,
          touchedTicketCount: bucket.ticketKeys.size,
        };
      });

    return rows.map((row, index) => ({
      ...row,
      touchedStoryPointsTrend: trendValue(rows, index, 'touchedStoryPoints'),
      locTrend: trendValue(rows, index, 'locChanged'),
    }));
  }, [from, groupMode, items, locChangedByPrId, selectedPrIds, tickets, to]);

  const chartWidth = Math.max(880, chartData.length * 150 + margin.left + margin.right);
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = chartHeight - margin.top - margin.bottom;
  const groupWidth = chartData.length > 0 ? plotWidth / chartData.length : plotWidth;
  const barGap = 8;
  const barWidth = Math.min(48, Math.max(14, (groupWidth - 34) / 3));
  const maxLoc = Math.max(1, ...chartData.flatMap((row) => [row.locChanged, row.locTrend]));
  const maxCount = Math.max(1, ...chartData.flatMap((row) => [
    row.prs,
    row.touchedStoryPoints,
    row.touchedStoryPointsTrend,
  ]));
  const locAxisMax = Math.ceil(maxLoc * 1.12);
  const countAxisMax = Math.ceil(maxCount * 1.12);
  const leftY = (value: number): number => margin.top + plotHeight - ((value / locAxisMax) * plotHeight);
  const rightY = (value: number): number => margin.top + plotHeight - ((value / countAxisMax) * plotHeight);
  const groupCenter = (index: number): number => margin.left + (groupWidth * index) + (groupWidth / 2);
  const barCenter = (index: number, slot: 'prs' | 'touchedStoryPoints' | 'locChanged'): number => {
    const center = groupCenter(index);
    if (slot === 'prs') return center - barWidth - barGap;
    if (slot === 'locChanged') return center + barWidth + barGap;
    return center;
  };
  const barX = (index: number, slot: 'prs' | 'touchedStoryPoints' | 'locChanged'): number => barCenter(index, slot) - (barWidth / 2);
  const locTicks = Array.from({ length: 5 }, (_, index) => Math.round((locAxisMax / 4) * index));
  const countTicks = Array.from({ length: 5 }, (_, index) => Math.round((countAxisMax / 4) * index));
  const hoverRow = hoverIndex === null ? null : chartData[hoverIndex] ?? null;

  function trendPolyline(metric: 'touchedStoryPoints' | 'locChanged'): string {
    return chartData.map((row, index) => {
      const x = barCenter(index, metric);
      const value = metric === 'touchedStoryPoints'
        ? row.touchedStoryPointsTrend
        : row.locTrend;
      const y = metric === 'locChanged' ? leftY(value) : rightY(value);
      return `${x},${y}`;
    }).join(' ');
  }

  function updateHover(event: MouseEvent<HTMLDivElement>) {
    const el = chartRef.current;
    const bounds = el?.getBoundingClientRect();
    if (!el || !bounds || chartData.length === 0) return;
    const contentX = event.clientX - bounds.left + el.scrollLeft;
    const x = (contentX / el.scrollWidth) * chartWidth;
    const rawIndex = Math.floor((x - margin.left) / groupWidth);
    if (rawIndex >= 0 && rawIndex < chartData.length) {
      setHoverIndex(rawIndex);
    } else {
      setHoverIndex(null);
    }
  }

  return (
    <div style={{ background: 'var(--panel-bg)', color: 'var(--panel-fg)', borderRadius: 12, padding: 16, border: '1px solid var(--panel-br)', boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontWeight: 700, marginBottom: 4 }}>KPI Trend</h2>
          <div style={{ color: 'var(--panel-muted)', fontSize: 13 }}>
            PRs, touched story points, and lines changed grouped by the selected interval.
          </div>
        </div>
        <div
          role="group"
          aria-label="Group KPI trend"
          style={{
            display: 'inline-flex',
            padding: 3,
            borderRadius: 10,
            border: '1px solid var(--panel-br)',
            background: 'var(--card-bg)',
          }}
        >
          {(['week', 'month'] as const).map((mode) => {
            const active = groupMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setGroupMode(mode)}
                style={{
                  minWidth: 76,
                  border: 0,
                  borderRadius: 8,
                  padding: '7px 10px',
                  background: active ? 'var(--panel-fg)' : 'transparent',
                  color: active ? 'var(--panel-bg)' : 'var(--panel-fg)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {mode === 'week' ? 'Weeks' : 'Months'}
              </button>
            );
          })}
        </div>
      </div>
      <div
        ref={chartRef}
        onMouseMove={updateHover}
        onMouseLeave={() => setHoverIndex(null)}
        style={{ width: '100%', overflowX: 'auto', position: 'relative' }}
      >
        <svg
          role="img"
          aria-label="KPI trend chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          width="100%"
          height={chartHeight}
          style={{ minWidth: chartWidth }}
        >
          <line x1={margin.left} y1={margin.top + plotHeight} x2={chartWidth - margin.right} y2={margin.top + plotHeight} stroke={palette.axis} strokeWidth="1" />
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke={palette.axis} strokeWidth="1" />
          <line x1={chartWidth - margin.right} y1={margin.top} x2={chartWidth - margin.right} y2={margin.top + plotHeight} stroke={palette.axis} strokeWidth="1" />

          {locTicks.map((tick, index) => {
            const y = leftY(tick);
            return (
              <g key={`loc-tick-${index}`}>
                <line x1={margin.left} y1={y} x2={chartWidth - margin.right} y2={y} stroke={palette.grid} strokeDasharray="4 4" />
                <text x={margin.left - 8} y={y + 4} textAnchor="end" fill={palette.axis} fontSize="12">{formatNumber(tick)}</text>
              </g>
            );
          })}
          {countTicks.map((tick, index) => {
            const y = rightY(tick);
            return (
              <text key={`count-tick-${index}`} x={chartWidth - margin.right + 8} y={y + 4} fill={palette.axis} fontSize="12">{formatNumber(tick)}</text>
            );
          })}

          {hoverIndex !== null && (
            <rect
              x={margin.left + (groupWidth * hoverIndex)}
              y={margin.top}
              width={groupWidth}
              height={plotHeight}
              fill="rgba(148, 163, 184, 0.10)"
            />
          )}

          {chartData.map((row, index) => {
            const baseY = margin.top + plotHeight;
            const prsY = rightY(row.prs);
            const touchedY = rightY(row.touchedStoryPoints);
            const locY = leftY(row.locChanged);
            return (
              <g key={row.key}>
                <rect x={barX(index, 'prs')} y={prsY} width={barWidth} height={baseY - prsY} rx="4" fill={palette.prs} />
                <rect x={barX(index, 'touchedStoryPoints')} y={touchedY} width={barWidth} height={baseY - touchedY} rx="4" fill={palette.touchedStoryPoints} />
                <rect x={barX(index, 'locChanged')} y={locY} width={barWidth} height={baseY - locY} rx="4" fill={palette.locChanged} />
                <text x={groupCenter(index)} y={chartHeight - 30} textAnchor="middle" fill={palette.axis} fontSize="12">{row.label}</text>
              </g>
            );
          })}

          <polyline points={trendPolyline('touchedStoryPoints')} fill="none" stroke={palette.touchedStoryPointsTrend} strokeWidth="2.5" />
          <polyline points={trendPolyline('locChanged')} fill="none" stroke={palette.locTrend} strokeWidth="2.5" />

          {chartData.map((row, index) => (
            <g key={`trend-points-${row.key}`}>
              <circle cx={barCenter(index, 'touchedStoryPoints')} cy={rightY(row.touchedStoryPointsTrend)} r="3" fill={palette.touchedStoryPointsTrend} />
              <circle cx={barCenter(index, 'locChanged')} cy={leftY(row.locTrend)} r="3" fill={palette.locTrend} />
            </g>
          ))}
        </svg>

        {hoverRow && hoverIndex !== null && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(82, Math.max(8, (groupCenter(hoverIndex) / chartWidth) * 100))}%`,
              top: 16,
              transform: 'translateX(-50%)',
              background: 'var(--tooltip-bg)',
              color: 'var(--tooltip-fg)',
              border: '1px solid var(--panel-br)',
              borderRadius: 8,
              padding: '10px 12px',
              boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 2,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{hoverRow.label}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <div><span style={{ color: palette.prs }}>PRs</span>: {formatNumber(hoverRow.prs)}</div>
              <div><span style={{ color: palette.touchedStoryPoints }}>Touched SP</span>: {formatNumber(hoverRow.touchedStoryPoints)} / trend {formatNumber(hoverRow.touchedStoryPointsTrend)}</div>
              <div><span style={{ color: palette.locChanged }}>LOC Changed</span>: {formatNumber(hoverRow.locChanged)} / trend {formatNumber(hoverRow.locTrend)}</div>
              <div style={{ color: 'var(--panel-muted)', marginTop: 4 }}>{formatNumber(hoverRow.touchedTicketCount)} tickets with PRs</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
        <LegendItem color={palette.prs} label="PRs" />
        <LegendItem color={palette.touchedStoryPoints} label="Touched SP" />
        <LegendItem color={palette.touchedStoryPointsTrend} label="Touched SP Trend" line />
        <LegendItem color={palette.locChanged} label="LOC Changed" />
        <LegendItem color={palette.locTrend} label="LOC Trend" line />
      </div>
    </div>
  );
}
