import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  EXTENDED_CONTEXT_WINDOW,
  STANDARD_CONTEXT_WINDOW,
  TranscriptUsageTracker,
  UsageAccumulator,
} from './session-usage.ts';

interface ResponseOptions {
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
  model?: string;
  isSidechain?: boolean;
}

function response(id: string, options: ResponseOptions = {}): string {
  return JSON.stringify({
    type: 'assistant',
    isSidechain: options.isSidechain ?? false,
    message: {
      id,
      model: options.model ?? 'claude-sonnet-5',
      usage: {
        input_tokens: options.input ?? 0,
        output_tokens: options.output ?? 0,
        cache_creation_input_tokens: options.cacheCreation ?? 0,
        cache_read_input_tokens: options.cacheRead ?? 0,
      },
    },
  });
}

function costState(totalCostUSD: number, models: string[] = ['claude-sonnet-5']): string {
  return JSON.stringify({
    type: 'cost-state',
    totalCostUSD,
    modelUsage: Object.fromEntries(models.map((model) => [model, { costUSD: totalCostUSD }])),
  });
}

function accumulate(...lines: string[]) {
  const accumulator = new UsageAccumulator();
  for (const line of lines) accumulator.addLine(line);
  return accumulator.snapshot();
}

describe('UsageAccumulator', () => {
  it('starts empty', () => {
    assert.deepEqual(accumulate(), {
      tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      contextTokens: 0,
      contextWindow: STANDARD_CONTEXT_WINDOW,
      model: null,
      costUsd: null,
      costIsPartial: false,
    });
  });

  it('counts a response split across several lines once', () => {
    const line = response('msg_1', { input: 10, output: 5 });
    assert.deepEqual(accumulate(line, line, line).tokens, {
      input: 10,
      output: 5,
      cacheCreation: 0,
      cacheRead: 0,
    });
  });

  it('sums responses and takes context size and model from the latest one', () => {
    const usage = accumulate(
      response('msg_1', { input: 5, output: 100, cacheCreation: 1000, cacheRead: 0 }),
      response('msg_2', {
        input: 3,
        output: 50,
        cacheCreation: 200,
        cacheRead: 1000,
        model: 'claude-opus-5',
      }),
    );
    assert.deepEqual(usage.tokens, { input: 8, output: 150, cacheCreation: 1200, cacheRead: 1000 });
    assert.equal(usage.contextTokens, 3 + 200 + 1000);
    assert.equal(usage.model, 'claude-opus-5');
  });

  it("counts subagent tokens without treating them as the main conversation's context", () => {
    const usage = accumulate(
      response('msg_1', { input: 100, model: 'claude-opus-5' }),
      response('msg_2', { input: 9000, model: 'claude-haiku-4-5', isSidechain: true }),
    );
    assert.equal(usage.tokens.input, 9100);
    assert.equal(usage.contextTokens, 100);
    assert.equal(usage.model, 'claude-opus-5');
  });

  it('takes cost from the latest cost record and marks later work as partial', () => {
    assert.deepEqual(
      pick(accumulate(response('msg_1'), costState(0.5), response('msg_2'), costState(1.25))),
      { costUsd: 1.25, costIsPartial: false },
    );
    assert.deepEqual(pick(accumulate(response('msg_1'), costState(0.5), response('msg_2'))), {
      costUsd: 0.5,
      costIsPartial: true,
    });

    function pick({ costUsd, costIsPartial }: { costUsd: number | null; costIsPartial: boolean }) {
      return { costUsd, costIsPartial };
    }
  });

  it('uses the 1M context window for extended-context models', () => {
    const extended = accumulate(
      costState(1, ['claude-opus-5[1m]']),
      response('msg_1', { model: 'claude-opus-5', cacheRead: 50_000 }),
    );
    assert.equal(extended.contextWindow, EXTENDED_CONTEXT_WINDOW);

    const tooBigForStandard = accumulate(response('msg_1', { cacheRead: 250_000 }));
    assert.equal(tooBigForStandard.contextWindow, EXTENDED_CONTEXT_WINDOW);

    assert.equal(
      accumulate(response('msg_1', { cacheRead: 50_000 })).contextWindow,
      STANDARD_CONTEXT_WINDOW,
    );
  });

  it('ignores malformed lines and synthetic messages', () => {
    const usage = accumulate(
      '{ not json',
      JSON.stringify({ type: 'assistant', message: { id: 'x', usage: 'nope' } }),
      response('msg_1', { model: '<synthetic>', input: 1 }),
    );
    assert.equal(usage.model, null);
    assert.equal(usage.tokens.input, 1);
  });
});

describe('TranscriptUsageTracker', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-usage-'));
    file = path.join(dir, 'session.jsonl');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads only what was appended since the last read', async () => {
    const tracker = new TranscriptUsageTracker(file);
    await fs.writeFile(file, `${response('msg_1', { output: 10 })}\n`);
    assert.equal((await tracker.read()).tokens.output, 10);

    await fs.appendFile(
      file,
      `${response('msg_1', { output: 10 })}\n${response('msg_2', { output: 5 })}\n`,
    );
    assert.equal((await tracker.read()).tokens.output, 15);
  });

  it('waits for a line that is still being written, even mid-character', async () => {
    const tracker = new TranscriptUsageTracker(file);
    const line = Buffer.from(`${response('msg_ä', { output: 7, model: 'claude-ä' })}\n`);
    const splitInsideCharacter = line.indexOf(Buffer.from('ä')) + 1;

    await fs.writeFile(file, line.subarray(0, splitInsideCharacter));
    assert.equal((await tracker.read()).tokens.output, 0);

    await fs.appendFile(file, line.subarray(splitInsideCharacter));
    const usage = await tracker.read();
    assert.equal(usage.tokens.output, 7);
    assert.equal(usage.model, 'claude-ä');
  });

  it('starts over when the file is replaced with a shorter one', async () => {
    const tracker = new TranscriptUsageTracker(file);
    await fs.writeFile(
      file,
      `${response('msg_1', { output: 100 })}\n${response('msg_2', { output: 100 })}\n`,
    );
    assert.equal((await tracker.read()).tokens.output, 200);

    await fs.writeFile(file, `${response('msg_3', { output: 1 })}\n`);
    assert.equal((await tracker.read()).tokens.output, 1);
  });
});
