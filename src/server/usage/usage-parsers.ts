import type { UsageWindow } from '../../shared/api.ts';
import { isRecord } from '../http-error.ts';

/** Maps Claude's OAuth usage response to the windows the dashboard shows. */
export function parseClaudeUsage(data: unknown): UsageWindow[] {
  if (!isRecord(data)) return [];
  const windows: UsageWindow[] = [];
  const add = (key: string, id: string, label: string) => {
    const window = data[key];
    if (!isRecord(window) || typeof window.utilization !== 'number') return;
    windows.push({
      id,
      label,
      utilization: clampPercent(window.utilization),
      resetsAt: typeof window.resets_at === 'string' ? window.resets_at : null,
    });
  };
  add('five_hour', 'claude-session', 'Session (5h)');
  add('seven_day', 'claude-week', 'Week');
  return windows;
}

/**
 * Finds the latest rate-limit snapshot in Codex session log lines (newest last). Codex writes
 * them as `rate_limits`, either at the top level or inside `payload`.
 */
export function parseCodexRateLimits(lines: readonly string[]): UsageWindow[] | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.includes('rate_limits')) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) continue;
    const limits = isRecord(record.rate_limits)
      ? record.rate_limits
      : isRecord(record.payload) && isRecord(record.payload.rate_limits)
        ? record.payload.rate_limits
        : undefined;
    const primary = limits && codexWindow(limits.primary, 'codex-primary');
    if (!limits || !primary) continue;
    const secondary = codexWindow(limits.secondary, 'codex-secondary');
    return secondary ? [primary, secondary] : [primary];
  }
  return null;
}

function codexWindow(value: unknown, id: string): UsageWindow | null {
  if (!isRecord(value) || typeof value.used_percent !== 'number') return null;
  const minutes = typeof value.window_minutes === 'number' ? value.window_minutes : null;
  return {
    id,
    label: windowLabel(minutes),
    utilization: clampPercent(value.used_percent),
    resetsAt: resetTime(value.resets_at),
  };
}

function windowLabel(minutes: number | null): string {
  if (minutes === null) return 'Limit';
  if (minutes === 10_080) return 'Week';
  if (minutes % 60 === 0) return `Session (${minutes / 60}h)`;
  return `${minutes} min`;
}

/** Codex reports resets as epoch seconds or ISO strings. */
function resetTime(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value;
  return null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
