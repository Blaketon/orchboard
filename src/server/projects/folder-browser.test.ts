import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { HttpError } from '../http-error.ts';
import { FolderBrowser } from './folder-browser.ts';

describe('FolderBrowser', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orchboard-folders-'));
  for (const dir of ['beta', 'Alpha', 'app10', 'app2', '.hidden', 'repo/.git', 'worktree']) {
    fs.mkdirSync(path.join(home, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(home, 'worktree', '.git'), 'gitdir: ../repo/.git/worktrees/x\n');
  fs.writeFileSync(path.join(home, 'notes.txt'), 'not a folder');
  const browser = new FolderBrowser({ home });

  after(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const status = (code: number) => (error: unknown) =>
    error instanceof HttpError && error.status === code;

  it('starts in the home folder and lists visible folders by name', async () => {
    const listing = await browser.list(null);
    assert.equal(listing.path, path.resolve(home));
    assert.equal(listing.parent, path.dirname(path.resolve(home)));
    assert.deepEqual(
      listing.folders.map((folder) => folder.name),
      ['Alpha', 'app2', 'app10', 'beta', 'repo', 'worktree'],
    );
    assert.equal(listing.truncated, false);
    assert.equal(listing.roots[0], path.resolve(home));
    assert.ok(listing.roots.length > 1);
  });

  it('marks git repositories, including worktrees', async () => {
    const listing = await browser.list(home);
    const repositories = listing.folders.filter((folder) => folder.repository);
    assert.deepEqual(
      repositories.map((folder) => folder.path),
      [path.join(home, 'repo'), path.join(home, 'worktree')],
    );
  });

  it('lists a subfolder and normalizes the path', async () => {
    const listing = await browser.list(path.join(home, 'beta', '..', 'repo'));
    assert.equal(listing.path, path.join(home, 'repo'));
    assert.deepEqual(listing.folders, []);
  });

  it('caps long listings', async () => {
    const capped = new FolderBrowser({ home, maxFolders: 2 });
    const listing = await capped.list(null);
    assert.deepEqual(
      listing.folders.map((folder) => folder.name),
      ['Alpha', 'app2'],
    );
    assert.equal(listing.truncated, true);
  });

  it('rejects relative paths and reports missing folders', async () => {
    await assert.rejects(browser.list('projects'), status(400));
    await assert.rejects(browser.list(`${home}\0`), status(400));
    await assert.rejects(browser.list(path.join(home, 'missing')), status(404));
    await assert.rejects(browser.list(path.join(home, 'notes.txt')), status(404));
  });
});
