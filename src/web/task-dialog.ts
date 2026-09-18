import type {
  AgentProvider,
  QueueColumn,
  QueuedTask,
  QueueState,
  StartTaskRequest,
  StartTaskResponse,
} from '../shared/api.ts';
import {
  CODEX_PERMISSION_MODES,
  DEFAULT_CODEX_PERMISSION_MODE,
  DEFAULT_PERMISSION_MODE,
  isCodexPermissionMode,
  isPermissionMode,
  PERMISSION_MODES,
  type CodexPermissionMode,
  type PermissionMode,
} from '../shared/permission-modes.ts';
import { AGENT_LABELS } from './agents.ts';
import { requestJson } from './api.ts';
import { createAttachmentPicker } from './attachments.ts';
import { el } from './dom.ts';
import { showToast } from './toast.ts';

type Mode = PermissionMode | CodexPermissionMode;

const PROVIDER_KEY = 'orchboard-agent';
const MODE_KEYS: Readonly<Record<AgentProvider, string>> = {
  claude: 'orchboard-permission-mode',
  codex: 'orchboard-codex-permission-mode',
};
const MODEL_KEYS: Readonly<Record<AgentProvider, string>> = {
  claude: 'orchboard-model',
  codex: 'orchboard-codex-model',
};

/**
 * Model names to suggest. Both CLIs accept a model name or alias and fall back to their own
 * configured default, so the field stays free text; these are only shortcuts.
 */
export const MODEL_SUGGESTIONS: Readonly<Record<AgentProvider, readonly string[]>> = {
  claude: ['opus', 'sonnet', 'haiku', 'fable'],
  codex: [],
};

/** The permission choices for an agent. */
export function modesFor(provider: AgentProvider): readonly { value: Mode; label: string }[] {
  return provider === 'codex' ? CODEX_PERMISSION_MODES : PERMISSION_MODES;
}

/** A mode that is valid for the agent, falling back to the agent's default. */
export function modeFor(provider: AgentProvider, value: unknown): Mode {
  if (provider === 'codex') {
    return isCodexPermissionMode(value) ? value : DEFAULT_CODEX_PERMISSION_MODE;
  }
  return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE;
}

type Target =
  | { readonly kind: 'start' }
  | { readonly kind: 'queue-add'; readonly column: QueueColumn }
  | { readonly kind: 'queue-edit'; readonly task: QueuedTask };

interface Labels {
  readonly title: string;
  readonly submit: string;
  readonly busy: string;
  /** Whether the form also offers to run the task right away instead of saving it. */
  readonly run: boolean;
}

/** The title and buttons for each use of the form. */
export const LABELS: Readonly<Record<Target['kind'], Labels>> = {
  start: { title: 'New task', submit: 'Start task', busy: 'Starting…', run: false },
  'queue-add': { title: 'New task', submit: 'Save', busy: 'Saving…', run: true },
  'queue-edit': { title: 'Edit queued task', submit: 'Save', busy: 'Saving…', run: false },
};

export interface TaskDialog {
  /** Opens the form to start a task now, prefilled with a project folder when one is selected. */
  open(defaultCwd: string | null): void;
  /** Opens the form to add a task to a queue column. */
  openQueueAdd(column: QueueColumn): void;
  /** Opens the form to edit a queued task. */
  openQueueEdit(task: QueuedTask): void;
}

