import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Agent } from '../../shared/api.ts';
import { parseTaskRequest } from '../agents/task-request.ts';
import { HttpError } from '../http-error.ts';
import { CodexRunner } from './codex-runner.ts';

const THREAD = '019a0b1c-2d3e-7f40-8152-637485960a1b';

type Message = Record<string, unknown>;

/** A fake `codex app-server` that answers requests from a script and records what it got. */
class FakeAppServer extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4321;
  readonly received: Message[] = [];

  constructor(answers: Readonly<Record<string, (params: unknown) => unknown>>) {
    super();
    this.stdin.setEncoding('utf8');
    let buffer = '';
    this.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const message = JSON.parse(line) as Message;
        this.received.push(message);
        const answer = typeof message.method === 'string' ? answers[message.method] : undefined;
        if (message.id !== undefined && answer) {
          this.send({ jsonrpc: '2.0', id: message.id, result: answer(message.params) });
        }
        this.emit('received');
      }
    });
    // Closing stdin makes the real app server exit.
    this.stdin.on('finish', () => setImmediate(() => this.emit('exit', 0)));
  }

  send(message: object): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill(): boolean {
    this.emit('exit', null);
    return true;
  }

  async waitFor(predicate: (message: Message) => boolean): Promise<Message> {
    for (;;) {
      const found = this.received.find(predicate);
      if (found) return found;
      await new Promise((resolve) => this.once('received', resolve));
    }
  }
}

