import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createServer } from './server.ts';

interface Response {
  status: number;
  body: unknown;
}

describe('server', () => {
  const server = createServer({ host: '127.0.0.1' });
  let port = 0;

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function request(
    path: string,
    options: { method?: string; headers?: http.OutgoingHttpHeaders } = {},
  ): Promise<Response> {
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

  it('answers the health check', async () => {
    assert.deepEqual(await request('/api/health'), { status: 200, body: { status: 'ok' } });
  });

  it('returns 404 for unknown routes', async () => {
    assert.equal((await request('/api/nope')).status, 404);
  });

  it('rejects a foreign Host header', async () => {
    const res = await request('/api/health', { headers: { host: `evil.example:${port}` } });
    assert.equal(res.status, 403);
  });

  it('rejects a cross-site Origin', async () => {
    const res = await request('/api/health', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
  });
});
