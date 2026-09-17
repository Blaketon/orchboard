// Types for the HTTP API, shared by the server and the browser code. Type-only on purpose:
// nothing here exists at runtime, so the browser never has to load this file.

export type AgentState = 'working' | 'blocked' | 'done';

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
