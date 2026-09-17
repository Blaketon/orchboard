import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { projectKey } from '../../shared/projects.ts';
import { HttpError } from '../http-error.ts';
import { ProjectsStore } from './projects-store.ts';

describe('ProjectsStore', () => {
  let root: string;
  let project: string;
  let store: ProjectsStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-projects-'));
    project = path.join(root, 'storefront');
    await fs.mkdir(project);
    store = new ProjectsStore(path.join(root, 'data'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    assert.deepEqual(await store.list(), []);
  });

  it('adds a project under its normalized path, once', async () => {
    await store.save({ path: `${project}${path.sep}` });
    const projects = await store.save({ path: project, label: 'Shop' });
    assert.deepEqual(projects, [
      { path: projectKey(project), label: 'Shop', pinned: false, exists: true },
    ]);
  });

  it('clears a label when it is saved blank', async () => {
    await store.save({ path: project, label: 'Shop' });
    const [saved] = await store.save({ path: project, label: '  ' });
    assert.equal(saved?.label, null);
  });

  it('pins a project without losing its name, and unpins it again', async () => {
    await store.save({ path: project, label: 'Shop' });
    const [pinned] = await store.save({ path: project, pinned: true });
    assert.ok(pinned);
    assert.equal(pinned.pinned, true);
    assert.equal(pinned.label, 'Shop');

    const [renamed] = await store.save({ path: project, label: 'Storefront' });
    assert.ok(renamed);
    assert.equal(renamed.pinned, true);

    const [unpinned] = await store.save({ path: project, pinned: false });
    assert.ok(unpinned);
    assert.equal(unpinned.pinned, false);
    assert.equal(unpinned.label, 'Storefront');
  });

  it('removes a project', async () => {
    await store.save({ path: project });
    assert.deepEqual(await store.remove(project), []);
  });

  it('reports projects whose folder has disappeared', async () => {
    await store.save({ path: project });
    await fs.rm(project, { recursive: true });
    assert.equal((await store.list())[0]?.exists, false);
  });

  it('rejects relative paths, missing folders, and long labels', async () => {
    const statusOf = async (request: unknown) => {
      try {
        await store.save(request);
        return 200;
      } catch (error) {
        return error instanceof HttpError ? error.status : 500;
      }
    };
    assert.equal(await statusOf({ path: 'relative' }), 400);
    assert.equal(await statusOf({ path: path.join(root, 'missing') }), 400);
    assert.equal(await statusOf({ path: project, label: 'x'.repeat(61) }), 400);
  });
});
