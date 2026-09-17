import type { AgentSnapshot, SavedProjectView } from '../shared/api.ts';
import { filterAgents, listProjects, type Project } from './agents.ts';
import { errorMessage, requestJson } from './api.ts';
import { renderBoard, renderProjects } from './board.ts';
import { createDetailPanel } from './detail.ts';
import { confirmDialog, formDialog } from './dialogs.ts';
import { byId } from './dom.ts';
import { connectLiveAgents, type ConnectionState } from './live.ts';
import { createNewTaskDialog } from './new-task.ts';
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

let snapshot: AgentSnapshot | undefined;
let savedProjects: SavedProjectView[] = [];
let selectedProject: string | null = null;
let query = '';

setUpThemeToggle(byId('theme-toggle', 'button'));

const currentProjects = (): Project[] => listProjects(snapshot?.agents ?? [], savedProjects);

const newTask = createNewTaskDialog({
  knownProjects: () => currentProjects().map((project) => project.key),
  onStarted: () => undefined,
});
byId('new-task', 'button').addEventListener('click', () => {
  newTask.open(selectedProject);
});

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

  renderBoard(board, filterAgents(snapshot.agents, { project: selectedProject, query }), {
    now: Date.now(),
    emptyText: query ? 'No matches' : 'Nothing here',
    onOpen: (agent) => {
      detail.open(agent);
    },
  });
  detail.update(snapshot.agents);
}

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

// Keep "started 5m ago" labels current between snapshots.
window.setInterval(render, 30_000);
