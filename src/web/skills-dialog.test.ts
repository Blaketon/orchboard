import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Skill } from '../shared/api.ts';
import { filterSkills } from './skills-dialog.ts';

const skill = (name: string, source: Skill['source'], description = ''): Skill => ({
  name,
  description,
  source,
  path: `/home/me/.${source.toLowerCase()}/skills/${name}`,
  system: false,
});

describe('filterSkills', () => {
  const skills = [
    skill('review', 'Claude', 'Review a pull request diff'),
    skill('deploy', 'Claude', 'Ship to production'),
    skill('plan', 'Codex', 'Plan a change before editing'),
  ];

  it('filters by source', () => {
    assert.deepEqual(
      filterSkills(skills, 'Codex', '').map((item) => item.name),
      ['plan'],
    );
  });

  it('matches every search word anywhere in the name, description, or path', () => {
    assert.deepEqual(
      filterSkills(skills, 'all', 'DIFF review').map((item) => item.name),
      ['review'],
    );
    assert.deepEqual(
      filterSkills(skills, 'all', '.codex').map((item) => item.name),
      ['plan'],
    );
    assert.equal(filterSkills(skills, 'Claude', 'plan').length, 0);
  });
});
