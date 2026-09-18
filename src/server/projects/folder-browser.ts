import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FolderEntry, FolderListing } from '../../shared/api.ts';
import { HttpError } from '../http-error.ts';

const MAX_PATH_CHARS = 4096;
const DRIVES_TTL_MS = 30_000;

export interface FolderBrowserOptions {
  /** Where browsing starts: the home folder, or the sample projects in demo mode. */
  readonly home: string;
  /** Most subfolders listed at once; a folder like `node_modules` can hold thousands. */
  readonly maxFolders?: number;
}

/**
 * Lists folders so the user can pick a project folder instead of typing its path. It only reads
 * folder names; nothing is opened or changed.
 */
export class FolderBrowser {
  readonly #home: string;
  readonly #maxFolders: number;
  #drives: { readonly at: number; readonly value: Promise<string[]> } | undefined;

  constructor(options: FolderBrowserOptions) {
    this.#home = path.resolve(options.home);
    this.#maxFolders = options.maxFolders ?? 500;
  }

  /** Lists the folders inside `requested`, or inside the home folder when it is null or empty. */
  async list(requested: string | null): Promise<FolderListing> {
    const dir = this.#resolve(requested);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new HttpError(404, `Folder not found: ${dir}`);
      }
      throw new HttpError(403, `Orchboard can't open ${dir}`);
    }

    const names = (
      await Promise.all(
        entries.map(async (entry) =>
          !entry.name.startsWith('.') && (await isFolder(dir, entry)) ? entry.name : null,
        ),
      )
    ).filter((name) => name !== null);
    names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const listed = names.slice(0, this.#maxFolders);

    const folders = await Promise.all(
      listed.map(async (name): Promise<FolderEntry> => {
        const folder = path.join(dir, name);
        // A worktree has a `.git` file rather than a folder; either marks a repository.
        return { name, path: folder, repository: await exists(path.join(folder, '.git')) };
      }),
    );
    const parent = path.dirname(dir);
    return {
      path: dir,
      parent: parent === dir ? null : parent,
      folders,
      truncated: names.length > listed.length,
      roots: [this.#home, ...(await this.#driveRoots())],
    };
  }

  #resolve(requested: string | null): string {
    const value = requested?.trim() ?? '';
    if (!value) return this.#home;
    if (value.length > MAX_PATH_CHARS || value.includes('\0') || !path.isAbsolute(value)) {
      throw new HttpError(400, 'Enter the absolute path of a folder.');
    }
    return path.resolve(value);
  }

  /** The drives on Windows, briefly cached since a disconnected network drive is slow to check. */
  #driveRoots(): Promise<string[]> {
    if (process.platform !== 'win32') return Promise.resolve(['/']);
    const now = Date.now();
    if (!this.#drives || now - this.#drives.at > DRIVES_TTL_MS) {
      this.#drives = { at: now, value: windowsDrives() };
    }
    return this.#drives.value;
  }
}

async function isFolder(dir: string, entry: Dirent): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  // Follow links, but leave out the ones that can't be opened, like the "My Documents"
  // junctions Windows keeps in the home folder for old programs.
  try {
    await (await fs.opendir(path.join(dir, entry.name))).close();
    return true;
  } catch {
    return false;
  }
}

async function windowsDrives(): Promise<string[]> {
  const drives = await Promise.all(
    Array.from({ length: 26 }, async (_, index) => {
      const root = `${String.fromCharCode(65 + index)}:\\`;
      return (await exists(root)) ? root : null;
    }),
  );
  return drives.filter((drive) => drive !== null);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
