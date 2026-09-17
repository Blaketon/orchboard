const STORAGE_KEY = 'orchboard-hidden-agents';

/** Agents the user hid from the board, remembered in this browser. */
export class HiddenAgents {
  #ids: Set<string>;

  constructor() {
    this.#ids = new Set();
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(stored)) {
        this.#ids = new Set(stored.filter((id): id is string => typeof id === 'string'));
      }
    } catch {
      // Unreadable storage: start with nothing hidden.
    }
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  get size(): number {
    return this.#ids.size;
  }

  hide(ids: Iterable<string>): void {
    for (const id of ids) this.#ids.add(id);
    this.#save();
  }

  showAll(): void {
    this.#ids.clear();
    this.#save();
  }

  /** Forgets agents that no longer exist, so the list doesn't grow forever. */
  prune(existing: ReadonlySet<string>): void {
    const before = this.#ids.size;
    for (const id of this.#ids) if (!existing.has(id)) this.#ids.delete(id);
    if (this.#ids.size !== before) this.#save();
  }

  #save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.#ids]));
    } catch {
      // Hiding still applies for this session.
    }
  }
}
