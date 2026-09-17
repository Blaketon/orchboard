import http from 'node:http';
import type { AgentFeed, AgentSnapshot } from './agents/agent-monitor.ts';
import { isLoopbackHost, isTrustedRequest } from './security.ts';

export interface ServerOptions {
  readonly host: string;
  readonly agents: AgentFeed;
  /** How often idle event streams send a comment so proxies don't drop them. */
  readonly keepAliveMs?: number;
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

export function createServer(options: ServerOptions): http.Server {
  const trust = { allowAnyHost: !isLoopbackHost(options.host) };
  const keepAliveMs = options.keepAliveMs ?? 25_000;

  const routes = new Map<string, Handler>([
    [
      'GET /api/health',
      (_req, res) => {
        sendJson(res, 200, { status: 'ok' });
      },
    ],
    [
      'GET /api/agents',
      async (_req, res) => {
        const first = await options.agents.ready();
        sendJson(res, 200, options.agents.current() ?? first);
      },
    ],
    [
      'GET /api/events',
      (req, res) => {
        streamAgents(req, res, options.agents, keepAliveMs);
      },
    ],
  ]);

  return http.createServer((req, res) => {
    if (!isTrustedRequest(req.headers, trust)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const handler = routes.get(`${req.method ?? ''} ${pathname}`);
    if (!handler) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    Promise.resolve()
      .then(() => handler(req, res))
      .catch((error: unknown) => {
        console.error(error);
        if (res.headersSent) res.end();
        else sendJson(res, 500, { error: 'Internal server error' });
      });
  });
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
