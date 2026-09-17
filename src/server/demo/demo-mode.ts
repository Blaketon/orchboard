import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  Agent,
  AgentSnapshot,
  Skill,
  Transcript,
  TranscriptPart,
  UsageReport,
} from '../../shared/api.ts';
import type { AgentActions } from '../agents/agent-actions.ts';
import type { AgentFeed } from '../agents/agent-monitor.ts';
import { HttpError } from '../http-error.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Everything the server needs, filled with sample data instead of real agents. */
export interface Demo {
  readonly dataDir: string;
  readonly agents: AgentFeed;
  readonly transcripts: { read(agent: Agent): Promise<Transcript> };
  readonly actions: AgentActions;
  readonly skills: () => Promise<Skill[]>;
  readonly usage: { report(): Promise<UsageReport> };
  readonly openTerminal: (agent: Agent) => Promise<void>;
}

const DEMO_MESSAGE = 'This is the Orchboard demo. Run it without --demo to work with real agents.';

const refuse = (): Promise<never> => Promise.reject(new HttpError(400, DEMO_MESSAGE));

/**
 * Sets up demo mode: sample projects in a temporary folder, a fixed set of agents, and actions
 * that politely refuse. Nothing here touches a real project, agent, or `~/.orchboard`.
 */
export async function createDemo(now: number = Date.now()): Promise<Demo> {
  const dataDir = path.join(os.tmpdir(), 'orchboard-demo');
  // Start from scratch so a demo always looks the same, whatever a previous run left behind.
  await fs.rm(dataDir, { recursive: true, force: true });
  const projects = await createProjects(dataDir);
  const agents = demoAgents(now, projects);
  await seedStore(
    dataDir,
    'projects.json',
    projects.map((project) => ({ path: project, label: null })),
  );
  await seedStore(dataDir, 'queue.json', demoQueue(projects, now));

  const snapshot: AgentSnapshot = { agents, error: null, updatedAt: now };
  const transcripts = demoTranscripts(agents);

  return {
    dataDir,
    agents: {
      ready: () => Promise.resolve(snapshot),
      current: () => snapshot,
      subscribe: () => () => undefined,
      refresh: () => undefined,
    },
    transcripts: {
      read: (agent) => Promise.resolve(transcripts.get(agent.id) ?? { entries: [], usage: null }),
    },
    actions: {
      start: refuse,
      reply: refuse,
      stop: refuse,
      remove: refuse,
      decide: refuse,
    },
    skills: () => Promise.resolve(demoSkills()),
    usage: { report: () => Promise.resolve(demoUsage(now)) },
    openTerminal: refuse,
  };
}

async function createProjects(dataDir: string): Promise<string[]> {
  const root = path.join(dataDir, 'projects');
  const docs: Readonly<Record<string, string>> = {
    storefront: '# Storefront\n\n- Run `npm test` before every commit.\n- Keep components small.\n',
    'api-gateway': '# API gateway\n\n- Every route needs an integration test.\n',
    'mobile-app': '# Mobile app\n\n- Keep the bundle under 2 MB.\n',
  };
  const created: string[] = [];
  for (const [name, text] of Object.entries(docs)) {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), text);
    created.push(dir.replace(/\\/g, '/'));
  }
  return created;
}

async function seedStore(dataDir: string, file: string, value: unknown): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, file), `${JSON.stringify(value, null, 2)}\n`);
}

