import http from 'node:http';
import type { Agent, Skill, Transcript } from '../shared/api.ts';
import type { AgentActions } from './agents/agent-actions.ts';
import type { AgentFeed, AgentSnapshot } from './agents/agent-monitor.ts';
import { MAX_IMAGE_BYTES, type AttachmentStore } from './attachments/attachment-store.ts';
import { HttpError, readBody, readJsonBody } from './http-error.ts';
import type { ModelService } from './models/model-service.ts';
import type { FolderBrowser } from './projects/folder-browser.ts';
import type { ProjectDocs } from './projects/project-docs.ts';
import type { ProjectsStore } from './projects/projects-store.ts';
import type { QueueStore } from './queue/queue-store.ts';
import { isLoopbackHost, isTrustedRequest } from './security.ts';
import { serveStatic, type StaticRoots } from './static-files.ts';
import type { UsageService } from './usage/usage-service.ts';

export interface ServerOptions {
  readonly host: string;
  readonly agents: AgentFeed;
  readonly transcripts: { read(agent: Agent): Promise<Transcript> };
  readonly actions: AgentActions;
  readonly projects: Pick<ProjectsStore, 'list' | 'save' | 'remove'>;
  readonly projectDocs: Pick<ProjectDocs, 'read' | 'save'>;
  readonly folders: Pick<FolderBrowser, 'list'>;
  readonly skills: () => Promise<Skill[]>;
  readonly attachments: Pick<AttachmentStore, 'save' | 'read'>;
  readonly queue: Pick<
    QueueStore,
    | 'read'
    | 'addColumn'
    | 'renameColumn'
    | 'removeColumn'
    | 'addTask'
    | 'updateTask'
    | 'moveTask'
    | 'removeTask'
    | 'start'
  >;
  readonly usage: Pick<UsageService, 'report'>;
  readonly models: Pick<ModelService, 'models'>;
  readonly openTerminal: (agent: Agent) => Promise<void>;
  /** Where the web app's files live. Without it, only the API is served. */
  readonly staticRoots?: StaticRoots;
  /** How often idle event streams send a comment so proxies don't drop them. */
  readonly keepAliveMs?: number;
}

type Params = Readonly<Record<string, string>>;
type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Params,
) => void | Promise<void>;

interface Route {
  readonly method: string;
  /** Path segments starting with `:` capture that segment, e.g. `/api/agents/:id`. */
  readonly path: string;
  readonly handler: Handler;
}

