import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface JsonStoreOptions<T> {
  /** Value used when the file doesn't exist yet or had to be set aside. */
  readonly fallback: () => T;
  /** Checks that parsed file contents have the expected shape. */
  readonly validate: (value: unknown) => value is T;
  /** Receives a message when a damaged file is set aside. Defaults to console.warn. */
  readonly onWarning?: (message: string) => void;
}

/**
 * One JSON value persisted in one file.
 *
 * Writes are atomic (fsynced temp file, then rename), so a crash never leaves a half-written
 * file. Every operation runs through a single queue, so concurrent updates can't overwrite
 * each other. A file that can't be parsed or has the wrong shape is renamed to
 * `<file>.corrupt-<timestamp>` instead of being silently overwritten.
 */
export class JsonStore<T> {
  readonly #file: string;
  readonly #options: JsonStoreOptions<T>;
  #pending: Promise<unknown> = Promise.resolve();

  constructor(file: string, options: JsonStoreOptions<T>) {
    this.#file = file;
    this.#options = options;
  }

  get file(): string {
    return this.#file;
  }

  read(): Promise<T> {
    return this.#enqueue(() => this.#load());
  }

  write(value: T): Promise<void> {
    return this.#enqueue(() => this.#save(value));
  }

  update(change: (current: T) => T | Promise<T>): Promise<T> {
    return this.#enqueue(async () => {
      const next = await change(await this.#load());
      await this.#save(next);
      return next;
    });
  }

  #enqueue<R>(task: () => Promise<R>): Promise<R> {
    const result = this.#pending.then(task);
    this.#pending = result.catch(() => undefined);
    return result;
  }

  async #load(): Promise<T> {
    let text: string;
    try {
      text = await fs.readFile(this.#file, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return this.#options.fallback();
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return this.#setAside('is not valid JSON');
    }
    return this.#options.validate(value) ? value : this.#setAside('has an unexpected format');
  }

  async #setAside(reason: string): Promise<T> {
    const backup = `${this.#file}.corrupt-${Date.now()}`;
    await fs.rename(this.#file, backup);
    const warn = this.#options.onWarning ?? console.warn;
    warn(`${this.#file} ${reason}. Moved it to ${backup} and started fresh.`);
    return this.#options.fallback();
  }

  async #save(value: T): Promise<void> {
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    const temp = `${this.#file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, 'w');
      try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await renameWithRetry(temp, this.#file);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }
}

// On Windows, antivirus scanners and indexers briefly lock files, making a rename fail with
// EPERM/EBUSY/EACCES even though retrying a moment later succeeds.
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      if (attempt >= attempts || code === undefined || !RETRYABLE_RENAME_CODES.has(code)) {
        throw error;
      }
      await sleep(attempt * 20);
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}
