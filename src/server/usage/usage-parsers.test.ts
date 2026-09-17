import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseClaudeUsage, parseCodexRateLimits } from './usage-parsers.ts';

describe('parseClaudeUsage', () => {
  it('maps the session and weekly windows', () => {
    assert.deepEqual(
      parseClaudeUsage({
        five_hour: { utilization: 34, resets_at: '2026-09-17T11:40:00Z' },
        seven_day: { utilization: 120, resets_at: null },
        seven_day_opus: null,
      }),
      [
        {
          id: 'claude-session',
          label: 'Session (5h)',
          utilization: 34,
          resetsAt: '2026-09-17T11:40:00Z',
        },
        { id: 'claude-week', label: 'Week', utilization: 100, resetsAt: null },
      ],
    );
  });

  it('ignores missing or malformed windows', () => {
    assert.deepEqual(parseClaudeUsage({ five_hour: { utilization: 'high' } }), []);
    assert.deepEqual(parseClaudeUsage('nope'), []);
  });
});

describe('parseCodexRateLimits', () => {
  const line = (rateLimits: unknown, nested = true) =>
    JSON.stringify(
      nested
        ? { type: 'event_msg', payload: { rate_limits: rateLimits } }
        : { rate_limits: rateLimits },
    );

  it('reads the newest snapshot that has a primary limit', () => {
    const windows = parseCodexRateLimits([
      line({ primary: { used_percent: 10, window_minutes: 300, resets_at: 1_789_000_000 } }),
      line({
        primary: { used_percent: 39, window_minutes: 300, resets_at: 1_789_000_000 },
        secondary: { used_percent: 80, window_minutes: 10_080 },
      }),
      line({ primary: null, secondary: null }),
    ]);
    assert.deepEqual(windows, [
      {
        id: 'codex-primary',
        label: 'Session (5h)',
        utilization: 39,
        resetsAt: new Date(1_789_000_000 * 1000).toISOString(),
      },
      { id: 'codex-secondary', label: 'Week', utilization: 80, resetsAt: null },
    ]);
  });

  it('accepts top-level rate limits and skips unrelated lines', () => {
    const windows = parseCodexRateLimits([
      line({ primary: { used_percent: 5 } }, false),
      '{"type":"message"}',
      'not json with rate_limits',
    ]);
    const [first] = windows ?? [];
    assert.ok(first);
    assert.equal(first.utilization, 5);
    assert.equal(first.label, 'Limit');
  });

  it('returns null when there is no snapshot', () => {
    assert.equal(parseCodexRateLimits(['{"type":"message"}']), null);
  });
});
