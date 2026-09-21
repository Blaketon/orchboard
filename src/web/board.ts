import type { Agent, AgentState } from '../shared/api.ts';
import { BOARD_COLUMNS, groupByState, projectKey, projectLabel, type Project } from './agents.ts';
import { moveColumn, orderColumns } from './column-order.ts';
import { el } from './dom.ts';
import { formatAge } from './format.ts';
import {
  clampStatusWidth,
  isCollapsed,
  RAIL_WIDTH,
  toggleOpen,
  type StatusLayout,
} from './status-layout.ts';

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
  // The three status columns move and resize together, always leading the row. Without a project
  // there is no queue to make room for, so they just show in full with no resize handle.
  const status = options.status
    ? statusGroup(groups, options, options.status)
    : el('div', { className: 'status-columns' }, statusColumns(groups, options));
  const order = orderColumns([...columns.keys()], options.columnOrder ?? []);

  // A drag in progress would be cancelled by replacing its card, so skip re-renders until it ends.
  if (container.querySelector('.dragging')) return;
  const row = el('div', { className: 'columns' }, [
    status,
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

/**
 * The status columns, grouped into one block that moves and resizes as a unit: the three full
 * columns above the rail floor, folding into the collapsed rail at it. A handle on the trailing
 * edge drags the block's width; dragging it down to the floor is what the rail used to need a
 * button for.
 */
function statusGroup(groups: Groups, options: BoardOptions, controls: StatusControls): HTMLElement {
  const { layout, onChange } = controls;
  const collapsed = isCollapsed(layout);
  const inner = collapsed
    ? [statusRailHeader(), ...statusRailTiles(groups, options, controls)]
    : statusColumns(groups, options);
  const group = el(
    'div',
    { className: collapsed ? 'status-columns status-columns-collapsed' : 'status-columns' },
    [...inner, statusResizeHandle()],
  );
  if (layout.width !== null) group.style.flex = `0 0 ${layout.width}px`;
  attachResizeHandle(group, layout, onChange);
  return group;
}

/** The full status columns, one per state. */
function statusColumns(groups: Groups, options: BoardOptions): HTMLElement[] {
  return BOARD_COLUMNS.map(({ state, title }) => {
    const cards = groups[state].map((agent) => card(agent, options));
    return el(
      'section',
      { className: 'column', attrs: { 'data-state': state, 'aria-label': title } },
      [
        el('header', { className: 'column-header' }, [
          el('h2', { className: 'column-title', text: title }),
          el('span', { className: 'column-count', text: String(cards.length) }),
          state === 'done' ? clearButton(groups.done, options) : null,
        ]),
        el(
          'div',
          { className: 'column-cards' },
          cards.length ? cards : [el('p', { className: 'column-empty', text: options.emptyText })],
        ),
      ],
    );
  });
}

function statusRailHeader(): HTMLElement {
  return el('div', { className: 'status-rail-header' }, [
    el('span', { className: 'status-rail-title', text: 'Agents' }),
  ]);
}

/** The status columns folded into one narrow stack of counts, each able to list its agents. */
function statusRailTiles(
  groups: Groups,
  options: BoardOptions,
  controls: StatusControls,
): HTMLElement[] {
  const { layout, onChange } = controls;
  return BOARD_COLUMNS.map(({ state, title }) => {
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
}

/** The vertical bar dragged to resize the status columns; collapsing to the rail is its floor. */
function statusResizeHandle(): HTMLElement {
  return el('div', {
    className: 'status-resize-handle',
    attrs: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': 'Resize status columns',
      title: 'Drag to resize, or drag to the edge to collapse. Double-click to reset.',
      tabindex: '0',
      'data-focus-key': 'status-resize',
    },
  });
}

const RESIZE_STEP = 40;

/** Wires up the handle at the end of `group` to drag, and arrow-key, its width. */
function attachResizeHandle(
  group: HTMLElement,
  layout: StatusLayout,
  onChange: (layout: StatusLayout) => void,
): void {
  const handle = group.querySelector<HTMLElement>(':scope > .status-resize-handle');
  if (!handle) return;
  let drag: { startX: number; startWidth: number; pointerId: number } | null = null;

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    drag = {
      startX: event.clientX,
      startWidth: group.getBoundingClientRect().width,
      pointerId: event.pointerId,
    };
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    // Marking the group `.dragging` skips re-renders (see `renderBoard`) until the drag ends.
    group.classList.add('dragging');
    const width = clampStatusWidth(drag.startWidth + (event.clientX - drag.startX));
    group.style.flex = `0 0 ${width}px`;
  });
  const endDrag = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    const dragged = group.classList.contains('dragging');
    group.classList.remove('dragging');
    if (!dragged) return; // A plain click leaves the layout alone.
    onChange({ ...layout, width: clampStatusWidth(group.getBoundingClientRect().width) });
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('lostpointercapture', endDrag);
  handle.addEventListener('dblclick', () => {
    onChange({ ...layout, width: null });
  });
  handle.addEventListener('keydown', (event) => {
    const width = layout.width ?? group.getBoundingClientRect().width;
    if (event.key === 'ArrowLeft')
      onChange({ ...layout, width: clampStatusWidth(width - RESIZE_STEP) });
    else if (event.key === 'ArrowRight')
      onChange({ ...layout, width: clampStatusWidth(width + RESIZE_STEP) });
    else if (event.key === 'Home') onChange({ ...layout, width: RAIL_WIDTH });
    else if (event.key === 'Enter' || event.key === ' ') onChange({ ...layout, width: null });
    else return;
    event.preventDefault();
  });
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
