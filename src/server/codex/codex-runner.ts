import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type {
  Agent,
  AgentState,
  Approval,
  ApprovalDecision,
  StartTaskResponse,
  Transcript,
} from '../../shared/api.ts';
import {
  DEFAULT_CODEX_PERMISSION_MODE,
  isCodexPermissionMode,
  type CodexPermissionMode,
} from '../../shared/permission-modes.ts';
import { assertDirectory, parsePrompt, type TaskRequest } from '../agents/task-request.ts';
import type { AttachmentStore } from '../attachments/attachment-store.ts';
import { HttpError, isRecord } from '../http-error.ts';
import { JsonStore } from '../storage/json-store.ts';
import {
  AppServerError,
  CodexCliMissingError,
  connectAppServer,
  spawnAppServer,
  type AppServerClient,
  type ServerRequest,
  type SpawnAppServer,
} from './app-server.ts';
import { approvalResponse, describeRequest, type ItemInfo } from './codex-approvals.ts';
import { locateRollout, readCodexTranscript } from './codex-transcript.ts';

/** A Codex task as saved in `codex-tasks.json`. */
export interface CodexTask {
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  /** Null until Codex has created the thread. */
  readonly threadId: string | null;
  readonly rolloutPath: string | null;
  readonly permissionMode: CodexPermissionMode;
  readonly state: AgentState;
  readonly startedAt: number;
  readonly error: string | null;
}

interface Session {
  readonly client: AppServerClient;
  turnId: string | null;
  stopping: boolean;
  readonly approvals: Map<string, { request: ServerRequest; approval: Approval }>;
  readonly items: Map<string, ItemInfo>;
}

export interface CodexRunnerOptions {
  readonly dataDir: string;
  readonly codexDir: string;
  /** Called whenever tasks change, so the board updates right away. */
  readonly onChange: () => void;
  readonly attachments?: Pick<AttachmentStore, 'paths'>;
  readonly spawn?: SpawnAppServer;
  readonly now?: () => number;
}

const TASK_ID = /^codex-[0-9a-f]{8}$/;
const INTERRUPTED_BY_SHUTDOWN = 'Orchboard stopped while this task was running. Reply to continue.';

/** Codex's sandbox and approval settings for each permission mode. */
export const CODEX_POLICIES: Readonly<
  Record<CodexPermissionMode, { sandbox: string; approvalPolicy: string }>
> = {
  'read-only': { sandbox: 'read-only', approvalPolicy: 'on-request' },
  auto: { sandbox: 'workspace-write', approvalPolicy: 'on-request' },
  'full-access': { sandbox: 'danger-full-access', approvalPolicy: 'never' },
};

/**
 * Runs Codex tasks through `codex app-server`. Each turn gets its own app-server process, which
 * exits when the turn ends; replies resume the thread in a new one. Codex keeps the
 * conversation in its own session files, which transcripts are read from.
 */
export class CodexRunner {
  readonly #store: JsonStore<CodexTask[]>;
  readonly #options: CodexRunnerOptions;
  readonly #sessions = new Map<string, Session>();
  #tasks: CodexTask[] = [];
  #closing = false;

