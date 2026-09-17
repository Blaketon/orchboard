import type {
  Agent,
  AgentProvider,
  Approval,
  ApprovalDecision,
  SessionUsage,
  Transcript,
  TranscriptPart,
} from '../shared/api.ts';
import { AGENT_LABELS, projectKey, projectLabel } from './agents.ts';
import { postJson, requestJson } from './api.ts';
import { confirmDialog } from './dialogs.ts';
import { el } from './dom.ts';
import { formatAgo, formatClock, formatCost, formatPercent, formatTokens } from './format.ts';
import { renderMarkdown } from './markdown.ts';
import { showToast } from './toast.ts';

const REFRESH_MS = 3000;
const STATE_LABELS: Readonly<Record<Agent['state'], string>> = {
  blocked: 'Awaiting input',
  working: 'Working',
  done: 'Completed',
};
/** Who wrote an assistant message in the transcript. */
const AGENT_NAMES: Readonly<Record<AgentProvider, string>> = { claude: 'Claude', codex: 'Codex' };

export interface DetailPanel {
  open(agent: Agent): void;
  /** Keeps the open agent's header in sync with the latest snapshot. */
  update(agents: readonly Agent[]): void;
}

/** A side panel showing one agent's live transcript and usage, refreshed while open. */
export function createDetailPanel(options: {
  readonly onHide: (agent: Agent) => void;
}): DetailPanel {
  const title = el('h2', { className: 'detail-title', attrs: { id: 'detail-title' } });
  const meta = el('p', { className: 'detail-meta' });
  const closeButton = el('button', {
    className: 'button',
    text: 'Close',
    attrs: { type: 'button' },
  });
  const stopButton = el('button', {
    className: 'button button-danger',
    text: 'Stop',
    attrs: { type: 'button', title: 'Stop the agent. Its conversation is kept.' },
  });
  const terminalButton = el('button', {
    className: 'button',
    text: 'Terminal',
    attrs: { type: 'button', title: 'Open this agent in a terminal window (claude attach)' },
  });
  const hideButton = el('button', {
    className: 'button',
    text: 'Hide',
    attrs: { type: 'button', title: 'Hide this agent from the board in this browser' },
  });
  const deleteButton = el('button', {
    className: 'button button-danger',
    text: 'Delete',
    attrs: { type: 'button', title: 'Delete the session and its worktree (claude rm)' },
  });
  const usage = el('div', { className: 'usage' });
  const log = el('div', { className: 'transcript' });
  const failure = el('p', { className: 'detail-error', attrs: { role: 'alert' } });
  failure.hidden = true;
  const approvals = el('div', { className: 'approvals' });
  const replyInput = el('textarea', {
    className: 'field-input reply-input',
    attrs: { rows: '2', 'aria-label': 'Reply to the agent' },
  });
  const replyButton = el('button', {
    className: 'button button-primary',
    text: 'Send',
    attrs: { type: 'submit' },
  });
  const replyForm = el('form', { className: 'reply' }, [replyInput, replyButton]);
  const dialog = el(
    'dialog',
    { className: 'detail', attrs: { 'aria-labelledby': 'detail-title' } },
    [
      el('header', { className: 'detail-header' }, [
        el('div', {}, [title, meta]),
        el('div', { className: 'detail-actions' }, [
          terminalButton,
          stopButton,
          hideButton,
          deleteButton,
          closeButton,
        ]),
      ]),
      usage,
      failure,
      log,
      approvals,
      replyForm,
    ],
  );
  document.body.append(dialog);

  let current: Agent | undefined;
  let lastBody = '';
  let timer: number | undefined;

  closeButton.addEventListener('click', () => {
    dialog.close();
  });

  terminalButton.addEventListener('click', () => {
    const agent = current;
    if (!agent) return;
    postJson(`/api/agents/${encodeURIComponent(agent.id)}/terminal`, {}).catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    });
  });

  hideButton.addEventListener('click', () => {
    const agent = current;
    if (!agent) return;
    dialog.close();
    options.onHide(agent);
  });

  deleteButton.addEventListener('click', () => {
    const agent = current;
    if (!agent) return;
    void confirmDialog({
      title: 'Delete this agent?',
      message:
        agent.provider === 'codex'
          ? `"${agent.name || agent.id}" will be removed from Orchboard. Codex keeps the conversation in its own history.`
          : `"${agent.name || agent.id}" and its conversation will be deleted, along with its git worktree when that is safe. This cannot be undone.`,
      confirmLabel: 'Delete',
    }).then(async (confirmed) => {
      if (!confirmed) return;
      try {
        await requestJson('DELETE', `/api/agents/${encodeURIComponent(agent.id)}`);
        dialog.close();
        showToast('Agent deleted', 'success');
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      }
    });
  });

  stopButton.addEventListener('click', () => {
    const agent = current;
    if (!agent) return;
    stopButton.disabled = true;
    postJson(`/api/agents/${encodeURIComponent(agent.id)}/stop`, {})
      .then(() => {
        showToast('Stopping agent…');
      })
      .catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      })
      .finally(() => {
        stopButton.disabled = false;
      });
  });

  replyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) replyForm.requestSubmit();
  });
  replyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const agent = current;
    const prompt = replyInput.value.trim();
    if (!agent || !prompt) return;
    replyButton.disabled = true;
    postJson(`/api/agents/${encodeURIComponent(agent.id)}/reply`, { prompt })
      .then(() => {
        replyInput.value = '';
        showToast('Reply sent', 'success');
        window.setTimeout(() => void refresh(), 1500);
      })
      .catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      })
      .finally(() => {
        replyButton.disabled = false;
      });
  });
  // Clicking the dimmed backdrop (outside the panel) closes it too.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    window.clearInterval(timer);
    current = undefined;
  });

  function renderHeader(agent: Agent): void {
    title.textContent = agent.name || agent.id;
    meta.replaceChildren(
      el('span', {
        className: 'badge',
        attrs: { 'data-state': agent.state },
        text: STATE_LABELS[agent.state],
      }),
      el('span', { className: 'agent-tag', text: AGENT_LABELS[agent.provider] }),
      el('span', { text: projectLabel(projectKey(agent.cwd)), attrs: { title: agent.cwd } }),
      el('span', { text: `started ${formatAgo(agent.startedAt, Date.now())}` }),
    );

    const running = agent.pid !== null || agent.state === 'working';
    stopButton.hidden = !running;
    deleteButton.hidden = running;
    // A running agent can't take a reply: resuming it would start a copy instead.
    const canReply = agent.pid === null;
    replyInput.disabled = !canReply;
    replyButton.disabled = !canReply;
    const waiting = agent.approvals?.length ?? 0;
    replyInput.placeholder = canReply
      ? 'Reply to the agent (Ctrl+Enter to send)'
      : waiting
        ? 'The agent is waiting for your decision above.'
        : 'The agent is working. You can reply once it stops or asks for input.';

    const codex = agent.provider === 'codex';
    terminalButton.title = codex
      ? 'Continue this task in a terminal (codex resume)'
      : 'Open this agent in a terminal (claude attach)';
    deleteButton.title = codex
      ? 'Remove this task from Orchboard'
      : 'Delete the session and its worktree (claude rm)';
    failure.hidden = !agent.error;
    failure.textContent = agent.error ?? '';
    renderApprovals(agent);
  }

  let approvalsShown = '';
  function renderApprovals(agent: Agent): void {
    const pending = agent.approvals ?? [];
    // Snapshots arrive often; rebuilding the same buttons would steal focus mid-click.
    const signature = JSON.stringify([agent.id, pending]);
    if (signature === approvalsShown) return;
    approvalsShown = signature;
    approvals.replaceChildren(...pending.map((approval) => renderApproval(agent, approval)));
  }

  function renderApproval(agent: Agent, approval: Approval): HTMLElement {
    const buttons: HTMLButtonElement[] = [];
    const decide = (decision: ApprovalDecision) => {
      for (const button of buttons) button.disabled = true;
      postJson(
        `/api/agents/${encodeURIComponent(agent.id)}/approvals/${encodeURIComponent(approval.id)}`,
        { decision },
      ).catch((error: unknown) => {
        for (const button of buttons) button.disabled = false;
        showToast(error instanceof Error ? error.message : String(error), 'error');
      });
    };
    const button = (text: string, decision: ApprovalDecision, className = 'button') => {
      const element = el('button', {
        className: `${className} button-small`,
        text,
        attrs: { type: 'button' },
        on: {
          click: () => {
            decide(decision);
          },
        },
      });
      buttons.push(element);
      return element;
    };

    return el('section', { className: 'approval', attrs: { 'aria-label': approval.title } }, [
      el('h3', { className: 'approval-title', text: approval.title }),
      approval.reason ? el('p', { className: 'approval-reason', text: approval.reason }) : null,
      approval.detail ? el('pre', { className: 'approval-detail', text: approval.detail }) : null,
      approval.declineOnly
        ? el('p', {
            className: 'approval-reason',
            text: 'Orchboard cannot answer this here. Decline it, or reply in a terminal.',
          })
        : null,
      el('div', { className: 'approval-actions' }, [
        approval.declineOnly ? null : button('Approve', 'accept', 'button button-primary'),
        approval.canAllowForSession && !approval.declineOnly
          ? button('Approve for this session', 'acceptForSession')
          : null,
        button('Decline', 'decline', 'button button-danger'),
      ]),
    ]);
  }

  async function refresh(): Promise<void> {
    const agent = current;
    if (!agent) return;
    let body: string;
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/transcript`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      body = await response.text();
    } catch (error) {
      if (current?.id === agent.id && !lastBody) {
        log.replaceChildren(
          el('p', {
            className: 'empty',
            text: `Could not load the transcript (${String(error)}).`,
          }),
        );
      }
      return;
    }
    if (current?.id !== agent.id || body === lastBody) return;
    const firstLoad = !lastBody;
    lastBody = body;
    renderTranscript(JSON.parse(body) as Transcript, firstLoad);
  }

  function renderTranscript(transcript: Transcript, firstLoad: boolean): void {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    renderUsage(usage, transcript.usage);
    log.replaceChildren(
      ...(transcript.entries.length
        ? transcript.entries.map((entry) =>
            el('article', { className: 'entry', attrs: { 'data-role': entry.role } }, [
              el('header', { className: 'entry-header' }, [
                el('span', {
                  className: 'entry-role',
                  text: entry.role === 'user' ? 'You' : AGENT_NAMES[current?.provider ?? 'claude'],
                }),
                el('time', { className: 'entry-time', text: formatClock(entry.timestamp) }),
              ]),
              ...entry.parts.map(renderPart),
            ]),
          )
        : [el('p', { className: 'empty', text: 'No transcript yet.' })]),
    );
    // Follow new output only if the reader is already at the bottom.
    if (firstLoad || nearBottom) log.scrollTop = log.scrollHeight;
  }

  return {
    open(agent) {
      current = agent;
      lastBody = '';
      renderHeader(agent);
      usage.replaceChildren();
      log.replaceChildren(el('p', { className: 'empty', text: 'Loading transcript…' }));
      if (!dialog.open) dialog.showModal();
      window.clearInterval(timer);
      void refresh();
      timer = window.setInterval(() => void refresh(), REFRESH_MS);
    },
    update(agents) {
      if (!current) return;
      const latest = agents.find((agent) => agent.id === current?.id);
      if (!latest) return;
      current = latest;
      renderHeader(latest);
    },
  };
}

function renderUsage(container: HTMLElement, usage: SessionUsage | null): void {
  const tokens = usage?.tokens;
  const total = tokens ? tokens.input + tokens.output + tokens.cacheCreation + tokens.cacheRead : 0;
  // Sessions with no conversation stored have nothing worth showing.
  if (!usage || total === 0) {
    container.replaceChildren();
    return;
  }
  const fill = el('span', { className: 'context-fill' });
  // CSSOM styles are allowed under the page's Content Security Policy; inline style attributes aren't.
  fill.style.width = formatPercent(usage.contextTokens, usage.contextWindow);

  container.replaceChildren(
    stat('Tokens', formatTokens(total)),
    stat('Cost', formatCost(usage.costUsd, usage.costIsPartial)),
    stat('Model', usage.model ?? '—'),
    el('div', { className: 'stat stat-context' }, [
      el('span', { className: 'stat-label', text: 'Context' }),
      el('span', {
        className: 'stat-value',
        text: `${formatPercent(usage.contextTokens, usage.contextWindow)} of ${formatTokens(usage.contextWindow)}`,
      }),
      el('span', { className: 'context-bar', attrs: { 'aria-hidden': 'true' } }, [fill]),
    ]),
  );
}

function stat(label: string, value: string): HTMLElement {
  return el('div', { className: 'stat' }, [
    el('span', { className: 'stat-label', text: label }),
    el('span', { className: 'stat-value', text: value }),
  ]);
}

function renderPart(part: TranscriptPart): HTMLElement {
  switch (part.type) {
    case 'text':
      return el('div', { className: 'entry-text' }, [renderMarkdown(part.text)]);
    case 'tool_call':
      return el('div', { className: 'tool-call' }, [
        el('span', { className: 'tool-name', text: part.name }),
        el('code', { className: 'tool-summary', text: part.summary }),
      ]);
    case 'tool_result':
      return el(
        'details',
        { className: 'tool-result', attrs: { 'data-error': String(part.isError) } },
        [
          el('summary', { text: part.isError ? 'Error' : 'Result' }),
          el('pre', { text: part.text || '(empty)' }),
        ],
      );
  }
}
