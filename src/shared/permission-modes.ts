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
