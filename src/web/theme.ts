import type { ThemeChoice } from './settings-store.ts';

/** Applies a theme; "system" follows the operating system's light or dark preference. */
export function applyTheme(choice: ThemeChoice): void {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}
