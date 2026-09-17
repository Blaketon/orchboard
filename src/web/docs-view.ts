import type { ProjectDoc, ProjectDocName, ProjectDocs } from '../shared/api.ts';
import { ApiError, errorMessage, requestJson } from './api.ts';
import { el } from './dom.ts';
import {
  discardEdits,
  hasConflict,
  isDirty,
  keepEdits,
  withDiskVersion,
  type DocState,
} from './docs-state.ts';
import { formatAgo } from './format.ts';
import { showToast } from './toast.ts';

const DOC_HINTS: Readonly<Record<ProjectDocName, string>> = {
  'CLAUDE.md': 'Loaded by Claude Code in every session in this project',
  'AGENTS.md': 'Loaded by Codex and other agents that read AGENTS.md',
};

export interface DocsProject {
  readonly key: string;
  readonly label: string;
}

export interface DocsView {
  /** Shows a project's docs, or a hint to pick one. Re-reads the files when it becomes visible. */
  show(project: DocsProject | null): void;
  hide(): void;
}

interface Panel {
  readonly id: string;
  readonly element: HTMLElement;
  update(): void;
}

/** Editors for the selected project's CLAUDE.md and AGENTS.md. Unsaved edits survive switching projects. */
export function createDocsView(container: HTMLElement): DocsView {
  const states = new Map<string, DocState>();
  const saving = new Set<string>();
  let panels: Panel[] = [];
  let project: DocsProject | null = null;
  let visible = false;
  let loads = 0;

  const docId = (key: string, name: string) => `${key}\n${name}`;

  window.addEventListener('beforeunload', (event) => {
    if ([...states.values()].some(isDirty)) event.preventDefault();
  });
  // Pick up edits made elsewhere (often by an agent) when coming back to the tab.
  window.addEventListener('focus', () => {
    if (visible && project) void load(project.key);
  });

  function renderMessage(title: string, message: string, action?: HTMLElement): void {
    panels = [];
    container.replaceChildren(
      el('div', { className: 'docs-message' }, [
        el('h2', { className: 'docs-message-title', text: title }),
        el('p', { text: message }),
        action,
      ]),
    );
  }

  async function load(key: string): Promise<void> {
    const token = ++loads;
    let docs: ProjectDocs;
    try {
      docs = await requestJson<ProjectDocs>(
        'GET',
        `/api/projects/docs?path=${encodeURIComponent(key)}`,
      );
    } catch (error) {
      if (token !== loads || project?.key !== key) return;
      if (panels.length) {
        showToast(`Could not reload the project docs: ${errorMessage(error)}`, 'error');
      } else {
        renderMessage(
          'Could not open the project docs',
          errorMessage(error),
          el('button', {
            className: 'button',
            text: 'Try again',
            attrs: { type: 'button' },
            on: { click: () => void load(key) },
          }),
        );
      }
      return;
    }
    if (token !== loads || project?.key !== key) return;

    for (const file of docs.files) {
      const id = docId(key, file.name);
      // A save in flight changes the file itself; its result updates the state instead.
      if (!saving.has(id)) states.set(id, withDiskVersion(states.get(id), file));
    }
    if (panels.length && panels.every((panel) => panel.id.startsWith(`${key}\n`))) {
      for (const panel of panels) panel.update();
    } else {
      renderPanels(docs);
    }
  }

  function renderPanels(docs: ProjectDocs): void {
    const key = project?.key ?? docs.path;
    panels = docs.files.map((file) => createPanel(key, file.name));
    container.replaceChildren(
      el('header', { className: 'docs-header' }, [
        el('div', { className: 'docs-heading' }, [
          el('h2', { className: 'docs-title', text: project?.label ?? key }),
          el('code', { className: 'docs-path', text: docs.path }),
        ]),
        el('button', {
          className: 'button',
          text: 'Reload',
          attrs: {
            type: 'button',
            title: 'Read the files from disk again. Unsaved edits are kept.',
          },
          on: { click: () => void load(key) },
        }),
      ]),
      el(
        'div',
        { className: 'docs-grid' },
        panels.map((panel) => panel.element),
      ),
    );
  }

  function createPanel(key: string, name: ProjectDocName): Panel {
    const id = docId(key, name);
    const status = el('span', { className: 'doc-status' });
    const editor = el('textarea', {
      className: 'doc-editor',
      attrs: { spellcheck: 'false', 'aria-label': name },
    });
    const revert = el('button', {
      className: 'button',
      text: 'Revert',
      attrs: { type: 'button', title: 'Discard unsaved changes' },
    });
    const save = el('button', {
      className: 'button button-primary',
      text: 'Save',
      attrs: { type: 'button', title: 'Save (Ctrl+S)' },
    });
    const conflict = el('div', { className: 'doc-conflict', attrs: { role: 'alert' } }, [
      el('span', { text: `${name} changed on disk while you were editing.` }),
      el('button', {
        className: 'button button-small',
        text: 'Use disk version',
        attrs: { type: 'button' },
        on: {
          click: () => {
            change((state) => discardEdits(state));
          },
        },
      }),
      el('button', {
        className: 'button button-small',
        text: 'Keep mine',
        attrs: { type: 'button', title: 'Keep your edits. Saving replaces the version on disk.' },
        on: {
          click: () => {
            change((state) => keepEdits(state));
          },
        },
      }),
    ]);

    const change = (next: (state: DocState) => DocState) => {
      const state = states.get(id);
      if (!state) return;
      const changed = next(state);
      // With the edits gone there is nothing to protect: follow the disk again.
      states.set(id, !isDirty(changed) && hasConflict(changed) ? discardEdits(changed) : changed);
      update();
    };

    function update(): void {
      const state = states.get(id);
      if (!state) return;
      if (editor.value !== state.text) editor.value = state.text;
      const dirty = isDirty(state);
      const busy = saving.has(id);
      const conflicted = hasConflict(state);

      conflict.hidden = !conflicted;
      revert.disabled = !dirty || busy;
      save.disabled = !dirty || busy || conflicted;
      save.textContent = busy ? 'Saving…' : 'Save';
      status.dataset.dirty = String(dirty);
      status.textContent = dirty
        ? 'Unsaved changes'
        : state.base.modifiedAt === null
          ? 'Not created yet'
          : `Updated ${formatAgo(state.base.modifiedAt, Date.now())}`;
    }

    async function submit(): Promise<void> {
      const state = states.get(id);
      if (!state || saving.has(id) || !isDirty(state) || hasConflict(state)) return;
      saving.add(id);
      update();
      try {
        const saved = await requestJson<ProjectDoc>('PUT', '/api/projects/docs', {
          path: key,
          name,
          content: state.text,
          expectedModifiedAt: state.base.modifiedAt,
        });
        // Typing during the save stays as a new unsaved change.
        const text = states.get(id)?.text ?? state.text;
        states.set(id, { base: saved, latest: saved, text });
        showToast(`Saved ${name}`, 'success');
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Reading the file again marks the conflict so the user can choose a version.
          saving.delete(id);
          await load(key);
        } else {
          showToast(`Could not save ${name}: ${errorMessage(error)}`, 'error');
        }
      } finally {
        saving.delete(id);
        update();
      }
    }

    editor.addEventListener('input', () => {
      change((state) => ({ ...state, text: editor.value }));
    });
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void submit();
      }
    });
    revert.addEventListener('click', () => {
      change((state) => discardEdits(state));
    });
    save.addEventListener('click', () => void submit());

    const element = el('section', { className: 'doc-panel', attrs: { 'aria-label': name } }, [
      el('header', { className: 'doc-panel-header' }, [
        el('div', {}, [
          el('h3', { className: 'doc-panel-title', text: name }),
          el('p', { className: 'doc-panel-hint', text: DOC_HINTS[name] }),
        ]),
        status,
      ]),
      conflict,
      editor,
      el('footer', { className: 'doc-panel-actions' }, [revert, save]),
    ]);
    update();
    return { id, element, update };
  }

  return {
    show(next) {
      const changed = next?.key !== project?.key;
      const appearing = !visible;
      visible = true;
      if (!changed && !appearing) return;
      project = next;
      if (!next) {
        renderMessage(
          'Project docs',
          'Choose a project in the sidebar to edit its CLAUDE.md and AGENTS.md.',
        );
        return;
      }
      if (changed) renderMessage('Project docs', 'Loading…');
      void load(next.key);
    },
    hide() {
      visible = false;
    },
  };
}
