import type { HoursLogEntry } from '../types';

/** Minute increments the duration picker offers — an HOURS_LOG cell only ever stores multiples
 *  of one of these, in either field. */
export const HOURS_LOG_MINUTE_STEPS = [0, 15, 30, 45] as const;

export function sumHoursLogMinutes(entries: HoursLogEntry[] | null | undefined): number {
  if (!Array.isArray(entries)) return 0;
  return entries.reduce((sum, e) => sum + (typeof e.minutes === 'number' && !isNaN(e.minutes) ? e.minutes : 0), 0);
}

/** Formats a minute count as "H:MM" (e.g. 975 -> "16:15"). */
export function formatHoursLogDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Formats an entry's logged-at timestamp as "dd.mm.yyyy HH:MM". */
export function formatHoursLogTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
