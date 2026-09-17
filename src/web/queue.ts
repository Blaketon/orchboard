import type { QueueColumn, QueuedTask, QueueState } from '../shared/api.ts';
import { PERMISSION_MODES } from '../shared/permission-modes.ts';
import { el } from './dom.ts';

const DRAG_TYPE = 'application/x-orchboard-task';

export interface QueueHandlers {
  readonly onAddColumn: () => void;
  readonly onRenameColumn: (column: QueueColumn) => void;
  readonly onRemoveColumn: (column: QueueColumn, taskCount: number) => void;
  readonly onAddTask: (column: QueueColumn) => void;
  readonly onEditTask: (task: QueuedTask) => void;
  readonly onRemoveTask: (task: QueuedTask) => void;
  readonly onStartTask: (task: QueuedTask) => void;
  /** `index` is the position among the target column's other tasks. */
  readonly onMoveTask: (taskId: string, columnId: string, index: number) => void;
}

/** The project's queue columns, followed by a tile for adding another column. */
export function renderQueueColumns(
  project: string,
  queue: QueueState,
  handlers: QueueHandlers,
): HTMLElement[] {
  const columns = queue.columns.filter((column) => column.project === project);
  return [
    ...columns.map((column) =>
      renderColumn(
        column,
        queue.tasks.filter((task) => task.columnId === column.id),
        handlers,
      ),
    ),
    el('button', {
      className: 'add-column',
      text: '+ Add column',
      attrs: { type: 'button' },
      on: { click: handlers.onAddColumn },
    }),
  ];
}

function renderColumn(
  column: QueueColumn,
  tasks: readonly QueuedTask[],
  handlers: QueueHandlers,
): HTMLElement {
  const cards = el(
    'div',
    { className: 'column-cards', attrs: { 'data-column-id': column.id } },
    tasks.length
      ? tasks.map((task) => renderTask(task, handlers))
      : [el('p', { className: 'column-empty', text: 'Drop or add tasks here' })],
  );
  enableDrop(cards, column.id, handlers);

  return el('section', { className: 'column queue-column', attrs: { 'aria-label': column.name } }, [
    el('header', { className: 'column-header' }, [
      el('h2', { className: 'column-title', text: column.name }),
      el('span', { className: 'column-count', text: String(tasks.length) }),
      el('span', { className: 'column-tools' }, [
        iconButton('✎', `Rename ${column.name}`, () => {
          handlers.onRenameColumn(column);
        }),
        iconButton('×', `Remove ${column.name}`, () => {
          handlers.onRemoveColumn(column, tasks.length);
        }),
      ]),
    ]),
    cards,
    el('button', {
      className: 'add-task',
      text: '+ Add task',
      attrs: { type: 'button' },
      on: {
        click: () => {
          handlers.onAddTask(column);
        },
      },
    }),
  ]);
}

function renderTask(task: QueuedTask, handlers: QueueHandlers): HTMLElement {
  const mode = PERMISSION_MODES.find((option) => option.value === task.permissionMode)?.label;
  const card = el(
    'div',
    {
      className: 'card queue-card',
      attrs: { draggable: 'true', 'data-task-id': task.id, title: task.prompt },
    },
    [
      el('span', { className: 'card-title', text: task.name }),
      el('span', { className: 'card-meta' }, [
        el('span', { className: 'card-project', text: mode ?? task.permissionMode }),
      ]),
      el('span', { className: 'queue-card-actions' }, [
        el('button', {
          className: 'button button-primary button-small',
          text: 'Start',
          attrs: { type: 'button' },
          on: {
            click: () => {
              handlers.onStartTask(task);
            },
          },
        }),
        el('button', {
          className: 'button button-small',
          text: 'Edit',
          attrs: { type: 'button' },
          on: {
            click: () => {
              handlers.onEditTask(task);
            },
          },
        }),
        iconButton('×', `Remove ${task.name}`, () => {
          handlers.onRemoveTask(task);
        }),
      ]),
    ],
  );
  card.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(DRAG_TYPE, task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });
  return card;
}

function enableDrop(zone: HTMLElement, columnId: string, handlers: QueueHandlers): void {
  const clearMarkers = () => {
    zone.classList.remove('drop-target');
    for (const marked of zone.querySelectorAll('.drop-before'))
      marked.classList.remove('drop-before');
  };

  zone.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearMarkers();
    zone.classList.add('drop-target');
    const { before } = dropPosition(zone, event.clientY);
    before?.classList.add('drop-before');
  });
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget as Node | null)) clearMarkers();
  });
  zone.addEventListener('drop', (event) => {
    const taskId = event.dataTransfer?.getData(DRAG_TYPE);
    clearMarkers();
    if (!taskId) return;
    event.preventDefault();
    handlers.onMoveTask(taskId, columnId, dropPosition(zone, event.clientY).index);
  });
}

/** Where a drop at `y` lands: the index among cards other than the one being dragged. */
function dropPosition(zone: HTMLElement, y: number): { index: number; before: HTMLElement | null } {
  const cards = [...zone.querySelectorAll<HTMLElement>('.queue-card:not(.dragging)')];
  const index = cards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  return index === -1
    ? { index: cards.length, before: null }
    : { index, before: cards[index] ?? null };
}

function iconButton(text: string, label: string, run: () => void): HTMLButtonElement {
  return el('button', {
    className: 'icon-button',
    text,
    attrs: { type: 'button', 'aria-label': label, title: label },
    on: { click: run },
  });
}
