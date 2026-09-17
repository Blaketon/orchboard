import http from 'node:http';
import type { AgentFeed, AgentSnapshot } from './agents/agent-monitor.ts';
import { isLoopbackHost, isTrustedRequest } from './security.ts';
import type { TranscriptSource } from './transcripts/transcript-reader.ts';

export interface ServerOptions {
  readonly host: string;
  readonly agents: AgentFeed;
  readonly transcripts: TranscriptSource;
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
        const snapshot = options.agents.current() ?? (await options.agents.ready());
        const agent = snapshot.agents.find((candidate) => candidate.id === params.id);
        if (!agent) {
          sendJson(res, 404, { error: 'Agent not found' });
          return;
        }
        sendJson(res, 200, { entries: await options.transcripts.read(agent) });
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

  return http.createServer((req, res) => {
    if (!isTrustedRequest(req.headers, trust)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const match = matchRoute(routes, req.method ?? '', pathname);
    if (!match) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    Promise.resolve()
      .then(() => match.route.handler(req, res, match.params))
      .catch((error: unknown) => {
        console.error(error);
        if (res.headersSent) res.end();
        else sendJson(res, 500, { error: 'Internal server error' });
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
