import type { AgentState, ClaudeAgent } from '../shared/api.ts';

export interface Project {
  /** Normalized repository path; worktrees count as their main repository. */
  readonly key: string;
  /** Short display name: the last two path segments. */
  readonly label: string;
  readonly count: number;
}

export const BOARD_COLUMNS: readonly { readonly state: AgentState; readonly title: string }[] = [
  { state: 'blocked', title: 'Awaiting input' },
  { state: 'working', title: 'Working' },
  { state: 'done', title: 'Completed' },
];

/** Groups `C:\repo` and `C:\repo\.claude\worktrees\fix` under one project. */
export function projectKey(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  const worktree = normalized.indexOf('/.claude/worktrees/');
  return worktree === -1 ? normalized : normalized.slice(0, worktree);
}

/** The repository folder name, e.g. `storefront` for `C:/Git/acme/storefront`. */
export function projectLabel(key: string): string {
  return key.split('/').filter(Boolean).at(-1) ?? key;
}

export function listProjects(agents: readonly ClaudeAgent[]): Project[] {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const key = projectKey(agent.cwd);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Two repositories with the same folder name get their parent folder added to tell them apart.
  const nameCounts = new Map<string, number>();
  for (const key of counts.keys()) {
    const name = projectLabel(key);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return [...counts]
    .map(([key, count]) => {
      const name = projectLabel(key);
      const label =
        (nameCounts.get(name) ?? 0) > 1 ? key.split('/').filter(Boolean).slice(-2).join('/') : name;
      return { key, label, count };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface AgentFilter {
  /** Project key, or null for all projects. */
  readonly project: string | null;
  readonly query: string;
}

export function filterAgents(agents: readonly ClaudeAgent[], filter: AgentFilter): ClaudeAgent[] {
  const query = filter.query.trim().toLowerCase();
  return agents.filter((agent) => {
    const key = projectKey(agent.cwd);
    if (filter.project !== null && key !== filter.project) return false;
    if (!query) return true;
    // Matching the whole path lets "acme/api" find a project as well as "api".
    return agent.name.toLowerCase().includes(query) || key.toLowerCase().includes(query);
  });
}

/** Buckets agents by state, newest first within each bucket. */
export function groupByState(agents: readonly ClaudeAgent[]): Record<AgentState, ClaudeAgent[]> {
  const groups: Record<AgentState, ClaudeAgent[]> = { blocked: [], working: [], done: [] };
  for (const agent of agents) groups[agent.state].push(agent);
  for (const group of Object.values(groups)) group.sort((a, b) => b.startedAt - a.startedAt);
  return groups;
}
