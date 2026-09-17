import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { USAGE_CACHE_MS, UsageService } from './usage-service.ts';

describe('UsageService', () => {
  let home: string;
  let now: number;
  let requests: { url: string; authorization: string | null }[];
  let respond: () => Response;

  const service = () =>
    new UsageService({
      claudeDir: path.join(home, '.claude'),
      codexDir: path.join(home, '.codex'),
      now: () => now,
      fetch: (input, init) => {
        requests.push({
          url: input instanceof Request ? input.url : input.toString(),
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return Promise.resolve(respond());
      },
    });

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-usage-'));
    now = 1_000_000;
    requests = [];
    respond = () => Response.json({ five_hour: { utilization: 20, resets_at: null } });
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  async function logIn(): Promise<void> {
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(home, '.claude', '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'secret-token' } }),
    );
  }

  it('reports Claude limits using the stored login, and caches them', async () => {
    await logIn();
    const usage = service();
    const first = await usage.report();
    assert.equal(first.claude.windows[0]?.utilization, 20);
    assert.equal(first.claude.error, null);
    assert.deepEqual(requests, [
      { url: 'https://api.anthropic.com/api/oauth/usage', authorization: 'Bearer secret-token' },
    ]);

    await usage.report();
    assert.equal(requests.length, 1, 'second report within the cache window');
    now += USAGE_CACHE_MS;
    await usage.report();
    assert.equal(requests.length, 2);
  });

  it('explains why Claude limits are missing without calling the API', async () => {
    const report = await service().report();
    assert.match(report.claude.error ?? '', /credentials/);
    assert.equal(requests.length, 0);
  });

  it('keeps the last known limits when a refresh fails', async () => {
    await logIn();
    const usage = service();
    await usage.report();
    respond = () => new Response('busy', { status: 429 });
    now += USAGE_CACHE_MS;
    const report = await usage.report();
    assert.equal(report.claude.windows[0]?.utilization, 20);
    assert.match(report.claude.error ?? '', /HTTP 429/);
  });

  it('reads Codex limits from the newest session log that has them', async () => {
    const dir = path.join(home, '.codex', 'sessions', '2026', '09', '17');
    await fs.mkdir(dir, { recursive: true });
    const snapshot = (percent: number) =>
      JSON.stringify({
        payload: { rate_limits: { primary: { used_percent: percent, window_minutes: 300 } } },
      });
    await fs.writeFile(path.join(dir, 'older.jsonl'), `${snapshot(70)}\n`);
    const older = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(dir, 'older.jsonl'), older, older);
    await fs.writeFile(path.join(dir, 'newer.jsonl'), `${snapshot(15)}\n`);

    const report = await service().report();
    assert.equal(report.codex.windows[0]?.utilization, 15);
    assert.equal(report.codex.error, null);
  });
});
