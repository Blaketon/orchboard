/**
 * Normalizes a working directory to its project: forward slashes, no trailing slash, and git
 * worktrees under `.claude/worktrees/` grouped with their main repository.
 */
export function projectKey(cwd: string): string {
  const normalized = cwd.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const worktree = normalized.indexOf('/.claude/worktrees/');
  return worktree === -1 ? normalized : normalized.slice(0, worktree);
}

/** The repository folder name, e.g. `storefront` for `C:/Git/acme/storefront`. */
export function projectLabel(key: string): string {
  return key.split('/').filter(Boolean).at(-1) ?? key;
}
