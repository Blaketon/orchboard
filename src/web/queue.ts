import type { QueueColumn, QueuedTask, QueueState } from '../shared/api.ts';
import { AGENT_LABELS } from './agents.ts';
import { queueColumnKey } from './column-order.ts';
import { el } from './dom.ts';
import { modesFor } from './task-dialog.ts';

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

  const section = el(
    'section',
    {
      className: 'column queue-column',
      attrs: { 'data-column-key': queueColumnKey(column.id), 'aria-label': column.name },
    },
    [
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
    ],
  );
  // The whole column takes the drop, so a task can be let go anywhere over it.
  enableDrop(section, cards, column.id, handlers);
  return section;
}

/** The agent a queued task will run on and its model; an unset model is the agent's default. */
export function taskRunner(task: QueuedTask): { agent: string; model: string } {
  return { agent: AGENT_LABELS[task.provider ?? 'claude'], model: task.model ?? 'Default model' };
}

function renderTask(task: QueuedTask, handlers: QueueHandlers): HTMLElement {
  const provider = task.provider ?? 'claude';
  const mode = modesFor(provider).find((option) => option.value === task.permissionMode)?.label;
  const runner = taskRunner(task);
  const card = el(
    'div',
    {
      className: 'card queue-card',
      attrs: { draggable: 'true', tabindex: '0', 'data-task-id': task.id, title: task.prompt },
      on: {
        // The whole card opens the task for editing; its own buttons keep their actions.
        click: (event) => {
          if (event.target instanceof Element && event.target.closest('button')) return;
          handlers.onEditTask(task);
        },
        keydown: (event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          handlers.onEditTask(task);
        },
      },
    },
    [
      el('span', { className: 'card-title', text: task.name }),
      el('span', { className: 'queue-card-runner' }, [
        el('span', { className: 'agent-tag', text: runner.agent }),
        el('span', {
          className: 'queue-card-model',
          text: runner.model,
          attrs: { title: `Model: ${runner.model}` },
        }),
      ]),
      el('span', { className: 'card-meta' }, [
        el('span', { className: 'card-project', text: mode ?? task.permissionMode }),
        task.images?.length
          ? el('span', {
              text: `${task.images.length} image${task.images.length === 1 ? '' : 's'}`,
            })
          : null,
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

/** Takes task drops anywhere over `column`, marking the column and the spot the task will land. */
function enableDrop(
  column: HTMLElement,
  cards: HTMLElement,
  columnId: string,
  handlers: QueueHandlers,
): void {
  const clearMarkers = () => {
    column.classList.remove('drop-target');
    for (const marked of cards.querySelectorAll('.drop-before, .drop-after')) {
      marked.classList.remove('drop-before', 'drop-after');
    }
  };

  column.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearMarkers();
    column.classList.add('drop-target');
    const { index, others } = dropPosition(cards, event.clientY);
    const before = others[index];
    if (before) before.classList.add('drop-before');
    else others.at(-1)?.classList.add('drop-after');
  });
  column.addEventListener('dragleave', (event) => {
    if (!column.contains(event.relatedTarget as Node | null)) clearMarkers();
  });
  column.addEventListener('drop', (event) => {
    const taskId = event.dataTransfer?.getData(DRAG_TYPE);
    clearMarkers();
    if (!taskId) return;
    event.preventDefault();
    handlers.onMoveTask(taskId, columnId, dropPosition(cards, event.clientY).index);
  });
}

/** Where a drop at `y` lands: the index among the cards other than the one being dragged. */
function dropPosition(cards: HTMLElement, y: number): { index: number; others: HTMLElement[] } {
  const others = [...cards.querySelectorAll<HTMLElement>('.queue-card:not(.dragging)')];
  const index = others.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  return { index: index === -1 ? others.length : index, others };
}

function iconButton(text: string, label: string, run: () => void): HTMLButtonElement {
  return el('button', {
    className: 'icon-button',
    text,
    attrs: { type: 'button', 'aria-label': label, title: label },
    on: { click: run },
  });
}
