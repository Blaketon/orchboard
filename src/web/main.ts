import type { AgentSnapshot } from '../shared/api.ts';
import { filterAgents, listProjects } from './agents.ts';
import { renderBoard, renderProjects } from './board.ts';
import { createDetailPanel } from './detail.ts';
import { byId } from './dom.ts';
import { connectLiveAgents, type ConnectionState } from './live.ts';
import { createNewTaskDialog } from './new-task.ts';
import { setUpThemeToggle } from './theme.ts';

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
let selectedProject: string | null = null;
let query = '';

setUpThemeToggle(byId('theme-toggle', 'button'));

const newTask = createNewTaskDialog({
  knownProjects: () => listProjects(snapshot?.agents ?? []).map((project) => project.key),
  onStarted: () => undefined,
});
byId('new-task', 'button').addEventListener('click', () => {
  newTask.open(selectedProject);
});

function render(): void {
  if (!snapshot) return;
  notice.hidden = snapshot.error === null;
  notice.textContent = snapshot.error ?? '';

  const projects = listProjects(snapshot.agents);
  if (selectedProject !== null && !projects.some((project) => project.key === selectedProject)) {
    selectedProject = null;
  }
  renderProjects(projectList, projects, snapshot.agents.length, selectedProject, (key) => {
    selectedProject = key;
    render();
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

// Keep "started 5m ago" labels current between snapshots.
window.setInterval(render, 30_000);
