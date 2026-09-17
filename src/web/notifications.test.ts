import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AgentState, Agent } from '../shared/api.ts';
import { detectTransitions } from './notifications.ts';

const agent = (id: string, state: AgentState): Agent => ({
  id,
  provider: 'claude',
  sessionId: id,
  name: id,
  cwd: '/work',
  startedAt: 0,
  state,
  pid: null,
});

describe('detectTransitions', () => {
  it('reports agents that just completed or started waiting for input', () => {
    const previous = new Map<string, AgentState>([
      ['a', 'working'],
      ['b', 'working'],
      ['c', 'blocked'],
    ]);
    const { done, blocked } = detectTransitions(previous, [
      agent('a', 'done'),
      agent('b', 'blocked'),
      agent('c', 'blocked'),
    ]);
    assert.deepEqual(
      done.map((x) => x.id),
      ['a'],
    );
    assert.deepEqual(
      blocked.map((x) => x.id),
      ['b'],
    );
  });

  it('ignores agents it has not seen before', () => {
    const { done, blocked } = detectTransitions(new Map(), [agent('new', 'done')]);
    assert.equal(done.length + blocked.length, 0);
  });

  it('does not report an agent going back to work', () => {
    const { done, blocked } = detectTransitions(new Map([['a', 'blocked']]), [
      agent('a', 'working'),
    ]);
    assert.equal(done.length + blocked.length, 0);
  });
});
