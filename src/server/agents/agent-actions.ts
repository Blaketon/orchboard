import type { Agent, StartTaskResponse } from '../../shared/api.ts';
import { HttpError } from '../http-error.ts';
import type { ClaudeActions } from './claude-actions.ts';
import { parseTaskRequest } from './task-request.ts';
import type { CodexRunner } from '../codex/codex-runner.ts';

/** What the HTTP layer can do with agents, whichever agent runs them. */
export interface AgentActions {
  start(request: unknown): Promise<StartTaskResponse>;
  reply(agent: Agent, request: unknown): Promise<void>;
  stop(agent: Agent): Promise<void>;
  remove(agent: Agent): Promise<void>;
  /** Answers a Codex approval request. */
  decide(agent: Agent, approvalId: string, request: unknown): Promise<void>;
}

/** Sends each action to the agent that runs the task. */
export function createAgentActions(providers: {
  readonly claude: ClaudeActions;
  readonly codex: Pick<CodexRunner, 'start' | 'reply' | 'stop' | 'remove' | 'decide'>;
}): AgentActions {
  const { claude, codex } = providers;
  return {
    start(request) {
      const task = parseTaskRequest(request);
      return task.provider === 'codex' ? codex.start(task) : claude.start(task);
    },
    reply: (agent, request) =>
      agent.provider === 'codex' ? codex.reply(agent, request) : claude.reply(agent, request),
    stop: (agent) => (agent.provider === 'codex' ? codex.stop(agent) : claude.stop(agent)),
    remove: (agent) => (agent.provider === 'codex' ? codex.remove(agent) : claude.remove(agent)),
    decide(agent, approvalId, request) {
      if (agent.provider !== 'codex') {
        return Promise.reject(
          new HttpError(400, 'Claude Code agents ask for approval in their own session.'),
        );
      }
      return codex.decide(agent, approvalId, request);
    },
  };
}
