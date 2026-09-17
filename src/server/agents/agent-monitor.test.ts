import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { AgentMonitor, type AgentSnapshot } from './agent-monitor.ts';
import type { Agent, ParseResult } from './claude-agents.ts';

function agent(id: string, state: Agent['state'] = 'working'): Agent {
  return {
    id,
    provider: 'claude',
    sessionId: `${id}-session`,
    name: `Task ${id}`,
    cwd: '/work',
    startedAt: 1,
    state,
    pid: null,
  };
}

/** A fake agent source whose next result can be swapped between polls. */
function fakeSource(initial: ParseResult | Error) {
  let next = initial;
  return {
    list: () => (next instanceof Error ? Promise.reject(next) : Promise.resolve(next)),
    set(value: ParseResult | Error) {
      next = value;
    },
  };
}

function createMonitor(source: ReturnType<typeof fakeSource>, intervalMs = 5) {
  const logs: string[] = [];
  const monitor = new AgentMonitor({
    list: source.list,
    intervalMs,
    log: (message) => logs.push(message),
  });
  return { monitor, logs };
}

describe('AgentMonitor', () => {
  it('has no snapshot until the first poll, then resolves ready()', async () => {
    const { monitor } = createMonitor(fakeSource({ agents: [agent('a')], skipped: [] }));
    assert.equal(monitor.current(), undefined);

    await monitor.poll();
    const ready = await monitor.ready();
    assert.deepEqual(ready.agents, [agent('a')]);
    assert.equal(ready.error, null);
    assert.equal(monitor.current(), ready);
  });

  it('notifies subscribers only when the agents change', async () => {
    const source = fakeSource({ agents: [agent('a')], skipped: [] });
    const { monitor } = createMonitor(source);
    const seen: AgentSnapshot[] = [];
    const unsubscribe = monitor.subscribe((snapshot) => seen.push(snapshot));

    await monitor.poll();
    await monitor.poll();
    assert.equal(seen.length, 1);

    source.set({ agents: [agent('a', 'done')], skipped: [] });
    await monitor.poll();
    assert.equal(seen.length, 2);
    assert.equal(seen[1]?.agents[0]?.state, 'done');

    unsubscribe();
    source.set({ agents: [], skipped: [] });
    await monitor.poll();
    assert.equal(seen.length, 2);
  });

  it('keeps the last agents and reports the error when a poll fails, logging it once', async () => {
    const source = fakeSource({ agents: [agent('a')], skipped: [] });
    const { monitor, logs } = createMonitor(source);
    await monitor.poll();

    source.set(new Error('claude is not logged in'));
    await monitor.poll();
    await monitor.poll();
    assert.deepEqual(monitor.current()?.agents, [agent('a')]);
    assert.equal(monitor.current()?.error, 'claude is not logged in');
    assert.deepEqual(logs, ['claude is not logged in']);

    source.set({ agents: [agent('a')], skipped: [] });
    await monitor.poll();
    assert.equal(monitor.current()?.error, null);
    assert.deepEqual(logs, ['claude is not logged in', 'Claude agents are available again.']);
  });

  it('logs each kind of skipped entry once, even as positions shift', async () => {
    const source = fakeSource({ agents: [], skipped: ['entry 0 has unrecognized state "paused"'] });
    const { monitor, logs } = createMonitor(source);
    await monitor.poll();
    source.set({ agents: [], skipped: ['entry 3 has unrecognized state "paused"'] });
    await monitor.poll();
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? '', /unrecognized state "paused"/);
  });

  it('keeps polling after start() and stops after stop()', async () => {
    let polls = 0;
    const monitor = new AgentMonitor({
      list: () => {
        polls++;
        return Promise.resolve({ agents: [], skipped: [] });
      },
      intervalMs: 5,
      log: () => undefined,
    });

    monitor.start();
    await sleep(60);
    monitor.stop();
    const afterStop = polls;
    assert.ok(afterStop >= 3, `expected several polls, got ${afterStop}`);

    await sleep(40);
    assert.ok(polls <= afterStop + 1, 'polling continued after stop()');
  });

  it('never runs two polls at the same time', async () => {
    let active = 0;
    let maxActive = 0;
    const monitor = new AgentMonitor({
      list: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(15);
        active--;
        return { agents: [], skipped: [] };
      },
      intervalMs: 1,
      log: () => undefined,
    });

    monitor.start();
    for (let i = 0; i < 10; i++) {
      monitor.refresh();
      await sleep(8);
    }
    monitor.stop();
    assert.equal(maxActive, 1);
  });

  it('polls right away on refresh() instead of waiting for the interval', async () => {
    let polls = 0;
    const monitor = new AgentMonitor({
      list: () => {
        polls++;
        return Promise.resolve({ agents: [], skipped: [] });
      },
      intervalMs: 60_000,
      log: () => undefined,
    });

    monitor.refresh(); // Ignored until started.
    monitor.start();
    await sleep(20);
    assert.equal(polls, 1);

    monitor.refresh();
    await sleep(20);
    monitor.stop();
    assert.equal(polls, 2);
  });
});