export function createServer(options: ServerOptions): http.Server {
  const trust = { allowAnyHost: !isLoopbackHost(options.host) };
  const keepAliveMs = options.keepAliveMs ?? 25_000;

  const findAgent = async (id: string | undefined): Promise<Agent> => {
    const snapshot = options.agents.current() ?? (await options.agents.ready());
    const agent = snapshot.agents.find((candidate) => candidate.id === id);
    if (!agent) throw new HttpError(404, 'Agent not found');
    return agent;
  };

  const routes: Route[] = [
    {
      method: 'GET',
      path: '/api/health',
      handler: (_req, res) => {
        sendJson(res, 200, { status: 'ok' });
      },
    },
    {
      method: 'GET',
      path: '/api/agents',
      handler: async (_req, res) => {
        const first = await options.agents.ready();
        sendJson(res, 200, options.agents.current() ?? first);
      },
    },
    {
      method: 'GET',
      path: '/api/agents/:id/transcript',
      handler: async (_req, res, params) => {
        sendJson(res, 200, await options.transcripts.read(await findAgent(params.id)));
      },
    },
    {
      method: 'GET',
      path: '/api/projects',
      handler: async (_req, res) => {
        sendJson(res, 200, await options.projects.list());
      },
    },
    {
      method: 'POST',
      path: '/api/projects',
      handler: async (req, res) => {
        sendJson(res, 200, await options.projects.save(await readJsonBody(req)));
      },
    },
    {
      method: 'DELETE',
      path: '/api/projects',
      handler: async (req, res) => {
        // Project paths contain slashes, so they travel in the query string, not the path.
        const projectPath = new URL(req.url ?? '/', 'http://localhost').searchParams.get('path');
        if (!projectPath) throw new HttpError(400, 'Missing project path.');
        sendJson(res, 200, await options.projects.remove(projectPath));
      },
    },
    {
      method: 'GET',
      path: '/api/projects/docs',
      handler: async (req, res) => {
        const projectPath = new URL(req.url ?? '/', 'http://localhost').searchParams.get('path');
        if (!projectPath) throw new HttpError(400, 'Missing project path.');
        sendJson(res, 200, await options.projectDocs.read(projectPath));
      },
    },
    {
      method: 'PUT',
      path: '/api/projects/docs',
      handler: async (req, res) => {
        sendJson(res, 200, await options.projectDocs.save(await readJsonBody(req)));
      },
    },
    {
      method: 'GET',
      path: '/api/folders',
      handler: async (req, res) => {
        const folder = new URL(req.url ?? '/', 'http://localhost').searchParams.get('path');
        sendJson(res, 200, await options.folders.list(folder));
      },
    },
    {
      method: 'GET',
      path: '/api/skills',
      handler: async (_req, res) => {
        sendJson(res, 200, await options.skills());
      },
    },
    {
      method: 'GET',
      path: '/api/usage',
      handler: async (_req, res) => {
        sendJson(res, 200, await options.usage.report());
      },
    },
    {
      method: 'GET',
      path: '/api/models/:provider',
      handler: async (_req, res, params) => {
        const { provider } = params;
        if (provider !== 'claude' && provider !== 'codex') {
          throw new HttpError(404, 'Unknown agent.');
        }
        sendJson(res, 200, await options.models.models(provider));
      },
    },
    {
      method: 'GET',
      path: '/api/queue',
      handler: async (_req, res) => {
        sendJson(res, 200, await options.queue.read());
      },
    },
    {
      method: 'POST',
      path: '/api/queue/columns',
      handler: async (req, res) => {
        sendJson(res, 201, await options.queue.addColumn(await readJsonBody(req)));
      },
    },
    {
      method: 'PATCH',
      path: '/api/queue/columns/:id',
      handler: async (req, res, params) => {
        sendJson(
          res,
          200,
          await options.queue.renameColumn(params.id ?? '', await readJsonBody(req)),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/api/queue/columns/:id',
      handler: async (_req, res, params) => {
        sendJson(res, 200, await options.queue.removeColumn(params.id ?? ''));
      },
    },
    {
      method: 'POST',
      path: '/api/queue/tasks',
      handler: async (req, res) => {
        sendJson(res, 201, await options.queue.addTask(await readJsonBody(req)));
      },
    },
    {
      method: 'PATCH',
      path: '/api/queue/tasks/:id',
      handler: async (req, res, params) => {
        sendJson(
          res,
          200,
          await options.queue.updateTask(params.id ?? '', await readJsonBody(req)),
        );
      },
    },
    {
      method: 'POST',
      path: '/api/queue/tasks/:id/move',
      handler: async (req, res, params) => {
        sendJson(res, 200, await options.queue.moveTask(params.id ?? '', await readJsonBody(req)));
      },
    },
    {
      method: 'DELETE',
      path: '/api/queue/tasks/:id',
      handler: async (_req, res, params) => {
        sendJson(res, 200, await options.queue.removeTask(params.id ?? ''));
      },
    },
    {
      method: 'POST',
      path: '/api/queue/tasks/:id/start',
      handler: async (_req, res, params) => {
        const result = await options.queue.start(params.id ?? '');
        options.agents.refresh();
        sendJson(res, 201, result);
      },
    },
    {
      method: 'POST',
      path: '/api/attachments',
      handler: async (req, res) => {
        // Like the JSON-only API, a non-simple content type keeps other sites from posting here.
        if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('image/')) {
          throw new HttpError(415, 'Expected an image request body.');
        }
        sendJson(res, 201, await options.attachments.save(await readBody(req, MAX_IMAGE_BYTES)));
      },
    },
    {
      method: 'GET',
      path: '/api/attachments/:id',
      handler: async (_req, res, params) => {
        const image = await options.attachments.read(params.id ?? '');
        res.writeHead(200, {
          'Content-Type': image.contentType,
          'Content-Length': image.bytes.length,
          'Cache-Control': 'private, max-age=86400, immutable',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(image.bytes);
      },
    },
    {
      method: 'POST',
      path: '/api/tasks',
      handler: async (req, res) => {
        const result = await options.actions.start(await readJsonBody(req));
        options.agents.refresh();
        sendJson(res, 201, result);
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/reply',
      handler: async (req, res, params) => {
        const agent = await findAgent(params.id);
        await options.actions.reply(agent, await readJsonBody(req));
        options.agents.refresh();
        sendJson(res, 202, { ok: true });
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/approvals/:approvalId',
      handler: async (req, res, params) => {
        const agent = await findAgent(params.id);
        await options.actions.decide(agent, params.approvalId ?? '', await readJsonBody(req));
        options.agents.refresh();
        sendJson(res, 202, { ok: true });
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/terminal',
      handler: async (_req, res, params) => {
        await options.openTerminal(await findAgent(params.id));
        sendJson(res, 202, { ok: true });
      },
    },
    {
      method: 'POST',
      path: '/api/agents/:id/stop',
      handler: async (_req, res, params) => {
        await options.actions.stop(await findAgent(params.id));
        options.agents.refresh();
        sendJson(res, 202, { ok: true });
      },
    },
    {
      method: 'DELETE',
      path: '/api/agents/:id',
      handler: async (_req, res, params) => {
        await options.actions.remove(await findAgent(params.id));
        options.agents.refresh();
        sendJson(res, 202, { ok: true });
      },
    },
    {
      method: 'GET',
      path: '/api/events',
      handler: (req, res) => {
        streamAgents(req, res, options.agents, keepAliveMs);
      },
    },
  ];

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    if (!isTrustedRequest(req.headers, trust)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const match = matchRoute(routes, req.method ?? '', pathname);
    if (match) {
      await match.route.handler(req, res, match.params);
      return;
    }
    if (
      options.staticRoots &&
      !pathname.startsWith('/api/') &&
      (await serveStatic(req, res, pathname, options.staticRoots))
    ) {
      return;
    }
    sendJson(res, 404, { error: 'Not found' });
  };

  return http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
      } else if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error(error);
        sendJson(res, 500, { error: 'Internal server error' });
      }
    });
  });
}

