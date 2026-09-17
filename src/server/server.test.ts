import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AgentMonitor, type AgentSnapshot } from './agents/agent-monitor.ts';
import type { ClaudeAgent } from './agents/claude-agents.ts';
import { createServer } from './server.ts';

interface JsonResponse {
  status: number;
  body: unknown;
}

function agent(id: string, state: ClaudeAgent['state']): ClaudeAgent {
  return {
    id,
    sessionId: `${id}-session`,
    name: `Task ${id}`,
    cwd: '/work',
    startedAt: 1,
    state,
    pid: null,
  };
}

describe('server', () => {
  let agents: ClaudeAgent[] = [agent('a', 'working')];
  const monitor = new AgentMonitor({
    list: () => Promise.resolve({ agents, skipped: [] }),
    log: () => undefined,
  });
  const server = createServer({ host: '127.0.0.1', agents: monitor });
  let port = 0;

  before(async () => {
    await monitor.poll();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  function request(
    path: string,
    options: { method?: string; headers?: http.OutgoingHttpHeaders } = {},
  ): Promise<JsonResponse> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: options.method ?? 'GET',
          headers: options.headers,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (data += chunk));
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as unknown });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  /** Opens /api/events and yields each `agents` event as it arrives. */
  function openEventStream(): Promise<{ next: () => Promise<AgentSnapshot>; close: () => void }> {
    return new Promise((resolve, reject) => {
      const queued: AgentSnapshot[] = [];
      const waiting: ((snapshot: AgentSnapshot) => void)[] = [];
      let buffer = '';

      const req = http.get({ host: '127.0.0.1', port, path: '/api/events' }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(res.headers['content-type'] ?? '', /^text\/event-stream/);
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = /^event: agents\ndata: (.*)$/m.exec(block)?.[1];
            if (data === undefined) continue;
            const snapshot = JSON.parse(data) as AgentSnapshot;
            const waiter = waiting.shift();
            if (waiter) waiter(snapshot);
            else queued.push(snapshot);
          }
        });
        resolve({
          next: () => {
            const snapshot = queued.shift();
            return snapshot ? Promise.resolve(snapshot) : new Promise((r) => waiting.push(r));
          },
          close: () => req.destroy(),
        });
      });
      req.on('error', reject);
    });
  }

  it('answers the health check', async () => {
    assert.deepEqual(await request('/api/health'), { status: 200, body: { status: 'ok' } });
  });

  it('returns the current agent snapshot', async () => {
    const res = await request('/api/agents');
    assert.equal(res.status, 200);
    assert.deepEqual((res.body as AgentSnapshot).agents, [agent('a', 'working')]);
  });

  it('streams the current snapshot, then every change', async () => {
    const stream = await openEventStream();
    try {
      assert.deepEqual((await stream.next()).agents, agents);

      agents = [agent('a', 'done'), agent('b', 'blocked')];
      await monitor.poll();
      assert.deepEqual((await stream.next()).agents, agents);
    } finally {
      stream.close();
    }
  });

  it('returns 404 for unknown routes and methods', async () => {
    assert.equal((await request('/api/nope')).status, 404);
    assert.equal((await request('/api/agents', { method: 'DELETE' })).status, 404);
  });

  it('rejects a foreign Host header', async () => {
    const res = await request('/api/agents', { headers: { host: `evil.example:${port}` } });
    assert.equal(res.status, 403);
  });

  it('rejects a cross-site Origin', async () => {
    const res = await request('/api/events', { headers: { origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });
});
