const STORAGE_KEY = 'orchboard-column-order';

/** Column key for a queue column; status columns use their state, e.g. `blocked`. */
export function queueColumnKey(id: string): string {
  return `queue:${id}`;
}

/**
 * Sorts columns by the saved order. Columns missing from it, such as a newly added queue column,
 * go after the saved ones in their default order.
 */
export function orderColumns(keys: readonly string[], saved: readonly string[]): string[] {
  const rank = new Map(saved.map((key, index) => [key, index]));
  const known = keys.filter((key) => rank.has(key));
  known.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  return [...known, ...keys.filter((key) => !rank.has(key))];
}

/** Moves `key` to `index` among the other columns. */
export function moveColumn(order: readonly string[], key: string, index: number): string[] {
  const rest = order.filter((other) => other !== key);
  if (rest.length === order.length) return [...order];
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, key);
  return rest;
}

/**
 * Applies a new order of the shown columns to the saved order. Columns not shown, such as another
 * project's queue columns, keep their places.
 */
export function mergeOrder(saved: readonly string[], shown: readonly string[]): string[] {
  const shownSet = new Set(shown);
  const all = [...saved, ...shown.filter((key) => !saved.includes(key))];
  // The shown columns fill the places the shown columns held, in their new order.
  let next = 0;
  return all.map((key) => (shownSet.has(key) ? (shown[next++] ?? key) : key));
}

/** The board's column order, remembered in this browser. */
export class ColumnOrder {
  #order: string[] = [];

  constructor() {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(stored)) {
        this.#order = stored.filter((key): key is string => typeof key === 'string');
      }
    } catch {
      // Unreadable storage: start with the default order.
    }
  }

  get(): readonly string[] {
    return this.#order;
  }

  /** Saves the shown columns in their new order. */
  update(shown: readonly string[]): void {
    this.#order = mergeOrder(this.#order, shown);
    this.#save();
  }

  /** Forgets columns that no longer exist, such as a removed queue column. */
  prune(existing: ReadonlySet<string>): void {
    const kept = this.#order.filter((key) => existing.has(key));
    if (kept.length === this.#order.length) return;
    this.#order = kept;
    this.#save();
  }

  #save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#order));
    } catch {
      // The order still applies for this session.
    }
  }
}
