const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact elapsed time: "just now", "12m", "3h 5m", "4d". */
export function formatAge(since: number, now: number): string {
  const elapsed = Math.max(0, now - since);
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    const minutes = Math.floor((elapsed % HOUR) / MINUTE);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${Math.floor(elapsed / DAY)}d`;
}

/** Elapsed time for a sentence: "just now" or "12m ago". */
export function formatAgo(since: number, now: number): string {
  const age = formatAge(since, now);
  return age === 'just now' ? age : `${age} ago`;
}

/** "950", "12.3k", "1.2M". */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${trimZero((count / 1000).toFixed(1))}k`;
  return `${trimZero((count / 1_000_000).toFixed(1))}M`;
}

/** "$0.42"; a trailing "+" marks a total that doesn't include the latest work yet. */
export function formatCost(usd: number | null, partial: boolean): string {
  if (usd === null) return '—';
  return `$${usd.toFixed(2)}${partial ? '+' : ''}`;
}

export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${Math.min(100, Math.round((part / whole) * 100))}%`;
}

/** Local clock time, e.g. "14:05". */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function trimZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}
