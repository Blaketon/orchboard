import type {
  QueueColumn,
  QueuedTask,
  QueueState,
  StartTaskRequest,
  StartTaskResponse,
} from '../shared/api.ts';
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  PERMISSION_MODES,
  type PermissionMode,
} from '../shared/permission-modes.ts';
import { requestJson } from './api.ts';
import { createAttachmentPicker } from './attachments.ts';
import { el } from './dom.ts';
import { showToast } from './toast.ts';

const MODE_KEY = 'orchboard-permission-mode';

type Target =
  | { readonly kind: 'start' }
  | { readonly kind: 'queue-add'; readonly column: QueueColumn }
  | { readonly kind: 'queue-edit'; readonly task: QueuedTask };

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
  const mode = el(
    'select',
    { className: 'field-input', attrs: { name: 'permissionMode' } },
    PERMISSION_MODES.map((option) =>
      el('option', { attrs: { value: option.value }, text: option.label }),
    ),
  );
  const images = createAttachmentPicker();
  images.listenOn(prompt);
  const error = el('p', { className: 'form-error', attrs: { role: 'alert' } });
  error.hidden = true;
  const submit = el('button', { className: 'button button-primary', attrs: { type: 'submit' } });
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
    field('Permissions', mode),
    error,
    el('div', { className: 'form-actions' }, [cancel, submit]),
    suggestions,
  ]);
  const dialog = el(
    'dialog',
    { className: 'modal', attrs: { 'aria-labelledby': 'task-dialog-title' } },
    [form],
  );
  document.body.append(dialog);

  let target: Target = { kind: 'start' };
  const LABELS: Readonly<Record<Target['kind'], { title: string; submit: string; busy: string }>> =
    {
      start: { title: 'New task', submit: 'Start task', busy: 'Starting…' },
      'queue-add': { title: 'Add to queue', submit: 'Add to queue', busy: 'Adding…' },
      'queue-edit': { title: 'Edit queued task', submit: 'Save', busy: 'Saving…' },
    };

  cancel.addEventListener('click', () => {
    dialog.close();
  });
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });

  async function save(): Promise<void> {
    if (images.isUploading()) {
      error.textContent = 'Wait for the images to finish uploading.';
      error.hidden = false;
      return;
    }
    const permissionMode = isPermissionMode(mode.value) ? mode.value : DEFAULT_PERMISSION_MODE;
    const fields = {
      cwd: cwd.value.trim(),
      prompt: prompt.value,
      name: name.value.trim(),
      permissionMode,
      images: images.ids(),
    };
    const labels = LABELS[target.kind];
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = labels.busy;
    try {
      if (target.kind === 'start') {
        await requestJson<StartTaskResponse>(
          'POST',
          '/api/tasks',
          fields satisfies StartTaskRequest,
        );
        showToast('Task started', 'success');
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
      saveMode(permissionMode);
      dialog.close();
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : String(caught);
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = labels.submit;
    }
  }

  function show(
    next: Target,
    values: {
      cwd: string;
      name: string;
      prompt: string;
      mode: PermissionMode;
      images: readonly string[];
    },
  ) {
    target = next;
    const labels = LABELS[next.kind];
    title.textContent = labels.title;
    submit.textContent = labels.submit;
    suggestions.replaceChildren(
      ...options.knownProjects().map((path) => el('option', { attrs: { value: path } })),
    );
    cwd.value = values.cwd;
    name.value = values.name;
    prompt.value = values.prompt;
    mode.value = values.mode;
    images.reset(values.images);
    error.hidden = true;
    dialog.showModal();
    (cwd.value ? prompt : cwd).focus();
  }

  return {
    open(defaultCwd) {
      show(
        { kind: 'start' },
        { cwd: defaultCwd ?? cwd.value, name: '', prompt: '', mode: storedMode(), images: [] },
      );
    },
    openQueueAdd(column) {
      show(
        { kind: 'queue-add', column },
        { cwd: column.project, name: '', prompt: '', mode: storedMode(), images: [] },
      );
    },
    openQueueEdit(task) {
      show(
        { kind: 'queue-edit', task },
        {
          cwd: task.cwd,
          name: task.name,
          prompt: task.prompt,
          mode: isPermissionMode(task.permissionMode) ? task.permissionMode : storedMode(),
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

function storedMode(): PermissionMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    return isPermissionMode(stored) ? stored : DEFAULT_PERMISSION_MODE;
  } catch {
    return DEFAULT_PERMISSION_MODE;
  }
}

function saveMode(value: PermissionMode): void {
  try {
    localStorage.setItem(MODE_KEY, value);
  } catch {
    // Remembering the choice is a convenience only.
  }
}
