#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Agent } from '../shared/api.ts';
import { projectKey } from '../shared/projects.ts';
import { createAgentActions } from './agents/agent-actions.ts';
import { AgentMonitor, type AgentListResult } from './agents/agent-monitor.ts';
import { createClaudeActions } from './agents/claude-actions.ts';
import { listClaudeAgents } from './agents/claude-agents.ts';
import { openAgentTerminal } from './agents/terminal.ts';
import { AttachmentStore } from './attachments/attachment-store.ts';
import { parseCliArgs, USAGE, type CliOptions } from './cli-args.ts';
import { CodexRunner } from './codex/codex-runner.ts';
import { loadConfig, type Config } from './config.ts';
import { createDemo } from './demo/demo-mode.ts';
import { ProjectDocs } from './projects/project-docs.ts';
import { ProjectsStore } from './projects/projects-store.ts';
import { QueueStore } from './queue/queue-store.ts';
import { isLoopbackHost } from './security.ts';
import { createServer } from './server.ts';
import { listSkills, skillRoots } from './skills/skills.ts';
import { TranscriptReader } from './transcripts/transcript-reader.ts';
import { UsageService } from './usage/usage-service.ts';

// Two levels up from both src/server (development) and dist/server (built).
const packageRoot = path.resolve(import.meta.dirname, '..', '..');

let cli: CliOptions;
let config: Config;
try {
  cli = parseCliArgs(process.argv.slice(2));
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (cli.help) {
  console.log(USAGE);
  process.exit(0);
}
if (cli.version) {
  console.log(readVersion());
  process.exit(0);
}

const port = cli.port ?? config.port;
const host = cli.host ?? config.host;
const demo = cli.demo ? await createDemo() : undefined;
const dataDir = demo?.dataDir ?? config.dataDir;

const attachments = new AttachmentStore(dataDir);
const codex = new CodexRunner({
  dataDir,
  codexDir: config.codexDir,
  attachments,
  onChange: () => {
    monitor.refresh();
  },
});
if (!demo) await codex.load();

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
const projects = new ProjectsStore(dataDir);
const queue = new QueueStore(dataDir, demo?.actions ?? actions);
const server = createServer({
  host,
  agents: demo?.agents ?? monitor,
  transcripts: demo?.transcripts ?? {
    read: (agent) =>
      agent.provider === 'codex' ? codex.transcript(agent) : claudeTranscripts.read(agent),
  },
  actions: demo?.actions ?? actions,
  projects,
  projectDocs: new ProjectDocs({
    isKnownProject: async (key) =>
      (await projects.list()).some((project) => project.path === key) ||
      (await (demo?.agents ?? monitor).ready()).agents.some(
        (agent) => projectKey(agent.cwd) === key,
      ),
  }),
  skills: demo?.skills ?? (() => listSkills(skillRoots(config.claudeDir, config.codexDir))),
  queue,
  attachments,
  usage:
    demo?.usage ?? new UsageService({ claudeDir: config.claudeDir, codexDir: config.codexDir }),
  openTerminal: demo?.openTerminal ?? ((agent) => openAgentTerminal(agent)),
  staticRoots: {
    publicDir: path.join(packageRoot, 'public'),
    buildDir: path.join(packageRoot, 'dist'),
  },
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${port} is already in use. Is Orchboard already running? ` +
        'Use --port to pick another one.',
    );
    process.exit(1);
  }
  throw error;
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const loopback = isLoopbackHost(host);
  const url = `http://${loopback ? 'localhost' : host}:${actualPort}`;

  console.log(`Orchboard running at ${url}`);
  if (demo) {
    console.log(
      'Demo mode: sample data only. No agents are started and no real files are touched.',
    );
  }
  if (!loopback) {
    console.warn(
      `Warning: listening on ${host}. Anyone who can reach this address can use Orchboard.`,
    );
  }
  if (cli.open) openBrowser(url);
  if (!demo) {
    monitor.start();
    void pruneAttachments();
  }
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

function readVersion(): string {
  try {
    const text = fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8');
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Opens the dashboard in the default browser, ignoring desktops without one. */
function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? { file: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '""', url] }
      : process.platform === 'darwin'
        ? { file: 'open', args: [url] }
        : { file: 'xdg-open', args: [url] };
  const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore' });
  child.once('error', () => {
    console.warn(`Could not open a browser. Open ${url} yourself.`);
  });
  child.unref();
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
