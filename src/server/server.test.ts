import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { QueueState } from '../shared/api.ts';
import { AgentMonitor, type AgentSnapshot } from './agents/agent-monitor.ts';
import type { AgentActions } from './agents/agent-actions.ts';
import type { Agent } from './agents/claude-agents.ts';
import { HttpError } from './http-error.ts';
import { QueueStore } from './queue/queue-store.ts';
import { createServer } from './server.ts';
import type { Transcript } from './transcripts/transcript-reader.ts';

interface JsonResponse {
  status: number;
  body: unknown;
}

function agent(id: string, state: Agent['state']): Agent {
  return {
    id,
    provider: 'claude',
    sessionId: `${id}-session`,
    name: `Task ${id}`,
    cwd: '/work',
    startedAt: 1,
    state,
    pid: null,
  };
}

describe('server', () => {
  let agents: Agent[] = [agent('a', 'working')];
  const monitor = new AgentMonitor({
    list: () => Promise.resolve({ agents, skipped: [] }),
    log: () => undefined,
  });
  const transcriptReads: string[] = [];
  const transcript: Transcript = {
    entries: [{ role: 'user', timestamp: 't', parts: [{ type: 'text', text: 'Fix the tests' }] }],
    usage: null,
  };
  const queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchboard-server-queue-'));
  const actionCalls: unknown[][] = [];
  const actions: AgentActions = {
    start: (request) => {
      actionCalls.push(['start', request]);
      return Promise.resolve({ id: 'new12345' });
    },
    reply: (target, request) => {
      actionCalls.push(['reply', target.id, request]);
      return Promise.resolve();
    },
    stop: (target) => {
      actionCalls.push(['stop', target.id]);
      return Promise.reject(new HttpError(409, 'This agent is not running.'));
    },
    remove: (target) => {
      actionCalls.push(['remove', target.id]);
      return Promise.resolve();
    },
    decide: (target, approvalId, request) => {
      actionCalls.push(['decide', target.id, approvalId, request]);
      return Promise.resolve();
    },
  };
  const server = createServer({
    host: '127.0.0.1',
    agents: monitor,
    transcripts: {
      read: (session) => {
        transcriptReads.push(session.sessionId);
        return Promise.resolve(transcript);
      },
    },
    actions,
    projects: {
      list: () => Promise.resolve([{ path: '/work', label: null, exists: true }]),
      save: () => Promise.resolve([]),
      remove: (projectPath) => {
        removedProjects.push(projectPath);
        return Promise.resolve([]);
      },
    },
    projectDocs: {
      read: (projectPath) =>
        Promise.resolve({
          path: projectPath,
          files: [{ name: 'CLAUDE.md', exists: true, content: '# Rules', modifiedAt: 1 }],
        }),
      save: (body) => {
        savedDocs.push(body);
        return Promise.resolve({ name: 'CLAUDE.md', exists: true, content: '', modifiedAt: 2 });
      },
    },
    folders: {
      list: (folder) => {
        browsedFolders.push(folder);
        return Promise.resolve({
          path: folder ?? '/home',
          parent: null,
          folders: [],
          truncated: false,
          roots: ['/home', '/'],
        });
      },
    },
    skills: () =>
      Promise.resolve([
        {
          name: 'review',
          description: 'Review a diff',
          source: 'Claude',
          path: '/s',
          system: false,
        },
      ]),
    attachments: {
      save: (bytes) => {
        uploads.push(bytes.length);
        return Promise.resolve({ id: 'img' });
      },
      read: (id) =>
        id === 'known.png'
          ? Promise.resolve({ bytes: Buffer.from('png-bytes'), contentType: 'image/png' })
          : Promise.reject(new HttpError(404, 'Attachment not found.')),
    },
    queue: new QueueStore(queueDir, actions),
    openTerminal: (target) => {
      actionCalls.push(['terminal', target.id]);
      return Promise.resolve();
    },
    usage: {
      report: () =>
        Promise.resolve({
          claude: { windows: [], error: 'Not logged in to Claude Code.' },
          codex: { windows: [], error: null },
        }),
    },
    models: {
      models: (provider) =>
        Promise.resolve({
          default: provider === 'claude' ? 'opus' : null,
          options: [{ value: `${provider}-model`, label: 'Model' }],
        }),
    },
  });
  const removedProjects: string[] = [];
  const browsedFolders: (string | null)[] = [];
  const savedDocs: unknown[] = [];
  const uploads: number[] = [];
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
    options: { method?: string; headers?: http.OutgoingHttpHeaders; body?: string } = {},
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
      req.end(options.body);
    });
  }

  const postJson = (path: string, body: unknown) =>
    request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('starts a task', async () => {
    const body = { cwd: '/work', prompt: 'Fix the tests' };
    assert.deepEqual(await postJson('/api/tasks', body), {
      status: 201,
      body: { id: 'new12345' },
    });
    assert.deepEqual(actionCalls.at(-1), ['start', body]);
  });

  it('replies to an agent and passes action errors through with their status', async () => {
    assert.equal((await postJson('/api/agents/a/reply', { prompt: 'Yes' })).status, 202);
    assert.deepEqual(actionCalls.at(-1), ['reply', 'a', { prompt: 'Yes' }]);

    assert.deepEqual(await postJson('/api/agents/a/stop', {}), {
      status: 409,
      body: { error: 'This agent is not running.' },
    });
    assert.equal((await postJson('/api/agents/nope/reply', { prompt: 'Yes' })).status, 404);

    assert.equal((await request('/api/agents/a', { method: 'DELETE' })).status, 202);
    assert.deepEqual(actionCalls.at(-1), ['remove', 'a']);

    assert.equal((await postJson('/api/agents/a/terminal', {})).status, 202);
    assert.deepEqual(actionCalls.at(-1), ['terminal', 'a']);

    const decided = await postJson('/api/agents/a/approvals/7', { decision: 'accept' });
    assert.equal(decided.status, 202);
    assert.deepEqual(actionCalls.at(-1), ['decide', 'a', '7', { decision: 'accept' }]);
  });

  it('manages queue columns and tasks through the API', async () => {
    const created = await postJson('/api/queue/columns', { project: '/work', name: 'Next up' });
    assert.equal(created.status, 201);
    const columnId = (created.body as QueueState).columns[0]?.id ?? '';

    await postJson('/api/queue/tasks', { columnId, prompt: 'First' });
    let state = (await postJson('/api/queue/tasks', { columnId, prompt: 'Second' }))
      .body as QueueState;
    const [first, second] = state.tasks;

    state = (await postJson(`/api/queue/tasks/${second?.id ?? ''}/move`, { columnId, index: 0 }))
      .body as QueueState;
    assert.deepEqual(
      state.tasks.map((task) => task.prompt),
      ['Second', 'First'],
    );

    const patched = await request(`/api/queue/tasks/${first?.id ?? ''}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    assert.equal((patched.body as QueueState).tasks[1]?.name, 'Renamed');

    const started = await postJson(`/api/queue/tasks/${second?.id ?? ''}/start`, {});
    assert.equal(started.status, 201);
    assert.deepEqual(actionCalls.at(-1)?.[0], 'start');

    const removed = await request(`/api/queue/columns/${columnId}`, { method: 'DELETE' });
    assert.deepEqual(removed.body, { columns: [], tasks: [] });
    fs.rmSync(queueDir, { recursive: true, force: true });
  });

  it('lists saved projects and removes one by its path', async () => {
    assert.deepEqual(await request('/api/projects'), {
      status: 200,
      body: [{ path: '/work', label: null, exists: true }],
    });
    const res = await request(`/api/projects?path=${encodeURIComponent('C:/Git/my app')}`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(removedProjects, ['C:/Git/my app']);
  });

  it('lists folders for picking a project, from home or a given path', async () => {
    assert.equal((await request('/api/folders')).status, 200);
    const res = await request(`/api/folders?path=${encodeURIComponent('C:\\Git\\my app')}`);
    assert.equal((res.body as { path: string }).path, 'C:\\Git\\my app');
    assert.deepEqual(browsedFolders, [null, 'C:\\Git\\my app']);
  });

  it('reads and saves project docs', async () => {
    const read = await request(`/api/projects/docs?path=${encodeURIComponent('/work')}`);
    assert.equal(read.status, 200);
    assert.equal((read.body as { path: string }).path, '/work');
    assert.equal((await request('/api/projects/docs')).status, 400);

    const body = { path: '/work', name: 'CLAUDE.md', content: 'x', expectedModifiedAt: 1 };
    const saved = await request('/api/projects/docs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(savedDocs, [body]);
  });

  it('accepts image uploads and serves them back', async () => {
    const uploaded = await request('/api/attachments', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: 'fake image',
    });
    assert.deepEqual(uploaded, { status: 201, body: { id: 'img' } });
    assert.deepEqual(uploads, [10]);

    const notImage = await request('/api/attachments', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'x',
    });
    assert.equal(notImage.status, 415);

    const image = await new Promise<{ status: number; type: string | undefined; body: string }>(
      (resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port, path: '/api/attachments/known.png' }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (data += chunk));
            res.on('end', () => {
              resolve({
                status: res.statusCode ?? 0,
                type: res.headers['content-type'],
                body: data,
              });
            });
          })
          .on('error', reject);
      },
    );
    assert.deepEqual(image, { status: 200, type: 'image/png', body: 'png-bytes' });
    assert.equal((await request('/api/attachments/other.png')).status, 404);
  });

  it('lists skills', async () => {
    const res = await request('/api/skills');
    assert.equal(res.status, 200);
    assert.equal((res.body as { name: string }[])[0]?.name, 'review');
  });

  it("lists an agent's models with its default", async () => {
    const claude = await request('/api/models/claude');
    assert.equal(claude.status, 200);
    assert.deepEqual(claude.body, {
      default: 'opus',
      options: [{ value: 'claude-model', label: 'Model' }],
    });
    assert.equal((await request('/api/models/codex')).status, 200);
    assert.equal((await request('/api/models/gemini')).status, 404);
  });

  it('rejects action requests that are not JSON', async () => {
    const res = await request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(res.status, 415);
  });

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

  it("returns an agent's transcript", async () => {
    const res = await request('/api/agents/a/transcript');
    assert.deepEqual(res, { status: 200, body: transcript });
    assert.deepEqual(transcriptReads, ['a-session']);
  });

  it('returns 404 for the transcript of an unknown agent', async () => {
    const res = await request('/api/agents/nope/transcript');
    assert.deepEqual(res, { status: 404, body: { error: 'Agent not found' } });
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
