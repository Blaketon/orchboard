import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QueuedTask } from '../shared/api.ts';
import { taskRunner } from './queue.ts';

/** A queued task with no agent or model set, as older versions saved them. */
const task = (extra: Partial<QueuedTask> = {}): QueuedTask => ({
  id: 'task-1',
  columnId: 'col-1',
  name: 'Fix the build',
  cwd: '/work',
  prompt: 'Fix the build',
  permissionMode: 'manual',
  createdAt: 0,
  ...extra,
});

describe('taskRunner', () => {
  it('names the agent and the chosen model', () => {
    assert.deepEqual(taskRunner(task({ provider: 'claude', model: 'opus' })), {
      agent: 'Claude Code',
      model: 'opus',
    });
    assert.deepEqual(taskRunner(task({ provider: 'codex', model: 'gpt-5.5' })), {
      agent: 'Codex',
      model: 'gpt-5.5',
    });
  });

  it("shows the agent's default model when none is chosen", () => {
    assert.equal(taskRunner(task({ provider: 'codex' })).model, 'Default model');
  });

  it('runs tasks saved by older versions on Claude Code', () => {
    assert.deepEqual(taskRunner(task()), { agent: 'Claude Code', model: 'Default model' });
  });
});
