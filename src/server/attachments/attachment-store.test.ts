import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { HttpError } from '../http-error.ts';
import {
  AttachmentStore,
  describeAttachments,
  detectImageType,
  parseAttachmentIds,
} from './attachment-store.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e.png';

const status = (expected: number) => (error: unknown) =>
  error instanceof HttpError && error.status === expected;

describe('detectImageType', () => {
  it('recognizes images by their leading bytes', () => {
    assert.equal(detectImageType(PNG), 'png');
    assert.equal(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
    assert.equal(detectImageType(new TextEncoder().encode('GIF89a')), 'gif');
    assert.equal(detectImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'webp');
    assert.equal(detectImageType(new TextEncoder().encode('<svg onload="alert(1)">')), undefined);
    assert.equal(detectImageType(new Uint8Array()), undefined);
  });
});

describe('parseAttachmentIds', () => {
  it('accepts store-generated ids only', () => {
    assert.deepEqual(parseAttachmentIds(undefined), []);
    assert.deepEqual(parseAttachmentIds([ID, ID]), [ID]);
    assert.throws(() => parseAttachmentIds(['../secret.png']), status(400));
    assert.throws(() => parseAttachmentIds(['C:/Users/me/x.png']), status(400));
    assert.throws(() => parseAttachmentIds('x'), status(400));
  });

  it('limits how many images a task has', () => {
    const ids = Array.from({ length: 11 }, (_, i) =>
      ID.replace('0f8f', `0f${String(i).padStart(2, '0')}`),
    );
    assert.throws(() => parseAttachmentIds(ids), status(400));
  });
});

describe('AttachmentStore', () => {
  let dataDir: string;
  let store: AttachmentStore;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-attachments-'));
    store = new AttachmentStore(dataDir);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('saves an image and reads it back', async () => {
    const { id } = await store.save(PNG);
    assert.match(id, /\.png$/);
    const image = await store.read(id);
    assert.equal(image.contentType, 'image/png');
    assert.deepEqual(new Uint8Array(image.bytes), PNG);
    assert.deepEqual(await store.paths([id]), [path.join(dataDir, 'attachments', id)]);
  });

  it('rejects files that are not images', async () => {
    await assert.rejects(store.save(new TextEncoder().encode('<html>')), status(415));
  });

  it('reports missing attachments', async () => {
    await assert.rejects(store.read(ID), status(404));
    await assert.rejects(store.read('../queue.json'), status(404));
    await assert.rejects(store.paths([ID]), status(400));
  });

  it('prunes old attachments that are no longer referenced', async () => {
    const old = await store.save(PNG);
    const queued = await store.save(PNG);
    const fresh = await store.save(PNG);
    const monthAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    for (const { id } of [old, queued]) {
      await fs.utimes(path.join(store.dir, id), monthAgo, monthAgo);
    }

    const removed = await store.prune({
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      keep: new Set([queued.id]),
    });
    assert.equal(removed, 1);
    assert.deepEqual((await fs.readdir(store.dir)).sort(), [queued.id, fresh.id].sort());
  });
});

describe('describeAttachments', () => {
  it('lists image paths for the agent', () => {
    assert.equal(describeAttachments([]), '');
    assert.equal(
      describeAttachments(['/a.png']),
      '\n\nAttached image (open with the Read tool):\n- /a.png',
    );
  });
});
