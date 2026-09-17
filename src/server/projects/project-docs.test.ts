import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { projectKey } from '../../shared/projects.ts';
import { HttpError } from '../http-error.ts';
import { matchLineEndings, ProjectDocs } from './project-docs.ts';

describe('ProjectDocs', () => {
  let root: string;
  let project: string;
  let docs: ProjectDocs;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-docs-'));
    project = path.join(root, 'storefront');
    await fs.mkdir(project);
    docs = new ProjectDocs({
      isKnownProject: (key) => Promise.resolve(key === projectKey(project)),
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const status = (expected: number) => (error: unknown) =>
    error instanceof HttpError && error.status === expected;

  it('reads both files, reporting missing ones as empty', async () => {
    await fs.writeFile(path.join(project, 'CLAUDE.md'), '# Rules\n');
    const result = await docs.read(`${project}${path.sep}`);

    assert.equal(result.path, projectKey(project));
    const [claude, agents] = result.files;
    assert.ok(claude);
    assert.equal(claude.name, 'CLAUDE.md');
    assert.equal(claude.exists, true);
    assert.equal(claude.content, '# Rules\n');
    assert.equal(typeof claude.modifiedAt, 'number');
    assert.deepEqual(agents, { name: 'AGENTS.md', exists: false, content: '', modifiedAt: null });
  });

  it('creates a new file', async () => {
    const saved = await docs.save({
      path: project,
      name: 'AGENTS.md',
      content: 'Run the tests.\n',
      expectedModifiedAt: null,
    });
    assert.equal(saved.exists, true);
    assert.equal(await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8'), 'Run the tests.\n');
  });

  it('updates a file it loaded, keeping CRLF line endings', async () => {
    await fs.writeFile(path.join(project, 'CLAUDE.md'), 'one\r\ntwo\r\n');
    const [loaded] = (await docs.read(project)).files;
    await docs.save({
      path: project,
      name: 'CLAUDE.md',
      content: 'one\ntwo\nthree\n',
      expectedModifiedAt: loaded?.modifiedAt ?? null,
    });
    assert.equal(
      await fs.readFile(path.join(project, 'CLAUDE.md'), 'utf8'),
      'one\r\ntwo\r\nthree\r\n',
    );
  });

  it('refuses to overwrite a file that changed after it was loaded', async () => {
    await assert.rejects(
      docs.save({ path: project, name: 'CLAUDE.md', content: 'x', expectedModifiedAt: 12345 }),
      status(409),
    );
    await fs.writeFile(path.join(project, 'CLAUDE.md'), 'written by an agent');
    await assert.rejects(
      docs.save({ path: project, name: 'CLAUDE.md', content: 'x', expectedModifiedAt: null }),
      status(409),
    );
    assert.equal(await fs.readFile(path.join(project, 'CLAUDE.md'), 'utf8'), 'written by an agent');
  });

  it('only edits the known file names', async () => {
    await assert.rejects(
      docs.save({ path: project, name: '../escape.md', content: 'x', expectedModifiedAt: null }),
      status(400),
    );
    await assert.rejects(
      docs.save({ path: project, name: 'README.md', content: 'x', expectedModifiedAt: null }),
      status(400),
    );
  });

  it('only opens projects on the board', async () => {
    const other = path.join(root, 'other');
    await fs.mkdir(other);
    await assert.rejects(docs.read(other), status(403));
    await assert.rejects(
      docs.save({ path: other, name: 'CLAUDE.md', content: 'x', expectedModifiedAt: null }),
      status(403),
    );
    await assert.rejects(docs.read('relative/path'), status(400));
  });

  it('reports a known project whose folder is gone', async () => {
    await fs.rm(project, { recursive: true });
    await assert.rejects(docs.read(project), status(404));
  });

  it('rejects malformed and oversized saves', async () => {
    await assert.rejects(docs.save({ path: project, name: 'CLAUDE.md' }), status(400));
    await assert.rejects(
      docs.save({
        path: project,
        name: 'CLAUDE.md',
        content: 'x'.repeat(500_001),
        expectedModifiedAt: null,
      }),
      status(413),
    );
  });
});

describe('matchLineEndings', () => {
  it('converts to CRLF only when the previous content used it', () => {
    assert.equal(matchLineEndings('a\nb', 'x\r\ny'), 'a\r\nb');
    assert.equal(matchLineEndings('a\nb', 'x\ny'), 'a\nb');
    assert.equal(matchLineEndings('a\r\nb', 'x\r\ny'), 'a\r\nb');
  });
});
