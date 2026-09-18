import type { AgentSnapshot, Agent, QueueState, SavedProjectView } from '../shared/api.ts';
import { BOARD_COLUMNS, filterAgents, listProjects, type Project } from './agents.ts';
import { errorMessage, requestJson } from './api.ts';
import { renderBoard, renderProjects } from './board.ts';
import { ColumnOrder, queueColumnKey } from './column-order.ts';
import { createDetailPanel } from './detail.ts';
import { createDocsView } from './docs-view.ts';
import { HiddenAgents } from './hidden-agents.ts';
import { confirmDialog, formDialog } from './dialogs.ts';
import { byId } from './dom.ts';
import { renderList } from './list.ts';
import { connectLiveAgents, type ConnectionState } from './live.ts';
import { createTaskDialog } from './task-dialog.ts';
import { createNotifier } from './notifications.ts';
import { renderQueueColumns, type QueueHandlers } from './queue.ts';
import { createSettingsDialog } from './settings-dialog.ts';
import { createSkillsDialog } from './skills-dialog.ts';
import { SettingsStore } from './settings-store.ts';
import { loadStatusLayout, saveStatusLayout, type StatusLayout } from './status-layout.ts';
import { unlockAudioOnInteraction } from './sound.ts';
import { applyTheme } from './theme.ts';
import { createUsageWidget } from './usage-widget.ts';
import { showToast } from './toast.ts';

const CONNECTION_LABELS: Readonly<Record<ConnectionState, string>> = {
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Offline',
};

const board = byId('board', 'div');
const docs = byId('docs', 'div');
const docsView = createDocsView(docs);
const notice = byId('notice', 'p');
const connection = byId('connection', 'span');
const projectList = byId('project-list', 'ul');
const search = byId('search', 'input');
const hiddenBar = byId('hidden-bar', 'div');
const hiddenLabel = byId('hidden-label', 'span');
const hiddenToggle = byId('hidden-toggle', 'button');
const hiddenReset = byId('hidden-reset', 'button');
const hidden = new HiddenAgents();
const columnOrder = new ColumnOrder();
let showHidden = false;
const detail = createDetailPanel({
  onHide: (agent) => {
    hidden.hide([agent.id]);
    showToast('Agent hidden from the board');
    render();
  },
});

type View = 'board' | 'list' | 'docs';
const VIEW_KEY = 'orchboard-view';

function parseView(value: string | null | undefined): View {
  return value === 'list' || value === 'docs' ? value : 'board';
}

function storedView(): View {
  try {
    return parseView(localStorage.getItem(VIEW_KEY));
  } catch {
    return 'board';
  }
}

function saveView(value: View): void {
  try {
    localStorage.setItem(VIEW_KEY, value);
  } catch {
    // Remembering the view is a convenience only.
  }
}

let view: View = storedView();
let snapshot: AgentSnapshot | undefined;
let savedProjects: SavedProjectView[] = [];
let queue: QueueState = { columns: [], tasks: [] };
let selectedProject: string | null = null;
let query = '';
let statusLayout = loadStatusLayout();

const settings = new SettingsStore();
settings.subscribe((current) => {
  applyTheme(current.theme);
});
const settingsDialog = createSettingsDialog(settings);
byId('open-settings', 'button').addEventListener('click', () => {
  settingsDialog.open();
});
const skillsDialog = createSkillsDialog();
byId('open-skills', 'button').addEventListener('click', () => {
  skillsDialog.open();
});
unlockAudioOnInteraction();
createUsageWidget(byId('usage', 'section'), settings);

const notifier = createNotifier({
  settings: () => settings.get(),
  onOpen: (agent) => {
    detail.open(agent);
  },
});

const currentProjects = (): Project[] => listProjects(snapshot?.agents ?? [], savedProjects);

function setQueue(next: QueueState): void {
  queue = next;
  // The queue lists every project's columns, so any other saved key is a removed column.
  columnOrder.prune(
    new Set([
      ...BOARD_COLUMNS.map((column) => column.state),
      ...next.columns.map((column) => queueColumnKey(column.id)),
    ]),
  );
  render();
}

const taskDialog = createTaskDialog({
  knownProjects: () => currentProjects().map((project) => project.key),
  onQueueChanged: setQueue,
});
byId('new-task', 'button').addEventListener('click', () => {
  taskDialog.open(selectedProject);
});

/** Runs a queue request and applies the returned state, reporting failures as toasts. */
function updateQueue(run: () => Promise<QueueState>): void {
  run()
    .then(setQueue)
    .catch((error: unknown) => {
      showToast(errorMessage(error), 'error');
    });
}

