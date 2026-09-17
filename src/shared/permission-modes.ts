/** Claude Code's `--permission-mode` choices, with labels for the new-task form. */
export const PERMISSION_MODES = [
  { value: 'manual', label: 'Ask before acting' },
  { value: 'acceptEdits', label: 'Auto-accept file edits' },
  { value: 'plan', label: 'Plan only, no changes' },
  { value: 'auto', label: 'Auto mode' },
  { value: 'dontAsk', label: "Don't ask" },
  { value: 'bypassPermissions', label: 'Bypass all permissions (dangerous)' },
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number]['value'];

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'manual';

export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.some((mode) => mode.value === value);
}

/** Codex sandbox and approval presets, matching the Codex CLI's own choices. */
export const CODEX_PERMISSION_MODES = [
  { value: 'read-only', label: 'Read only, ask before changes' },
  { value: 'auto', label: 'Edit the project, ask for anything else' },
  { value: 'full-access', label: 'Full access, never ask (dangerous)' },
] as const;

export type CodexPermissionMode = (typeof CODEX_PERMISSION_MODES)[number]['value'];

export const DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode = 'read-only';

export function isCodexPermissionMode(value: unknown): value is CodexPermissionMode {
  return CODEX_PERMISSION_MODES.some((mode) => mode.value === value);
}
