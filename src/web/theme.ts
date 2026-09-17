type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'orchboard-theme';
const ORDER: readonly ThemeChoice[] = ['system', 'light', 'dark'];

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function saveChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage can be unavailable (private windows, blocked site data); the theme still applies.
  }
}

function apply(choice: ThemeChoice, button: HTMLButtonElement): void {
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  button.textContent = `Theme: ${choice}`;
}

/** Cycles system → light → dark, remembering the choice in this browser. */
export function setUpThemeToggle(button: HTMLButtonElement): void {
  let choice = readChoice();
  apply(choice, button);
  button.addEventListener('click', () => {
    choice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? 'system';
    saveChoice(choice);
    apply(choice, button);
  });
}
