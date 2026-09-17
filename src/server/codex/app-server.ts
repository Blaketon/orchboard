import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export type RequestId = string | number;

/** A request the app server sends to the client, e.g. to approve a command. */
export interface ServerRequest {
  readonly id: RequestId;
  readonly method: string;
  readonly params: unknown;
}

/** The parts of a child process the client uses, so tests can pass a fake. */
export interface AppServerProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly pid?: number | undefined;
  kill(): boolean;
  once(event: 'exit', listener: (code: number | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
}

export interface AppServerHandlers {
  readonly onNotification: (method: string, params: unknown) => void;
  readonly onRequest: (request: ServerRequest) => void;
  /** Called once when the process ends, with the tail of its error output. */
  readonly onExit: (code: number | null, stderr: string) => void;
}

export class AppServerError extends Error {
  readonly code: number | undefined;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'AppServerError';
    this.code = code;
  }
}

const STDERR_TAIL_CHARS = 4000;

/**
 * JSON-RPC 2.0 over a `codex app-server` process's stdio: one JSON message per line.
 * Requests resolve with their result or reject with the server's error.
 */
export class AppServerClient {
  readonly #process: AppServerProcess;
  readonly #handlers: AppServerHandlers;
  readonly #pending = new Map<
    RequestId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  #nextId = 1;
  #buffer = '';
  #stderr = '';
  #exited = false;

  constructor(process: AppServerProcess, handlers: AppServerHandlers) {
    this.#process = process;
    this.#handlers = handlers;
    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => {
      this.#receive(chunk);
    });
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-STDERR_TAIL_CHARS);
    });
    // Writing to a process that already exited emits EPIPE; the exit handler reports it.
    process.stdin.on('error', () => undefined);
    process.once('error', (error) => {
      this.#finish(null, error.message);
    });
    process.once('exit', (code) => {
      this.#finish(code, this.#stderr.trim());
    });
  }

  get pid(): number | null {
    return this.#process.pid ?? null;
  }

  get exited(): boolean {
    return this.#exited;
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.#exited) return Promise.reject(new AppServerError('Codex is no longer running.'));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.#send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: RequestId, result: unknown): void {
    this.#send({ jsonrpc: '2.0', id, result });
  }

  respondError(id: RequestId, message: string): void {
    this.#send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
  }

  /** Ends the process: closing stdin lets it exit cleanly, killing makes sure it does. */
  close(graceMs = 2000): void {
    if (this.#exited) return;
    this.#process.stdin.end();
    setTimeout(() => {
      if (!this.#exited) this.#process.kill();
    }, graceMs).unref();
  }

  #send(message: object): void {
    if (this.#exited) return;
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #receive(chunk: string): void {
    this.#buffer += chunk;
    const lines = this.#buffer.split('\n');
    this.#buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message === 'object' && message !== null) {
        this.#dispatch(message as Record<string, unknown>);
      }
    }
  }

  #dispatch(message: Record<string, unknown>): void {
    const { id, method } = message;
    const hasId = typeof id === 'string' || typeof id === 'number';

    if (hasId && typeof method === 'string') {
      this.#handlers.onRequest({ id, method, params: message.params });
      return;
    }
    if (typeof method === 'string') {
      this.#handlers.onNotification(method, message.params);
      return;
    }
    if (!hasId) return;
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    const error = message.error;
    if (typeof error === 'object' && error !== null) {
      const { message: text, code } = error as { message?: unknown; code?: unknown };
      pending.reject(
        new AppServerError(
          typeof text === 'string' ? text : 'Codex reported an error.',
          typeof code === 'number' ? code : undefined,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  #finish(code: number | null, stderr: string): void {
    if (this.#exited) return;
    this.#exited = true;
    const reason = stderr || `Codex exited${code === null ? '' : ` with code ${code}`}.`;
    for (const pending of this.#pending.values()) pending.reject(new AppServerError(reason));
    this.#pending.clear();
    this.#handlers.onExit(code, stderr);
  }
}

export class CodexCliMissingError extends Error {
  constructor() {
    super(
      'Codex CLI not found. Install it (npm install -g @openai/codex) and make sure `codex` is on your PATH.',
    );
    this.name = 'CodexCliMissingError';
  }
}

export type SpawnAppServer = (cwd: string) => AppServerProcess;

/** Starts `codex app-server` in `cwd`. Arguments are fixed, so the Windows shell sees no user text. */
export const spawnAppServer: SpawnAppServer = (cwd) =>
  process.platform === 'win32'
    ? // npm installs `codex` as a .cmd shim on Windows, which only a shell can run.
      spawn('cmd.exe', ['/d', '/s', '/c', 'codex', 'app-server', '--stdio'], {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    : spawn('codex', ['app-server', '--stdio'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

export const CLIENT_INFO = { name: 'orchboard', title: 'Orchboard', version: '0.0.0' } as const;

/** Spawns an app server and completes the initialize handshake. */
export async function connectAppServer(
  cwd: string,
  handlers: AppServerHandlers,
  spawnProcess: SpawnAppServer = spawnAppServer,
): Promise<AppServerClient> {
  const child = spawnProcess(cwd);
  let exitReason = '';
  const client = new AppServerClient(child, {
    ...handlers,
    onExit: (code, stderr) => {
      exitReason = stderr;
      handlers.onExit(code, stderr);
    },
  });
  try {
    await client.request('initialize', {
      clientInfo: CLIENT_INFO,
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
  } catch (error) {
    client.close(0);
    // cmd.exe reports a missing command on stderr and exits with 1.
    if (/not recognized|ENOENT|not found/i.test(`${exitReason} ${String(error)}`)) {
      throw new CodexCliMissingError();
    }
    throw error;
  }
  client.notify('initialized');
  return client;
}
