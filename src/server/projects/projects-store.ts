import fs from 'node:fs/promises';
import path from 'node:path';
import type { SavedProject, SavedProjectView } from '../../shared/api.ts';
import { projectKey } from '../../shared/projects.ts';
import { HttpError, isRecord } from '../http-error.ts';
import { JsonStore } from '../storage/json-store.ts';

export const MAX_LABEL_CHARS = 60;

/** Projects the user added to the sidebar, kept in `projects.json`. */
export class ProjectsStore {
  readonly #store: JsonStore<SavedProject[]>;

  constructor(dataDir: string) {
    this.#store = new JsonStore(path.join(dataDir, 'projects.json'), {
      fallback: () => [],
      validate: isSavedProjectList,
    });
  }

  async list(): Promise<SavedProjectView[]> {
    const projects = await this.#store.read();
    return Promise.all(
      projects.map(async (project) => ({ ...project, exists: await isDirectory(project.path) })),
    );
  }

  /**
   * Adds a project, or updates one that is already saved. Only the fields in the request
   * change, so pinning keeps the project's name and renaming keeps its pin.
   */
  async save(request: unknown): Promise<SavedProjectView[]> {
    if (
      !isRecord(request) ||
      typeof request.path !== 'string' ||
      !path.isAbsolute(request.path.trim())
    ) {
      throw new HttpError(400, 'Enter the absolute path of a project folder.');
    }
    const key = projectKey(request.path);
    if (!(await isDirectory(key)))
      throw new HttpError(400, `Folder not found: ${request.path.trim()}`);

    let label: string | null | undefined;
    if (request.label !== undefined) {
      const raw = typeof request.label === 'string' ? request.label.trim() : '';
      if (raw.length > MAX_LABEL_CHARS) {
        throw new HttpError(400, `Project names can be at most ${MAX_LABEL_CHARS} characters.`);
      }
      label = raw || null;
    }
    if (request.pinned !== undefined && typeof request.pinned !== 'boolean') {
      throw new HttpError(400, 'Expected pinned to be true or false.');
    }
    const { pinned } = request;

    await this.#store.update((projects) => {
      const existing = projects.find((project) => project.path === key);
      const saved: SavedProject = {
        path: key,
        label: label === undefined ? (existing?.label ?? null) : label,
        pinned: pinned ?? existing?.pinned ?? false,
      };
      return existing
        ? projects.map((project) => (project.path === key ? saved : project))
        : [...projects, saved];
    });
    return this.list();
  }

  async remove(projectPath: string): Promise<SavedProjectView[]> {
    const key = projectKey(projectPath);
    await this.#store.update((projects) => projects.filter((project) => project.path !== key));
    return this.list();
  }
}

function isSavedProjectList(value: unknown): value is SavedProject[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.path === 'string' &&
        (item.label === null || typeof item.label === 'string') &&
        (item.pinned === undefined || typeof item.pinned === 'boolean'),
    )
  );
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
