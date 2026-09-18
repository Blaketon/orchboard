import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentModels, AgentProvider, ModelOption } from '../../shared/api.ts';
import { isModelName } from '../agents/task-request.ts';
import {
  connectAppServer,
  spawnAppServer,
  type AppServerProcess,
  type SpawnAppServer,
} from '../codex/app-server.ts';
import { isRecord } from '../http-error.ts';

/** Claude Code's model aliases, which always point at the newest model of each family. */
export const CLAUDE_MODELS: readonly ModelOption[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
];

/** Listing Codex models means starting Codex, so the answer is kept this long. */
export const CODEX_MODELS_CACHE_MS = 5 * 60_000;
const CODEX_TIMEOUT_MS = 15_000;
const MAX_CODEX_PAGES = 5;

const NO_MODELS: AgentModels = { default: null, options: [] };

type Env = Readonly<Record<string, string | undefined>>;

export interface ModelServiceOptions {
  readonly claudeDir: string;
  readonly env?: Env;
  readonly spawn?: SpawnAppServer;
  /** Where Codex is started to list its models. Defaults to the home folder. */
  readonly codexCwd?: string;
  readonly now?: () => number;
}

/** The models each agent can run, and the one it runs when the task doesn't choose. */
export class ModelService {
  readonly #options: ModelServiceOptions;
  #codex: AgentModels = NO_MODELS;
  #codexLoadedAt = -Infinity;
  #codexPending: Promise<void> | undefined;

  constructor(options: ModelServiceOptions) {
    this.#options = options;
  }

  async models(provider: AgentProvider): Promise<AgentModels> {
    if (provider === 'codex') return this.#codexModels();
    return {
      default: await claudeDefaultModel(this.#options.claudeDir, this.#options.env ?? process.env),
      options: CLAUDE_MODELS,
    };
  }

  async #codexModels(): Promise<AgentModels> {
    const now = (this.#options.now ?? Date.now)();
    if (now - this.#codexLoadedAt >= CODEX_MODELS_CACHE_MS) {
      this.#codexPending ??= readCodexModels(
        this.#options.spawn ?? spawnAppServer,
        this.#options.codexCwd ?? os.homedir(),
      )
        .then((models) => {
          this.#codex = models;
        })
        // Without Codex the form still offers its default, so a failure keeps the last answer.
        .catch(() => undefined)
        .finally(() => {
          this.#codexLoadedAt = now;
          this.#codexPending = undefined;
        });
      await this.#codexPending;
    }
    return this.#codex;
  }
}

/**
 * The model Claude Code runs without `--model`: `ANTHROPIC_MODEL`, then `model` in its user
 * settings. Null when neither is set and Claude Code picks one for the account.
 */
export async function claudeDefaultModel(claudeDir: string, env: Env): Promise<string | null> {
  const fromEnv = env.ANTHROPIC_MODEL?.trim();
  if (fromEnv) return fromEnv;
  let settings: unknown;
  try {
    settings = JSON.parse(await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8'));
  } catch {
    return null;
  }
  const model = isRecord(settings) && typeof settings.model === 'string' ? settings.model : '';
  return model.trim() || null;
}

/** Asks a short-lived `codex app-server` for its models and the one its config selects. */
export async function readCodexModels(spawn: SpawnAppServer, cwd: string): Promise<AgentModels> {
  let child: AppServerProcess | undefined;
  // Ending the process rejects any request still waiting, so a stuck Codex can't hang the form.
  const timer = setTimeout(() => child?.kill(), CODEX_TIMEOUT_MS);
  try {
    const client = await connectAppServer(
      cwd,
      { onNotification: () => undefined, onRequest: () => undefined, onExit: () => undefined },
      (dir) => {
        child = spawn(dir);
        return child;
      },
    );
    try {
      const pages: unknown[] = [];
      let cursor: string | null = null;
      do {
        const page: unknown = await client.request('model/list', cursor === null ? {} : { cursor });
        pages.push(page);
        cursor = isRecord(page) && typeof page.nextCursor === 'string' ? page.nextCursor : null;
      } while (cursor !== null && pages.length < MAX_CODEX_PAGES);
      // Older versions can't read their config; the listed default is the next best answer.
      const config = await client.request('config/read', {}).catch(() => null);
      return parseCodexModels(pages, config);
    } finally {
      client.close(0);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turns `model/list` pages and a `config/read` result into the form's choices. The `model` set
 * in Codex config wins over the model Codex marks as its own default.
 */
export function parseCodexModels(pages: readonly unknown[], config: unknown): AgentModels {
  const options: ModelOption[] = [];
  let listedDefault: string | null = null;
  for (const page of pages) {
    const data = isRecord(page) && Array.isArray(page.data) ? (page.data as unknown[]) : [];
    for (const item of data) {
      if (!isRecord(item)) continue;
      const value =
        typeof item.model === 'string' ? item.model : typeof item.id === 'string' ? item.id : '';
      if (!isModelName(value)) continue;
      if (item.isDefault === true) listedDefault ??= value;
      if (item.hidden === true || options.some((option) => option.value === value)) continue;
      const label = typeof item.displayName === 'string' ? item.displayName.trim() : '';
      options.push({ value, label: label || value });
    }
  }
  const settings = isRecord(config) && isRecord(config.config) ? config.config : {};
  const configured = typeof settings.model === 'string' ? settings.model.trim() : '';
  return { default: configured || listedDefault, options };
}
