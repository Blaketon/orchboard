import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { ClaudeAgent } from '../../shared/api.ts';
import { HttpError } from '../http-error.ts';
import { createClaudeActions, defaultName } from './claude-actions.ts';
import { ClaudeCliMissingError, type RunClaude, type RunClaudeOptions } from './claude-cli.ts';

function recorder(output = '') {
  const calls: { args: readonly string[]; options: RunClaudeOptions | undefined }[] = [];
  const run: RunClaude = (args, options) => {
    calls.push({ args, options });
    return Promise.resolve(output);
  };
  return { calls, run };
}

async function rejectsWithStatus(promise: Promise<unknown>, status: number, message?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpError, `expected HttpError, got ${String(error)}`);
    assert.equal(error.status, status);
    if (message) assert.match(error.message, message);
    return true;
  });
}

describe('claude actions', () => {
  let project: string;

  before(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-project-'));
  });

  after(async () => {
    await fs.rm(project, { recursive: true, force: true });
  });

  const agent = (overrides: Partial<ClaudeAgent> = {}): ClaudeAgent => ({
    id: '1a2b3c4d',
    sessionId: '0f8e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b',
    name: 'Fix tests',
    cwd: project,
    startedAt: 0,
    state: 'blocked',
    pid: null,
    ...overrides,
  });

  describe('start', () => {
    it('starts a background agent in the project folder and returns its id', async () => {
      const { calls, run } = recorder('Started background session 9f8e7d6c\n');
      const result = await createClaudeActions(run).start({
        cwd: project,
        prompt: '-v flag handling',
        name: 'Flags',
        permissionMode: 'acceptEdits',
      });

      assert.deepEqual(result, { id: '9f8e7d6c' });
      assert.deepEqual(calls, [
        {
          args: [
            '--bg',
            '--name',
            'Flags',
            '--permission-mode',
            'acceptEdits',
            '--',
            '-v flag handling',
          ],
          options: { cwd: project },
        },
      ]);
    });

    it("names the task after the prompt's first line when no name is given", async () => {
      const { calls, run } = recorder();
      await createClaudeActions(run).start({
        cwd: project,
        prompt: '\n  Fix   the login bug\nmore',
      });
      assert.deepEqual(calls[0]?.args.slice(0, 3), ['--bg', '--name', 'Fix the login bug']);
    });

    it('rejects invalid requests before running anything', async () => {
      const { calls, run } = recorder();
      const actions = createClaudeActions(run);
      await rejectsWithStatus(
        actions.start({ cwd: 'relative/path', prompt: 'x' }),
        400,
        /absolute/,
      );
      await rejectsWithStatus(actions.start({ cwd: project, prompt: '   ' }), 400, /prompt/);
      await rejectsWithStatus(
        actions.start({ cwd: project, prompt: 'x', permissionMode: 'yolo' }),
        400,
        /permission mode/,
      );
      await rejectsWithStatus(
        actions.start({ cwd: path.join(project, 'missing'), prompt: 'x' }),
        400,
        /Folder not found/,
      );
      assert.equal(calls.length, 0);
    });

    it('reports CLI problems with clear statuses', async () => {
      await rejectsWithStatus(
        createClaudeActions(() => Promise.reject(new ClaudeCliMissingError())).start({
          cwd: project,
          prompt: 'x',
        }),
        503,
      );
      const failure = Object.assign(new Error('exit 1'), { stderr: 'Not logged in\n' });
      await rejectsWithStatus(
        createClaudeActions(() => Promise.reject(failure)).start({ cwd: project, prompt: 'x' }),
        502,
        /Not logged in/,
      );
    });
  });

  describe('reply', () => {
    it("continues the agent's session with the prompt", async () => {
      const { calls, run } = recorder();
      await createClaudeActions(run).reply(agent(), { prompt: 'Yes, apply both fixes' });
      assert.deepEqual(calls, [
        {
          args: ['--bg', '--resume', agent().sessionId, '--', 'Yes, apply both fixes'],
          options: { cwd: project },
        },
      ]);
    });

    it('refuses while the agent is still running', async () => {
      const { calls, run } = recorder();
      await rejectsWithStatus(
        createClaudeActions(run).reply(agent({ pid: 42, state: 'working' }), { prompt: 'hi' }),
        409,
      );
      assert.equal(calls.length, 0);
    });
  });

  describe('stop', () => {
    it('stops a running agent', async () => {
      const { calls, run } = recorder();
      await createClaudeActions(run).stop(agent({ pid: 42, state: 'working' }));
      assert.deepEqual(calls, [{ args: ['stop', '1a2b3c4d'], options: { fixedArgs: true } }]);
    });

    it('refuses when the agent is not running', async () => {
      await rejectsWithStatus(createClaudeActions(recorder().run).stop(agent()), 409);
    });
  });
});

describe('remove', () => {
  const finished: ClaudeAgent = {
    id: '1a2b3c4d',
    sessionId: 's',
    name: 'Done',
    cwd: '/work',
    startedAt: 0,
    state: 'done',
    pid: null,
  };

  it('deletes a finished agent with claude rm', async () => {
    const { calls, run } = recorder();
    await createClaudeActions(run).remove(finished);
    assert.deepEqual(calls, [{ args: ['rm', '1a2b3c4d'], options: { fixedArgs: true } }]);
  });

  it('refuses while the agent is running', async () => {
    await rejectsWithStatus(
      createClaudeActions(recorder().run).remove({ ...finished, state: 'working', pid: 7 }),
      409,
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