  constructor(options: CodexRunnerOptions) {
    this.#options = options;
    this.#store = new JsonStore(path.join(options.dataDir, 'codex-tasks.json'), {
      fallback: () => [],
      validate: isTaskList,
    });
  }

  /** Loads saved tasks. Turns that were running when Orchboard stopped can't continue. */
  async load(): Promise<void> {
    this.#tasks = (await this.#store.read()).map((task) =>
      task.state === 'working'
        ? {
            ...task,
            state: 'blocked',
            error: INTERRUPTED_BY_SHUTDOWN,
          }
        : task,
    );
  }

  agents(): Agent[] {
    return this.#tasks.map((task) => {
      const session = this.#sessions.get(task.id);
      const approvals = session ? [...session.approvals.values()].map((item) => item.approval) : [];
      return {
        id: task.id,
        provider: 'codex',
        sessionId: task.threadId ?? '',
        name: task.name,
        cwd: task.cwd,
        startedAt: task.startedAt,
        state: approvals.length ? 'blocked' : task.state,
        pid: session && !session.client.exited ? session.client.pid : null,
        approvals,
        error: task.error,
      };
    });
  }

  async start(request: TaskRequest): Promise<StartTaskResponse> {
    await assertDirectory(request.cwd);
    const mode = request.permissionMode ?? DEFAULT_CODEX_PERMISSION_MODE;
    if (!isCodexPermissionMode(mode)) throw new HttpError(400, 'Unknown permission mode.');
    const task: CodexTask = {
      id: `codex-${randomBytes(4).toString('hex')}`,
      name: request.name,
      cwd: request.cwd,
      threadId: null,
      rolloutPath: null,
      permissionMode: mode,
      state: 'working',
      startedAt: (this.#options.now ?? Date.now)(),
      error: null,
    };
    await this.#save([...this.#tasks, task]);
    try {
      await this.#runTurn(task.id, request.prompt, request.images);
    } catch (error) {
      // Without a thread there is nothing to show or resume.
      if (this.#find(task.id)?.threadId === null) {
        await this.#save(this.#tasks.filter((item) => item.id !== task.id));
      }
      throw error;
    }
    return { id: task.id };
  }

  async reply(agent: Agent, request: unknown): Promise<void> {
    const task = this.#require(agent.id);
    const prompt = parsePrompt(isRecord(request) ? request.prompt : undefined);
    if (this.#sessions.has(task.id)) {
      throw new HttpError(409, 'This task is still running. Wait for it to finish, or stop it.');
    }
    await assertDirectory(task.cwd);
    await this.#update(task.id, { state: 'working', error: null });
    await this.#runTurn(task.id, prompt, []);
  }

  async stop(agent: Agent): Promise<void> {
    const found = this.#require(agent.id);
    const session = this.#sessions.get(found.id);
    if (!session) throw new HttpError(409, 'This task is not running.');
    session.stopping = true;
    if (session.turnId && found.threadId) {
      // Interrupting lets Codex record the stop; the process is closed either way.
      const interrupt = session.client.request('turn/interrupt', {
        threadId: found.threadId,
        turnId: session.turnId,
      });
      await Promise.race([interrupt.catch(() => undefined), delay(3000)]);
    }
    session.client.close();
  }

  async remove(agent: Agent): Promise<void> {
    const found = this.#require(agent.id);
    if (this.#sessions.has(found.id)) throw new HttpError(409, 'Stop the task before deleting it.');
    await this.#save(this.#tasks.filter((item) => item.id !== found.id));
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- errors should reject, not throw.
  async decide(agent: Agent, approvalId: string, request: unknown): Promise<void> {
    const session = this.#sessions.get(this.#require(agent.id).id);
    const pending = session?.approvals.get(approvalId);
    if (!session || !pending) throw new HttpError(404, 'This request was already answered.');
    const decision = isRecord(request) ? request.decision : undefined;
    if (!isDecision(decision) || (pending.approval.declineOnly && decision !== 'decline')) {
      throw new HttpError(400, 'Unknown decision.');
    }
    const response = approvalResponse(pending.request, decision);
    if ('result' in response) session.client.respond(pending.request.id, response.result);
    else session.client.respondError(pending.request.id, response.error);
    session.approvals.delete(approvalId);
    this.#options.onChange();
  }

  async transcript(agent: Agent): Promise<Transcript> {
    const found = this.#require(agent.id);
    let file = found.rolloutPath;
    if (!file && found.threadId) {
      file = (await locateRollout(this.#options.codexDir, found.threadId, found.startedAt)) ?? null;
      if (file) await this.#update(found.id, { rolloutPath: file });
    }
    return readCodexTranscript(file ?? undefined);
  }

  /** Stops every running turn, e.g. when Orchboard shuts down, and waits for saves to finish. */
  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    for (const session of sessions) {
      this.#closing = true;
      session.client.close(0);
    }
    await Promise.all(sessions.map((session) => session.client.whenExited));
    await this.flush();
  }

  /** Waits until every change so far has been written to disk. */
  async flush(): Promise<void> {
    await this.#store.read();
  }

  async #runTurn(id: string, prompt: string, images: readonly string[]): Promise<void> {
    const initial = this.#require(id);
    const imagePaths =
      images.length && this.#options.attachments
        ? await this.#options.attachments.paths(images)
        : [];

    let client: AppServerClient;
    try {
      client = await connectAppServer(
        initial.cwd,
        {
          onNotification: (method, params) => {
            this.#onNotification(id, method, params);
          },
          onRequest: (request) => {
            this.#onRequest(id, request);
          },
          onExit: (_code, stderr) => {
            void this.#onExit(id, stderr);
          },
        },
        this.#options.spawn ?? spawnAppServer,
      );
    } catch (error) {
      await this.#update(id, { state: 'blocked', error: errorText(error) });
      if (error instanceof CodexCliMissingError) throw new HttpError(503, error.message);
      throw new HttpError(502, `Could not start Codex: ${errorText(error)}`);
    }
    const session: Session = {
      client,
      turnId: null,
      stopping: false,
      approvals: new Map(),
      items: new Map(),
    };
    this.#sessions.set(id, session);
    this.#options.onChange();

    try {
      const policy = CODEX_POLICIES[initial.permissionMode];
      const opened = initial.threadId
        ? await client.request('thread/resume', {
            threadId: initial.threadId,
            cwd: initial.cwd,
            ...policy,
            excludeTurns: true,
          })
        : await client.request('thread/start', { cwd: initial.cwd, ...policy });
      const thread = isRecord(opened) && isRecord(opened.thread) ? opened.thread : {};
      if (typeof thread.id !== 'string') throw new AppServerError('Codex did not open a thread.');
      await this.#update(id, {
        threadId: thread.id,
        ...(typeof thread.path === 'string' ? { rolloutPath: thread.path } : {}),
      });

      const input = [
        { type: 'text', text: prompt, text_elements: [] },
        ...imagePaths.map((file) => ({ type: 'localImage', path: file })),
      ];
      const started = await client.request('turn/start', { threadId: thread.id, input });
      if (isRecord(started) && isRecord(started.turn) && typeof started.turn.id === 'string') {
        session.turnId = started.turn.id;
      }
    } catch (error) {
      client.close(0);
      await this.#update(id, { state: 'blocked', error: errorText(error) });
      throw new HttpError(502, `Codex could not start the turn: ${errorText(error)}`);
    }
  }

  #onNotification(id: string, method: string, params: unknown): void {
    const session = this.#sessions.get(id);
    if (!session || !isRecord(params)) return;

    switch (method) {
      case 'turn/started':
        if (isRecord(params.turn) && typeof params.turn.id === 'string') {
          session.turnId = params.turn.id;
        }
        void this.#update(id, { state: 'working', error: null });
        break;
      case 'turn/completed': {
        const turn = isRecord(params.turn) ? params.turn : {};
        const failure =
          turn.status === 'failed' && isRecord(turn.error) && typeof turn.error.message === 'string'
            ? turn.error.message
            : null;
        void this.#update(id, {
          state: turn.status === 'completed' ? 'done' : 'blocked',
          error: failure,
        });
        // The turn is over; a reply resumes the thread in a new process.
        session.client.close();
        break;
      }
      case 'error':
        if (params.willRetry !== true && isRecord(params.error)) {
          const message = params.error.message;
          if (typeof message === 'string') void this.#update(id, { error: message });
        }
        break;
      case 'item/started':
        rememberItem(session.items, params.item);
        break;
      case 'serverRequest/resolved':
        if (session.approvals.delete(String(params.requestId))) this.#options.onChange();
        break;
      default:
        break;
    }
  }

  #onRequest(id: string, request: ServerRequest): void {
    const session = this.#sessions.get(id);
    if (!session) return;
    const approval = describeRequest(request, session.items);
    if (!approval) {
      session.client.respondError(request.id, `Orchboard can't handle ${request.method}.`);
      return;
    }
    session.approvals.set(approval.id, { request, approval });
    this.#options.onChange();
  }

  async #onExit(id: string, stderr: string): Promise<void> {
    const session = this.#sessions.get(id);
    this.#sessions.delete(id);
    const current = this.#find(id);
    if (current?.state === 'working') {
      await this.#update(id, {
        state: 'blocked',
        error: session?.stopping
          ? null
          : this.#closing
            ? INTERRUPTED_BY_SHUTDOWN
            : stderr || 'Codex stopped unexpectedly.',
      });
    } else {
      this.#options.onChange();
    }
  }

  #find(id: string): CodexTask | undefined {
    return task(this.#tasks, id);
  }

  #require(id: string): CodexTask {
    const found = TASK_ID.test(id) ? this.#find(id) : undefined;
    if (!found) throw new HttpError(404, 'Codex task not found.');
    return found;
  }

  async #update(id: string, patch: Partial<Omit<CodexTask, 'id'>>): Promise<void> {
    await this.#save(this.#tasks.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  /** Updates tasks in memory right away, then on disk. A failed write is logged, not thrown. */
  async #save(tasks: CodexTask[]): Promise<void> {
    this.#tasks = tasks;
    this.#options.onChange();
    try {
      await this.#store.write(tasks);
    } catch (error) {
      console.warn('Could not save Codex tasks:', error);
    }
  }
}

function task(tasks: readonly CodexTask[], id: string): CodexTask | undefined {
  return tasks.find((item) => item.id === id);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function rememberItem(items: Map<string, ItemInfo>, item: unknown): void {
  if (!isRecord(item) || typeof item.id !== 'string') return;
  if (item.type === 'commandExecution' && typeof item.command === 'string') {
    items.set(item.id, { command: item.command });
  } else if (item.type === 'fileChange' && Array.isArray(item.changes)) {
    items.set(item.id, {
      files: item.changes
        .map((change) => (isRecord(change) && typeof change.path === 'string' ? change.path : ''))
        .filter(Boolean),
    });
  }
}

function isDecision(value: unknown): value is ApprovalDecision {
  return value === 'accept' || value === 'acceptForSession' || value === 'decline';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTaskList(value: unknown): value is CodexTask[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.cwd === 'string' &&
        (item.threadId === null || typeof item.threadId === 'string') &&
        (item.rolloutPath === null || typeof item.rolloutPath === 'string') &&
        isCodexPermissionMode(item.permissionMode) &&
        (item.state === 'working' || item.state === 'blocked' || item.state === 'done') &&
        typeof item.startedAt === 'number' &&
        (item.error === null || typeof item.error === 'string'),
    )
  );
}
