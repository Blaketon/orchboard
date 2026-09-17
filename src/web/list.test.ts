import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaudeAgent } from '../shared/api.ts';
import { sortForList } from './list.ts';

const agent = (id: string, state: ClaudeAgent['state'], startedAt: number): ClaudeAgent => ({
  id,
  sessionId: id,
  name: id,
  cwd: '/work',
  startedAt,
  state,
  pid: null,
});

describe('sortForList', () => {
  it('orders working, then awaiting input, then completed, newest first within each', () => {
    const sorted = sortForList([
      agent('done-old', 'done', 1),
      agent('blocked', 'blocked', 5),
      agent('done-new', 'done', 9),
      agent('working', 'working', 2),
    ]);
    assert.deepEqual(
      sorted.map((a) => a.id),
      ['working', 'blocked', 'done-new', 'done-old'],
    );
  });
});
