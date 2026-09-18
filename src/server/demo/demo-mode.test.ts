import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { AttachmentStore } from '../attachments/attachment-store.ts';
import { ProjectDocs } from '../projects/project-docs.ts';
import { ProjectsStore } from '../projects/projects-store.ts';
import { QueueStore } from '../queue/queue-store.ts';
import { createServer } from '../server.ts';
import { createDemo, type Demo } from './demo-mode.ts';

/**
 * End-to-end check of demo mode: the whole server, its sample data, and the request guards,
 * without a real agent anywhere.
 */
describe('demo mode', () => {
  let demo: Demo;
  let server: http.Server;
  let port = 0;

  before(async () => {
    demo = await createDemo(Date.UTC(2026, 8, 17, 12));
    const projects = new ProjectsStore(demo.dataDir);
    server = createServer({
      host: '127.0.0.1',
      agents: demo.agents,
      transcripts: demo.transcripts,
      actions: demo.actions,
      projects,
      projectDocs: new ProjectDocs({
        isKnownProject: async (key) =>
          (await projects.list()).some((project) => project.path === key),
      }),
      skills: demo.skills,
      attachments: new AttachmentStore(demo.dataDir),
      queue: new QueueStore(demo.dataDir, demo.actions),
      usage: demo.usage,
      models: demo.models,
      openTerminal: demo.openTerminal,
      staticRoots: {
        publicDir: path.resolve(import.meta.dirname, '..', '..', '..', 'public'),
        buildDir: path.resolve(import.meta.dirname, '..', '..', '..', 'dist'),
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(demo.dataDir, { recursive: true, force: true });
  });

  function request(
    url: string,
    options: { method?: string; headers?: http.OutgoingHttpHeaders; body?: string } = {},
  ): Promise<{ status: number; type: string | undefined; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: url, method: options.method ?? 'GET', ...options },
        (res) => {
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
        },
      );
      req.on('error', reject);
      req.end(options.body);
    });
  }

  const json = async (url: string): Promise<unknown> => JSON.parse((await request(url)).body);

  it('serves the dashboard page', async () => {
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(page.type ?? '', /text\/html/);
    assert.match(page.body, /<title>Orchboard<\/title>/);
    assert.match(page.body, /\/app\/web\/main\.js/);
  });

  it('shows sample agents, projects, queue, usage, skills, and models', async () => {
    const snapshot = (await json('/api/agents')) as { agents: { provider: string }[] };
    assert.ok(snapshot.agents.length >= 6);
    assert.ok(snapshot.agents.some((agent) => agent.provider === 'codex'));

    const projects = (await json('/api/projects')) as { exists: boolean }[];
    assert.equal(projects.length, 3);
    assert.ok(projects.every((project) => project.exists));

    const queue = (await json('/api/queue')) as { columns: unknown[]; tasks: unknown[] };
    assert.equal(queue.columns.length, 3);
    assert.equal(queue.tasks.length, 3);

    const usage = (await json('/api/usage')) as { claude: { windows: unknown[] } };
    assert.equal(usage.claude.windows.length, 2);

    assert.ok(((await json('/api/skills')) as unknown[]).length > 0);

    const models = (await json('/api/models/codex')) as { default: string; options: unknown[] };
    assert.equal(models.default, 'gpt-5.5-codex');
    assert.ok(models.options.length > 0);
  });

  it('shows a transcript with usage for a sample task', async () => {
    const snapshot = (await json('/api/agents')) as { agents: { id: string; state: string }[] };
    const blocked = snapshot.agents.find((agent) => agent.state === 'blocked');
    assert.ok(blocked);
    const transcript = (await json(`/api/agents/${blocked.id}/transcript`)) as {
      entries: unknown[];
      usage: unknown;
    };
    assert.ok(transcript.entries.length > 0);
    assert.ok(transcript.usage);
  });

  it('refuses to start, stop, or answer anything', async () => {
    const start = await request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: '/work', prompt: 'Try it' }),
    });
    assert.equal(start.status, 400);
    assert.match(start.body, /demo/i);
  });

  it('keeps the request guards on', async () => {
    const foreignHost = await request('/api/agents', { headers: { host: 'example.com' } });
    assert.equal(foreignHost.status, 403);

    const crossSite = await request('/api/agents', {
      headers: { host: `127.0.0.1:${port}`, origin: 'https://evil.example' },
    });
    assert.equal(crossSite.status, 403);

    const notJson = await request('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(notJson.status, 415);
  });

  it('puts its sample data in a sandbox, not in a real project', async () => {
    const entries = await fs.readdir(demo.dataDir);
    assert.deepEqual(entries.sort(), ['projects', 'projects.json', 'queue.json']);
    assert.match(demo.dataDir, /orchboard-demo$/);
  });
});
