import { byId, el } from './dom.ts';
import { connectLiveAgents, type ConnectionState } from './live.ts';
import { setUpThemeToggle } from './theme.ts';

const CONNECTION_LABELS: Readonly<Record<ConnectionState, string>> = {
  connecting: 'Connecting…',
  live: 'Live',
  offline: 'Offline',
};

const board = byId('board', 'div');
const notice = byId('notice', 'p');
const connection = byId('connection', 'span');

setUpThemeToggle(byId('theme-toggle', 'button'));

connectLiveAgents({
  onConnection: (state) => {
    connection.dataset.state = state;
    connection.textContent = CONNECTION_LABELS[state];
  },
  onSnapshot: (snapshot) => {
    notice.hidden = snapshot.error === null;
    notice.textContent = snapshot.error ?? '';
    board.replaceChildren(
      el('p', {
        className: 'empty',
        text: `${snapshot.agents.length} agents found. The board view is coming next.`,
      }),
    );
  },
});
