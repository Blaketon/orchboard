import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { JsonStore } from './json-store.ts';

interface Counter {
  count: number;
}

function isCounter(value: unknown): value is Counter {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { count?: unknown }).count === 'number'
  );
}

describe('JsonStore', () => {
  let dir: string;
  let file: string;
  let warnings: string[];

  function createStore(): JsonStore<Counter> {
    return new JsonStore(file, {
      fallback: () => ({ count: 0 }),
      validate: isCounter,
      onWarning: (message) => warnings.push(message),
    });
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-store-'));
    file = path.join(dir, 'nested', 'counter.json');
    warnings = [];
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns the fallback without creating a file when none exists', async () => {
    assert.deepEqual(await createStore().read(), { count: 0 });
    await assert.rejects(fs.access(file));
  });

  it('writes readable JSON, creating missing directories', async () => {
    const store = createStore();
    await store.write({ count: 3 });
    assert.deepEqual(await store.read(), { count: 3 });
    assert.equal(await fs.readFile(file, 'utf8'), '{\n  "count": 3\n}\n');
  });

  it('persists updates across store instances', async () => {
    await createStore().update((current) => ({ count: current.count + 1 }));
    assert.deepEqual(await createStore().read(), { count: 1 });
  });

  it('applies concurrent updates one after another without losing any', async () => {
    const store = createStore();
    await Promise.all(
      Array.from({ length: 25 }, () => store.update((current) => ({ count: current.count + 1 }))),
    );
    assert.deepEqual(await store.read(), { count: 25 });
  });

  it('leaves the file unchanged when an update throws, and keeps working', async () => {
    const store = createStore();
    await store.write({ count: 1 });
    await assert.rejects(
      store.update(() => {
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.deepEqual(await store.read(), { count: 1 });
    await store.update((current) => ({ count: current.count + 1 }));
    assert.deepEqual(await store.read(), { count: 2 });
  });

  it('leaves no temp files behind', async () => {
    const store = createStore();
    await store.write({ count: 1 });
    await store.write({ count: 2 });
    assert.deepEqual(await fs.readdir(path.dirname(file)), ['counter.json']);
  });

  it('sets aside a file with invalid JSON instead of overwriting it', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json');

    assert.deepEqual(await createStore().read(), { count: 0 });

    const entries = await fs.readdir(path.dirname(file));
    const backup = entries.find((name) => name.startsWith('counter.json.corrupt-'));
    assert.ok(backup, 'expected a backup file');
    assert.equal(await fs.readFile(path.join(path.dirname(file), backup), 'utf8'), '{ not json');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /is not valid JSON/);
  });

  it('sets aside a file with the wrong shape', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ "count": "three" }');

    assert.deepEqual(await createStore().read(), { count: 0 });
    assert.match(warnings[0] ?? '', /has an unexpected format/);
  });
});
