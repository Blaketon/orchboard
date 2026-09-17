import type { ClaudeAgent } from '../shared/api.ts';
import { BOARD_COLUMNS, groupByState, projectKey, projectLabel, type Project } from './agents.ts';
import { el } from './dom.ts';
import { formatAge } from './format.ts';

export interface BoardOptions {
  readonly now: number;
  readonly emptyText: string;
  readonly onOpen: (agent: ClaudeAgent) => void;
  /** Extra columns after the status columns, e.g. the selected project's queue. */
  readonly extraColumns?: readonly HTMLElement[];
  /** Hides every completed agent currently shown. */
  readonly onClearCompleted?: (agents: readonly ClaudeAgent[]) => void;
}

export function renderBoard(
  container: HTMLElement,
  agents: readonly ClaudeAgent[],
  options: BoardOptions,
): void {
  // Re-rendering replaces the cards; keep keyboard focus on the same agent.
  const focusedId =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.agentId
      : undefined;

  const groups = groupByState(agents);
  const columns = BOARD_COLUMNS.map(({ state, title }) => {
    const cards = groups[state].map((agent) => card(agent, options));
    return el(
      'section',
      { className: 'column', attrs: { 'data-state': state, 'aria-label': title } },
      [
        el('header', { className: 'column-header' }, [
          el('h2', { className: 'column-title', text: title }),
          el('span', { className: 'column-count', text: String(cards.length) }),
          state === 'done' && cards.length && options.onClearCompleted
            ? el('button', {
                className: 'column-clear',
                text: 'Clear',
                attrs: { type: 'button', title: 'Hide completed agents from the board' },
                on: {
                  click: () => {
                    options.onClearCompleted?.(groups.done);
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
  // A drag in progress would be cancelled by replacing its card, so skip re-renders until it ends.
  if (container.querySelector('.dragging')) return;
  container.replaceChildren(
    el('div', { className: 'columns' }, [...columns, ...(options.extraColumns ?? [])]),
  );

  if (focusedId) {
    container.querySelector<HTMLElement>(`[data-agent-id="${CSS.escape(focusedId)}"]`)?.focus();
  }
}

function card(agent: ClaudeAgent, options: BoardOptions): HTMLButtonElement {
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
        el('span', { className: 'card-age', text: formatAge(agent.startedAt, options.now) }),
      ]),
    ],
  );
}

export interface ProjectListHandlers {
  readonly onSelect: (key: string | null) => void;
  readonly onRename: (project: Project) => void;
  readonly onRemove: (project: Project) => void;
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
    if (!project?.saved) return el('li', { className: 'project-item' }, [select]);

    const action = (text: string, label: string, run: () => void) =>
      el('button', {
        className: 'icon-button project-action',
        text,
        attrs: { type: 'button', 'aria-label': `${label} ${project.label}`, title: label },
        on: { click: run },
      });
    return el('li', { className: 'project-item' }, [
      select,
      el('span', { className: 'project-actions' }, [
        action('✎', 'Rename', () => {
          handlers.onRename(project);
        }),
        action('×', 'Remove', () => {
          handlers.onRemove(project);
        }),
      ]),
    ]);
  };

  list.replaceChildren(item(null), ...projects.map(item));
}
