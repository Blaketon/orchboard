import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import {
  CLAUDE_MODELS,
  CODEX_MODELS_CACHE_MS,
  claudeDefaultModel,
  ModelService,
  parseCodexModels,
  readCodexModels,
} from './model-service.ts';

type Message = Record<string, unknown>;

/** A fake `codex app-server` that answers requests from a script; a throwing answer is an error. */
class FakeAppServer extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4321;
  readonly received: Message[] = [];
  exited = false;

  constructor(answers: Readonly<Record<string, (params: unknown) => unknown>>) {
    super();
    this.stdin.setEncoding('utf8');
    let buffer = '';
    this.stdin.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const message = JSON.parse(line) as Message;
        this.received.push(message);
        const answer = typeof message.method === 'string' ? answers[message.method] : undefined;
        if (message.id === undefined || !answer) continue;
        let reply: Message;
        try {
          reply = { result: answer(message.params) };
        } catch (error) {
          reply = { error: { code: -32601, message: String(error) } };
        }
        this.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, ...reply })}\n`);
      }
    });
    this.stdin.on('finish', () => {
      setImmediate(() => this.kill());
    });
  }

  kill(): boolean {
    if (!this.exited) {
      this.exited = true;
      this.emit('exit', 0);
    }
    return true;
  }
}

const listed = (model: string, extra: Message = {}): Message => ({
  id: model,
  model,
  displayName: model.toUpperCase(),
  hidden: false,
  isDefault: false,
  ...extra,
});

const codexAnswers = {
  initialize: () => ({}),
  'model/list': (params: unknown) =>
    (params as { cursor?: string }).cursor === 'page-2'
      ? { data: [listed('gpt-mini')], nextCursor: null }
      : {
          data: [listed('gpt-big', { isDefault: true }), listed('gpt-hidden', { hidden: true })],
          nextCursor: 'page-2',
        },
  'config/read': () => ({ config: { model: 'gpt-mini' } }),
};

describe('claudeDefaultModel', () => {
  let dir: string;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-models-'));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reads the model from the user settings', async () => {
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ model: ' opus ' }));
    assert.equal(await claudeDefaultModel(dir, {}), 'opus');
  });

  it('prefers ANTHROPIC_MODEL, as Claude Code does', async () => {
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ model: 'opus' }));
    assert.equal(await claudeDefaultModel(dir, { ANTHROPIC_MODEL: 'sonnet' }), 'sonnet');
    assert.equal(await claudeDefaultModel(dir, { ANTHROPIC_MODEL: ' ' }), 'opus');
  });

  it('is null without a setting or a readable settings file', async () => {
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
    assert.equal(await claudeDefaultModel(dir, {}), null);
    await fs.writeFile(path.join(dir, 'settings.json'), '{ not json');
    assert.equal(await claudeDefaultModel(dir, {}), null);
    assert.equal(await claudeDefaultModel(path.join(dir, 'missing'), {}), null);
  });
});

describe('parseCodexModels', () => {
  it('lists visible models and prefers the configured model as the default', () => {
    const page = {
      data: [
        listed('gpt-big', { isDefault: true, displayName: 'GPT Big' }),
        listed('gpt-small', { displayName: '' }),
        listed('gpt-hidden', { hidden: true }),
        listed('bad name; rm -rf'),
        'junk',
      ],
    };
    assert.deepEqual(parseCodexModels([page], { config: { model: 'gpt-small' } }), {
      default: 'gpt-small',
      options: [
        { value: 'gpt-big', label: 'GPT Big' },
        { value: 'gpt-small', label: 'gpt-small' },
      ],
    });
  });

  it("falls back to the model Codex marks as default, even when it's hidden", () => {
    const page = { data: [listed('gpt-hidden', { hidden: true, isDefault: true })] };
    assert.deepEqual(parseCodexModels([page], null), { default: 'gpt-hidden', options: [] });
    assert.deepEqual(parseCodexModels([], { config: { model: null } }), {
      default: null,
      options: [],
    });
  });
});

describe('readCodexModels', () => {
  it('reads every page and the config, then ends the app server', async () => {
    const fake = new FakeAppServer(codexAnswers);
    const models = await readCodexModels(() => fake, '/home');
    assert.deepEqual(models, {
      default: 'gpt-mini',
      options: [
        { value: 'gpt-big', label: 'GPT-BIG' },
        { value: 'gpt-mini', label: 'GPT-MINI' },
      ],
    });
    assert.deepEqual(
      fake.received.map((message) => message.method),
      ['initialize', 'initialized', 'model/list', 'model/list', 'config/read'],
    );
    assert.equal(fake.stdin.writableEnded, true);
  });

  it('uses the listed default when Codex cannot read its config', async () => {
    const fake = new FakeAppServer({
      ...codexAnswers,
      'config/read': () => {
        throw new Error('Method not found');
      },
    });
    const models = await readCodexModels(() => fake, '/home');
    assert.equal(models.default, 'gpt-big');
  });
});

describe('ModelService', () => {
  it('offers the Claude aliases with the default from the settings', async () => {
    const claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-models-'));
    try {
      await fs.writeFile(path.join(claudeDir, 'settings.json'), JSON.stringify({ model: 'haiku' }));
      const service = new ModelService({ claudeDir, env: {} });
      assert.deepEqual(await service.models('claude'), {
        default: 'haiku',
        options: CLAUDE_MODELS,
      });
    } finally {
      await fs.rm(claudeDir, { recursive: true, force: true });
    }
  });

  it('asks Codex once per cache period and keeps the last answer when Codex fails', async () => {
    let now = 0;
    let spawned = 0;
    let fail = false;
    const service = new ModelService({
      claudeDir: '/nowhere',
      now: () => now,
      spawn: () => {
        spawned++;
        // A failing Codex never answers and exits.
        const fake = new FakeAppServer(fail ? {} : codexAnswers);
        if (fail) setImmediate(() => fake.kill());
        return fake;
      },
    });

    const [first, second] = await Promise.all([service.models('codex'), service.models('codex')]);
    assert.equal(first.default, 'gpt-mini');
    assert.deepEqual(second, first);
    assert.equal(spawned, 1);

    now += CODEX_MODELS_CACHE_MS - 1;
    await service.models('codex');
    assert.equal(spawned, 1);

    now += 1;
    fail = true;
    assert.deepEqual(await service.models('codex'), first);
    assert.equal(spawned, 2);
  });

  it('offers only the default when Codex is not installed', async () => {
    const service = new ModelService({
      claudeDir: '/nowhere',
      spawn: () => {
        const fake = new FakeAppServer({});
        setImmediate(() => fake.kill());
        return fake;
      },
    });
    assert.deepEqual(await service.models('codex'), { default: null, options: [] });
  });
});
