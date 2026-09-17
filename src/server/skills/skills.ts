import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Skill } from '../../shared/api.ts';

export interface SkillRoot {
  readonly source: Skill['source'];
  readonly dir: string;
}

/** Skill folders can be grouped (e.g. Codex's `.system/`), but never nest deeply. */
const MAX_DEPTH = 3;
const SKIPPED_DIRS = new Set(['node_modules', '.git']);

export function skillRoots(claudeDir: string, codexDir: string): SkillRoot[] {
  return [
    { source: 'Claude', dir: path.join(claudeDir, 'skills') },
    { source: 'Codex', dir: path.join(codexDir, 'skills') },
  ];
}

/** Lists every `SKILL.md` under the roots. Missing roots and unreadable files are skipped. */
export async function listSkills(roots: readonly SkillRoot[]): Promise<Skill[]> {
  const found = await Promise.all(
    roots.map(async (root) => {
      const files = await findSkillFiles(root.dir, 0);
      const skills = await Promise.all(files.map((file) => readSkill(root, file)));
      return skills.filter((skill) => skill !== undefined);
    }),
  );
  return found
    .flat()
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    );
}

async function findSkillFiles(dir: string, depth: number): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const full = path.join(dir, entry.name);
      if (entry.name === 'SKILL.md' && entry.isFile()) return [full];
      if (depth >= MAX_DEPTH || SKIPPED_DIRS.has(entry.name)) return [];
      // Skills are often linked in from a checkout, so follow directory symlinks too.
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await isDirectory(full)))) {
        return findSkillFiles(full, depth + 1);
      }
      return [];
    }),
  );
  return nested.flat();
}

async function readSkill(root: SkillRoot, file: string): Promise<Skill | undefined> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  const folder = path.dirname(file);
  const meta = parseFrontmatter(text);
  const name = meta.get('name') ?? '';
  return {
    name: name === '' ? path.basename(folder) : name,
    description: meta.get('description') ?? '',
    source: root.source,
    path: folder,
    system: path.relative(root.dir, folder).split(path.sep).includes('.system'),
  };
}

/**
 * Reads top-level `key: value` pairs from a Markdown file's YAML frontmatter. Handles the forms
 * skill files use: plain, quoted, folded (`>`), and literal (`|`) values, including plain values
 * continued on indented lines. Nested YAML is ignored.
 */
export function parseFrontmatter(text: string): Map<string, string> {
  const meta = new Map<string, string>();
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    text.charCodeAt(0) === 0xfeff ? text.slice(1) : text,
  );
  if (!match) return meta;

  const lines = (match[1] ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const entry = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i] ?? '');
    if (!entry) continue;
    const key = entry[1] ?? '';
    const value = (entry[2] ?? '').trim();

    const continued: string[] = [];
    while (i + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[i + 1] ?? '')) {
      continued.push((lines[++i] ?? '').trim());
    }
    while (continued.at(-1) === '') continued.pop();

    const block = /^([>|])[+-]?$/.exec(value);
    if (block) {
      meta.set(key, block[1] === '|' ? continued.join('\n') : foldLines(continued));
    } else {
      meta.set(key, unquote(foldLines([value, ...continued])));
    }
  }
  return meta;
}

/** YAML folding: single line breaks become spaces, blank lines become line breaks. */
function foldLines(lines: readonly string[]): string {
  return lines
    .join('\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, ' '))
    .join('\n')
    .trim();
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}