const queueHandlers: QueueHandlers = {
  onAddColumn: () => {
    const project = selectedProject;
    if (!project) return;
    void formDialog({
      title: 'Add column',
      submitLabel: 'Add column',
      fields: [
        { name: 'name', label: 'Name', placeholder: 'Next up', required: true, maxLength: 40 },
      ],
      submit: async ({ name }) => {
        setQueue(await requestJson<QueueState>('POST', '/api/queue/columns', { project, name }));
      },
    });
  },
  onRenameColumn: (column) => {
    void formDialog({
      title: 'Rename column',
      submitLabel: 'Save',
      fields: [{ name: 'name', label: 'Name', value: column.name, required: true, maxLength: 40 }],
      submit: async ({ name }) => {
        setQueue(
          await requestJson<QueueState>(
            'PATCH',
            `/api/queue/columns/${encodeURIComponent(column.id)}`,
            {
              name,
            },
          ),
        );
      },
    });
  },
  onRemoveColumn: (column, taskCount) => {
    void confirmDialog({
      title: 'Remove column?',
      message: taskCount
        ? `"${column.name}" and its ${taskCount} queued task${taskCount === 1 ? '' : 's'} will be deleted.`
        : `"${column.name}" will be deleted.`,
      confirmLabel: 'Remove',
    }).then((confirmed) => {
      if (confirmed) {
        updateQueue(() =>
          requestJson('DELETE', `/api/queue/columns/${encodeURIComponent(column.id)}`),
        );
      }
    });
  },
  onAddTask: (column) => {
    taskDialog.openQueueAdd(column);
  },
  onEditTask: (task) => {
    taskDialog.openQueueEdit(task);
  },
  onRemoveTask: (task) => {
    void confirmDialog({
      title: 'Remove queued task?',
      message: `"${task.name}" will be deleted from the queue.`,
      confirmLabel: 'Remove',
    }).then((confirmed) => {
      if (confirmed) {
        updateQueue(() => requestJson('DELETE', `/api/queue/tasks/${encodeURIComponent(task.id)}`));
      }
    });
  },
  onStartTask: (task) => {
    updateQueue(async () => {
      const result = await requestJson<{ queue: QueueState }>(
        'POST',
        `/api/queue/tasks/${encodeURIComponent(task.id)}/start`,
        {},
      );
      showToast(`Started "${task.name}"`, 'success');
      return result.queue;
    });
  },
  onMoveTask: (taskId, columnId, index) => {
    updateQueue(() =>
      requestJson('POST', `/api/queue/tasks/${encodeURIComponent(taskId)}/move`, {
        columnId,
        index,
      }),
    );
  },
};

async function loadQueue(): Promise<void> {
  try {
    setQueue(await requestJson<QueueState>('GET', '/api/queue'));
  } catch (error) {
    showToast(`Could not load the queue: ${errorMessage(error)}`, 'error');
  }
}

async function loadProjects(): Promise<void> {
  try {
    savedProjects = await requestJson<SavedProjectView[]>('GET', '/api/projects');
    render();
  } catch (error) {
    showToast(`Could not load projects: ${errorMessage(error)}`, 'error');
  }
}

byId('add-project', 'button').addEventListener('click', () => {
  void formDialog({
    title: 'Add project',
    submitLabel: 'Add project',
    fields: [
      { name: 'path', label: 'Folder', placeholder: 'C:\\Git\\my-project', required: true },
      {
        name: 'label',
        label: 'Name (optional)',
        placeholder: 'Defaults to the folder name',
        maxLength: 60,
      },
    ],
    submit: async (values) => {
      savedProjects = await requestJson<SavedProjectView[]>('POST', '/api/projects', values);
      render();
    },
  });
});

function renameProject(project: Project): void {
  void formDialog({
    title: 'Rename project',
    submitLabel: 'Save',
    fields: [
      {
        name: 'label',
        label: 'Name',
        value: project.label,
        placeholder: 'Leave empty to use the folder name',
        maxLength: 60,
      },
    ],
    submit: async (values) => {
      savedProjects = await requestJson<SavedProjectView[]>('POST', '/api/projects', {
        path: project.key,
        label: values.label,
      });
      render();
    },
  });
}

