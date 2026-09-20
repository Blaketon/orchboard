import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectKey, projectLabel } from './projects.ts';

describe('projectKey', () => {
  it('converts backslashes to forward slashes', () => {
    assert.equal(projectKey('C:\\Git\\acme\\storefront'), 'C:/Git/acme/storefront');
  });

  it('trims trailing slashes and surrounding whitespace', () => {
    assert.equal(projectKey('  /Users/acme/storefront/  '), '/Users/acme/storefront');
    assert.equal(projectKey('C:\\Git\\acme\\storefront\\'), 'C:/Git/acme/storefront');
  });

  it('groups a git worktree with its main repository', () => {
    assert.equal(
      projectKey('/Users/acme/storefront/.claude/worktrees/task-fields'),
      '/Users/acme/storefront',
    );
    assert.equal(
      projectKey('C:\\Git\\storefront\\.claude\\worktrees\\task-fields'),
      'C:/Git/storefront',
    );
  });
});

describe('projectLabel', () => {
  it('uses the last path segment as the label', () => {
    assert.equal(projectLabel('C:/Git/acme/storefront'), 'storefront');
    assert.equal(projectLabel('/Users/acme/storefront'), 'storefront');
  });

  it('falls back to the whole key when there is no segment', () => {
    assert.equal(projectLabel(''), '');
  });
});
