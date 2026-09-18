import type { Agent, AgentState } from '../shared/api.ts';
import { BOARD_COLUMNS, groupByState, projectKey, projectLabel, type Project } from './agents.ts';
import { moveColumn, orderColumns } from './column-order.ts';
import { el } from './dom.ts';
import { formatAge } from './format.ts';
import { toggleOpen, type StatusLayout } from './status-layout.ts';

export interface StatusControls {
  readonly layout: StatusLayout;
  readonly onChange: (layout: StatusLayout) => void;
}

const COLUMN_DRAG_TYPE = 'application/x-orchboard-column';

export interface BoardOptions {
  readonly now: number;
  readonly emptyText: string;
  readonly onOpen: (agent: Agent) => void;
  /**
   * Extra columns after the status columns, e.g. the selected project's queue. Columns with a
   * `data-column-key` attribute can be reordered; the rest stay at the end.
   */
  readonly extraColumns?: readonly HTMLElement[];
  /** Saved column order, as column keys; see `orderColumns`. */
  readonly columnOrder?: readonly string[];
  /** Called with the shown columns' keys in their new order after the user drags a column. */
  readonly onReorderColumns?: (keys: readonly string[]) => void;
  /** Hides every completed agent currently shown. */
  readonly onClearCompleted?: (agents: readonly Agent[]) => void;
  /** Lets the status columns fold into a rail of counts; without it they always show in full. */
  readonly status?: StatusControls;
}

type Groups = Record<AgentState, Agent[]>;

export function renderBoard(
  container: HTMLElement,
  agents: readonly Agent[],
  options: BoardOptions,
): void {
  // Re-rendering replaces the cards and buttons; keep keyboard focus on the same one.
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusedId = active?.dataset.agentId;
  const focusedTaskId = active?.dataset.taskId;
  const focusKey = active?.dataset.focusKey;

  const groups = groupByState(agents);
  const columns = new Map<string, HTMLElement>();
  const trailing: HTMLElement[] = [];
  for (const column of options.extraColumns ?? []) {
    const key = column.dataset.columnKey;
    if (key) columns.set(key, column);
    else trailing.push(column);
  }
  // Collapsed, the status columns fold into one rail that stays in front; only full columns move.
  const rail = options.status?.layout.collapsed
    ? statusRail(groups, options, options.status)
    : null;
  const states: string[] = rail ? [] : BOARD_COLUMNS.map((column) => column.state);
  const order = orderColumns([...states, ...columns.keys()], options.columnOrder ?? []);
  if (!rail) {
    // The collapse button goes on whichever status column is shown first.
    const first = order.find((key) => states.includes(key));
    for (const [state, column] of statusColumns(groups, options, first)) columns.set(state, column);
  }

  // A drag in progress would be cancelled by replacing its card, so skip re-renders until it ends.
  if (container.querySelector('.dragging')) return;
  const row = el('div', { className: 'columns' }, [
    rail,
    ...order.map((key) => columns.get(key)),
    ...trailing,
  ]);
  if (options.onReorderColumns) enableColumnDrag(row, order, options.onReorderColumns);
  container.replaceChildren(row);

  if (focusedId) {
    container.querySelector<HTMLElement>(`[data-agent-id="${CSS.escape(focusedId)}"]`)?.focus();
  } else if (focusedTaskId) {
    container.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(focusedTaskId)}"]`)?.focus();
  } else if (focusKey) {
    container.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }
}

/** The full status columns by state; `collapseOn` is the one that gets the collapse button. */
function statusColumns(
  groups: Groups,
  options: BoardOptions,
  collapseOn: string | undefined,
): [AgentState, HTMLElement][] {
  return BOARD_COLUMNS.map(({ state, title }) => {
    const cards = groups[state].map((agent) => card(agent, options));
    const controls = options.status;
    const column = el(
      'section',
      {
        className: 'column',
        attrs: { 'data-state': state, 'data-column-key': state, 'aria-label': title },
      },
      [
        el('header', { className: 'column-header' }, [
          el('h2', { className: 'column-title', text: title }),
          el('span', { className: 'column-count', text: String(cards.length) }),
          state === 'done' ? clearButton(groups.done, options) : null,
          state === collapseOn && controls
            ? el('button', {
                className: 'icon-button column-collapse',
                text: '«',
                attrs: {
                  type: 'button',
                  'aria-label': 'Collapse status columns',
                  title: 'Collapse status columns to make room for the project board',
                  'data-focus-key': 'status-toggle',
                },
                on: {
                  click: () => {
                    controls.onChange({ ...controls.layout, collapsed: true });
                  },
                },
              })
            : null,
        ]),
        el(
          'div',
          { className: 'column-cards' },
          cards.length ? cards : [el('p', { className: 'column-empty', text: options.emptyText })],
        ),
      ],
    );
    return [state, column];
  });
}

