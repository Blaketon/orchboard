import type { Agent, AgentProvider, AgentState, SavedProject } from '../shared/api.ts';
import { projectKey, projectLabel } from '../shared/projects.ts';

export { projectKey, projectLabel };

export interface Project {
  /** Normalized repository path; worktrees count as their main repository. */
  readonly key: string;
  /** Display name: a saved label, else the folder name (plus its parent if names clash). */
  readonly label: string;
  readonly count: number;
  /** True when the user added the project, so it can be renamed or removed. */
  readonly saved: boolean;
}

export const AGENT_LABELS: Readonly<Record<AgentProvider, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

export const BOARD_COLUMNS: readonly { readonly state: AgentState; readonly title: string }[] = [
  { state: 'blocked', title: 'Awaiting input' },
  { state: 'working', title: 'Working' },
  { state: 'done', title: 'Completed' },
];

/** Projects from the agents on the board plus the ones the user saved, even without agents. */
export function listProjects(
  agents: readonly Agent[],
  saved: readonly SavedProject[] = [],
): Project[] {
  const counts = new Map<string, number>();
  for (const project of saved) counts.set(projectKey(project.path), 0);
  for (const agent of agents) {
    const key = projectKey(agent.cwd);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const savedLabels = new Map(saved.map((project) => [projectKey(project.path), project.label]));

  // Two repositories with the same folder name get their parent folder added to tell them apart.
  const nameCounts = new Map<string, number>();
  for (const key of counts.keys()) {
    const name = projectLabel(key);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return [...counts]
    .map(([key, count]) => {
      const name = projectLabel(key);
      const fallback =
        (nameCounts.get(name) ?? 0) > 1 ? key.split('/').filter(Boolean).slice(-2).join('/') : name;
      return {
        key,
        label: savedLabels.get(key) ?? fallback,
        count,
        saved: savedLabels.has(key),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface AgentFilter {
  /** Project key, or null for all projects. */
  readonly project: string | null;
  readonly query: string;
}

export function filterAgents(agents: readonly Agent[], filter: AgentFilter): Agent[] {
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
export function groupByState(agents: readonly Agent[]): Record<AgentState, Agent[]> {
  const groups: Record<AgentState, Agent[]> = { blocked: [], working: [], done: [] };
  for (const agent of agents) groups[agent.state].push(agent);
  for (const group of Object.values(groups)) group.sort((a, b) => b.startedAt - a.startedAt);
  return groups;
}
