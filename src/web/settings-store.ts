export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  readonly theme: ThemeChoice;
  /** Show a toast when an agent completes. */
  readonly toastOnDone: boolean;
  /** Show a toast when an agent starts waiting for input. */
  readonly toastOnBlocked: boolean;
  /** Also show a system notification while the dashboard tab is in the background. */
  readonly desktopNotifications: boolean;
  readonly toastSeconds: number;
  readonly soundOnDone: boolean;
  readonly soundOnBlocked: boolean;
  /** 0 to 1. */
  readonly volume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  toastOnDone: true,
  toastOnBlocked: true,
  desktopNotifications: false,
  toastSeconds: 6,
  soundOnDone: true,
  soundOnBlocked: false,
  volume: 0.6,
};

const STORAGE_KEY = 'orchboard-settings';

/** Reads stored settings, keeping only valid values so an old or edited entry can't break the app. */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const value = raw as Record<string, unknown>;
  const bool = (key: keyof Settings): boolean =>
    typeof value[key] === 'boolean' ? value[key] : (DEFAULT_SETTINGS[key] as boolean);
  const number = (key: keyof Settings, min: number, max: number): number => {
    const n = value[key];
    return typeof n === 'number' && Number.isFinite(n)
      ? Math.min(max, Math.max(min, n))
      : (DEFAULT_SETTINGS[key] as number);
  };
  return {
    theme: value.theme === 'light' || value.theme === 'dark' ? value.theme : 'system',
    toastOnDone: bool('toastOnDone'),
    toastOnBlocked: bool('toastOnBlocked'),
    desktopNotifications: bool('desktopNotifications'),
    toastSeconds: number('toastSeconds', 2, 60),
    soundOnDone: bool('soundOnDone'),
    soundOnBlocked: bool('soundOnBlocked'),
    volume: number('volume', 0, 1),
  };
}

type Listener = (settings: Settings) => void;

/** Settings for this browser, saved in localStorage. */
export class SettingsStore {
  #settings: Settings;
  readonly #listeners = new Set<Listener>();

  constructor() {
    this.#settings = DEFAULT_SETTINGS;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) this.#settings = parseSettings(JSON.parse(stored));
    } catch {
      // Unreadable or unavailable storage: keep the defaults.
    }
  }

  get(): Settings {
    return this.#settings;
  }

  update(changes: Partial<Settings>): void {
    this.#settings = parseSettings({ ...this.#settings, ...changes });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#settings));
    } catch {
      // Settings still apply for this session.
    }
    for (const listener of this.#listeners) listener(this.#settings);
  }

  subscribe(listener: Listener): void {
    this.#listeners.add(listener);
    listener(this.#settings);
  }
}
