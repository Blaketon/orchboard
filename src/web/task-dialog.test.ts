import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LABELS, modelChoices, modeFor, modesFor } from './task-dialog.ts';

describe('task form labels', () => {
  it('saves a new queued task or runs it right away', () => {
    assert.deepEqual(LABELS['queue-add'], {
      title: 'New task',
      submit: 'Save',
      busy: 'Saving…',
      run: true,
    });
  });

  it('offers to run only for a new queued task', () => {
    assert.equal(LABELS.start.run, false);
    assert.equal(LABELS['queue-edit'].run, false);
  });
});

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

describe('model menu', () => {
  const models = {
    default: 'opus',
    options: [
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
    ],
  };

  it("names the agent's default and lists its models after it", () => {
    assert.deepEqual(modelChoices(models, 'sonnet'), [
      { value: '', label: 'Default (Opus)' },
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
    ]);
  });

  it("shows a default that isn't offered by its name, and an unknown one as just Default", () => {
    const named = modelChoices({ ...models, default: 'claude-opus-5' }, '');
    assert.equal(named[0]?.label, 'Default (claude-opus-5)');
    assert.equal(modelChoices({ ...models, default: null }, '')[0]?.label, 'Default');
    assert.deepEqual(modelChoices(undefined, ''), [{ value: '', label: 'Default' }]);
  });

  it('keeps a chosen model that the agent does not offer', () => {
    assert.deepEqual(modelChoices(models, 'claude-opus-5').at(-1), {
      value: 'claude-opus-5',
      label: 'claude-opus-5',
    });
    assert.equal(modelChoices(undefined, 'opus').length, 2);
  });
});