const standardAnswers = {
  initialize: () => ({}),
  'thread/start': () => ({ thread: { id: THREAD, path: null } }),
  'thread/resume': () => ({ thread: { id: THREAD, path: null } }),
  'turn/start': () => ({ turn: { id: 'turn-1' } }),
  'turn/interrupt': () => ({}),
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('CodexRunner', () => {
  let dataDir: string;
  let project: string;
  let servers: FakeAppServer[];
  let changes: number;
  let runner: CodexRunner;

  const createRunner = () =>
    new CodexRunner({
      dataDir,
      codexDir: path.join(dataDir, 'codex-home'),
      onChange: () => {
        changes++;
      },
      attachments: { paths: (ids) => Promise.resolve(ids.map((id) => path.join('/att', id))) },
      spawn: () => {
        const server = new FakeAppServer(standardAnswers);
        servers.push(server);
        return server;
      },
      now: () => 1_000,
    });

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-codex-runner-'));
    project = path.join(dataDir, 'project');
    await fs.mkdir(project);
    servers = [];
    changes = 0;
    runner = createRunner();
    await runner.load();
  });

  afterEach(async () => {
    await runner.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const start = (fields: object = {}) =>
    runner.start(
      parseTaskRequest({
        provider: 'codex',
        cwd: project,
        prompt: 'Fix the flaky test',
        permissionMode: 'auto',
        ...fields,
      }),
    );

  const only = (): Agent => {
    const [agent] = runner.agents();
    assert.ok(agent);
    return agent;
  };

  it('starts a thread and a turn with the chosen sandbox', async () => {
    const image = '0f8fad5b-d9cb-469f-a165-70867728950e.png';
    const { id } = await start({ images: [image] });
    assert.match(id ?? '', /^codex-[0-9a-f]{8}$/);

    const server = servers[0];
    assert.ok(server);
    const threadStart = await server.waitFor((message) => message.method === 'thread/start');
    assert.deepEqual(threadStart.params, {
      cwd: project,
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
    });
    const turnStart = await server.waitFor((message) => message.method === 'turn/start');
    assert.deepEqual(turnStart.params, {
      threadId: THREAD,
      input: [
        { type: 'text', text: 'Fix the flaky test', text_elements: [] },
        { type: 'localImage', path: path.join('/att', image) },
      ],
    });

    assert.deepEqual(only(), {
      id,
      provider: 'codex',
      sessionId: THREAD,
      name: 'Fix the flaky test',
      cwd: project,
      startedAt: 1_000,
      state: 'working',
      pid: 4321,
      approvals: [],
      error: null,
    });
    assert.ok(changes > 0);
  });

  it('finishes when the turn completes and resumes the thread on reply', async () => {
    await start();
    servers[0]?.send({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: { threadId: THREAD, turn: { id: 'turn-1', status: 'completed', error: null } },
    });
    await settle();
    await settle();
    assert.equal(only().state, 'done');
    assert.equal(only().pid, null);

    await runner.reply(only(), { prompt: 'Also update the docs' });
    const resume = await servers[1]?.waitFor((message) => message.method === 'thread/resume');
    assert.equal((resume?.params as Message).threadId, THREAD);
    assert.equal(only().state, 'working');
    await assert.rejects(runner.reply(only(), { prompt: 'Again' }), statusIs(409));
  });

  it('records why a turn failed', async () => {
    await start();
    servers[0]?.send({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        turn: { id: 'turn-1', status: 'failed', error: { message: 'Usage limit reached' } },
      },
    });
    await settle();
    assert.equal(only().state, 'blocked');
    assert.equal(only().error, 'Usage limit reached');
  });

  it('holds approval requests until the user decides', async () => {
    await start();
    const server = servers[0];
    assert.ok(server);
    server.send({
      jsonrpc: '2.0',
      method: 'item/started',
      params: { item: { type: 'commandExecution', id: 'item-1', command: 'npm install' } },
    });
    server.send({
      jsonrpc: '2.0',
      id: 99,
      method: 'item/commandExecution/requestApproval',
      params: { itemId: 'item-1', reason: 'Needs the network' },
    });
    server.send({ jsonrpc: '2.0', id: 100, method: 'item/tool/call', params: {} });
    await server.waitFor((message) => message.id === 100);
    await settle();

    const agent = only();
    assert.equal(agent.state, 'blocked');
    assert.equal(agent.approvals?.[0]?.detail, 'npm install');
    assert.deepEqual(server.received.find((message) => message.id === 100)?.error, {
      code: -32000,
      message: "Orchboard can't handle item/tool/call.",
    });

    await assert.rejects(runner.decide(agent, '99', { decision: 'maybe' }), statusIs(400));
    await runner.decide(agent, '99', { decision: 'acceptForSession' });
    const answer = await server.waitFor((message) => message.id === 99);
    assert.deepEqual(answer.result, { decision: 'acceptForSession' });
    assert.equal(only().state, 'working');
    await assert.rejects(runner.decide(agent, '99', { decision: 'accept' }), statusIs(404));
  });

  it('interrupts the turn when stopped, then removes the task', async () => {
    await start();
    await runner.stop(only());
    const interrupt = await servers[0]?.waitFor((message) => message.method === 'turn/interrupt');
    assert.deepEqual(interrupt?.params, { threadId: THREAD, turnId: 'turn-1' });
    await settle();
    await settle();
    assert.equal(only().state, 'blocked');
    assert.equal(only().error, null);
    await assert.rejects(runner.stop(only()), statusIs(409));

    await runner.remove(only());
    assert.deepEqual(runner.agents(), []);
  });

  it('stops a running task before removing it', async () => {
    await start();
    await runner.remove(only());
    const interrupt = await servers[0]?.waitFor((message) => message.method === 'turn/interrupt');
    assert.deepEqual(interrupt?.params, { threadId: THREAD, turnId: 'turn-1' });
    assert.deepEqual(runner.agents(), []);

    // A fresh runner reads the saved list, so the task stays gone.
    await runner.flush();
    runner = createRunner();
    await runner.load();
    assert.deepEqual(runner.agents(), []);
  });

  it('forgets a task whose Codex never started', async () => {
    runner = new CodexRunner({
      dataDir,
      codexDir: dataDir,
      onChange: () => undefined,
      spawn: () => {
        const server = new FakeAppServer({});
        server.stdin.once('data', () => {
          server.stderr.write("'codex' is not recognized as an internal or external command\n");
          setImmediate(() => server.emit('exit', 1));
        });
        return server;
      },
    });
    await runner.load();
    await assert.rejects(start(), statusIs(503));
    assert.deepEqual(runner.agents(), []);
  });

  it('marks turns that were running when Orchboard stopped as needing a reply', async () => {
    await start();
    await runner.flush();
    const restarted = createRunner();
    await restarted.load();
    const [agent] = restarted.agents();
    assert.equal(agent?.state, 'blocked');
    assert.match(agent.error ?? '', /Reply to continue/);
    assert.equal(agent.sessionId, THREAD);
  });
});

function statusIs(status: number) {
  return (error: unknown) => error instanceof HttpError && error.status === status;
}