function demoAgents(now: number, projects: readonly string[]): Agent[] {
  const [storefront = '', gateway = '', mobile = ''] = projects;
  const agent = (
    id: string,
    name: string,
    cwd: string,
    state: Agent['state'],
    startedAt: number,
    extra: Partial<Agent> = {},
  ): Agent => ({
    id,
    provider: 'claude',
    sessionId: `0f8e2c4a-1b3d-4e5f-8a9b-${id}00000000`,
    name,
    cwd,
    startedAt,
    state,
    pid: null,
    ...extra,
  });

  return [
    agent(
      '1a2b3c4d',
      'Checkout keeps the old total after a coupon',
      storefront,
      'blocked',
      now - 18 * MINUTE,
    ),
    agent(
      '2b3c4d5e',
      'Split the product page into components',
      storefront,
      'working',
      now - 6 * MINUTE,
      {
        pid: 4812,
      },
    ),
    agent(
      '3c4d5e6f',
      'Rate limit the public search endpoint',
      gateway,
      'working',
      now - 24 * MINUTE,
      {
        pid: 5104,
      },
    ),
    agent('4d5e6f7a', 'Add contract tests for the orders API', gateway, 'done', now - 3 * HOUR),
    agent('5e6f7a8b', 'Dark mode for the settings screen', mobile, 'done', now - 5 * HOUR),
    agent('6f7a8b9c', 'Cut the startup time on Android', mobile, 'done', now - 2 * DAY),
    {
      id: 'codex-9f8e7d6c',
      provider: 'codex',
      sessionId: '019a0b1c-2d3e-7f40-8152-637485960a1b',
      name: 'Move the image pipeline to WebP',
      cwd: storefront,
      startedAt: now - 3 * MINUTE,
      state: 'blocked',
      pid: 6620,
      error: null,
      approvals: [
        {
          id: '1',
          kind: 'command',
          title: 'Run a command',
          detail: 'npm install --save-dev sharp',
          reason: 'Installing packages needs network access.',
          canAllowForSession: true,
          declineOnly: false,
        },
      ],
    },
    {
      id: 'codex-8e7d6c5b',
      provider: 'codex',
      sessionId: '019a0b1c-2d3e-7f40-8152-637485960a2c',
      name: 'Document the deploy steps',
      cwd: gateway,
      startedAt: now - 40 * MINUTE,
      state: 'done',
      pid: null,
      error: null,
      approvals: [],
    },
  ];
}

function demoQueue(projects: readonly string[], now: number): unknown {
  const [storefront = '', gateway = ''] = projects;
  return {
    columns: [
      { id: 'col-next', project: storefront, name: 'Next up' },
      { id: 'col-later', project: storefront, name: 'Later' },
      { id: 'col-gateway', project: gateway, name: 'Next up' },
    ],
    tasks: [
      {
        id: 'task-1',
        columnId: 'col-next',
        name: 'Empty cart page looks broken on mobile',
        provider: 'claude',
        cwd: storefront,
        prompt:
          'The empty cart page overflows on a 375px wide screen. Find the cause and fix it, then add a regression test.',
        permissionMode: 'acceptEdits',
        images: [],
        createdAt: now - 2 * HOUR,
      },
      {
        id: 'task-2',
        columnId: 'col-next',
        name: 'Upgrade to the new payments SDK',
        provider: 'codex',
        cwd: storefront,
        prompt: 'Upgrade the payments SDK to v5 and update the checkout flow to match its new API.',
        permissionMode: 'auto',
        images: [],
        createdAt: now - 90 * MINUTE,
      },
      {
        id: 'task-3',
        columnId: 'col-later',
        name: 'Replace the homepage carousel',
        provider: 'claude',
        cwd: storefront,
        prompt: 'Replace the homepage carousel with a static hero section and delete the old code.',
        permissionMode: 'plan',
        images: [],
        createdAt: now - DAY,
      },
    ],
  };
}

