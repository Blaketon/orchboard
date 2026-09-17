import type { AgentSnapshot, ClaudeAgent, QueueState, SavedProjectView } from '../shared/api.ts';
import { filterAgents, listProjects, type Project } from './agents.ts';
import { errorMessage, requestJson } from './api.ts';
import { renderBoard, renderProjects } from './board.ts';
import { createDetailPanel } from './detail.ts';
import { confirmDialog, formDialog } from './dialogs.ts';
import { byId } from './dom.ts';
import { renderList } from './list.ts';
import { connectLiveAgents, type ConnectionState } from './live.ts';
import { createTaskDialog } from './task-dialog.ts';
import { renderQueueColumns, type QueueHandlers } from './queue.ts';
import { setUpThemeToggle } from './theme.ts';
import { showToast } from './toast.ts';

const CONNECTION_LABELS: Readonly<Record<ConnectionState, string>> = {
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Offline',
};

const board = byId('board', 'div');
const notice = byId('notice', 'p');
const connection = byId('connection', 'span');
const projectList = byId('project-list', 'ul');
const search = byId('search', 'input');
const detail = createDetailPanel();

type View = 'board' | 'list';
const VIEW_KEY = 'orchboard-view';

function storedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
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

setUpThemeToggle(byId('theme-toggle', 'button'));

const currentProjects = (): Project[] => listProjects(snapshot?.agents ?? [], savedProjects);

function setQueue(next: QueueState): void {
  queue = next;
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
  });

  const visible = filterAgents(snapshot.agents, { project: selectedProject, query });
  const common = {
    now: Date.now(),
    emptyText: query ? 'No matches' : 'Nothing here',
    onOpen: (agent: ClaudeAgent) => {
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
    });
  }
  detail.update(snapshot.agents);
}

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
    setView(button.dataset.view === 'list' ? 'list' : 'board');
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
  },
});

void loadProjects();
void loadQueue();

// Keep "started 5m ago" labels current between snapshots.
window.setInterval(render, 30_000);
