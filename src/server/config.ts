import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = '127.0.0.1';
export const DATA_DIR_NAME = '.orchboard';

export interface Config {
  readonly port: number;
  readonly host: string;
  /** Where Orchboard keeps its own state (projects, queue, archive). */
  readonly dataDir: string;
  /** Claude Code's config directory, which holds session transcripts. */
  readonly claudeDir: string;
}

type Env = Readonly<Record<string, string | undefined>>;

// Prefixed on purpose: some shells and containers export HOST as the machine's
// hostname, which would silently bind the server to the network.
export function loadConfig(env: Env = process.env, homeDir: string = os.homedir()): Config {
  return {
    port: parsePort(env.ORCHBOARD_PORT),
    host: nonBlank(env.ORCHBOARD_HOST) ?? DEFAULT_HOST,
    dataDir: resolveDir(env.ORCHBOARD_DATA_DIR, path.join(homeDir, DATA_DIR_NAME)),
    // Same variable Claude Code itself uses to relocate its config directory.
    claudeDir: resolveDir(env.CLAUDE_CONFIG_DIR, path.join(homeDir, '.claude')),
  };
}

export function parsePort(value: string | undefined): number {
  const raw = nonBlank(value);
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid ORCHBOARD_PORT "${raw}": expected an integer from 0 to 65535.`);
  }
  return port;
}

function resolveDir(value: string | undefined, fallback: string): string {
  const dir = nonBlank(value);
  return dir === undefined ? fallback : path.resolve(dir);
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}
