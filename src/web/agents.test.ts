import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Agent } from '../shared/api.ts';
import { filterAgents, groupByState, listProjects, projectKey, projectLabel } from './agents.ts';

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: 'a',
    provider: 'claude',
    sessionId: 's',
    name: 'Task',
    cwd: '/work/acme/storefront',
    startedAt: 0,
    state: 'working',
    pid: null,
    ...overrides,
  };
}

describe('projectKey', () => {
  it('normalizes Windows paths and trailing slashes', () => {
    assert.equal(projectKey('C:\\Git\\acme\\storefront\\'), 'C:/Git/acme/storefront');
  });

  it('groups worktrees with their main repository', () => {
    assert.equal(
      projectKey('C:\\Git\\acme\\storefront\\.claude\\worktrees\\fix-tests'),
      'C:/Git/acme/storefront',
    );
  });
});

describe('projectLabel', () => {
  it('uses the repository folder name', () => {
    assert.equal(projectLabel('C:/Git/acme/storefront'), 'storefront');
    assert.equal(projectLabel('/repo'), 'repo');
  });
});

describe('listProjects', () => {
  it('counts agents per project, sorted by label', () => {
    const projects = listProjects([
      agent({ cwd: '/w/zeta/api' }),
      agent({ cwd: '/w/acme/web' }),
      agent({ cwd: '/w/acme/web/.claude/worktrees/x' }),
    ]);
    assert.deepEqual(projects, [
      { key: '/w/zeta/api', label: 'api', count: 1, saved: false, pinned: false },
      { key: '/w/acme/web', label: 'web', count: 2, saved: false, pinned: false },
    ]);
  });

  it('lists pinned projects first', () => {
    const projects = listProjects(
      [agent({ cwd: '/w/acme/web' }), agent({ cwd: '/w/zeta/api' })],
      [
        { path: '/w/zeta/api', label: null, pinned: true },
        { path: '/w/acme/web', label: null },
      ],
    );
    assert.deepEqual(
      projects.map((project) => [project.label, project.pinned]),
      [
        ['api', true],
        ['web', false],
      ],
    );
  });

  it('adds the parent folder when two repositories share a name', () => {
    const labels = listProjects([
      agent({ cwd: '/w/acme/server' }),
      agent({ cwd: '/w/zeta/server' }),
      agent({ cwd: '/w/zeta/web' }),
    ]).map((project) => project.label);
    assert.deepEqual(labels, ['acme/server', 'web', 'zeta/server']);
  });
});

describe('filterAgents', () => {
  const agents = [
    agent({ id: '1', name: 'Fix login bug', cwd: '/w/acme/web' }),
    agent({ id: '2', name: 'Add rate limiting', cwd: '/w/acme/api' }),
  ];

  it('filters by project', () => {
    const ids = filterAgents(agents, { project: '/w/acme/api', query: '' }).map((a) => a.id);
    assert.deepEqual(ids, ['2']);
  });

  it('searches names and project labels, ignoring case', () => {
    assert.deepEqual(
      filterAgents(agents, { project: null, query: 'LOGIN' }).map((a) => a.id),
      ['1'],
    );
    assert.deepEqual(
      filterAgents(agents, { project: null, query: 'acme/api' }).map((a) => a.id),
      ['2'],
    );
  });
});

describe('groupByState', () => {
  it('buckets agents by state, newest first', () => {
    const groups = groupByState([
      agent({ id: 'old', state: 'done', startedAt: 1 }),
      agent({ id: 'new', state: 'done', startedAt: 2 }),
      agent({ id: 'b', state: 'blocked' }),
    ]);
    assert.deepEqual(
      groups.done.map((a) => a.id),
      ['new', 'old'],
    );
    assert.deepEqual(
      groups.blocked.map((a) => a.id),
      ['b'],
    );
    assert.deepEqual(groups.working, []);
  });
});
