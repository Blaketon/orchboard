import path from 'node:path';
import type { Agent } from '../shared/api.ts';
import { projectKey } from '../shared/projects.ts';
import { createAgentActions } from './agents/agent-actions.ts';
import { AgentMonitor, type AgentListResult } from './agents/agent-monitor.ts';
import { createClaudeActions } from './agents/claude-actions.ts';
import { listClaudeAgents } from './agents/claude-agents.ts';
import { openAgentTerminal } from './agents/terminal.ts';
import { AttachmentStore } from './attachments/attachment-store.ts';
import { CodexRunner } from './codex/codex-runner.ts';
import { loadConfig, type Config } from './config.ts';
import { ProjectDocs } from './projects/project-docs.ts';
import { ProjectsStore } from './projects/projects-store.ts';
import { QueueStore } from './queue/queue-store.ts';
import { isLoopbackHost } from './security.ts';
import { createServer } from './server.ts';
import { listSkills, skillRoots } from './skills/skills.ts';
import { TranscriptReader } from './transcripts/transcript-reader.ts';
import { UsageService } from './usage/usage-service.ts';

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const attachments = new AttachmentStore(config.dataDir);
const codex = new CodexRunner({
  dataDir: config.dataDir,
  codexDir: config.codexDir,
  attachments,
  onChange: () => {
    monitor.refresh();
  },
});
await codex.load();

// Codex tasks stay visible even when Claude Code can't be listed.
let claudeAgents: readonly Agent[] = [];
async function listAgents(): Promise<AgentListResult> {
  try {
    const claude = await listClaudeAgents();
    claudeAgents = claude.agents;
    return { agents: [...claude.agents, ...codex.agents()], skipped: claude.skipped };
  } catch (error) {
    return {
      agents: [...claudeAgents, ...codex.agents()],
      skipped: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const monitor = new AgentMonitor({ list: listAgents });
const actions = createAgentActions({
  claude: createClaudeActions(undefined, attachments),
  codex,
});
const claudeTranscripts = new TranscriptReader(config.claudeDir);
const projects = new ProjectsStore(config.dataDir);
const queue = new QueueStore(config.dataDir, actions);
const server = createServer({
  host: config.host,
  agents: monitor,
  transcripts: {
    read: (agent) =>
      agent.provider === 'codex' ? codex.transcript(agent) : claudeTranscripts.read(agent),
  },
  actions,
  projects,
  projectDocs: new ProjectDocs({
    isKnownProject: async (key) =>
      (await projects.list()).some((project) => project.path === key) ||
      (await monitor.ready()).agents.some((agent) => projectKey(agent.cwd) === key),
  }),
  skills: () => listSkills(skillRoots(config.claudeDir, config.codexDir)),
  queue,
  attachments,
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
  void pruneAttachments();
});

/** Agents look at pasted images early in their task, so month-old ones go unless still queued. */
async function pruneAttachments(): Promise<void> {
  try {
    const { tasks } = await queue.read();
    await attachments.prune({
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      keep: new Set(tasks.flatMap((task) => task.images ?? [])),
    });
  } catch (error) {
    console.warn('Could not clean up old attachments:', error);
  }
}

function shutdown(): void {
  monitor.stop();
  const closed = new Promise((resolve) => server.close(resolve));
  // Open event streams would otherwise keep the server from closing.
  server.closeAllConnections();
  // Running Codex turns end with Orchboard; wait until their state is saved.
  void Promise.all([closed, codex.close()]).finally(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
