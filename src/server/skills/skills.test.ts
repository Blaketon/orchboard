import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { listSkills, parseFrontmatter, skillRoots } from './skills.ts';

describe('parseFrontmatter', () => {
  it('reads plain and quoted values', () => {
    const meta = parseFrontmatter(
      "---\nname: deploy\ndescription: \"Ship it: safely\"\nnote: 'it''s fine'\n---\n# Deploy\n",
    );
    assert.equal(meta.get('name'), 'deploy');
    assert.equal(meta.get('description'), 'Ship it: safely');
    assert.equal(meta.get('note'), "it's fine");
  });

  it('reads folded, literal, and continued values', () => {
    const meta = parseFrontmatter(
      [
        '---',
        'folded: >',
        '  one',
        '  two',
        'literal: |-',
        '  one',
        '  two',
        'continued: starts here',
        '  and ends here',
        'metadata:',
        '  nested: ignored',
        '---',
      ].join('\r\n'),
    );
    assert.equal(meta.get('folded'), 'one two');
    assert.equal(meta.get('literal'), 'one\ntwo');
    assert.equal(meta.get('continued'), 'starts here and ends here');
    assert.equal(meta.has('nested'), false);
  });

  it('returns nothing without frontmatter', () => {
    assert.equal(parseFrontmatter('# Just a heading\nname: not meta').size, 0);
  });
});

describe('listSkills', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-skills-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function writeSkill(dir: string, content: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), content);
  }

  it('finds Claude and Codex skills, sorted by source and name', async () => {
    const claudeDir = path.join(root, 'claude');
    const codexDir = path.join(root, 'codex');
    await writeSkill(
      path.join(claudeDir, 'skills', 'review'),
      '---\nname: review\ndescription: Review a diff\n---\n',
    );
    await writeSkill(path.join(claudeDir, 'skills', 'Audit'), '# No frontmatter\n');
    await writeSkill(
      path.join(codexDir, 'skills', '.system', 'plan'),
      '---\nname: plan\ndescription: Plan work\n---\n',
    );

    const skills = await listSkills(skillRoots(claudeDir, codexDir));
    assert.deepEqual(skills, [
      {
        name: 'Audit',
        description: '',
        source: 'Claude',
        path: path.join(claudeDir, 'skills', 'Audit'),
        system: false,
      },
      {
        name: 'review',
        description: 'Review a diff',
        source: 'Claude',
        path: path.join(claudeDir, 'skills', 'review'),
        system: false,
      },
      {
        name: 'plan',
        description: 'Plan work',
        source: 'Codex',
        path: path.join(codexDir, 'skills', '.system', 'plan'),
        system: true,
      },
    ]);
  });

  it('returns nothing when the skill folders are missing', async () => {
    assert.deepEqual(await listSkills(skillRoots(path.join(root, 'a'), path.join(root, 'b'))), []);
  });

  it('skips skills nested too deeply and inside node_modules', async () => {
    const claudeDir = path.join(root, 'claude');
    await writeSkill(path.join(claudeDir, 'skills', 'a', 'b', 'c', 'd'), '# too deep');
    await writeSkill(path.join(claudeDir, 'skills', 'tool', 'node_modules', 'x'), '# vendored');
    assert.deepEqual(await listSkills(skillRoots(claudeDir, path.join(root, 'codex'))), []);
  });
});
