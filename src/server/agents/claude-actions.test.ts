import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Agent } from '../../shared/api.ts';
import { HttpError } from '../http-error.ts';
import { createClaudeActions } from './claude-actions.ts';
import { ClaudeCliMissingError, type RunClaude, type RunClaudeOptions } from './claude-cli.ts';
import { parseTaskRequest } from './task-request.ts';

const task = (request: object) => parseTaskRequest(request);

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

  const agent = (overrides: Partial<Agent> = {}): Agent => ({
    id: '1a2b3c4d',
    provider: 'claude',
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
      const result = await createClaudeActions({ run }).start(
        task({
          cwd: project,
          prompt: '-v flag handling',
          name: 'Flags',
          permissionMode: 'acceptEdits',
        }),
      );

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

    it('points the agent at attached images and gives it access to them', async () => {
      const { calls, run } = recorder();
      const id = '0f8fad5b-d9cb-469f-a165-70867728950e.png';
      const attachments = {
        dir: '/data/attachments',
        paths: (ids: readonly string[]) =>
          Promise.resolve(ids.map((item) => `/data/attachments/${item}`)),
      };
      await createClaudeActions({ run, attachments }).start(
        task({
          cwd: project,
          prompt: 'What is wrong in this screenshot?',
          name: 'Screenshot',
          images: [id],
        }),
      );
      assert.deepEqual(calls[0]?.args, [
        '--bg',
        '--name',
        'Screenshot',
        '--add-dir',
        '/data/attachments',
        '--',
        [
          'What is wrong in this screenshot?',
          '',
          'Attached image (open with the Read tool):',
          `- /data/attachments/${id}`,
        ].join('\n'),
      ]);
    });

    it('passes a chosen model to the CLI', async () => {
      const { calls, run } = recorder();
      await createClaudeActions({ run }).start(
        task({ cwd: project, prompt: 'Try opus', name: 'Models', model: 'opus' }),
      );
      assert.deepEqual(calls[0]?.args.slice(0, 5), ['--bg', '--name', 'Models', '--model', 'opus']);
    });

    it('checks that the project folder exists before running anything', async () => {
      const { calls, run } = recorder();
      await rejectsWithStatus(
        createClaudeActions({ run }).start(
          task({ cwd: path.join(project, 'missing'), prompt: 'x' }),
        ),
        400,
        /Folder not found/,
      );
      assert.equal(calls.length, 0);
    });

    it('reports CLI problems with clear statuses', async () => {
      await rejectsWithStatus(
        createClaudeActions({ run: () => Promise.reject(new ClaudeCliMissingError()) }).start(
          task({ cwd: project, prompt: 'x' }),
        ),
        503,
      );
      const failure = Object.assign(new Error('exit 1'), { stderr: 'Not logged in\n' });
      await rejectsWithStatus(
        createClaudeActions({ run: () => Promise.reject(failure) }).start(
          task({ cwd: project, prompt: 'x' }),
        ),
        502,
        /Not logged in/,
      );
    });
  });

  describe('reply', () => {
    it("continues the agent's session with the prompt", async () => {
      const { calls, run } = recorder();
      await createClaudeActions({ run }).reply(agent(), { prompt: 'Yes, apply both fixes' });
      assert.deepEqual(calls, [
        {
          args: ['--bg', '--resume', agent().sessionId, '--', 'Yes, apply both fixes'],
          options: { cwd: project },
        },
      ]);
    });

    it('stops an agent that is awaiting input, then continues it', async () => {
      const { calls, run } = recorder();
      let alive = true;
      const actions = createClaudeActions({
        run,
        isPidAlive: () => alive,
        sleep: () => {
          // The process goes away after the first check, as `claude stop` does its work.
          alive = false;
          return Promise.resolve();
        },
      });

      await actions.reply(agent({ pid: 42 }), { prompt: 'Recompute the total' });
      assert.deepEqual(
        calls.map((call) => call.args),
        [
          ['stop', '1a2b3c4d'],
          ['--bg', '--resume', agent().sessionId, '--', 'Recompute the total'],
        ],
      );
    });

    it('points at the terminal when the agent will not stop', async () => {
      const { calls, run } = recorder();
      const actions = createClaudeActions({
        run,
        isPidAlive: () => true,
        sleep: () => Promise.resolve(),
      });
      await rejectsWithStatus(actions.reply(agent({ pid: 42 }), { prompt: 'hi' }), 409, /Terminal/);
      // It stopped, but never resumed.
      assert.deepEqual(calls.map((call) => call.args[0]).slice(1), []);
    });

    it('refuses while the agent is still working', async () => {
      const { calls, run } = recorder();
      await rejectsWithStatus(
        createClaudeActions({ run }).reply(agent({ pid: 42, state: 'working' }), { prompt: 'hi' }),
        409,
        /still working/,
      );
      assert.equal(calls.length, 0);
    });
  });

  describe('stop', () => {
    it('stops a running agent', async () => {
      const { calls, run } = recorder();
      await createClaudeActions({ run }).stop(agent({ pid: 42, state: 'working' }));
      assert.deepEqual(calls, [{ args: ['stop', '1a2b3c4d'], options: { fixedArgs: true } }]);
    });

    it('refuses when the agent is not running', async () => {
      await rejectsWithStatus(createClaudeActions({ run: recorder().run }).stop(agent()), 409);
    });
  });
});

describe('remove', () => {
  const finished: Agent = {
    id: '1a2b3c4d',
    provider: 'claude',
    sessionId: 's',
    name: 'Done',
    cwd: '/work',
    startedAt: 0,
    state: 'done',
    pid: null,
  };

  it('deletes a finished agent with claude rm', async () => {
    const { calls, run } = recorder();
    await createClaudeActions({ run }).remove(finished);
    assert.deepEqual(calls, [{ args: ['rm', '1a2b3c4d'], options: { fixedArgs: true } }]);
  });

  it('refuses while the agent is running', async () => {
    await rejectsWithStatus(
      createClaudeActions({ run: recorder().run }).remove({
        ...finished,
        state: 'working',
        pid: 7,
      }),
      409,
    );
  });
});
