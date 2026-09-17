import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import {
  AppServerClient,
  AppServerError,
  CodexCliMissingError,
  connectAppServer,
  type AppServerHandlers,
  type AppServerProcess,
  type ServerRequest,
} from './app-server.ts';

/** A fake app server: collects what the client writes and lets tests reply line by line. */
class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 1234;
  readonly sent: Record<string, unknown>[] = [];
  killed = false;

  constructor() {
    super();
    this.stdin.setEncoding('utf8');
    let buffer = '';
    this.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) this.sent.push(JSON.parse(line) as Record<string, unknown>);
      this.emit('sent');
    });
  }

  reply(message: object): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', null);
    return true;
  }

  /** The `index`th message the client wrote, waiting for it if needed. */
  async sentAt(index: number): Promise<Record<string, unknown>> {
    while (this.sent.length <= index) {
      await new Promise((resolve) => this.once('sent', resolve));
    }
    return this.sent[index] ?? {};
  }
}

function handlers(): AppServerHandlers & {
  notifications: [string, unknown][];
  requests: ServerRequest[];
  exits: [number | null, string][];
} {
  const notifications: [string, unknown][] = [];
  const requests: ServerRequest[] = [];
  const exits: [number | null, string][] = [];
  return {
    notifications,
    requests,
    exits,
    onNotification: (method, params) => notifications.push([method, params]),
    onRequest: (request) => requests.push(request),
    onExit: (code, stderr) => exits.push([code, stderr]),
  };
}

const asProcess = (fake: FakeProcess) => fake as unknown as AppServerProcess;

describe('AppServerClient', () => {
  it('matches responses to requests and routes notifications and server requests', async () => {
    const fake = new FakeProcess();
    const events = handlers();
    const client = new AppServerClient(asProcess(fake), events);

    const result = client.request<{ thread: { id: string } }>('thread/start', { cwd: '/work' });
    const sent = await fake.sentAt(0);
    assert.deepEqual(sent, {
      jsonrpc: '2.0',
      id: 1,
      method: 'thread/start',
      params: { cwd: '/work' },
    });

    // A split line and an unrelated message arrive before the response.
    fake.stdout.write('{"jsonrpc":"2.0","method":"turn/started",');
    fake.stdout.write('"params":{"threadId":"t"}}\n');
    fake.reply({
      jsonrpc: '2.0',
      id: 'approval-1',
      method: 'item/fileChange/requestApproval',
      params: {},
    });
    fake.reply({ jsonrpc: '2.0', id: 1, result: { thread: { id: 't' } } });

    assert.deepEqual(await result, { thread: { id: 't' } });
    assert.deepEqual(events.notifications, [['turn/started', { threadId: 't' }]]);
    assert.deepEqual(events.requests, [
      { id: 'approval-1', method: 'item/fileChange/requestApproval', params: {} },
    ]);

    client.respond('approval-1', { decision: 'accept' });
    assert.deepEqual(await fake.sentAt(1), {
      jsonrpc: '2.0',
      id: 'approval-1',
      result: { decision: 'accept' },
    });
  });

  it('rejects with the server error, and rejects pending requests when the process exits', async () => {
    const fake = new FakeProcess();
    const events = handlers();
    const client = new AppServerClient(asProcess(fake), events);

    const failing = client.request('turn/start', {});
    await fake.sentAt(0);
    fake.reply({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'thread not found' } });
    await assert.rejects(failing, (error: unknown) => {
      assert.ok(error instanceof AppServerError);
      assert.equal(error.message, 'thread not found');
      assert.equal(error.code, -32600);
      return true;
    });

    const hanging = client.request('turn/start', {});
    await fake.sentAt(1);
    fake.stderr.write('rate limited\n');
    await new Promise((resolve) => setImmediate(resolve));
    fake.emit('exit', 1);
    await assert.rejects(hanging, /rate limited/);
    assert.deepEqual(events.exits, [[1, 'rate limited']]);
    assert.equal(client.exited, true);
    await assert.rejects(client.request('x', {}), /no longer running/);
  });
});

describe('connectAppServer', () => {
  it('initializes the connection', async () => {
    const fake = new FakeProcess();
    const connecting = connectAppServer('/work', handlers(), () => asProcess(fake));
    const initialize = await fake.sentAt(0);
    assert.equal(initialize.method, 'initialize');
    fake.reply({ jsonrpc: '2.0', id: initialize.id, result: {} });

    const client = await connecting;
    assert.deepEqual(await fake.sentAt(1), { jsonrpc: '2.0', method: 'initialized' });
    assert.equal(client.pid, 1234);
  });

  it('explains a missing Codex CLI', async () => {
    const fake = new FakeProcess();
    const connecting = connectAppServer('/work', handlers(), () => asProcess(fake));
    await fake.sentAt(0);
    fake.stderr.write("'codex' is not recognized as an internal or external command\n");
    await new Promise((resolve) => setImmediate(resolve));
    fake.emit('exit', 1);
    await assert.rejects(connecting, CodexCliMissingError);
  });
});
