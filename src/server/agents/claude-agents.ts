import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const AGENT_STATES = ['working', 'blocked', 'done'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

/** A Claude Code background agent, as reported by `claude agents --json --all`. */
export interface ClaudeAgent {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly state: AgentState;
  /** Process ID while the agent's process is alive; null once it has exited. */
  readonly pid: number | null;
}

export interface ParseResult {
  readonly agents: ClaudeAgent[];
  /** Why entries were skipped, e.g. an unrecognized state from a newer Claude Code. */
  readonly skipped: string[];
}

export type RunCommand = (command: string, args: readonly string[]) => Promise<string>;

export interface ListOptions {
  readonly run?: RunCommand;
  readonly isPidAlive?: (pid: number) => boolean;
}

export class ClaudeCliMissingError extends Error {
  constructor() {
    super(
      'Could not find the `claude` CLI on your PATH. Install Claude Code (https://code.claude.com) and restart Orchboard.',
    );
    this.name = 'ClaudeCliMissingError';
  }
}

export const AGENTS_COMMAND_ARGS = ['agents', '--json', '--all'] as const;

export async function listClaudeAgents(options: ListOptions = {}): Promise<ParseResult> {
  const run = options.run ?? runClaude;
  const isAlive = options.isPidAlive ?? isPidAlive;

  let output: string;
  try {
    output = await run('claude', AGENTS_COMMAND_ARGS);
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

  const agents: ClaudeAgent[] = [];
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

async function runClaude(command: string, args: readonly string[]): Promise<string> {
  if (process.platform !== 'win32') return execFileText(command, args);
  try {
    // The native installer provides claude.exe, which runs without a shell.
    return await execFileText(`${command}.exe`, args);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
    // An npm install provides claude.cmd, which Windows can only start through a shell.
    // Safe here because every argument is a fixed constant.
    return execFileText(`${command}.cmd`, args, true);
  }
}

async function execFileText(file: string, args: readonly string[], shell = false): Promise<string> {
  const { stdout } = await execFileAsync(file, [...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    shell,
  });
  return stdout;
}

function isAgentState(value: unknown): value is AgentState {
  return (AGENT_STATES as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