/** The status columns folded into one narrow stack of counts, each able to list its agents. */
function statusRail(groups: Groups, options: BoardOptions, controls: StatusControls): HTMLElement {
  const { layout, onChange } = controls;
  const tiles = BOARD_COLUMNS.map(({ state, title }) => {
    const agents = groups[state];
    const open = layout.open.includes(state);
    return el(
      'section',
      {
        className: 'column status-tile',
        attrs: {
          'data-state': state,
          'aria-label': title,
          // Agents waiting on the user stay noticeable even when only their count shows.
          ...(state === 'blocked' && agents.length ? { 'data-attention': 'true' } : {}),
        },
      },
      [
        el('header', { className: 'status-tile-header' }, [
          el(
            'button',
            {
              className: 'status-tile-toggle',
              attrs: {
                type: 'button',
                'aria-expanded': String(open),
                title: open
                  ? `Hide the ${title.toLowerCase()} list`
                  : `List ${title.toLowerCase()}`,
                'data-focus-key': `status-${state}`,
              },
              on: {
                click: () => {
                  onChange(toggleOpen(layout, state));
                },
              },
            },
            [
              el('span', { className: 'column-title', text: title }),
              el('span', { className: 'column-count', text: String(agents.length) }),
              el('span', {
                className: 'status-tile-chevron',
                text: open ? '▾' : '▸',
                attrs: { 'aria-hidden': 'true' },
              }),
            ],
          ),
          state === 'done' ? clearButton(agents, options) : null,
        ]),
        open
          ? el(
              'div',
              { className: 'column-cards' },
              agents.length
                ? agents.map((agent) => compactCard(agent, options))
                : [el('p', { className: 'column-empty', text: options.emptyText })],
            )
          : null,
      ],
    );
  });

  return el('div', { className: 'status-rail' }, [
    el('div', { className: 'status-rail-header' }, [
      el('span', { className: 'status-rail-title', text: 'Agents' }),
      el('button', {
        className: 'icon-button',
        text: '»',
        attrs: {
          type: 'button',
          'aria-label': 'Expand status columns',
          title: 'Expand status columns',
          'data-focus-key': 'status-toggle',
        },
        on: {
          click: () => {
            onChange({ ...layout, collapsed: false });
          },
        },
      }),
    ]),
    ...tiles,
  ]);
}

function clearButton(done: readonly Agent[], options: BoardOptions): HTMLButtonElement | null {
  const { onClearCompleted } = options;
  if (!done.length || !onClearCompleted) return null;
  return el('button', {
    className: 'column-clear',
    text: 'Clear',
    attrs: { type: 'button', title: 'Hide completed agents from the board' },
    on: {
      click: () => {
        onClearCompleted(done);
      },
    },
  });
}

/** A one-line card for the collapsed rail; the project is already selected, so it is left out. */
function compactCard(agent: Agent, options: BoardOptions): HTMLButtonElement {
  const name = agent.name || agent.id;
  return el(
    'button',
    {
      className: 'card card-compact',
      attrs: { type: 'button', 'data-agent-id': agent.id, 'data-state': agent.state, title: name },
      on: {
        click: () => {
          options.onOpen(agent);
        },
      },
    },
    [
      el('span', { className: 'card-compact-row' }, [
        el('span', { className: 'card-title', text: name }),
        el('span', { className: 'card-age', text: formatAge(agent.startedAt, options.now) }),
      ]),
      agent.approvals?.length
        ? el('span', { className: 'card-attention', text: 'Needs your approval' })
        : null,
    ],
  );
}

