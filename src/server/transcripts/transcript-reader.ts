import fs from 'node:fs/promises';
import path from 'node:path';
import { TranscriptUsageTracker, type SessionUsage } from './session-usage.ts';
import { parseTranscript, type TranscriptEntry } from './transcript-parser.ts';

/** Transcripts can grow to many megabytes; only the most recent part is ever displayed. */
export const MAX_TAIL_BYTES = 2 * 1024 * 1024;

const SESSION_ID = /^[A-Za-z0-9-]+$/;

/** Claude Code's project folder name for a working directory: every non-alphanumeric character becomes `-`. */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export interface Transcript {
  readonly entries: TranscriptEntry[];
  /** Null when the session hasn't written a transcript yet. */
  readonly usage: SessionUsage | null;
}

export interface TranscriptSource {
  read(session: { cwd: string; sessionId: string }): Promise<Transcript>;
}

export class TranscriptReader implements TranscriptSource {
  readonly #projectsDir: string;
  readonly #locations = new Map<string, string>();
  readonly #usageTrackers = new Map<string, TranscriptUsageTracker>();

  /** @param claudeDir Claude Code's config directory, usually `~/.claude`. */
  constructor(claudeDir: string) {
    this.#projectsDir = path.join(claudeDir, 'projects');
  }

  /** Returns the latest entries and usage totals; empty if the session hasn't written a transcript yet. */
  async read(session: { cwd: string; sessionId: string }): Promise<Transcript> {
    const file = await this.locate(session);
    if (!file) return { entries: [], usage: null };

    let tracker = this.#usageTrackers.get(file);
    if (!tracker) {
      tracker = new TranscriptUsageTracker(file);
      this.#usageTrackers.set(file, tracker);
    }
    const [lines, usage] = await Promise.all([readTailLines(file), tracker.read()]);
    return { entries: parseTranscript(lines), usage };
  }

  /**
   * Finds `<sessionId>.jsonl`. It normally lives in the folder for the agent's working directory,
   * but an agent that moved into a git worktree writes it under the worktree's folder instead,
   * so fall back to searching every project folder.
   */
  async locate({
    cwd,
    sessionId,
  }: {
    cwd: string;
    sessionId: string;
  }): Promise<string | undefined> {
    if (!SESSION_ID.test(sessionId)) throw new Error(`Invalid session id: ${sessionId}`);
    const fileName = `${sessionId}.jsonl`;

    const cached = this.#locations.get(sessionId);
    if (cached && (await exists(cached))) return cached;

    const candidates = [path.join(this.#projectsDir, encodeProjectDir(cwd), fileName)];
    for (const dir of await listDirs(this.#projectsDir)) {
      candidates.push(path.join(this.#projectsDir, dir, fileName));
    }
    for (const candidate of candidates) {
      if (await exists(candidate)) {
        this.#locations.set(sessionId, candidate);
        return candidate;
      }
    }
    return undefined;
  }
}

/** Reads the last `maxBytes` of a file as lines, dropping a first line that was cut in half. */
export async function readTailLines(file: string, maxBytes = MAX_TAIL_BYTES): Promise<string[]> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);

    let bytes = buffer;
    if (start > 0) {
      // Newline bytes never occur inside multi-byte UTF-8 characters, so cutting after the
      // first one also avoids decoding half a character.
      const newline = buffer.indexOf(0x0a);
      bytes = newline === -1 ? Buffer.alloc(0) : buffer.subarray(newline + 1);
    }
    return bytes.toString('utf8').split('\n');
  } finally {
    await handle.close();
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
