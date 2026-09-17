import type { AgentSnapshot, ClaudeAgent } from '../../shared/api.ts';
import type { ParseResult } from './claude-agents.ts';

export type { AgentSnapshot };

export type SnapshotListener = (snapshot: AgentSnapshot) => void;

/** What the HTTP layer needs from the monitor. */
export interface AgentFeed {
  /** Resolves once the first poll has finished. */
  ready(): Promise<AgentSnapshot>;
  current(): AgentSnapshot | undefined;
  /** Calls the listener whenever the snapshot changes. Returns an unsubscribe function. */
  subscribe(listener: SnapshotListener): () => void;
}

export interface AgentMonitorOptions {
  readonly list: () => Promise<ParseResult>;
  readonly intervalMs?: number;
  readonly log?: (message: string) => void;
  readonly now?: () => number;
}

/**
 * Polls the agent list on one shared timer and notifies subscribers only when something
 * changed, so every open browser tab shares one `claude agents` process per interval.
 */
export class AgentMonitor implements AgentFeed {
  readonly #list: () => Promise<ParseResult>;
  readonly #intervalMs: number;
  readonly #log: (message: string) => void;
  readonly #now: () => number;
  readonly #listeners = new Set<SnapshotListener>();
  readonly #loggedSkips = new Set<string>();
  readonly #ready: Promise<AgentSnapshot>;
  #resolveReady: (snapshot: AgentSnapshot) => void = () => undefined;
  #snapshot: AgentSnapshot | undefined;
  #signature = '';
  #loggedError: string | null = null;
  #timer: NodeJS.Timeout | undefined;
  #generation = 0;

  constructor(options: AgentMonitorOptions) {
    this.#list = options.list;
    this.#intervalMs = options.intervalMs ?? 2000;
    this.#log = options.log ?? console.warn;
    this.#now = options.now ?? Date.now;
    this.#ready = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
  }

  ready(): Promise<AgentSnapshot> {
    return this.#ready;
  }

  current(): AgentSnapshot | undefined {
    return this.#snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Starts polling immediately, then again `intervalMs` after each poll finishes. */
  start(): void {
    this.stop();
    const generation = ++this.#generation;
    const loop = async (): Promise<void> => {
      await this.poll();
      if (generation !== this.#generation) return;
      this.#timer = setTimeout(() => void loop(), this.#intervalMs);
      this.#timer.unref();
    };
    void loop();
  }

  stop(): void {
    this.#generation++;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async poll(): Promise<AgentSnapshot> {
    let agents = this.#snapshot?.agents ?? [];
    let error: string | null = null;
    try {
      const result = await this.#list();
      agents = result.agents;
      this.#logSkipped(result.skipped);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    this.#logErrorChange(error);
    return this.#publish(agents, error);
  }

  #publish(agents: readonly ClaudeAgent[], error: string | null): AgentSnapshot {
    const signature = JSON.stringify({ agents, error });
    const previous = this.#snapshot;
    if (previous !== undefined && signature === this.#signature) return previous;

    const snapshot: AgentSnapshot = { agents, error, updatedAt: this.#now() };
    this.#snapshot = snapshot;
    this.#signature = signature;
    if (previous === undefined) this.#resolveReady(snapshot);

    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch (listenerError) {
        this.#log(`An agent listener failed: ${String(listenerError)}`);
      }
    }
    return snapshot;
  }

  // Polls run every few seconds, so only log when the error changes, not on every poll.
  #logErrorChange(error: string | null): void {
    if (error === this.#loggedError) return;
    if (error !== null) this.#log(error);
    else this.#log('Claude agents are available again.');
    this.#loggedError = error;
  }

  #logSkipped(reasons: readonly string[]): void {
    for (const reason of reasons) {
      // Entry positions shift between polls; dedupe on the reason itself.
      const key = reason.replace(/^entry \d+ /, '');
      if (this.#loggedSkips.has(key)) continue;
      this.#loggedSkips.add(key);
      this.#log(`Skipped an agent from \`claude agents\`: ${reason}`);
    }
  }
}
