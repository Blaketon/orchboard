import type { Agent, AgentState } from '../shared/api.ts';
import { BOARD_COLUMNS, groupByState, projectKey, projectLabel, type Project } from './agents.ts';
import { el } from './dom.ts';
import { formatAge } from './format.ts';
import { toggleOpen, type StatusLayout } from './status-layout.ts';

export interface StatusControls {
  readonly layout: StatusLayout;
  readonly onChange: (layout: StatusLayout) => void;
}

export interface BoardOptions {
  readonly now: number;
  readonly emptyText: string;
  readonly onOpen: (agent: Agent) => void;
  /** Extra columns after the status columns, e.g. the selected project's queue. */
  readonly extraColumns?: readonly HTMLElement[];
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
  const status = options.status?.layout.collapsed
    ? [statusRail(groups, options, options.status)]
    : statusColumns(groups, options);
  // A drag in progress would be cancelled by replacing its card, so skip re-renders until it ends.
  if (container.querySelector('.dragging')) return;
  container.replaceChildren(
    el('div', { className: 'columns' }, [...status, ...(options.extraColumns ?? [])]),
  );

  if (focusedId) {
    container.querySelector<HTMLElement>(`[data-agent-id="${CSS.escape(focusedId)}"]`)?.focus();
  } else if (focusedTaskId) {
    container.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(focusedTaskId)}"]`)?.focus();
  } else if (focusKey) {
    container.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  }
}

function statusColumns(groups: Groups, options: BoardOptions): HTMLElement[] {
  return BOARD_COLUMNS.map(({ state, title }, index) => {
    const cards = groups[state].map((agent) => card(agent, options));
    const controls = options.status;
    return el(
      'section',
      { className: 'column', attrs: { 'data-state': state, 'aria-label': title } },
      [
        el('header', { className: 'column-header' }, [
          el('h2', { className: 'column-title', text: title }),
          el('span', { className: 'column-count', text: String(cards.length) }),
          state === 'done' ? clearButton(groups.done, options) : null,
          index === 0 && controls
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
