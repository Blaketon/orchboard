import type { AgentSnapshot, Agent } from '../../shared/api.ts';
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
  /** Polls again soon, e.g. right after starting or stopping an agent. */
  refresh(): void;
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
  #running = false;
  #inFlight = false;
  #pollAgainSoon = false;

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
    this.#running = true;
    this.#schedule(0, this.#generation);
  }

  stop(): void {
    this.#generation++;
    this.#running = false;
    this.#pollAgainSoon = false;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  refresh(): void {
    if (!this.#running) return;
    // Never overlap polls: if one is running, start the next as soon as it finishes.
    if (this.#inFlight) this.#pollAgainSoon = true;
    else this.#schedule(0, this.#generation);
  }

  #schedule(delayMs: number, generation: number): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#tick(generation), delayMs);
    this.#timer.unref();
  }

  async #tick(generation: number): Promise<void> {
    if (generation !== this.#generation) return;
    this.#inFlight = true;
    try {
      await this.poll();
    } finally {
      this.#inFlight = false;
    }
    if (generation !== this.#generation) return;
    const delay = this.#pollAgainSoon ? 0 : this.#intervalMs;
    this.#pollAgainSoon = false;
    this.#schedule(delay, generation);
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

  #publish(agents: readonly Agent[], error: string | null): AgentSnapshot {
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