function demoTranscripts(agents: readonly Agent[]): Map<string, Transcript> {
  const at = (agent: Agent, offset: number) => new Date(agent.startedAt + offset).toISOString();
  const transcripts = new Map<string, Transcript>();

  const [blocked, working] = agents;
  const codex = agents.find((agent) => agent.provider === 'codex' && agent.state === 'blocked');

  if (blocked) {
    transcripts.set(blocked.id, {
      entries: [
        {
          role: 'user',
          timestamp: at(blocked, 0),
          parts: [
            {
              type: 'text',
              text: 'Applying a coupon updates the line items but the order total stays the same until you reload. Find out why.',
            },
          ],
        },
        {
          role: 'assistant',
          timestamp: at(blocked, 40_000),
          parts: [
            tool('Grep', 'pattern: applyCoupon'),
            result('src/cart/totals.ts:42: export function applyCoupon(cart, coupon) {'),
            {
              type: 'text',
              text: [
                '`applyCoupon` returns a **new** cart object, but `useCart` mutates the old one:',
                '',
                '```ts',
                'cart.items = next.items; // total is never recomputed',
                '```',
                '',
                'Two ways to fix it:',
                '',
                '1. Replace the cart in state with the returned object.',
                '2. Recompute `total` inside `applyCoupon` and return it.',
                '',
                'Which do you prefer?',
              ].join('\n'),
            },
          ],
        },
      ],
      usage: {
        tokens: { input: 18_400, output: 2_100, cacheCreation: 12_000, cacheRead: 96_000 },
        contextTokens: 42_000,
        contextWindow: 200_000,
        model: 'claude-opus-5',
        costUsd: 0.42,
        costIsPartial: false,
      },
    });
  }

  if (working) {
    transcripts.set(working.id, {
      entries: [
        {
          role: 'user',
          timestamp: at(working, 0),
          parts: [
            {
              type: 'text',
              text: 'Split ProductPage.tsx into smaller components. Keep the props stable.',
            },
          ],
        },
        {
          role: 'assistant',
          timestamp: at(working, 25_000),
          parts: [
            { type: 'text', text: 'Starting with the gallery and the buy box.' },
            tool('Write', 'src/product/Gallery.tsx'),
            result('Created src/product/Gallery.tsx'),
            tool('Bash', 'npm test -- product'),
          ],
        },
      ],
      usage: {
        tokens: { input: 9_100, output: 1_400, cacheCreation: 8_000, cacheRead: 41_000 },
        contextTokens: 21_500,
        contextWindow: 200_000,
        model: 'claude-sonnet-5',
        costUsd: 0.11,
        costIsPartial: true,
      },
    });
  }

  if (codex) {
    transcripts.set(codex.id, {
      entries: [
        {
          role: 'user',
          timestamp: at(codex, 0),
          parts: [
            {
              type: 'text',
              text: 'Convert uploaded images to WebP and keep a JPEG fallback for old browsers.',
            },
          ],
        },
        {
          role: 'assistant',
          timestamp: at(codex, 20_000),
          parts: [
            {
              type: 'text',
              text: 'I will use `sharp` for the conversion. Installing it needs network access, so I am asking first.',
            },
          ],
        },
      ],
      usage: {
        tokens: { input: 6_200, output: 800, cacheCreation: 0, cacheRead: 14_000 },
        contextTokens: 19_800,
        contextWindow: 272_000,
        model: 'gpt-5.5-codex',
        costUsd: null,
        costIsPartial: false,
      },
    });
  }

  return transcripts;
}

function tool(name: string, summary: string): TranscriptPart {
  return { type: 'tool_call', id: `call-${name}-${summary.length}`, name, summary };
}

function result(text: string): TranscriptPart {
  return { type: 'tool_result', toolUseId: 'call', text, isError: false };
}

export function demoUsage(now: number = Date.now()): UsageReport {
  return {
    claude: {
      windows: [
        { id: 'five_hour', label: 'Session (5h)', utilization: 46, resetsAt: iso(now + 2 * HOUR) },
        { id: 'seven_day', label: 'Week', utilization: 63, resetsAt: iso(now + 3 * DAY) },
      ],
      error: null,
    },
    codex: {
      windows: [
        { id: 'primary', label: 'Session (5h)', utilization: 31, resetsAt: iso(now + HOUR) },
        { id: 'secondary', label: 'Week', utilization: 78, resetsAt: iso(now + 4 * DAY) },
      ],
      error: null,
    },
  };
}

const iso = (time: number) => new Date(time).toISOString();

function demoSkills(): Skill[] {
  return [
    {
      name: 'code-review',
      description: 'Reviews a diff for correctness, missing tests, and risky changes.',
      source: 'Claude',
      path: '~/.claude/skills/code-review',
      system: false,
    },
    {
      name: 'release-notes',
      description: 'Turns merged pull requests into release notes grouped by area.',
      source: 'Claude',
      path: '~/.claude/skills/release-notes',
      system: false,
    },
    {
      name: 'plan',
      description: 'Writes an implementation plan before changing code.',
      source: 'Codex',
      path: '~/.codex/skills/.system/plan',
      system: true,
    },
  ];
}
