import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentProvider } from '../../shared/api.ts';
import {
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_PERMISSION_MODE,
  isCodexPermissionMode,
  isPermissionMode,
  type CodexPermissionMode,
  type PermissionMode,
} from '../../shared/permission-modes.ts';
import { parseAttachmentIds } from '../attachments/attachment-store.ts';
import { HttpError, isRecord } from '../http-error.ts';

export const MAX_PROMPT_CHARS = 100_000;
export const MAX_NAME_CHARS = 120;
// Model names and aliases only, so nothing odd reaches a command line or the app server.
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

/** A validated request to start a task with either agent. */
export interface TaskRequest {
  readonly provider: AgentProvider;
  readonly cwd: string;
  readonly prompt: string;
  readonly name: string;
  /** Unset means the agent's own default. */
  readonly permissionMode?: PermissionMode | CodexPermissionMode;
  /** Unset means the agent picks its configured model. */
  readonly model?: string;
  readonly images: string[];
}

export function parseTaskRequest(request: unknown): TaskRequest {
  if (!isRecord(request)) throw new HttpError(400, 'Expected a JSON object.');
  const { cwd } = request;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd.trim())) {
    throw new HttpError(400, 'Choose a project folder (an absolute path).');
  }
  const provider = parseProvider(request.provider);
  const prompt = parsePrompt(request.prompt);
  const permissionMode =
    request.permissionMode === undefined
      ? undefined
      : parsePermissionMode(provider, request.permissionMode);
  const model = parseModel(request.model);
  return {
    provider,
    cwd: cwd.trim(),
    prompt,
    name: parseName(request.name, prompt),
    images: parseAttachmentIds(request.images),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(model === undefined ? {} : { model }),
  };
}

export function parseProvider(value: unknown): AgentProvider {
  if (value === undefined || value === 'claude') return 'claude';
  if (value === 'codex') return 'codex';
  throw new HttpError(400, 'Unknown agent. Choose Claude Code or Codex.');
}

export function parsePermissionMode(
  provider: AgentProvider,
  value: unknown,
): PermissionMode | CodexPermissionMode {
  if (value === undefined) {
    return provider === 'codex' ? DEFAULT_CODEX_PERMISSION_MODE : DEFAULT_PERMISSION_MODE;
  }
  const valid = provider === 'codex' ? isCodexPermissionMode(value) : isPermissionMode(value);
  if (!valid) throw new HttpError(400, 'Unknown permission mode.');
  return value as PermissionMode | CodexPermissionMode;
}

/** A model name or alias, e.g. `opus` or `claude-opus-5`. Blank means the agent's default. */
export function parseModel(value: unknown): string | undefined {
  const model = typeof value === 'string' ? value.trim() : '';
  if (!model) return undefined;
  if (!MODEL_NAME.test(model)) throw new HttpError(400, `Unknown model name: ${model}`);
  return model;
}

export function parsePrompt(value: unknown): string {
  const prompt = typeof value === 'string' ? value.trim() : '';
  if (!prompt) throw new HttpError(400, 'Write a prompt for the agent.');
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new HttpError(
      400,
      `Prompts can be at most ${MAX_PROMPT_CHARS.toLocaleString('en')} characters.`,
    );
  }
  return prompt;
}

export function parseName(value: unknown, prompt: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length > MAX_NAME_CHARS) {
    throw new HttpError(400, `Task names can be at most ${MAX_NAME_CHARS} characters.`);
  }
  return name || defaultName(prompt);
}

/** The prompt's first line, shortened, so every task gets a readable name. */
export function defaultName(prompt: string): string {
  const firstLine = prompt.split('\n').find((line) => line.trim()) ?? prompt;
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed;
}

export async function assertDirectory(dir: string): Promise<void> {
  try {
    if ((await fs.stat(dir)).isDirectory()) return;
  } catch {
    // Fall through to the error below.
  }
  throw new HttpError(400, `Folder not found: ${dir}`);
}
