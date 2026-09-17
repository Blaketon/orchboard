import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { HttpError } from '../http-error.ts';
import { defaultName, parseTaskRequest } from './task-request.ts';

const CWD = path.resolve('/work');

function statusOf(run: () => unknown): number {
  try {
    run();
    return 200;
  } catch (error) {
    return error instanceof HttpError ? error.status : 500;
  }
}

describe('parseTaskRequest', () => {
  it('defaults to Claude Code and names the task after the prompt', () => {
    assert.deepEqual(
      parseTaskRequest({ cwd: ` ${CWD} `, prompt: '\n  Fix   the login bug\nmore' }),
      {
        provider: 'claude',
        cwd: CWD,
        prompt: 'Fix   the login bug\nmore',
        name: 'Fix the login bug',
        images: [],
      },
    );
  });

  it('checks the permission mode against the chosen agent', () => {
    const codex = parseTaskRequest({
      provider: 'codex',
      cwd: CWD,
      prompt: 'x',
      permissionMode: 'full-access',
    });
    assert.equal(codex.permissionMode, 'full-access');
    assert.equal(
      statusOf(() =>
        parseTaskRequest({ provider: 'codex', cwd: CWD, prompt: 'x', permissionMode: 'plan' }),
      ),
      400,
    );
    assert.equal(
      statusOf(() => parseTaskRequest({ cwd: CWD, prompt: 'x', permissionMode: 'full-access' })),
      400,
    );
  });

  it('rejects invalid requests', () => {
    assert.equal(
      statusOf(() => parseTaskRequest({ cwd: 'relative/path', prompt: 'x' })),
      400,
    );
    assert.equal(
      statusOf(() => parseTaskRequest({ cwd: CWD, prompt: '   ' })),
      400,
    );
    assert.equal(
      statusOf(() => parseTaskRequest({ cwd: CWD, prompt: 'x', provider: 'gpt' })),
      400,
    );
    assert.equal(
      statusOf(() => parseTaskRequest({ cwd: CWD, prompt: 'x', images: ['../../etc/passwd'] })),
      400,
    );
    assert.equal(
      statusOf(() => parseTaskRequest({ cwd: CWD, prompt: 'x', name: 'n'.repeat(121) })),
      400,
    );
    assert.equal(
      statusOf(() => parseTaskRequest('nope')),
      400,
    );
  });
});

describe('defaultName', () => {
  it('shortens long first lines', () => {
    const name = defaultName('a'.repeat(100));
    assert.equal(name.length, 60);
    assert.ok(name.endsWith('…'));
  });
});
