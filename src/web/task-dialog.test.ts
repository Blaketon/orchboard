import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { modeFor, modesFor } from './task-dialog.ts';

describe('permission modes per agent', () => {
  it('offers each agent its own modes', () => {
    assert.ok(modesFor('claude').some((mode) => mode.value === 'acceptEdits'));
    assert.deepEqual(
      modesFor('codex').map((mode) => mode.value),
      ['read-only', 'auto', 'full-access'],
    );
  });

  it("falls back to the agent's default for a mode from the other agent", () => {
    assert.equal(modeFor('codex', 'acceptEdits'), 'read-only');
    assert.equal(modeFor('claude', 'full-access'), 'manual');
    assert.equal(modeFor('codex', 'auto'), 'auto');
    assert.equal(modeFor('claude', null), 'manual');
  });
});