function matchRoute(
  routes: readonly Route[],
  method: string,
  pathname: string,
): { route: Route; params: Params } | undefined {
  const actual = pathname.split('/');
  for (const route of routes) {
    if (route.method !== method) continue;
    const expected = route.path.split('/');
    if (expected.length !== actual.length) continue;

    const params: Record<string, string> = {};
    const matches = expected.every((segment, i) => {
      const value = actual[i] ?? '';
      if (!segment.startsWith(':')) return segment === value;
      if (!value) return false;
      try {
        params[segment.slice(1)] = decodeURIComponent(value);
        return true;
      } catch {
        return false;
      }
    });
    if (matches) return { route, params };
  }
  return undefined;
}

/** Streams agent snapshots as Server-Sent Events: the current one first, then every change. */
function streamAgents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  feed: AgentFeed,
  keepAliveMs: number,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');

  const send = (snapshot: AgentSnapshot): void => {
    res.write(`event: agents\ndata: ${JSON.stringify(snapshot)}\n\n`);
  };

  // Before the first poll there is nothing to send. An empty placeholder would look like
  // every agent just vanished; the first real snapshot arrives through the subscription.
  const initial = feed.current();
  if (initial) send(initial);
  const unsubscribe = feed.subscribe(send);

  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), keepAliveMs);
  keepAlive.unref();

  req.on('close', () => {
    unsubscribe();
    clearInterval(keepAlive);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
