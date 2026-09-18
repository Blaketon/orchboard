import type { UsageReport, UsageSource, UsageWindow } from '../shared/api.ts';
import { requestJson } from './api.ts';
import { el } from './dom.ts';
import { makeDraggable } from './draggable.ts';
import { formatAge } from './format.ts';
import type { SettingsStore } from './settings-store.ts';
import { showToast } from './toast.ts';

const REFRESH_MS = 60_000;
const POSITION_KEY = 'orchboard-usage-position';
export const NEAR_LIMIT_PERCENT = 90;

export interface UsageAlert {
  readonly kind: 'near-limit' | 'reset';
  readonly message: string;
}

/**
 * Alerts for windows that just crossed 90% or just reset, compared with the previous readings.
 * The first reading of a window only sets a baseline.
 */
export function usageAlerts(
  previous: ReadonlyMap<string, number>,
  source: string,
  windows: readonly UsageWindow[],
): UsageAlert[] {
  const alerts: UsageAlert[] = [];
  for (const limit of windows) {
    const before = previous.get(limit.id);
    if (before === undefined) continue;
    const now = Math.round(limit.utilization);
    if (before < NEAR_LIMIT_PERCENT && now >= NEAR_LIMIT_PERCENT) {
      alerts.push({ kind: 'near-limit', message: `${source} ${limit.label} usage is at ${now}%` });
    } else if (before >= 10 && now < before) {
      alerts.push({
        kind: 'reset',
        message: `${source} ${limit.label} limit reset, now at ${now}%`,
      });
    }
  }
  return alerts;
}

/** Plan-limit bars in an overlay the user can drag around, refreshed every minute. */
export function createUsageWidget(container: HTMLElement, settings: SettingsStore): void {
  const previous = new Map<string, number>();
  let report: UsageReport | undefined;
  container.title = 'Drag to move, double-click to reset';
  const place = makeDraggable(container, POSITION_KEY);

  const render = () => {
    const current = settings.get();
    container.hidden = !current.showUsage || !report;
    if (container.hidden || !report) return;
    container.replaceChildren(
      ...[renderSource('Claude', report.claude), renderSource('Codex', report.codex)].filter(
        (node): node is HTMLElement => node !== null,
      ),
    );
    place();
  };

  const load = async () => {
    if (!settings.get().showUsage) return;
    try {
      report = await requestJson<UsageReport>('GET', '/api/usage');
    } catch {
      return; // The server may be restarting; try again on the next tick.
    }
    if (settings.get().usageAlerts) {
      for (const [source, data] of [
        ['Claude', report.claude],
        ['Codex', report.codex],
      ] as const) {
        for (const alert of usageAlerts(previous, source, data.windows)) {
          showToast(alert.message, alert.kind === 'near-limit' ? 'error' : 'success', {
            durationMs: settings.get().toastSeconds * 1000,
          });
        }
      }
    }
    for (const limit of [...report.claude.windows, ...report.codex.windows]) {
      previous.set(limit.id, Math.round(limit.utilization));
    }
    render();
  };

  settings.subscribe(() => {
    if (settings.get().showUsage && !report) void load();
    render();
  });
  window.setInterval(() => void load(), REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void load();
  });
}

function renderSource(name: string, source: UsageSource): HTMLElement | null {
  // Codex is optional: stay quiet when it has never been used.
  if (!source.windows.length && (name === 'Codex' || !source.error)) return null;
  const now = Date.now();
  return el('div', { className: 'usage-source' }, [
    el('h3', { className: 'usage-heading', text: name }),
    ...(source.windows.length
      ? source.windows.map((limit) => renderWindow(limit, now))
      : [el('p', { className: 'usage-error', text: source.error ?? '' })]),
  ]);
}

function renderWindow(limit: UsageWindow, now: number): HTMLElement {
  const percent = Math.round(limit.utilization);
  const fill = el('span', { className: 'usage-fill' });
  fill.style.width = `${percent}%`;
  fill.dataset.level = percent >= NEAR_LIMIT_PERCENT ? 'high' : percent >= 70 ? 'medium' : 'low';

  const resets = limit.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN;
  const title = Number.isNaN(resets)
    ? undefined
    : `Resets in ${formatAge(now, resets)} (${new Date(resets).toLocaleString()})`;

  return el('div', { className: 'usage-row', attrs: title ? { title } : {} }, [
    el('span', { className: 'usage-label', text: limit.label }),
    el('span', { className: 'usage-percent', text: `${percent}%` }),
    el('span', { className: 'usage-bar', attrs: { 'aria-hidden': 'true' } }, [fill]),
  ]);
}