async function togglePin(project: Project): Promise<void> {
  try {
    savedProjects = await requestJson<SavedProjectView[]>('POST', '/api/projects', {
      path: project.key,
      pinned: !project.pinned,
    });
    render();
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
}

async function removeProject(project: Project): Promise<void> {
  const confirmed = await confirmDialog({
    title: 'Remove project?',
    message: `"${project.label}" will be removed from the sidebar. Its files and agents are not affected.`,
    confirmLabel: 'Remove',
  });
  if (!confirmed) return;
  try {
    savedProjects = await requestJson<SavedProjectView[]>(
      'DELETE',
      `/api/projects?path=${encodeURIComponent(project.key)}`,
    );
    render();
  } catch (error) {
    showToast(errorMessage(error), 'error');
  }
}

function render(): void {
  if (!snapshot) return;
  notice.hidden = snapshot.error === null;
  notice.textContent = snapshot.error ?? '';

  const projects = currentProjects();
  if (selectedProject !== null && !projects.some((project) => project.key === selectedProject)) {
    selectedProject = null;
  }
  renderProjects(projectList, projects, snapshot.agents.length, selectedProject, {
    onSelect: (key) => {
      selectedProject = key;
      render();
    },
    onRename: renameProject,
    onRemove: (project) => void removeProject(project),
    onTogglePin: (project) => void togglePin(project),
  });

  hidden.prune(new Set(snapshot.agents.map((agent) => agent.id)));
  detail.update(snapshot.agents);

  const showDocs = view === 'docs';
  board.hidden = showDocs;
  docs.hidden = !showDocs;
  search.hidden = showDocs;
  if (showDocs) {
    hiddenBar.hidden = true;
    const project = projects.find((candidate) => candidate.key === selectedProject);
    docsView.show(project ? { key: project.key, label: project.label } : null);
    return;
  }
  docsView.hide();

  const matching = filterAgents(snapshot.agents, { project: selectedProject, query });
  const visible = showHidden ? matching : matching.filter((agent) => !hidden.has(agent.id));
  const hiddenCount = matching.length - visible.length;
  // Only mention hidden agents that the current project and search would otherwise show.
  hiddenBar.hidden = showHidden ? hidden.size === 0 : hiddenCount === 0;
  hiddenLabel.textContent = showHidden
    ? `Showing ${hidden.size} hidden agent${hidden.size === 1 ? '' : 's'}`
    : `${hiddenCount} hidden agent${hiddenCount === 1 ? '' : 's'} not shown`;
  hiddenToggle.textContent = showHidden ? 'Hide them' : 'Show';

  const common = {
    now: Date.now(),
    emptyText: query ? 'No matches' : 'Nothing here',
    onOpen: (agent: Agent) => {
      detail.open(agent);
    },
  };
  if (view === 'list') {
    renderList(board, visible, common);
  } else {
    renderBoard(board, visible, {
      ...common,
      // Queue columns belong to one project, so they appear once a project is selected.
      extraColumns: selectedProject
        ? renderQueueColumns(selectedProject, queue, queueHandlers)
        : [],
      // Collapsing the status columns only makes room for the queue, so it needs a project.
      ...(selectedProject
        ? {
            status: {
              layout: statusLayout,
              onChange: (next: StatusLayout) => {
                statusLayout = next;
                saveStatusLayout(next);
                render();
              },
            },
          }
        : {}),
      columnOrder: columnOrder.get(),
      onReorderColumns: (keys) => {
        columnOrder.update(keys);
        render();
      },
      onClearCompleted: (agents) => {
        hidden.hide(agents.map((agent) => agent.id));
        showToast(`Hid ${agents.length} completed agent${agents.length === 1 ? '' : 's'}`);
        render();
      },
    });
  }
}

hiddenToggle.addEventListener('click', () => {
  showHidden = !showHidden;
  render();
});
hiddenReset.addEventListener('click', () => {
  hidden.showAll();
  showHidden = false;
  render();
});

const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('.view-button')];
function setView(next: View): void {
  view = next;
  for (const button of viewButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  saveView(view);
  render();
}
for (const button of viewButtons) {
  button.addEventListener('click', () => {
    setView(parseView(button.dataset.view));
  });
}
setView(view);

search.addEventListener('input', () => {
  query = search.value;
  render();
});

connectLiveAgents({
  onConnection: (state) => {
    connection.dataset.state = state;
    connection.textContent = CONNECTION_LABELS[state];
  },
  onSnapshot: (next) => {
    snapshot = next;
    render();
    notifier.handle(next.agents);
  },
});

void loadProjects();
void loadQueue();

// Keep "started 5m ago" labels current between snapshots.
window.setInterval(render, 30_000);
