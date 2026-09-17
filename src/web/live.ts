import type { AgentSnapshot } from '../shared/api.ts';

export type ConnectionState = 'connecting' | 'live' | 'offline';

export interface LiveAgentsHandlers {
  readonly onSnapshot: (snapshot: AgentSnapshot) => void;
  readonly onConnection: (state: ConnectionState) => void;
}

/**
 * Subscribes to `/api/events`. EventSource reconnects on its own after drops; this only reports
 * the connection state and hands over each snapshot.
 */
export function connectLiveAgents(handlers: LiveAgentsHandlers): () => void {
  const source = new EventSource('/api/events');
  handlers.onConnection('connecting');

  source.addEventListener('open', () => {
    handlers.onConnection('live');
  });
  source.addEventListener('error', () => {
    handlers.onConnection(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
  });
  source.addEventListener('agents', (event) => {
    handlers.onSnapshot(JSON.parse((event as MessageEvent<string>).data) as AgentSnapshot);
  });

  return () => {
    source.close();
  };
}
