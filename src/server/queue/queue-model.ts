import path from 'node:path';
import type { QueueColumn, QueuedTask, QueueState } from '../../shared/api.ts';
import { projectKey } from '../../shared/projects.ts';
import { isCodexPermissionMode, isPermissionMode } from '../../shared/permission-modes.ts';
import {
  parseName,
  parsePermissionMode,
  parsePrompt,
  parseProvider,
} from '../agents/task-request.ts';
import { isAttachmentId, parseAttachmentIds } from '../attachments/attachment-store.ts';
import { HttpError, isRecord } from '../http-error.ts';

// Pure queue operations: each takes the current state and returns the next one, so they are
// easy to test and run inside a single JsonStore update.

export const MAX_COLUMN_NAME_CHARS = 40;

export const EMPTY_QUEUE: QueueState = { columns: [], tasks: [] };

export function addColumn(state: QueueState, request: unknown, id: string): QueueState {
  if (
    !isRecord(request) ||
    typeof request.project !== 'string' ||
    !path.isAbsolute(request.project)
  ) {
    throw new HttpError(400, 'A column needs a project.');
  }
  const column: QueueColumn = {
    id,
    project: projectKey(request.project),
    name: columnName(request.name),
  };
  return { ...state, columns: [...state.columns, column] };
}

export function renameColumn(state: QueueState, id: string, request: unknown): QueueState {
  const name = columnName(isRecord(request) ? request.name : undefined);
  findColumn(state, id);
  return {
    ...state,
    columns: state.columns.map((column) => (column.id === id ? { ...column, name } : column)),
  };
}

/** Removes a column together with the tasks in it. */
export function removeColumn(state: QueueState, id: string): QueueState {
  findColumn(state, id);
  return {
    columns: state.columns.filter((column) => column.id !== id),
    tasks: state.tasks.filter((task) => task.columnId !== id),
  };
}

export function addTask(state: QueueState, request: unknown, id: string, now: number): QueueState {
  if (!isRecord(request) || typeof request.columnId !== 'string') {
    throw new HttpError(400, 'A task needs a column.');
  }
  const column = findColumn(state, request.columnId);
  const prompt = parsePrompt(request.prompt);
  const provider = parseProvider(request.provider);
  const task: QueuedTask = {
    id,
    columnId: column.id,
    name: parseName(request.name, prompt),
    provider,
    cwd: taskCwd(request.cwd, column.project),
    prompt,
    permissionMode: parsePermissionMode(provider, request.permissionMode),
    images: parseAttachmentIds(request.images),
    createdAt: now,
  };
  return { ...state, tasks: [...state.tasks, task] };
}

export function updateTask(state: QueueState, id: string, request: unknown): QueueState {
  const task = findTask(state, id);
  if (!isRecord(request)) throw new HttpError(400, 'Expected a JSON object.');
  const prompt = request.prompt === undefined ? task.prompt : parsePrompt(request.prompt);
  const oldProvider = task.provider ?? 'claude';
  const provider = request.provider === undefined ? oldProvider : parseProvider(request.provider);
  // Switching agents without choosing a mode falls back to the new agent's default.
  const mode =
    request.permissionMode ?? (provider === oldProvider ? task.permissionMode : undefined);
  const updated: QueuedTask = {
    ...task,
    prompt,
    name: request.name === undefined ? task.name : parseName(request.name, prompt),
    provider,
    cwd: request.cwd === undefined ? task.cwd : taskCwd(request.cwd, task.cwd),
    permissionMode: parsePermissionMode(provider, mode),
    images: request.images === undefined ? (task.images ?? []) : parseAttachmentIds(request.images),
  };
  return { ...state, tasks: state.tasks.map((item) => (item.id === id ? updated : item)) };
}

/** Moves a task to `index` among the tasks of `columnId` (possibly its own column). */
export function moveTask(state: QueueState, id: string, request: unknown): QueueState {
  const task = findTask(state, id);
  if (
    !isRecord(request) ||
    typeof request.columnId !== 'string' ||
    typeof request.index !== 'number'
  ) {
    throw new HttpError(400, 'Moving a task needs a column and a position.');
  }
  const target = findColumn(state, request.columnId);
  const source = findColumn(state, task.columnId);
  if (target.project !== source.project) {
    throw new HttpError(400, 'Tasks can only move between columns of the same project.');
  }

  const rest = state.tasks.filter((item) => item.id !== id);
  const inTarget = rest.filter((item) => item.columnId === target.id);
  const index = Math.max(0, Math.min(Math.trunc(request.index), inTarget.length));
  const moved = { ...task, columnId: target.id };

  // Insert before the task currently at `index`, or after the column's last task.
  const anchor = inTarget[index] ?? inTarget.at(-1);
  let position = rest.length;
  if (anchor) position = rest.indexOf(anchor) + (inTarget[index] ? 0 : 1);
  return { ...state, tasks: [...rest.slice(0, position), moved, ...rest.slice(position)] };
}

export function removeTask(state: QueueState, id: string): QueueState {
  findTask(state, id);
  return { ...state, tasks: state.tasks.filter((task) => task.id !== id) };
}

export function findTask(state: QueueState, id: string): QueuedTask {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new HttpError(404, 'Queued task not found.');
  return task;
}

function findColumn(state: QueueState, id: string): QueueColumn {
  const column = state.columns.find((item) => item.id === id);
  if (!column) throw new HttpError(404, 'Column not found.');
  return column;
}

function columnName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new HttpError(400, 'Give the column a name.');
  if (name.length > MAX_COLUMN_NAME_CHARS) {
    throw new HttpError(400, `Column names can be at most ${MAX_COLUMN_NAME_CHARS} characters.`);
  }
  return name;
}

function taskCwd(value: unknown, fallback: string): string {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !path.isAbsolute(value.trim())) {
    throw new HttpError(400, 'The task folder must be an absolute path.');
  }
  return value.trim();
}

export function isQueueState(value: unknown): value is QueueState {
  return (
    isRecord(value) &&
    Array.isArray(value.columns) &&
    Array.isArray(value.tasks) &&
    value.columns.every(
      (column) =>
        isRecord(column) &&
        typeof column.id === 'string' &&
        typeof column.project === 'string' &&
        typeof column.name === 'string',
    ) &&
    value.tasks.every(
      (task) =>
        isRecord(task) &&
        typeof task.id === 'string' &&
        typeof task.columnId === 'string' &&
        typeof task.name === 'string' &&
        typeof task.cwd === 'string' &&
        typeof task.prompt === 'string' &&
        (task.provider === 'codex'
          ? isCodexPermissionMode(task.permissionMode)
          : (task.provider === undefined || task.provider === 'claude') &&
            isPermissionMode(task.permissionMode)) &&
        (task.images === undefined ||
          (Array.isArray(task.images) && task.images.every(isAttachmentId))) &&
        typeof task.createdAt === 'number',
    )
  );
}
