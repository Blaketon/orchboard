import http from 'node:http';
import type { Config } from './config.ts';
import { isLoopbackHost, isTrustedRequest } from './security.ts';

export function createServer(config: Pick<Config, 'host'>): http.Server {
  const trust = { allowAnyHost: !isLoopbackHost(config.host) };

  return http.createServer((req, res) => {
    if (!isTrustedRequest(req.headers, trust)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
