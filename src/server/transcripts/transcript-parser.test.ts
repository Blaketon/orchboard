import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_RESULT_CHARS,
  MAX_SUMMARY_CHARS,
  parseTranscript,
  summarizeToolInput,
} from './transcript-parser.ts';

const lines = (...records: unknown[]): string[] => records.map((record) => JSON.stringify(record));

const userPrompt = (text: string, extra: object = {}) => ({
  type: 'user',
  timestamp: '2026-09-17T10:00:00.000Z',
  message: { role: 'user', content: text },
  ...extra,
});

const assistantBlock = (id: string, block: object, timestamp = '2026-09-17T10:00:01.000Z') => ({
  type: 'assistant',
  timestamp,
  message: { id, role: 'assistant', content: [block] },
});

describe('parseTranscript', () => {
  it('reads a prompt and merges one assistant turn split across lines', () => {
    const entries = parseTranscript(
      lines(
        userPrompt('Fix the flaky test'),
        assistantBlock('msg_1', { type: 'thinking', thinking: 'hmm' }),
        assistantBlock('msg_1', { type: 'text', text: 'Looking into it.' }),
        assistantBlock('msg_1', {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Bash',
          input: { command: 'npm test' },
        }),
      ),
    );

    assert.deepEqual(entries, [
      {
        role: 'user',
        timestamp: '2026-09-17T10:00:00.000Z',
        parts: [{ type: 'text', text: 'Fix the flaky test' }],
      },
      {
        role: 'assistant',
        timestamp: '2026-09-17T10:00:01.000Z',
        parts: [
          { type: 'text', text: 'Looking into it.' },
          { type: 'tool_call', id: 'toolu_1', name: 'Bash', summary: 'npm test' },
        ],
      },
    ]);
  });

  it('keeps separate assistant messages as separate entries', () => {
    const entries = parseTranscript(
      lines(
        assistantBlock('msg_1', { type: 'text', text: 'One' }),
        assistantBlock('msg_2', { type: 'text', text: 'Two' }),
      ),
    );
    assert.equal(entries.length, 2);
  });

  it('reads tool results from strings and from text and image blocks', () => {
    const [entry] = parseTranscript(
      lines({
        type: 'user',
        timestamp: 't',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_2',
              is_error: true,
              content: [
                { type: 'text', text: 'failed' },
                { type: 'image', source: {} },
              ],
            },
          ],
        },
      }),
    );
    assert.deepEqual(entry?.parts, [
      { type: 'tool_result', toolUseId: 'toolu_1', text: 'ok', isError: false },
      { type: 'tool_result', toolUseId: 'toolu_2', text: 'failed\n[image]', isError: true },
    ]);
  });

  it('truncates very long tool results', () => {
    const [entry] = parseTranscript(
      lines({
        type: 'user',
        timestamp: 't',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'x', content: 'a'.repeat(10_000) }],
        },
      }),
    );
    const part = entry?.parts[0];
    assert.equal(part?.type === 'tool_result' ? part.text.length : 0, MAX_RESULT_CHARS);
  });

  it('skips system-injected, subagent, thinking-only, malformed, and non-message lines', () => {
    const entries = parseTranscript([
      ...lines(
        userPrompt('injected', { isMeta: true }),
        userPrompt('subagent', { isSidechain: true }),
        assistantBlock('msg_1', { type: 'thinking', thinking: '...' }),
        { type: 'ai-title', aiTitle: 'Fix tests' },
        { type: 'attachment', attachment: {} },
      ),
      '{ half a line',
      '',
    ]);
    assert.deepEqual(entries, []);
  });

  it('keeps only the most recent entries', () => {
    const entries = parseTranscript(
      lines(...Array.from({ length: 10 }, (_, i) => userPrompt(`prompt ${i}`))),
      3,
    );
    assert.deepEqual(
      entries.map((entry) => entry.parts[0]),
      [7, 8, 9].map((i) => ({ type: 'text', text: `prompt ${i}` })),
    );
  });
});

describe('summarizeToolInput', () => {
  it('describes common tools by their key input', () => {
    assert.equal(summarizeToolInput('Bash', { command: 'git status' }), 'git status');
    assert.equal(summarizeToolInput('PowerShell', { command: 'Get-ChildItem' }), 'Get-ChildItem');
    assert.equal(summarizeToolInput('Read', { file_path: '/src/app.ts' }), '/src/app.ts');
    assert.equal(summarizeToolInput('Grep', { pattern: 'TODO', path: 'src' }), 'TODO in src');
    assert.equal(summarizeToolInput('TodoWrite', { todos: [{}, {}] }), '2 todo(s)');
    assert.equal(
      summarizeToolInput('AskUserQuestion', { questions: [{ question: 'Which license?' }] }),
      'Which license?',
    );
  });

  it('falls back to the first text input for unknown and MCP tools', () => {
    assert.equal(
      summarizeToolInput('mcp__browser__navigate', { tabId: 3, url: 'https://example.com' }),
      'https://example.com',
    );
  });

  it('collapses whitespace and truncates long summaries', () => {
    assert.equal(summarizeToolInput('Bash', { command: 'echo  a\n  b' }), 'echo a b');
    const long = summarizeToolInput('Bash', { command: 'x'.repeat(500) });
    assert.equal(long.length, MAX_SUMMARY_CHARS);
    assert.ok(long.endsWith('…'));
  });

  it('returns an empty summary for missing input', () => {
    assert.equal(summarizeToolInput('Bash', undefined), '');
  });
});