/** Lets the user move a column by dragging its header; `order` is the shown columns' keys. */
function enableColumnDrag(
  row: HTMLElement,
  order: readonly string[],
  onReorder: (keys: readonly string[]) => void,
): void {
  const sections = [...row.querySelectorAll<HTMLElement>(':scope > [data-column-key]')];
  let dragged: HTMLElement | null = null;

  const clearMarkers = () => {
    for (const marked of row.querySelectorAll('.column-drop-before, .column-drop-after')) {
      marked.classList.remove('column-drop-before', 'column-drop-after');
    }
  };
  /** Where a drop at `x` lands: the index among the columns other than the dragged one. */
  const dropIndex = (x: number) => {
    const others = sections.filter((section) => section !== dragged);
    const index = others.findIndex((section) => {
      const rect = section.getBoundingClientRect();
      return x < rect.left + rect.width / 2;
    });
    return { others, index: index === -1 ? others.length : index };
  };
  /** The new order for a drop at `x`, or null when the column would stay where it is. */
  const reordered = (x: number) => {
    const key = dragged?.dataset.columnKey;
    if (!key) return null;
    const next = moveColumn(order, key, dropIndex(x).index);
    return next.some((other, index) => other !== order[index]) ? next : null;
  };

  for (const section of sections) {
    const header = section.querySelector<HTMLElement>(':scope > .column-header');
    if (!header) continue;
    header.draggable = true;
    header.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer) return;
      dragged = section;
      event.dataTransfer.setData(COLUMN_DRAG_TYPE, section.dataset.columnKey ?? '');
      event.dataTransfer.effectAllowed = 'move';
      // Drag the whole column, held where the pointer grabbed its header.
      const rect = section.getBoundingClientRect();
      event.dataTransfer.setDragImage(section, event.clientX - rect.left, event.clientY - rect.top);
      // Fade the column once the browser has taken the drag image, so the image stays opaque.
      requestAnimationFrame(() => {
        if (dragged === section) section.classList.add('dragging');
      });
    });
    header.addEventListener('dragend', () => {
      dragged = null;
      section.classList.remove('dragging');
      clearMarkers();
    });
  }

  row.addEventListener('dragover', (event) => {
    if (!dragged || !event.dataTransfer?.types.includes(COLUMN_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearMarkers();
    if (!reordered(event.clientX)) return;
    const { others, index } = dropIndex(event.clientX);
    const before = others[index];
    if (before) before.classList.add('column-drop-before');
    else others.at(-1)?.classList.add('column-drop-after');
  });
  row.addEventListener('dragleave', (event) => {
    if (!row.contains(event.relatedTarget as Node | null)) clearMarkers();
  });
  row.addEventListener('drop', (event) => {
    if (!dragged) return;
    event.preventDefault();
    clearMarkers();
    const next = reordered(event.clientX);
    // The board skips re-renders while a column is marked as dragging.
    dragged.classList.remove('dragging');
    dragged = null;
    if (next) onReorder(next);
  });
}

function card(agent: Agent, options: BoardOptions): HTMLButtonElement {
  return el(
    'button',
    {
      className: 'card',
      attrs: { type: 'button', 'data-agent-id': agent.id, 'data-state': agent.state },
      on: {
        click: () => {
          options.onOpen(agent);
        },
      },
    },
    [
      el('span', { className: 'card-title', text: agent.name || agent.id }),
      el('span', { className: 'card-meta' }, [
        el('span', { className: 'card-project', text: projectLabel(projectKey(agent.cwd)) }),
        agentTag(agent),
        el('span', { className: 'card-age', text: formatAge(agent.startedAt, options.now) }),
      ]),
      agent.approvals?.length
        ? el('span', { className: 'card-attention', text: 'Needs your approval' })
        : null,
    ],
  );
}

export interface ProjectListHandlers {
  readonly onSelect: (key: string | null) => void;
  readonly onRename: (project: Project) => void;
  readonly onRemove: (project: Project) => void;
  /** Pins or unpins the project, keeping it at the top of the list. */
  readonly onTogglePin: (project: Project) => void;
}

export function renderProjects(
  list: HTMLUListElement,
  projects: readonly Project[],
  total: number,
  selected: string | null,
  handlers: ProjectListHandlers,
): void {
  const item = (project: Project | null) => {
    const key = project?.key ?? null;
    const select = el(
      'button',
      {
        className: 'project',
        attrs: {
          type: 'button',
          'aria-current': String(selected === key),
          ...(key ? { title: key } : {}),
        },
        on: {
          click: () => {
            handlers.onSelect(key);
          },
        },
      },
      [
        el('span', { className: 'project-label', text: project?.label ?? 'All projects' }),
        el('span', { className: 'project-count', text: String(project?.count ?? total) }),
      ],
    );
    if (!project) return el('li', { className: 'project-item' }, [select]);

    const action = (text: string, label: string, run: () => void) =>
      el('button', {
        className: 'icon-button project-action',
        text,
        attrs: { type: 'button', 'aria-label': `${label} ${project.label}`, title: label },
        on: { click: run },
      });
    // Starring a project that was only on the board because of its agents also saves it.
    const star = el('button', {
      className: 'icon-button project-star',
      text: project.pinned ? '★' : '☆',
      attrs: {
        type: 'button',
        'aria-pressed': String(project.pinned),
        'aria-label': `${project.pinned ? 'Unpin' : 'Pin'} ${project.label}`,
        title: project.pinned ? 'Unpin' : 'Pin to the top',
      },
      on: {
        click: () => {
          handlers.onTogglePin(project);
        },
      },
    });
    return el('li', { className: 'project-item' }, [
      star,
      select,
      project.saved
        ? el('span', { className: 'project-actions' }, [
            action('✎', 'Rename', () => {
              handlers.onRename(project);
            }),
            action('×', 'Remove', () => {
              handlers.onRemove(project);
            }),
          ])
        : null,
    ]);
  };

  list.replaceChildren(item(null), ...projects.map(item));
}

/** Marks Codex tasks; Claude Code agents are the default and go unmarked. */
export function agentTag(agent: Agent): HTMLElement | null {
  return agent.provider === 'codex' ? el('span', { className: 'agent-tag', text: 'Codex' }) : null;
}
