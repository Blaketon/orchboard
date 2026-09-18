// Types for the HTTP API, shared by the server and the browser code. Type-only on purpose:
// nothing here exists at runtime, so the browser never has to load this file.

import type { CodexPermissionMode, PermissionMode } from './permission-modes.ts';

export type AgentState = 'working' | 'blocked' | 'done';

/** Which coding agent runs a task. */
export type AgentProvider = 'claude' | 'codex';

/** `POST /api/tasks`. */
export interface StartTaskRequest {
  /** Defaults to Claude Code. */
  readonly provider?: AgentProvider;
  /** Absolute path of the project folder to run the agent in. */
  readonly cwd: string;
  readonly prompt: string;
  /** Defaults to the prompt's first line. */
  readonly name?: string;
  /** A Claude Code mode, or a Codex mode for Codex tasks. */
  readonly permissionMode?: PermissionMode | CodexPermissionMode;
  /** Model to run the task with, e.g. `opus`. Unset means the agent's own default. */
  readonly model?: string;
  /** Ids of uploaded attachments the agent should look at. */
  readonly images?: readonly string[];
}

export interface StartTaskResponse {
  /** The new agent's id, when the CLI reported one. */
  readonly id: string | null;
}

/** `POST /api/agents/:id/reply`. */
export interface ReplyRequest {
  readonly prompt: string;
}

/** Something a running Codex task needs the user to decide before it continues. */
export interface Approval {
  readonly id: string;
  readonly kind: 'command' | 'fileChange' | 'permissions' | 'question';
  /** Short heading, e.g. "Run a command". */
  readonly title: string;
  /** What exactly is asked: the command, the files, the permissions, or the question. */
  readonly detail: string;
  readonly reason: string | null;
  /** Whether "allow for the rest of the session" can be chosen. */
  readonly canAllowForSession: boolean;
  /** Orchboard can't answer this kind of request, only decline it. */
  readonly declineOnly: boolean;
}

export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline';

/** `POST /api/agents/:id/approvals/:approvalId`. */
export interface ApprovalRequest {
  readonly decision: ApprovalDecision;
}

/** A project the user added to the sidebar. */
export interface SavedProject {
  /** Normalized project path (see `projectKey`). */
  readonly path: string;
  /** Custom display name, or null to use the folder name. */
  readonly label: string | null;
  /** Pinned projects come first in the sidebar. Missing in projects saved by older versions. */
  readonly pinned?: boolean;
}

/** An entry of `GET /api/projects`. */
export interface SavedProjectView extends SavedProject {
  /** False when the folder has since been moved or deleted. */
  readonly exists: boolean;
}

/** A folder inside the one being browsed. */
export interface FolderEntry {
  readonly name: string;
  /** Absolute path. */
  readonly path: string;
  /** True when the folder is a git repository, as projects usually are. */
  readonly repository: boolean;
}

/** `GET /api/folders?path=`: the folders inside a folder, for picking a project. */
export interface FolderListing {
  /** Absolute path of the folder listed; the home folder when none was asked for. */
  readonly path: string;
  /** Its parent folder, or null at the top of a drive. */
  readonly parent: string | null;
  /** Sorted by name. Hidden folders are left out. */
  readonly folders: readonly FolderEntry[];
  /** True when the folder had more subfolders than are listed. */
  readonly truncated: boolean;
  /** Where browsing can start over: the home folder and the drives (or `/`). */
  readonly roots: readonly string[];
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
  /** Missing in queues saved by older versions, which only ran Claude Code. */
  readonly provider?: AgentProvider;
  /** Folder the agent will run in; the column's project unless changed. */
  readonly cwd: string;
  readonly prompt: string;
  readonly permissionMode: PermissionMode | CodexPermissionMode;
  /** Model for the task, as in `StartTaskRequest.model`. */
  readonly model?: string;
  /** Attachment ids, as in `StartTaskRequest.images`. Missing in queues saved by older versions. */
  readonly images?: readonly string[];
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

/** A model the task form offers. */
export interface ModelOption {
  /** Name passed to the agent, e.g. `opus` or `gpt-5.5`. */
  readonly value: string;
  readonly label: string;
}

/** `GET /api/models/:provider`. */
export interface AgentModels {
  /** The model the agent runs when none is chosen, from its own settings; null when unknown. */
  readonly default: string | null;
  readonly options: readonly ModelOption[];
}

/** `GET /api/queue`. Columns and tasks are listed in display order. */
export interface QueueState {
  readonly columns: readonly QueueColumn[];
  readonly tasks: readonly QueuedTask[];
}

/**
 * A coding agent on the board: a Claude Code background agent from `claude agents --json --all`,
 * or a Codex task that Orchboard runs.
 */
export interface Agent {
  readonly id: string;
  readonly provider: AgentProvider;
  /** Claude Code session id, or Codex thread id. */
  readonly sessionId: string;
  readonly name: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly state: AgentState;
  /** Process ID while the agent's process is alive; null once it has exited. */
  readonly pid: number | null;
  /** Codex requests waiting for a decision. Claude Code agents ask in their terminal instead. */
  readonly approvals?: readonly Approval[];
  /** Why the last turn failed, when known. */
  readonly error?: string | null;
}

/** `GET /api/agents` and each `agents` event on `GET /api/events`. */
export interface AgentSnapshot {
  readonly agents: readonly Agent[];
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

/** Agent instruction files a project can have: Claude Code reads CLAUDE.md, Codex reads AGENTS.md. */
export type ProjectDocName = 'CLAUDE.md' | 'AGENTS.md';

export interface ProjectDoc {
  readonly name: ProjectDocName;
  readonly exists: boolean;
  readonly content: string;
  /** The file's modification time, sent back when saving to detect edits made elsewhere. */
  readonly modifiedAt: number | null;
}

/** `GET /api/projects/docs?path=`. */
export interface ProjectDocs {
  readonly path: string;
  readonly files: ProjectDoc[];
}

/** `PUT /api/projects/docs`. Responds with the saved `ProjectDoc`. */
export interface SaveProjectDocRequest {
  readonly path: string;
  readonly name: ProjectDocName;
  readonly content: string;
  /** The `modifiedAt` the edit started from; null when the file didn't exist. */
  readonly expectedModifiedAt: number | null;
}

/** `GET /api/skills`: one installed skill. */
export interface Skill {
  readonly name: string;
  readonly description: string;
  readonly source: 'Claude' | 'Codex';
  /** Folder holding the skill's SKILL.md. */
  readonly path: string;
  /** Bundled with the tool rather than installed by the user. */
  readonly system: boolean;
}

/** `POST /api/attachments` (raw image body): an image saved for a task prompt. */
export interface Attachment {
  /** Pass in `StartTaskRequest.images`; the image is served at `/api/attachments/:id`. */
  readonly id: string;
}
