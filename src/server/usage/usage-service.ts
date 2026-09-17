import fs from 'node:fs/promises';
import path from 'node:path';
import type { UsageReport, UsageSource, UsageWindow } from '../../shared/api.ts';
import { isRecord } from '../http-error.ts';
import { readTailLines } from '../transcripts/transcript-reader.ts';
import { parseClaudeUsage, parseCodexRateLimits } from './usage-parsers.ts';

export const USAGE_CACHE_MS = 60_000;
const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const MAX_CODEX_FILES = 50;

export interface UsageServiceOptions {
  readonly claudeDir: string;
  readonly codexDir: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

/** Plan limits for Claude (from Anthropic's usage API) and Codex (from its session logs), cached briefly. */
export class UsageService {
  readonly #options: UsageServiceOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #claude = new CachedSource(() => this.#loadClaude());
  #codex = new CachedSource(() => this.#loadCodex());

  constructor(options: UsageServiceOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async report(): Promise<UsageReport> {
    const now = this.#now();
    const [claude, codex] = await Promise.all([this.#claude.get(now), this.#codex.get(now)]);
    return { claude, codex };
  }

  async #loadClaude(): Promise<UsageWindow[]> {
    const token = await readClaudeToken(this.#options.claudeDir);
    // The token is only ever sent to Anthropic; it never reaches the browser.
    const response = await this.#fetch(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Claude usage request failed (HTTP ${response.status}).`);
    return parseClaudeUsage(await response.json());
  }

  async #loadCodex(): Promise<UsageWindow[]> {
    const files = await newestJsonlFiles(
      path.join(this.#options.codexDir, 'sessions'),
      MAX_CODEX_FILES,
    );
    for (const file of files) {
      const windows = parseCodexRateLimits(await readTailLines(file));
      if (windows) return windows;
    }
    throw new Error('No Codex usage recorded yet.');
  }
}

/** Serves a cached value for a while and keeps the last good value when a refresh fails. */
class CachedSource {
  readonly #load: () => Promise<UsageWindow[]>;
  #windows: UsageWindow[] = [];
  #error: string | null = null;
  #loadedAt = -Infinity;
  #pending: Promise<void> | undefined;

  constructor(load: () => Promise<UsageWindow[]>) {
    this.#load = load;
  }

  async get(now: number): Promise<UsageSource> {
    if (now - this.#loadedAt >= USAGE_CACHE_MS) {
      this.#pending ??= this.#load()
        .then((windows) => {
          this.#windows = windows;
          this.#error = null;
        })
        .catch((error: unknown) => {
          this.#error = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          this.#loadedAt = now;
          this.#pending = undefined;
        });
      await this.#pending;
    }
    return { windows: this.#windows, error: this.#error };
  }
}

async function readClaudeToken(claudeDir: string): Promise<string> {
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(path.join(claudeDir, '.credentials.json'), 'utf8'));
  } catch {
    // macOS keeps Claude Code credentials in the Keychain instead of this file.
    throw new Error(
      'Claude plan limits need a Claude Code login stored in ~/.claude/.credentials.json.',
    );
  }
  const oauth = isRecord(data) ? data.claudeAiOauth : undefined;
  if (!isRecord(oauth) || typeof oauth.accessToken !== 'string' || !oauth.accessToken) {
    throw new Error('Not logged in to Claude Code.');
  }
  return oauth.accessToken;
}

async function newestJsonlFiles(dir: string, limit: number): Promise<string[]> {
  const found: { file: string; mtimeMs: number }[] = [];
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 5) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.name.endsWith('.jsonl')) {
        try {
          found.push({ file: full, mtimeMs: (await fs.stat(full)).mtimeMs });
        } catch {
          // The file vanished while scanning.
        }
      }
    }
  };
  await walk(dir, 0);
  return found
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((entry) => entry.file);
}
