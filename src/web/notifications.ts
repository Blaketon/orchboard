import type { AgentState, ClaudeAgent } from '../shared/api.ts';
import type { Settings } from './settings-store.ts';
import { playChime } from './sound.ts';
import { showToast } from './toast.ts';

export interface Transitions {
  readonly done: ClaudeAgent[];
  readonly blocked: ClaudeAgent[];
}

/**
 * Agents that just finished or just started waiting, compared with the previous snapshot.
 * Agents seen for the first time only count if they arrive already running, so opening the
 * dashboard doesn't announce everything that finished earlier.
 */
export function detectTransitions(
  previous: ReadonlyMap<string, AgentState>,
  agents: readonly ClaudeAgent[],
): Transitions {
  const done: ClaudeAgent[] = [];
  const blocked: ClaudeAgent[] = [];
  for (const agent of agents) {
    const before = previous.get(agent.id);
    if (before === undefined || before === agent.state) continue;
    if (agent.state === 'done') done.push(agent);
    else if (agent.state === 'blocked') blocked.push(agent);
  }
  return { done, blocked };
}

export interface Notifier {
  handle(agents: readonly ClaudeAgent[]): void;
}

export function createNotifier(options: {
  readonly settings: () => Settings;
  readonly onOpen: (agent: ClaudeAgent) => void;
}): Notifier {
  let previous: Map<string, AgentState> | undefined;

  const notify = (agent: ClaudeAgent, title: string, settings: Settings) => {
    const durationMs = settings.toastSeconds * 1000;
    showToast(`${title}: ${agent.name || agent.id}`, title === 'Completed' ? 'success' : 'info', {
      durationMs,
      onClick: () => {
        options.onOpen(agent);
      },
    });
    if (
      settings.desktopNotifications &&
      document.hidden &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      const notification = new Notification(`Orchboard: ${title}`, {
        body: agent.name || agent.id,
        tag: `orchboard-${agent.id}`,
      });
      notification.addEventListener('click', () => {
        window.focus();
        options.onOpen(agent);
      });
    }
  };

  return {
    handle(agents) {
      const current = new Map(agents.map((agent) => [agent.id, agent.state]));
      // The first snapshot only establishes a baseline.
      if (!previous) {
        previous = current;
        return;
      }
      const { done, blocked } = detectTransitions(previous, agents);
      previous = current;

      const settings = options.settings();
      if (settings.toastOnDone) for (const agent of done) notify(agent, 'Completed', settings);
      if (settings.toastOnBlocked)
        for (const agent of blocked) notify(agent, 'Needs input', settings);
      // One chime per snapshot, however many agents changed.
      if (done.length && settings.soundOnDone) playChime('done', settings.volume);
      else if (blocked.length && settings.soundOnBlocked) playChime('blocked', settings.volume);
    },
  };
}
