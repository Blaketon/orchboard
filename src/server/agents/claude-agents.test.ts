import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, it } from 'node:test';
import {
  AGENTS_COMMAND_ARGS,
  ClaudeCliMissingError,
  isPidAlive,
  listClaudeAgents,
  parseAgents,
  type RunCommand,
} from './claude-agents.ts';

const blocked = {
  id: '1a2b3c4d',
  cwd: '/work/storefront',
  kind: 'background',
  startedAt: 1_789_000_000_000,
  sessionId: '0f8e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b',
  name: 'Migrate checkout',
  state: 'blocked',
};
const working = {
  ...blocked,
  id: '5e6f7a8b',
  sessionId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  state: 'working',
  pid: 4242,
};
const interactive = {
  cwd: '/work/docs',
  kind: 'interactive',
  startedAt: 1_789_000_000_000,
  sessionId: '11111111-2222-4333-8444-555555555555',
  name: 'terminal session',
  status: 'busy',
  pid: 777,
};

describe('parseAgents', () => {
  it('parses background agents and defaults a missing pid to null', () => {
    const { agents, skipped } = parseAgents(JSON.stringify([blocked, working]));
    assert.deepEqual(skipped, []);
    assert.deepEqual(agents, [
      {
        id: blocked.id,
        sessionId: blocked.sessionId,
        name: blocked.name,
        cwd: blocked.cwd,
        startedAt: blocked.startedAt,
        state: 'blocked',
        pid: null,
      },
      {
        id: working.id,
        sessionId: working.sessionId,
        name: working.name,
        cwd: working.cwd,
        startedAt: working.startedAt,
        state: 'working',
        pid: 4242,
      },
    ]);
  });

  it('ignores interactive sessions without reporting them', () => {
    assert.deepEqual(parseAgents(JSON.stringify([interactive])), { agents: [], skipped: [] });
  });

  it('skips malformed entries and says why', () => {
    const { agents, skipped } = parseAgents(
      JSON.stringify([
        { ...blocked, id: undefined },
        'oops',
        { ...blocked, state: 'paused' },
        blocked,
      ]),
    );
    assert.equal(agents.length, 1);
    assert.deepEqual(skipped, [
      'entry 0 is missing required fields',
      'entry 1 is not an object',
      'entry 2 has unrecognized state "paused"',
    ]);
  });

  it('rejects output that is not a JSON list', () => {
    assert.throws(() => parseAgents('Error: not logged in'), /did not return valid JSON/);
    assert.throws(() => parseAgents('{}'), /did not return a list/);
  });
});

describe('listClaudeAgents', () => {
  it('runs `claude agents --json --all`', async () => {
    const calls: [string, readonly string[]][] = [];
    const run: RunCommand = (command, args) => {
      calls.push([command, args]);
      return Promise.resolve('[]');
    };
    await listClaudeAgents({ run });
    assert.deepEqual(calls, [['claude', AGENTS_COMMAND_ARGS]]);
  });

  it('clears the pid of agents whose process has exited', async () => {
    const run: RunCommand = () => Promise.resolve(JSON.stringify([working]));
    const alive = await listClaudeAgents({ run, isPidAlive: () => true });
    const exited = await listClaudeAgents({ run, isPidAlive: () => false });
    assert.equal(alive.agents[0]?.pid, 4242);
    assert.equal(exited.agents[0]?.pid, null);
  });

  it('reports a missing CLI with a clear error', async () => {
    const run: RunCommand = () =>
      Promise.reject(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
    await assert.rejects(listClaudeAgents({ run }), ClaudeCliMissingError);
  });

  it('passes other command failures through', async () => {
    const run: RunCommand = () => Promise.reject(new Error('exit code 1'));
    await assert.rejects(listClaudeAgents({ run }), /exit code 1/);
  });
});

describe('isPidAlive', () => {
  it('is true for a running process and false once it has exited', async () => {
    assert.equal(isPidAlive(process.pid), true);

    const child = spawn(process.execPath, ['-e', '']);
    const pid = child.pid;
    assert.ok(pid !== undefined);
    await once(child, 'exit');
    assert.equal(isPidAlive(pid), false);
  });
});
