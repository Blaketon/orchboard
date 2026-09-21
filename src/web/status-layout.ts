import type { AgentState } from '../shared/api.ts';

/** Width of the collapsed rail, in pixels; also the floor a drag can resize down to. */
export const RAIL_WIDTH = 240;
/** Widest the status columns can be dragged out to. */
export const MAX_STATUS_WIDTH = 1200;

/** How the agent status columns sit on a project's board, remembered in this browser. */
export interface StatusLayout {
  /**
   * Width of the status columns in pixels, dragged by their resize handle. `null` lets them share
   * space with the queue columns as usual. At `RAIL_WIDTH` they fold into a narrow rail of counts.
   */
  readonly width: number | null;
  /** States whose agents the collapsed rail lists under their count, in board order. */
  readonly open: readonly AgentState[];
}

export const DEFAULT_STATUS_LAYOUT: StatusLayout = { width: null, open: [] };

const STATES: readonly AgentState[] = ['blocked', 'working', 'done'];
const STORAGE_KEY = 'orchboard-status-layout';

export function clampStatusWidth(width: number): number {
  return Math.round(Math.max(RAIL_WIDTH, Math.min(width, MAX_STATUS_WIDTH)));
}

/** Whether a layout's width has been dragged all the way down to the collapsed rail. */
export function isCollapsed(layout: StatusLayout): boolean {
  return layout.width !== null && layout.width <= RAIL_WIDTH;
}

/** Reads a stored layout, keeping only valid values so an old or edited entry can't break it. */
export function parseStatusLayout(raw: unknown): StatusLayout {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_STATUS_LAYOUT;
  const { width, open } = raw as Record<string, unknown>;
  return {
    width: typeof width === 'number' && Number.isFinite(width) ? clampStatusWidth(width) : null,
    open: Array.isArray(open) ? STATES.filter((state) => open.includes(state)) : [],
  };
}

/** Lists a state's agents in the collapsed rail, or folds them back into the count. */
export function toggleOpen(layout: StatusLayout, state: AgentState): StatusLayout {
  const open = layout.open.includes(state)
    ? layout.open.filter((candidate) => candidate !== state)
    : STATES.filter((candidate) => candidate === state || layout.open.includes(candidate));
  return { ...layout, open };
}

export function loadStatusLayout(): StatusLayout {
  try {
    return parseStatusLayout(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return DEFAULT_STATUS_LAYOUT;
  }
}

export function saveStatusLayout(layout: StatusLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // The layout still applies until the page reloads.
  }
}
