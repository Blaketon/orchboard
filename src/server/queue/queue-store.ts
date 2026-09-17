import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { QueueState, StartTaskResponse } from '../../shared/api.ts';
import type { ClaudeActions } from '../agents/claude-actions.ts';
import { JsonStore } from '../storage/json-store.ts';
import {
  addColumn,
  addTask,
  EMPTY_QUEUE,
  findTask,
  isQueueState,
  moveTask,
  removeColumn,
  removeTask,
  renameColumn,
  updateTask,
} from './queue-model.ts';

/** The task queue, persisted in `queue.json`. */
export class QueueStore {
  readonly #store: JsonStore<QueueState>;
  readonly #actions: Pick<ClaudeActions, 'start'>;

  constructor(dataDir: string, actions: Pick<ClaudeActions, 'start'>) {
    this.#store = new JsonStore(path.join(dataDir, 'queue.json'), {
      fallback: () => EMPTY_QUEUE,
      validate: isQueueState,
    });
    this.#actions = actions;
  }

  read(): Promise<QueueState> {
    return this.#store.read();
  }

  addColumn(request: unknown): Promise<QueueState> {
    return this.#store.update((state) => addColumn(state, request, randomUUID()));
  }

  renameColumn(id: string, request: unknown): Promise<QueueState> {
    return this.#store.update((state) => renameColumn(state, id, request));
  }

  removeColumn(id: string): Promise<QueueState> {
    return this.#store.update((state) => removeColumn(state, id));
  }

  addTask(request: unknown): Promise<QueueState> {
    return this.#store.update((state) => addTask(state, request, randomUUID(), Date.now()));
  }

  updateTask(id: string, request: unknown): Promise<QueueState> {
    return this.#store.update((state) => updateTask(state, id, request));
  }

  moveTask(id: string, request: unknown): Promise<QueueState> {
    return this.#store.update((state) => moveTask(state, id, request));
  }

  removeTask(id: string): Promise<QueueState> {
    return this.#store.update((state) => removeTask(state, id));
  }

  /** Launches a queued task as a Claude Code agent, then takes it off the queue. */
  async start(id: string): Promise<{ queue: QueueState; started: StartTaskResponse }> {
    const task = findTask(await this.#store.read(), id);
    const started = await this.#actions.start({
      cwd: task.cwd,
      prompt: task.prompt,
      name: task.name,
      permissionMode: task.permissionMode,
    });
    // Tolerate the task having been removed meanwhile; the agent is already running.
    const queue = await this.#store.update((state) =>
      state.tasks.some((item) => item.id === id) ? removeTask(state, id) : state,
    );
    return { queue, started };
  }
}
