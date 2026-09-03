import { MSG, ToolError } from "../errors.js";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseGa4Date(raw: string, now: Date): Date {
  const s = raw.trim();
  if (s === "today") return startOfUtcDay(now);
  if (s === "yesterday") {
    const d = startOfUtcDay(now);
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
  const ago = /^(\d+)daysAgo$/i.exec(s);
  if (ago) {
    const d = startOfUtcDay(now);
    d.setUTCDate(d.getUTCDate() - Number(ago[1]));
    return d;
  }
  const m = YMD.exec(s);
  if (!m) {
    throw new ToolError("INVALID_ARGUMENT", `Date must be YYYY-MM-DD, today, yesterday, or NdaysAgo (got ${raw})`);
  }
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function inclusiveDays(start: Date, end: Date): number {
  const ms = startOfUtcDay(end).getTime() - startOfUtcDay(start).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

export function capDateRange(
  startRaw: string,
  endRaw: string,
  now: Date,
  allowLong: boolean,
): void {
  const start = parseGa4Date(startRaw, now);
  const end = parseGa4Date(endRaw, now);
  if (end.getTime() < start.getTime()) {
    throw new ToolError("INVALID_ARGUMENT", "end_date is before start_date");
  }
  const days = inclusiveDays(start, end);
  if (days > 366 && !allowLong) {
    throw new ToolError("INVALID_ARGUMENT", MSG.RANGE_TOO_LONG);
  }
}

export function slicePage<T>(
  items: T[],
  pageSize: number,
  pageToken: string | undefined,
): { items: T[]; next?: string; total: number } {
  const start = pageToken ? Number(pageToken) : 0;
  const offset = Number.isFinite(start) && start >= 0 ? start : 0;
  const slice = items.slice(offset, offset + pageSize);
  const next = offset + slice.length < items.length ? String(offset + slice.length) : undefined;
  return { items: slice, next, total: items.length };
}
