import type { ClaudeAgent } from '../shared/api.ts';
import { projectKey, projectLabel } from './agents.ts';
import { el } from './dom.ts';
import { formatAge } from './format.ts';

export const STATE_LABELS: Readonly<Record<ClaudeAgent['state'], string>> = {
  blocked: 'Awaiting input',
  working: 'Working',
  done: 'Completed',
};

const STATE_ORDER: Readonly<Record<ClaudeAgent['state'], number>> = {
  working: 0,
  blocked: 1,
  done: 2,
};

export interface ListOptions {
  readonly now: number;
  readonly emptyText: string;
  readonly onOpen: (agent: ClaudeAgent) => void;
}

/** Sorts running agents first, then those awaiting input, then completed; newest first within each. */
export function sortForList(agents: readonly ClaudeAgent[]): ClaudeAgent[] {
  return [...agents].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.startedAt - a.startedAt,
  );
}

export function renderList(
  container: HTMLElement,
  agents: readonly ClaudeAgent[],
  options: ListOptions,
): void {
  const rows = sortForList(agents).map((agent) =>
    el('tr', { attrs: { 'data-state': agent.state } }, [
      el('td', {}, [
        el('button', {
          className: 'list-open',
          text: agent.name || agent.id,
          attrs: { type: 'button', 'data-agent-id': agent.id },
          on: {
            click: () => {
              options.onOpen(agent);
            },
          },
        }),
      ]),
      el('td', {
        className: 'list-muted',
        text: projectLabel(projectKey(agent.cwd)),
        attrs: { title: agent.cwd },
      }),
      el('td', {}, [
        el('span', {
          className: 'badge',
          attrs: { 'data-state': agent.state },
          text: STATE_LABELS[agent.state],
        }),
      ]),
      el('td', { className: 'list-muted list-age', text: formatAge(agent.startedAt, options.now) }),
    ]),
  );

  container.replaceChildren(
    el('table', { className: 'list' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Task', attrs: { scope: 'col' } }),
          el('th', { text: 'Project', attrs: { scope: 'col' } }),
          el('th', { text: 'Status', attrs: { scope: 'col' } }),
          el('th', { text: 'Started', attrs: { scope: 'col' } }),
        ]),
      ]),
      el(
        'tbody',
        {},
        rows.length
          ? rows
          : [
              el('tr', {}, [
                el('td', { className: 'empty', text: options.emptyText, attrs: { colspan: '4' } }),
              ]),
            ],
      ),
    ]),
  );
}
