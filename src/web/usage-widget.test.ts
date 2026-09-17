import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UsageWindow } from '../shared/api.ts';
import { usageAlerts } from './usage-widget.ts';

const window = (utilization: number): UsageWindow => ({
  id: 'claude-session',
  label: 'Session (5h)',
  utilization,
  resetsAt: null,
});

describe('usageAlerts', () => {
  it('stays quiet on the first reading', () => {
    assert.deepEqual(usageAlerts(new Map(), 'Claude', [window(95)]), []);
  });

  it('warns once when usage crosses 90%', () => {
    assert.deepEqual(usageAlerts(new Map([['claude-session', 85]]), 'Claude', [window(91)]), [
      { kind: 'near-limit', message: 'Claude Session (5h) usage is at 91%' },
    ]);
    assert.deepEqual(usageAlerts(new Map([['claude-session', 91]]), 'Claude', [window(93)]), []);
  });

  it('announces a reset when usage drops', () => {
    assert.deepEqual(usageAlerts(new Map([['claude-session', 80]]), 'Claude', [window(2)]), [
      { kind: 'reset', message: 'Claude Session (5h) limit reset, now at 2%' },
    ]);
  });
});
