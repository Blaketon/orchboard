import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { HttpError } from '../http-error.ts';
import { QueueStore } from './queue-store.ts';

// An absolute path valid on whatever OS the tests run on: QueueStore's addColumn checks
// `path.isAbsolute` natively, so a hardcoded `C:/...` path only passes on Windows.
const PROJECT = path.join(path.parse(process.cwd()).root, 'Git', 'acme').replace(/\\/g, '/');

describe('QueueStore', () => {
  let dataDir: string;
  let starts: unknown[];
  let failStart: boolean;
  let store: QueueStore;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-queue-'));
    starts = [];
    failStart = false;
    store = new QueueStore(dataDir, {
      start: (request) => {
        if (failStart) return Promise.reject(new HttpError(502, 'Not logged in'));
        starts.push(request);
        return Promise.resolve({ id: 'abcd1234' });
      },
    });
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  async function queueOneTask(): Promise<string> {
    const withColumn = await store.addColumn({ project: PROJECT, name: 'Next' });
    const columnId = withColumn.columns[0]?.id ?? '';
    const withTask = await store.addTask({
      columnId,
      prompt: 'Fix the tests',
      permissionMode: 'acceptEdits',
    });
    return withTask.tasks[0]?.id ?? '';
  }

  it('persists columns and tasks across instances', async () => {
    await queueOneTask();
    const reopened = new QueueStore(dataDir, { start: () => Promise.resolve({ id: null }) });
    const state = await reopened.read();
    assert.equal(state.columns.length, 1);
    assert.equal(state.tasks[0]?.prompt, 'Fix the tests');
  });

  it('starts a queued task with its settings and removes it from the queue', async () => {
    const id = await queueOneTask();
    const { queue, started } = await store.start(id);
    assert.deepEqual(starts, [
      {
        provider: 'claude',
        cwd: PROJECT,
        prompt: 'Fix the tests',
        name: 'Fix the tests',
        permissionMode: 'acceptEdits',
        images: [],
      },
    ]);
    assert.deepEqual(started, { id: 'abcd1234' });
    assert.deepEqual(queue.tasks, []);
  });

  it('keeps the task queued when starting it fails', async () => {
    const id = await queueOneTask();
    failStart = true;
    await assert.rejects(store.start(id), /Not logged in/);
    assert.equal((await store.read()).tasks.length, 1);
  });
});
