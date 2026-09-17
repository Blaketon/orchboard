import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ProjectDoc,
  ProjectDocName,
  ProjectDocs as ProjectDocsView,
} from '../../shared/api.ts';
import { projectKey } from '../../shared/projects.ts';
import { HttpError, isRecord } from '../http-error.ts';

export const PROJECT_DOC_NAMES: readonly ProjectDocName[] = ['CLAUDE.md', 'AGENTS.md'];
export const MAX_DOC_CHARS = 500_000;

export interface ProjectDocsOptions {
  /** Whether a normalized project path is on the board: saved, or where an agent runs. */
  readonly isKnownProject: (key: string) => Promise<boolean>;
}

/**
 * Reads and writes a project's agent instruction files.
 *
 * These files steer every agent started in the project, so only projects already on the board
 * can be edited, and only the two known file names. Saves are rejected when the file changed
 * since the editor loaded it, so an agent's or another editor's changes aren't overwritten.
 */
export class ProjectDocs {
  readonly #options: ProjectDocsOptions;

  constructor(options: ProjectDocsOptions) {
    this.#options = options;
  }

  async read(projectPath: string): Promise<ProjectDocsView> {
    const dir = await this.#projectDir(projectPath);
    return {
      path: dir,
      files: await Promise.all(PROJECT_DOC_NAMES.map((name) => readDoc(dir, name))),
    };
  }

  async save(request: unknown): Promise<ProjectDoc> {
    if (
      !isRecord(request) ||
      typeof request.path !== 'string' ||
      typeof request.content !== 'string' ||
      !(request.expectedModifiedAt === null || typeof request.expectedModifiedAt === 'number')
    ) {
      throw new HttpError(
        400,
        'Expected a project path, file name, content, and expectedModifiedAt.',
      );
    }
    const name = PROJECT_DOC_NAMES.find((candidate) => candidate === request.name);
    if (!name) throw new HttpError(400, `Only ${PROJECT_DOC_NAMES.join(' and ')} can be edited.`);
    if (request.content.length > MAX_DOC_CHARS) {
      throw new HttpError(
        413,
        `${name} can be at most ${MAX_DOC_CHARS.toLocaleString('en')} characters.`,
      );
    }

    const dir = await this.#projectDir(request.path);
    const current = await readDoc(dir, name);
    if (current.modifiedAt !== request.expectedModifiedAt) {
      throw new HttpError(
        409,
        `${name} changed on disk after you opened it. Reload to see the latest version.`,
      );
    }
    // Written in place rather than through a temp file and rename, so a symlinked file
    // (a common way to share one AGENTS.md and CLAUDE.md) stays a symlink.
    await fs.writeFile(
      path.join(dir, name),
      current.exists ? matchLineEndings(request.content, current.content) : request.content,
      'utf8',
    );
    return readDoc(dir, name);
  }

  async #projectDir(projectPath: string): Promise<string> {
    if (!path.isAbsolute(projectPath.trim())) {
      throw new HttpError(400, 'Expected the absolute path of a project folder.');
    }
    const key = projectKey(projectPath);
    if (!(await this.#options.isKnownProject(key))) {
      throw new HttpError(403, 'Add this folder as a project before editing its files.');
    }
    try {
      if ((await fs.stat(key)).isDirectory()) return key;
    } catch {
      // Reported below.
    }
    throw new HttpError(404, `Folder not found: ${key}`);
  }
}

async function readDoc(dir: string, name: ProjectDocName): Promise<ProjectDoc> {
  const file = path.join(dir, name);
  try {
    const [content, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    return { name, exists: true, content, modifiedAt: stat.mtimeMs };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { name, exists: false, content: '', modifiedAt: null };
    }
    throw error;
  }
}

/** Browsers send textarea contents with LF line endings; keep a CRLF file CRLF. */
export function matchLineEndings(content: string, previous: string): string {
  if (!previous.includes('\r\n') || content.includes('\r')) return content;
  return content.replace(/\n/g, '\r\n');
}
