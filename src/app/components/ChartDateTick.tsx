'use client';

import type { JSX } from 'react';

export function weekdayFromYmd(label?: string): string | null {
  if (!label) return null;
  const parts = label.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = parts;
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
}

interface AxisTickProps {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  color?: string;
}

export function DateAxisTick({ x = 0, y = 0, payload, color = '#94a3b8' }: AxisTickProps): JSX.Element {
  const label = String(payload?.value ?? '');
  const weekday = weekdayFromYmd(label);

  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fill={color} fontSize={11}>
        <tspan x={0}>{label}</tspan>
        {weekday ? <tspan x={0} dy={12}>{weekday}</tspan> : null}
      </text>
    </g>
  );
}
