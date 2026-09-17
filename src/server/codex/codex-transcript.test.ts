import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { locateRollout, parseCodexRollout, readCodexTranscript } from './codex-transcript.ts';

const THREAD = '019a0b1c-2d3e-7f40-8152-637485960a1b';

const line = (type: string, payload: object, timestamp = '2026-09-15T10:00:00.000Z') =>
  JSON.stringify({ timestamp, type, payload });

const rollout = [
  line('session_meta', { id: THREAD, cwd: '/work' }),
  line('turn_context', { model: 'gpt-5.5-codex' }),
  line('response_item', {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: '# AGENTS.md instructions for /work\n\nBe brief.' },
      {
        type: 'input_text',
        text: '<environment_context>\n  <cwd>/work</cwd>\n</environment_context>',
      },
    ],
  }),
  line('response_item', {
    type: 'message',
    role: 'developer',
    content: [{ type: 'input_text', text: 'System rules' }],
  }),
  line('response_item', {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'Why do the tests fail?' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
    ],
  }),
  line('response_item', { type: 'reasoning', summary: [], encrypted_content: 'x' }),
  line('response_item', {
    type: 'custom_tool_call',
    call_id: 'call_1',
    name: 'exec',
    input: 'npm test\n  --silent',
  }),
  line('response_item', {
    type: 'custom_tool_call_output',
    call_id: 'call_1',
    output: [{ type: 'input_text', text: '1 failing' }],
  }),
  line('response_item', {
    type: 'function_call',
    call_id: 'call_2',
    name: 'shell',
    arguments: JSON.stringify({ command: ['git', 'status'] }),
  }),
  line('response_item', {
    type: 'function_call_output',
    call_id: 'call_2',
    output: JSON.stringify({ output: 'clean', metadata: { exit_code: 0 } }),
  }),
  line('response_item', {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'A snapshot is stale.' }],
  }),
  line('event_msg', {
    type: 'token_count',
    info: {
      total_token_usage: {
        input_tokens: 12_000,
        cached_input_tokens: 10_000,
        cache_write_input_tokens: 0,
        output_tokens: 500,
        total_tokens: 12_500,
      },
      last_token_usage: { input_tokens: 6_000, output_tokens: 200, total_tokens: 6_200 },
      model_context_window: 272_000,
    },
  }),
  'not json',
];

describe('parseCodexRollout', () => {
  it('reads the conversation without injected context', () => {
    const { entries } = parseCodexRollout(rollout);
    assert.deepEqual(entries, [
      {
        role: 'user',
        timestamp: '2026-09-15T10:00:00.000Z',
        parts: [{ type: 'text', text: 'Why do the tests fail?\n\n(image)' }],
      },
      {
        role: 'assistant',
        timestamp: '2026-09-15T10:00:00.000Z',
        parts: [
          { type: 'tool_call', id: 'call_1', name: 'exec', summary: 'npm test --silent' },
          { type: 'tool_result', toolUseId: 'call_1', text: '1 failing', isError: false },
          { type: 'tool_call', id: 'call_2', name: 'shell', summary: 'git status' },
          { type: 'tool_result', toolUseId: 'call_2', text: 'clean', isError: false },
          { type: 'text', text: 'A snapshot is stale.' },
        ],
      },
    ]);
  });

  it('reports token usage and context from the latest token count', () => {
    assert.deepEqual(parseCodexRollout(rollout).usage, {
      tokens: { input: 2_000, output: 500, cacheCreation: 0, cacheRead: 10_000 },
      contextTokens: 6_200,
      contextWindow: 272_000,
      model: 'gpt-5.5-codex',
      costUsd: null,
      costIsPartial: false,
    });
  });

  it('keeps only the latest entries', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      line('response_item', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `Message ${i}` }],
      }),
    );
    const { entries } = parseCodexRollout(many, 2);
    assert.deepEqual(
      entries.map((entry) => entry.parts[0]),
      [
        { type: 'text', text: 'Message 3' },
        { type: 'text', text: 'Message 4' },
      ],
    );
  });
});

describe('locateRollout', () => {
  let codexDir: string;

  beforeEach(async () => {
    codexDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-codex-'));
  });

  afterEach(async () => {
    await fs.rm(codexDir, { recursive: true, force: true });
  });

  it('finds the rollout in the folder for the day the thread started', async () => {
    const startedAt = new Date(2026, 8, 15, 23, 59).getTime();
    const dir = path.join(codexDir, 'sessions', '2026', '09', '16');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-09-16T00-00-01-${THREAD}.jsonl`);
    await fs.writeFile(file, `${rollout.join('\n')}\n`);

    assert.equal(await locateRollout(codexDir, THREAD, startedAt), file);
    assert.equal((await readCodexTranscript(file)).entries.length, 2);
  });

  it('ignores ids that are not thread ids', async () => {
    assert.equal(await locateRollout(codexDir, '../../secret', Date.now()), undefined);
    assert.equal(await locateRollout(codexDir, THREAD, Date.now()), undefined);
    assert.deepEqual(await readCodexTranscript(undefined), { entries: [], usage: null });
  });
});
