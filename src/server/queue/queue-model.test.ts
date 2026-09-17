import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { QueueState } from '../../shared/api.ts';
import { HttpError } from '../http-error.ts';
import {
  addColumn,
  addTask,
  EMPTY_QUEUE,
  isQueueState,
  moveTask,
  removeColumn,
  removeTask,
  renameColumn,
  updateTask,
} from './queue-model.ts';

const PROJECT = 'C:/Git/acme/storefront';

function statusOf(run: () => unknown): number {
  try {
    run();
    return 200;
  } catch (error) {
    return error instanceof HttpError ? error.status : 500;
  }
}

/** Two columns in one project: `next` with tasks a, b, c and `later` with task d. */
function sample(): QueueState {
  let state = addColumn(EMPTY_QUEUE, { project: PROJECT, name: 'Next up' }, 'next');
  state = addColumn(state, { project: PROJECT, name: 'Later' }, 'later');
  for (const id of ['a', 'b', 'c'])
    state = addTask(state, { columnId: 'next', prompt: `Task ${id}` }, id, 1);
  return addTask(state, { columnId: 'later', prompt: 'Task d' }, 'd', 1);
}

const order = (state: QueueState, columnId: string) =>
  state.tasks.filter((task) => task.columnId === columnId).map((task) => task.id);

describe('queue columns', () => {
  it('adds columns with a normalized project path', () => {
    const state = addColumn(
      EMPTY_QUEUE,
      { project: 'C:\\Git\\acme\\storefront\\', name: ' Next ' },
      'x',
    );
    assert.deepEqual(state.columns, [{ id: 'x', project: PROJECT, name: 'Next' }]);
  });

  it('validates column names and projects', () => {
    assert.equal(
      statusOf(() => addColumn(EMPTY_QUEUE, { project: PROJECT, name: '' }, 'x')),
      400,
    );
    assert.equal(
      statusOf(() => addColumn(EMPTY_QUEUE, { project: 'relative', name: 'X' }, 'x')),
      400,
    );
    assert.equal(
      statusOf(() => renameColumn(EMPTY_QUEUE, 'missing', { name: 'X' })),
      404,
    );
  });

  it('renames a column', () => {
    assert.equal(renameColumn(sample(), 'later', { name: 'Someday' }).columns[1]?.name, 'Someday');
  });

  it('removes a column together with its tasks', () => {
    const state = removeColumn(sample(), 'next');
    assert.deepEqual(
      state.columns.map((column) => column.id),
      ['later'],
    );
    assert.deepEqual(
      state.tasks.map((task) => task.id),
      ['d'],
    );
  });
});

describe('queued tasks', () => {
  it('adds a task that runs in the column project by default', () => {
    const [task] = addTask(
      addColumn(EMPTY_QUEUE, { project: PROJECT, name: 'Next' }, 'col'),
      { columnId: 'col', prompt: 'Add dark mode\nDetails…' },
      'task',
      42,
    ).tasks;
    assert.deepEqual(task, {
      id: 'task',
      columnId: 'col',
      name: 'Add dark mode',
      cwd: PROJECT,
      prompt: 'Add dark mode\nDetails…',
      permissionMode: 'manual',
      images: [],
      createdAt: 42,
    });
  });

  it('updates only the fields that were sent', () => {
    const state = updateTask(sample(), 'b', { name: 'Renamed', permissionMode: 'plan' });
    const task = state.tasks.find((item) => item.id === 'b');
    assert.ok(task);
    assert.equal(task.name, 'Renamed');
    assert.equal(task.permissionMode, 'plan');
    assert.equal(task.prompt, 'Task b');
  });

  it('keeps image attachments with a task', () => {
    const image = '0f8fad5b-d9cb-469f-a165-70867728950e.png';
    let state = updateTask(sample(), 'a', { images: [image] });
    assert.deepEqual(state.tasks[0]?.images, [image]);
    state = updateTask(state, 'a', { name: 'Renamed' });
    assert.deepEqual(state.tasks[0]?.images, [image]);
    assert.equal(
      statusOf(() => updateTask(sample(), 'a', { images: ['../../secret.png'] })),
      400,
    );
  });

  it('loads queues saved before tasks had images', () => {
    const task = sample().tasks[0];
    assert.ok(task);
    const legacy: Record<string, unknown> = { ...task };
    delete legacy.images;
    assert.equal(isQueueState({ columns: [], tasks: [legacy] }), true);
    assert.equal(isQueueState({ columns: [], tasks: [{ ...legacy, images: ['x'] }] }), false);
  });

  it('rejects invalid task input', () => {
    assert.equal(
      statusOf(() => addTask(sample(), { columnId: 'next', prompt: ' ' }, 'x', 1)),
      400,
    );
    assert.equal(
      statusOf(() => addTask(sample(), { columnId: 'nope', prompt: 'x' }, 'x', 1)),
      404,
    );
    assert.equal(
      statusOf(() => updateTask(sample(), 'a', { permissionMode: 'yolo' })),
      400,
    );
    assert.equal(
      statusOf(() => removeTask(sample(), 'nope')),
      404,
    );
  });

  it('reorders a task within its column', () => {
    assert.deepEqual(order(moveTask(sample(), 'c', { columnId: 'next', index: 0 }), 'next'), [
      'c',
      'a',
      'b',
    ]);
    assert.deepEqual(order(moveTask(sample(), 'a', { columnId: 'next', index: 2 }), 'next'), [
      'b',
      'c',
      'a',
    ]);
  });

  it('moves a task to another column at a position, clamping out-of-range indexes', () => {
    const top = moveTask(sample(), 'b', { columnId: 'later', index: 0 });
    assert.deepEqual(order(top, 'later'), ['b', 'd']);
    assert.deepEqual(order(top, 'next'), ['a', 'c']);

    const bottom = moveTask(sample(), 'a', { columnId: 'later', index: 99 });
    assert.deepEqual(order(bottom, 'later'), ['d', 'a']);
  });

  it('moves a task into an empty column', () => {
    let state = addColumn(sample(), { project: PROJECT, name: 'Empty' }, 'empty');
    state = moveTask(state, 'a', { columnId: 'empty', index: 0 });
    assert.deepEqual(order(state, 'empty'), ['a']);
  });

  it('refuses to move tasks to another project', () => {
    const state = addColumn(sample(), { project: 'C:/Git/other', name: 'Other' }, 'other');
    assert.equal(
      statusOf(() => moveTask(state, 'a', { columnId: 'other', index: 0 })),
      400,
    );
  });
});
