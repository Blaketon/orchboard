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

  /** Adds a project, or updates the label of one that is already saved. */
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

    const rawLabel = typeof request.label === 'string' ? request.label.trim() : '';
    if (rawLabel.length > MAX_LABEL_CHARS) {
      throw new HttpError(400, `Project names can be at most ${MAX_LABEL_CHARS} characters.`);
    }
    const label = rawLabel || null;

    await this.#store.update((projects) => {
      const existing = projects.findIndex((project) => project.path === key);
      if (existing === -1) return [...projects, { path: key, label }];
      return projects.map((project, i) => (i === existing ? { ...project, label } : project));
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
        (item.label === null || typeof item.label === 'string'),
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
