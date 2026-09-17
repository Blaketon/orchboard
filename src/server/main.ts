import path from 'node:path';
import { AgentMonitor } from './agents/agent-monitor.ts';
import { createClaudeActions } from './agents/claude-actions.ts';
import { listClaudeAgents } from './agents/claude-agents.ts';
import { openAgentTerminal } from './agents/terminal.ts';
import { loadConfig, type Config } from './config.ts';
import { ProjectsStore } from './projects/projects-store.ts';
import { QueueStore } from './queue/queue-store.ts';
import { isLoopbackHost } from './security.ts';
import { createServer } from './server.ts';
import { TranscriptReader } from './transcripts/transcript-reader.ts';
import { UsageService } from './usage/usage-service.ts';

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const monitor = new AgentMonitor({ list: () => listClaudeAgents() });
const actions = createClaudeActions();
const server = createServer({
  host: config.host,
  agents: monitor,
  transcripts: new TranscriptReader(config.claudeDir),
  actions,
  projects: new ProjectsStore(config.dataDir),
  queue: new QueueStore(config.dataDir, actions),
  usage: new UsageService({ claudeDir: config.claudeDir, codexDir: config.codexDir }),
  openTerminal: (agent) => openAgentTerminal(agent),
  // Two levels up from both src/server (development) and dist/server (built).
  staticRoots: {
    publicDir: path.resolve(import.meta.dirname, '..', '..', 'public'),
    buildDir: path.resolve(import.meta.dirname, '..', '..', 'dist'),
  },
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} is already in use. Is Orchboard already running? ` +
        'Set ORCHBOARD_PORT to use another port.',
    );
    process.exit(1);
  }
  throw error;
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const loopback = isLoopbackHost(config.host);

  console.log(`Orchboard running at http://${loopback ? 'localhost' : config.host}:${port}`);
  if (!loopback) {
    console.warn(
      `Warning: listening on ${config.host}. Anyone who can reach this address can use Orchboard.`,
    );
  }
  monitor.start();
});

function shutdown(): void {
  monitor.stop();
  server.close(() => process.exit(0));
  // Open event streams would otherwise keep the server from closing.
  server.closeAllConnections();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