/** One form for starting a task now, adding it to a queue column, or editing a queued task. */
export function createTaskDialog(options: {
  /** Folders to suggest, e.g. every project in the sidebar. */
  readonly knownProjects: () => readonly string[];
  readonly onQueueChanged: (queue: QueueState) => void;
}): TaskDialog {
  const suggestions = el('datalist', { attrs: { id: 'project-suggestions' } });
  const title = el('h2', { className: 'form-title', attrs: { id: 'task-dialog-title' } });
  const cwd = el('input', {
    className: 'field-input',
    attrs: {
      name: 'cwd',
      list: 'project-suggestions',
      required: '',
      placeholder: 'C:\\Git\\my-project',
      autocomplete: 'off',
      spellcheck: 'false',
    },
  });
  const name = el('input', {
    className: 'field-input',
    attrs: {
      name: 'name',
      maxlength: '120',
      placeholder: 'Defaults to the first line of the prompt',
    },
  });
  const prompt = el('textarea', {
    className: 'field-input field-prompt',
    attrs: { name: 'prompt', required: '', rows: '8', placeholder: 'What should the agent do?' },
  });
  const agent = el(
    'select',
    { className: 'field-input', attrs: { name: 'provider' } },
    (Object.keys(AGENT_LABELS) as AgentProvider[]).map((value) =>
      el('option', { attrs: { value }, text: AGENT_LABELS[value] }),
    ),
  );
  const mode = el('select', { className: 'field-input', attrs: { name: 'permissionMode' } });
  const modelOptions = el('datalist', { attrs: { id: 'model-suggestions' } });
  const model = el('input', {
    className: 'field-input',
    attrs: {
      name: 'model',
      list: 'model-suggestions',
      placeholder: 'Default',
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: '80',
    },
  });
  const images = createAttachmentPicker();
  images.listenOn(prompt);
  const error = el('p', { className: 'form-error', attrs: { role: 'alert' } });
  error.hidden = true;
  const submit = el('button', { className: 'button button-primary', attrs: { type: 'submit' } });
  // A plain button, so Enter and Ctrl+Enter keep saving rather than starting an agent.
  const run = el('button', { className: 'button', text: 'Run', attrs: { type: 'button' } });
  const cancel = el('button', { className: 'button', text: 'Cancel', attrs: { type: 'button' } });

  const form = el('form', { className: 'form' }, [
    title,
    field('Project folder', cwd),
    field('Task name', name),
    field('Prompt', prompt, 'Ctrl+Enter to submit'),
    el('div', { className: 'field' }, [
      el('span', { className: 'field-label', text: 'Images' }),
      images.element,
    ]),
    el('div', { className: 'field-row' }, [field('Agent', agent), field('Permissions', mode)]),
    field('Model', model, "Leave empty for the agent's own default"),
    error,
    el('div', { className: 'form-actions' }, [cancel, run, submit]),
    suggestions,
    modelOptions,
  ]);
  const dialog = el(
    'dialog',
    { className: 'modal', attrs: { 'aria-labelledby': 'task-dialog-title' } },
    [form],
  );
  document.body.append(dialog);

  let target: Target = { kind: 'start' };

  const currentProvider = (): AgentProvider => (agent.value === 'codex' ? 'codex' : 'claude');

  function setProvider(provider: AgentProvider, selected: unknown, chosenModel: string): void {
    agent.value = provider;
    mode.replaceChildren(
      ...modesFor(provider).map((option) =>
        el('option', { attrs: { value: option.value }, text: option.label }),
      ),
    );
    mode.value = modeFor(provider, selected);
    modelOptions.replaceChildren(
      ...MODEL_SUGGESTIONS[provider].map((value) => el('option', { attrs: { value } })),
    );
    model.value = chosenModel;
  }

  agent.addEventListener('change', () => {
    const provider = currentProvider();
    // Each agent has its own models, so switching brings up that agent's last choice.
    setProvider(provider, stored(MODE_KEYS[provider]), stored(MODEL_KEYS[provider]) ?? '');
  });
  cancel.addEventListener('click', () => {
    dialog.close();
  });
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(false);
  });
  run.addEventListener('click', () => {
    if (form.reportValidity()) void save(true);
  });

  /** Sends the form, or with `runNow` starts the task instead of saving it to the queue. */
  async function save(runNow: boolean): Promise<void> {
    if (images.isUploading()) {
      error.textContent = 'Wait for the images to finish uploading.';
      error.hidden = false;
      return;
    }
    const provider = currentProvider();
    const permissionMode = modeFor(provider, mode.value);
    const fields = {
      provider,
      cwd: cwd.value.trim(),
      prompt: prompt.value,
      name: name.value.trim(),
      permissionMode,
      model: model.value.trim(),
      images: images.ids(),
    };
    const labels = runNow ? { submit: 'Run', busy: 'Starting…' } : LABELS[target.kind];
    const button = runNow ? run : submit;
    error.hidden = true;
    submit.disabled = true;
    run.disabled = true;
    button.textContent = labels.busy;
    try {
      if (target.kind === 'start' || runNow) {
        await requestJson<StartTaskResponse>(
          'POST',
          '/api/tasks',
          fields satisfies StartTaskRequest,
        );
        showToast(`${AGENT_LABELS[provider]} task started`, 'success');
      } else if (target.kind === 'queue-add') {
        options.onQueueChanged(
          await requestJson<QueueState>('POST', '/api/queue/tasks', {
            ...fields,
            columnId: target.column.id,
          }),
        );
      } else {
        options.onQueueChanged(
          await requestJson<QueueState>(
            'PATCH',
            `/api/queue/tasks/${encodeURIComponent(target.task.id)}`,
            fields,
          ),
        );
      }
      remember(PROVIDER_KEY, provider);
      remember(MODE_KEYS[provider], permissionMode);
      remember(MODEL_KEYS[provider], fields.model);
      dialog.close();
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : String(caught);
      error.hidden = false;
    } finally {
      submit.disabled = false;
      run.disabled = false;
      button.textContent = labels.submit;
    }
  }

  function show(
    next: Target,
    values: {
      cwd: string;
      name: string;
      prompt: string;
      provider: AgentProvider;
      mode: unknown;
      model: string;
      images: readonly string[];
    },
  ) {
    target = next;
    const labels = LABELS[next.kind];
    title.textContent = labels.title;
    submit.textContent = labels.submit;
    run.hidden = !labels.run;
    suggestions.replaceChildren(
      ...options.knownProjects().map((path) => el('option', { attrs: { value: path } })),
    );
    cwd.value = values.cwd;
    name.value = values.name;
    prompt.value = values.prompt;
    setProvider(values.provider, values.mode, values.model);
    images.reset(values.images);
    error.hidden = true;
    dialog.showModal();
    (cwd.value ? prompt : cwd).focus();
  }

  /** A new task starts with the agent, mode, and model used last time. */
  const fresh = () => {
    const provider: AgentProvider = stored(PROVIDER_KEY) === 'codex' ? 'codex' : 'claude';
    return {
      name: '',
      prompt: '',
      provider,
      mode: stored(MODE_KEYS[provider]),
      model: stored(MODEL_KEYS[provider]) ?? '',
      images: [],
    };
  };

  return {
    open(defaultCwd) {
      show({ kind: 'start' }, { ...fresh(), cwd: defaultCwd ?? cwd.value });
    },
    openQueueAdd(column) {
      show({ kind: 'queue-add', column }, { ...fresh(), cwd: column.project });
    },
    openQueueEdit(task) {
      show(
        { kind: 'queue-edit', task },
        {
          cwd: task.cwd,
          name: task.name,
          prompt: task.prompt,
          provider: task.provider ?? 'claude',
          mode: task.permissionMode,
          model: task.model ?? '',
          images: task.images ?? [],
        },
      );
    },
  };
}

function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return el('label', { className: 'field' }, [
    el('span', { className: 'field-label' }, [
      label,
      hint ? el('span', { className: 'field-hint', text: hint }) : null,
    ]),
    input,
  ]);
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering the choice is a convenience only.
  }
}
