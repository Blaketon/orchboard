// Types for the HTTP API, shared by the server and the browser code. Type-only on purpose:
// nothing here exists at runtime, so the browser never has to load this file.

import type { PermissionMode } from './permission-modes.ts';

export type AgentState = 'working' | 'blocked' | 'done';

/** `POST /api/tasks`. */
export interface StartTaskRequest {
  /** Absolute path of the project folder to run the agent in. */
  readonly cwd: string;
  readonly prompt: string;
  /** Defaults to the prompt's first line. */
  readonly name?: string;
  readonly permissionMode?: PermissionMode;
}

export interface StartTaskResponse {
  /** The new agent's id, when the CLI reported one. */
  readonly id: string | null;
}

/** `POST /api/agents/:id/reply`. */
export interface ReplyRequest {
  readonly prompt: string;
}

/** A project the user added to the sidebar. */
export interface SavedProject {
  /** Normalized project path (see `projectKey`). */
  readonly path: string;
  /** Custom display name, or null to use the folder name. */
  readonly label: string | null;
}

/** An entry of `GET /api/projects`. */
export interface SavedProjectView extends SavedProject {
  /** False when the folder has since been moved or deleted. */
  readonly exists: boolean;
}

/** A user-defined column of planned tasks, shown on the board next to a project's agents. */
export interface QueueColumn {
  readonly id: string;
  /** Project key the column belongs to. */
  readonly project: string;
  readonly name: string;
}

/** A task waiting in a queue column until the user starts it. */
export interface QueuedTask {
  readonly id: string;
  readonly columnId: string;
  readonly name: string;
  /** Folder the agent will run in; the column's project unless changed. */
  readonly cwd: string;
  readonly prompt: string;
  readonly permissionMode: PermissionMode;
  readonly createdAt: number;
}

/** One rate-limit window, e.g. Claude's 5-hour session limit. */
export interface UsageWindow {
  readonly id: string;
  readonly label: string;
  /** Percent of the limit used, 0 to 100. */
  readonly utilization: number;
  /** ISO timestamp when the window resets, if known. */
  readonly resetsAt: string | null;
}

export interface UsageSource {
  readonly windows: readonly UsageWindow[];
  /** Why usage is unavailable, e.g. not logged in. Windows from an earlier success are kept. */
  readonly error: string | null;
}

/** `GET /api/usage`. */
export interface UsageReport {
  readonly claude: UsageSource;
  readonly codex: UsageSource;
}

/** `GET /api/queue`. Columns and tasks are listed in display order. */
export interface QueueState {
  readonly columns: readonly QueueColumn[];
  readonly tasks: readonly QueuedTask[];
}

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

/** `GET /api/agents` and each `agents` event on `GET /api/events`. */
export interface AgentSnapshot {
  readonly agents: readonly ClaudeAgent[];
  /** Why the latest poll failed, or null. Agents from the last successful poll are kept. */
  readonly error: string | null;
  /** When the agents or error last changed. */
  readonly updatedAt: number;
}

export type TranscriptPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool_call';
      readonly id: string;
      readonly name: string;
      readonly summary: string;
    }
  | {
      readonly type: 'tool_result';
      readonly toolUseId: string;
      readonly text: string;
      readonly isError: boolean;
    };

export interface TranscriptEntry {
  readonly role: 'user' | 'assistant';
  /** ISO timestamp of the first line in the entry. */
  readonly timestamp: string;
  readonly parts: readonly TranscriptPart[];
}

export interface TokenTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
}

export interface SessionUsage {
  readonly tokens: TokenTotals;
  /** Tokens sent with the latest main-conversation request: how full the context window is. */
  readonly contextTokens: number;
  readonly contextWindow: number;
  /** Model of the latest response, e.g. `claude-opus-5`. */
  readonly model: string | null;
  /** Claude Code's own running cost record for the session, in USD. Null until it writes one. */
  readonly costUsd: number | null;
  /** True when the session has done more work since Claude Code last recorded its cost. */
  readonly costIsPartial: boolean;
}

/** `GET /api/agents/:id/transcript`. */
export interface Transcript {
  readonly entries: TranscriptEntry[];
  /** Null when the session hasn't written a transcript yet. */
  readonly usage: SessionUsage | null;
}
