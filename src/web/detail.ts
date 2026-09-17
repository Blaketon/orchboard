import type { ClaudeAgent, SessionUsage, Transcript, TranscriptPart } from '../shared/api.ts';
import { projectKey, projectLabel } from './agents.ts';
import { postJson } from './api.ts';
import { el } from './dom.ts';
import { formatAge, formatClock, formatCost, formatPercent, formatTokens } from './format.ts';
import { showToast } from './toast.ts';

const REFRESH_MS = 3000;
const STATE_LABELS: Readonly<Record<ClaudeAgent['state'], string>> = {
  blocked: 'Awaiting input',
  working: 'Working',
  done: 'Completed',
};

export interface DetailPanel {
  open(agent: ClaudeAgent): void;
  /** Keeps the open agent's header in sync with the latest snapshot. */
  update(agents: readonly ClaudeAgent[]): void;
}

/** A side panel showing one agent's live transcript and usage, refreshed while open. */
export function createDetailPanel(): DetailPanel {
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
  const usage = el('div', { className: 'usage' });
  const log = el('div', { className: 'transcript' });
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
        el('div', { className: 'detail-actions' }, [terminalButton, stopButton, closeButton]),
      ]),
      usage,
      log,
      replyForm,
    ],
  );
  document.body.append(dialog);

  let current: ClaudeAgent | undefined;
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

  function renderHeader(agent: ClaudeAgent): void {
    title.textContent = agent.name || agent.id;
    meta.replaceChildren(
      el('span', {
        className: 'badge',
        attrs: { 'data-state': agent.state },
        text: STATE_LABELS[agent.state],
      }),
      el('span', { text: projectLabel(projectKey(agent.cwd)), attrs: { title: agent.cwd } }),
      el('span', { text: `started ${formatAge(agent.startedAt, Date.now())} ago` }),
    );

    const running = agent.pid !== null || agent.state === 'working';
    stopButton.hidden = !running;
    // A running agent can't take a reply: resuming it would start a copy instead.
    const canReply = agent.pid === null;
    replyInput.disabled = !canReply;
    replyButton.disabled = !canReply;
    replyInput.placeholder = canReply
      ? 'Reply to the agent (Ctrl+Enter to send)'
      : 'The agent is working. You can reply once it stops or asks for input.';
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
                  text: entry.role === 'user' ? 'You' : 'Claude',
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
      return el('p', { className: 'entry-text', text: part.text });
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
