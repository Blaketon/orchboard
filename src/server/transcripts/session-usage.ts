import fs from 'node:fs/promises';
import type { SessionUsage, TokenTotals } from '../../shared/api.ts';

export type { SessionUsage, TokenTotals };

export const STANDARD_CONTEXT_WINDOW = 200_000;
export const EXTENDED_CONTEXT_WINDOW = 1_000_000;

/**
 * Accumulates token usage and cost from transcript lines, in order.
 *
 * Claude Code repeats the same `usage` on every line of a multi-block assistant response, so
 * responses are counted once per message id. Cost comes from the `cost-state` lines Claude Code
 * writes when a turn ends; each one holds the session's running total, so the latest wins.
 */
export class UsageAccumulator {
  #input = 0;
  #output = 0;
  #cacheCreation = 0;
  #cacheRead = 0;
  #contextTokens = 0;
  #model: string | null = null;
  #costUsd: number | null = null;
  #workSinceCost = false;
  readonly #seenMessageIds = new Set<string>();
  readonly #extendedContextModels = new Set<string>();

  addLine(line: string): void {
    if (!line.trim()) return;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(record)) return;

    if (record.type === 'cost-state') {
      this.#addCostState(record);
    } else if (record.type === 'assistant' && isRecord(record.message)) {
      this.#addResponse(record.message, record.isSidechain === true);
    }
  }

  snapshot(): SessionUsage {
    const extended =
      (this.#model !== null && this.#extendedContextModels.has(this.#model)) ||
      this.#contextTokens > STANDARD_CONTEXT_WINDOW;
    return {
      tokens: {
        input: this.#input,
        output: this.#output,
        cacheCreation: this.#cacheCreation,
        cacheRead: this.#cacheRead,
      },
      contextTokens: this.#contextTokens,
      contextWindow: extended ? EXTENDED_CONTEXT_WINDOW : STANDARD_CONTEXT_WINDOW,
      model: this.#model,
      costUsd: this.#costUsd,
      costIsPartial: this.#costUsd !== null && this.#workSinceCost,
    };
  }

  #addResponse(message: Record<string, unknown>, isSidechain: boolean): void {
    const { id, usage, model } = message;
    if (typeof id !== 'string' || !isRecord(usage) || this.#seenMessageIds.has(id)) return;
    this.#seenMessageIds.add(id);

    const input = count(usage.input_tokens);
    const cacheCreation = count(usage.cache_creation_input_tokens);
    const cacheRead = count(usage.cache_read_input_tokens);
    this.#input += input;
    this.#output += count(usage.output_tokens);
    this.#cacheCreation += cacheCreation;
    this.#cacheRead += cacheRead;
    this.#workSinceCost = true;

    // Subagent tokens count toward totals, but their context isn't the main conversation's.
    if (isSidechain) return;
    this.#contextTokens = input + cacheCreation + cacheRead;
    if (typeof model === 'string' && !model.startsWith('<')) this.#model = model;
  }

  #addCostState(record: Record<string, unknown>): void {
    if (typeof record.totalCostUSD === 'number') {
      this.#costUsd = record.totalCostUSD;
      this.#workSinceCost = false;
    }
    // Cost records key 1M-context variants as e.g. `claude-opus-5[1m]`.
    if (isRecord(record.modelUsage)) {
      for (const key of Object.keys(record.modelUsage)) {
        const match = /^(.+)\[1m\]$/.exec(key);
        if (match?.[1]) this.#extendedContextModels.add(match[1]);
      }
    }
  }
}

/**
 * Tracks usage for one transcript file, reading only the bytes appended since the last call.
 * Starts over if the file shrinks or is replaced.
 */
export class TranscriptUsageTracker {
  readonly #file: string;
  #accumulator = new UsageAccumulator();
  #offset = 0;
  #partialLine: Buffer = Buffer.alloc(0);

  constructor(file: string) {
    this.#file = file;
  }

  async read(): Promise<SessionUsage> {
    const handle = await fs.open(this.#file, 'r');
    try {
      const { size } = await handle.stat();
      if (size < this.#offset) this.#reset();
      if (size > this.#offset) {
        const buffer = Buffer.alloc(size - this.#offset);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, this.#offset);
        this.#offset += bytesRead;
        this.#consume(buffer.subarray(0, bytesRead));
      }
      return this.#accumulator.snapshot();
    } finally {
      await handle.close();
    }
  }

  #consume(chunk: Buffer): void {
    // Only complete lines are parsed; a line still being written waits for the next read as raw
    // bytes, so a multi-byte UTF-8 character split across reads isn't decoded too early.
    let start = 0;
    let newline: number;
    while ((newline = chunk.indexOf(0x0a, start)) !== -1) {
      const line = Buffer.concat([this.#partialLine, chunk.subarray(start, newline)]);
      this.#accumulator.addLine(line.toString('utf8'));
      this.#partialLine = Buffer.alloc(0);
      start = newline + 1;
    }
    this.#partialLine = Buffer.concat([this.#partialLine, chunk.subarray(start)]);
  }

  #reset(): void {
    this.#accumulator = new UsageAccumulator();
    this.#offset = 0;
    this.#partialLine = Buffer.alloc(0);
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
