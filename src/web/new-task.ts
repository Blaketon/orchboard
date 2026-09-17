import type { StartTaskRequest, StartTaskResponse } from '../shared/api.ts';
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  PERMISSION_MODES,
  type PermissionMode,
} from '../shared/permission-modes.ts';
import { postJson } from './api.ts';
import { el } from './dom.ts';
import { showToast } from './toast.ts';

const MODE_KEY = 'orchboard-permission-mode';

export interface NewTaskDialog {
  /** Opens the form, prefilled with a project folder when one is selected. */
  open(defaultCwd: string | null): void;
}

export function createNewTaskDialog(options: {
  /** Folders to suggest, e.g. every project currently on the board. */
  readonly knownProjects: () => readonly string[];
  readonly onStarted: () => void;
}): NewTaskDialog {
  const suggestions = el('datalist', { attrs: { id: 'project-suggestions' } });
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
  const error = el('p', { className: 'form-error', attrs: { role: 'alert' } });
  error.hidden = true;
  const submit = el('button', {
    className: 'button button-primary',
    text: 'Start task',
    attrs: { type: 'submit' },
  });
  const cancel = el('button', { className: 'button', text: 'Cancel', attrs: { type: 'button' } });

  const form = el('form', { className: 'form', attrs: { method: 'dialog' } }, [
    el('h2', { className: 'form-title', text: 'New task', attrs: { id: 'new-task-title' } }),
    field('Project folder', cwd),
    field('Task name', name),
    field('Prompt', prompt, 'Ctrl+Enter to start'),
    field('Permissions', mode),
    error,
    el('div', { className: 'form-actions' }, [cancel, submit]),
    suggestions,
  ]);
  const dialog = el(
    'dialog',
    { className: 'modal', attrs: { 'aria-labelledby': 'new-task-title' } },
    [form],
  );
  document.body.append(dialog);

  mode.value = storedMode();
  cancel.addEventListener('click', () => {
    dialog.close();
  });
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void start();
  });

  async function start(): Promise<void> {
    const request: StartTaskRequest = {
      cwd: cwd.value.trim(),
      prompt: prompt.value,
      name: name.value.trim(),
      permissionMode: isPermissionMode(mode.value) ? mode.value : DEFAULT_PERMISSION_MODE,
    };
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Starting…';
    try {
      await postJson<StartTaskResponse>('/api/tasks', request);
      saveMode(request.permissionMode ?? DEFAULT_PERMISSION_MODE);
      name.value = '';
      prompt.value = '';
      dialog.close();
      showToast('Task started', 'success');
      options.onStarted();
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : String(caught);
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Start task';
    }
  }

  return {
    open(defaultCwd) {
      suggestions.replaceChildren(
        ...options.knownProjects().map((path) => el('option', { attrs: { value: path } })),
      );
      if (defaultCwd) cwd.value = defaultCwd;
      error.hidden = true;
      dialog.showModal();
      (cwd.value ? prompt : cwd).focus();
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
