import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { resolveStaticPath } from './static-files.ts';

const roots = { publicDir: path.resolve('/srv/public'), buildDir: path.resolve('/srv/dist') };

describe('resolveStaticPath', () => {
  it('serves index.html for the root path', () => {
    assert.equal(resolveStaticPath('/', roots), path.join(roots.publicDir, 'index.html'));
  });

  it('serves public files and compiled browser code', () => {
    assert.equal(resolveStaticPath('/styles.css', roots), path.join(roots.publicDir, 'styles.css'));
    assert.equal(
      resolveStaticPath('/assets/logo-128.png', roots),
      path.join(roots.publicDir, 'assets', 'logo-128.png'),
    );
    assert.equal(
      resolveStaticPath('/app/web/main.js', roots),
      path.join(roots.buildDir, 'web', 'main.js'),
    );
    assert.equal(
      resolveStaticPath('/app/shared/api.js', roots),
      path.join(roots.buildDir, 'shared', 'api.js'),
    );
  });

  it('keeps compiled server code private', () => {
    assert.equal(resolveStaticPath('/app/server/main.js', roots), undefined);
  });

  it('refuses paths that escape the root, even when encoded', () => {
    for (const pathname of [
      '/../secrets.css',
      '/app/web/../../server/main.js',
      '/%2e%2e/secrets.css',
      '/app/web/..%2f..%2fsecret.js',
      '/app/web/..%5c..%5csecret.js',
    ]) {
      assert.equal(resolveStaticPath(pathname, roots), undefined, pathname);
    }
  });

  it('refuses hidden files, unknown file types, and malformed encoding', () => {
    for (const pathname of [
      '/.env',
      '/assets/.hidden.png',
      '/notes.txt',
      '/app/web/main.ts',
      '/%E0%A4%A',
    ]) {
      assert.equal(resolveStaticPath(pathname, roots), undefined, pathname);
    }
  });
});
