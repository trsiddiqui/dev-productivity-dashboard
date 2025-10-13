// src/lib/datetime.ts
export const CENTRAL_TZ = "America/Chicago";

type FmtOpts = { withSeconds?: boolean };

export function formatTimeZone(input: Date | string | number, opts: FmtOpts = {}) {
  const d =
    typeof input === "string" || typeof input === "number" ? new Date(input) : input;
  if (!d || Number.isNaN(d.getTime())) return "—";

  const { withSeconds = false } = opts;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TZ,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: true,
    timeZoneName: "short",
  }).format(d);
}

export function formatCentralRange(
  from: Date | string | number,
  to: Date | string | number,
  opts: FmtOpts = {}
) {
  return `${formatTimeZone(from, opts)} – ${formatTimeZone(to, opts)}`;
}
