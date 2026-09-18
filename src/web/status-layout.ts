import type { AgentState } from '../shared/api.ts';

/** How the agent status columns sit on a project's board, remembered in this browser. */
export interface StatusLayout {
  /** Folds the status columns into a narrow rail of counts, leaving the width to the queue. */
  readonly collapsed: boolean;
  /** States whose agents the collapsed rail lists under their count, in board order. */
  readonly open: readonly AgentState[];
}

export const DEFAULT_STATUS_LAYOUT: StatusLayout = { collapsed: false, open: [] };

const STATES: readonly AgentState[] = ['blocked', 'working', 'done'];
const STORAGE_KEY = 'orchboard-status-layout';

/** Reads a stored layout, keeping only valid values so an old or edited entry can't break it. */
export function parseStatusLayout(raw: unknown): StatusLayout {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_STATUS_LAYOUT;
  const { collapsed, open } = raw as Record<string, unknown>;
  return {
    collapsed: collapsed === true,
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
