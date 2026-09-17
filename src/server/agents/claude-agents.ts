import type { AgentState, Agent } from '../../shared/api.ts';
import { ClaudeCliMissingError, errorCode, runClaude, type RunClaude } from './claude-cli.ts';

export type { AgentState, Agent };
export { ClaudeCliMissingError };

export const AGENT_STATES: readonly AgentState[] = ['working', 'blocked', 'done'];

export interface ParseResult {
  readonly agents: Agent[];
  /** Why entries were skipped, e.g. an unrecognized state from a newer Claude Code. */
  readonly skipped: string[];
}

export interface ListOptions {
  readonly run?: RunClaude;
  readonly isPidAlive?: (pid: number) => boolean;
}

export const AGENTS_COMMAND_ARGS = ['agents', '--json', '--all'] as const;

export async function listClaudeAgents(options: ListOptions = {}): Promise<ParseResult> {
  const run = options.run ?? runClaude;
  const isAlive = options.isPidAlive ?? isPidAlive;

  let output: string;
  try {
    output = await run(AGENTS_COMMAND_ARGS, { fixedArgs: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw new ClaudeCliMissingError();
    throw error;
  }

  const result = parseAgents(output);
  return {
    // A crashed agent can keep its old pid in the CLI's list; don't report it as running.
    agents: result.agents.map((agent) =>
      agent.pid !== null && !isAlive(agent.pid) ? { ...agent, pid: null } : agent,
    ),
    skipped: result.skipped,
  };
}

export function parseAgents(output: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    throw new Error('`claude agents --json` did not return valid JSON.');
  }
  if (!Array.isArray(data)) {
    throw new Error('`claude agents --json` did not return a list.');
  }

  const agents: Agent[] = [];
  const skipped: string[] = [];
  data.forEach((entry: unknown, index) => {
    if (!isRecord(entry)) {
      skipped.push(`entry ${index} is not an object`);
      return;
    }
    // Interactive terminal sessions aren't agents the board manages.
    if (entry.kind !== 'background') return;

    const { id, sessionId, name, cwd, startedAt, state, pid } = entry;
    if (
      typeof id !== 'string' ||
      typeof sessionId !== 'string' ||
      typeof name !== 'string' ||
      typeof cwd !== 'string' ||
      typeof startedAt !== 'number'
    ) {
      skipped.push(`entry ${index} is missing required fields`);
      return;
    }
    if (!isAgentState(state)) {
      skipped.push(`entry ${index} has unrecognized state ${JSON.stringify(state)}`);
      return;
    }
    agents.push({
      id,
      provider: 'claude',
      sessionId,
      name,
      cwd,
      startedAt,
      state,
      pid: typeof pid === 'number' ? pid : null,
    });
  });
  return { agents, skipped };
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return errorCode(error) === 'EPERM';
  }
}

function isAgentState(value: unknown): value is AgentState {
  return (AGENT_STATES as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
