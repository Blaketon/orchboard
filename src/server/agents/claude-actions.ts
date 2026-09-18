import type { Agent, StartTaskResponse } from '../../shared/api.ts';
import { describeAttachments, type AttachmentStore } from '../attachments/attachment-store.ts';
import { HttpError, isRecord } from '../http-error.ts';
import { isPidAlive } from './claude-agents.ts';
import { cliErrorMessage, ClaudeCliMissingError, runClaude, type RunClaude } from './claude-cli.ts';
import { assertDirectory, parsePrompt, type TaskRequest } from './task-request.ts';

const AGENT_ID = /^[A-Za-z0-9_-]+$/;
/** How long to wait for a stopped session's process to go away before giving up. */
const STOP_TIMEOUT_MS = 8000;

export interface ClaudeActions {
  start(task: TaskRequest): Promise<StartTaskResponse>;
  reply(agent: Agent, request: unknown): Promise<void>;
  stop(agent: Agent): Promise<void>;
  remove(agent: Agent): Promise<void>;
}

export interface ClaudeActionsOptions {
  readonly run?: RunClaude;
  readonly attachments?: Pick<AttachmentStore, 'dir' | 'paths'>;
  readonly isPidAlive?: (pid: number) => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Starts, continues, and stops Claude Code background agents through the `claude` CLI. */
export function createClaudeActions(options: ClaudeActionsOptions = {}): ClaudeActions {
  const run = options.run ?? runClaude;
  const { attachments } = options;
  const alive = options.isPidAlive ?? isPidAlive;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function runOrFail(
    args: readonly string[],
    runOptions: Parameters<RunClaude>[1],
  ): Promise<string> {
    try {
      return await run(args, runOptions);
    } catch (error) {
      if (error instanceof ClaudeCliMissingError) throw new HttpError(503, error.message);
      throw new HttpError(502, `Claude Code reported an error: ${cliErrorMessage(error)}`);
    }
  }

  function checkId(agent: Agent): void {
    if (!AGENT_ID.test(agent.id)) throw new HttpError(400, 'Invalid agent id.');
  }

  /**
   * Stops a session and waits for its process to exit. Claude Code can't resume a session that
   * still holds its transcript, so an agent waiting for input has to be stopped before it can
   * be continued. The conversation itself is kept.
   */
  async function stopAndWait(agent: Agent, pid: number, failure: string): Promise<void> {
    checkId(agent);
    await runOrFail(['stop', agent.id], { fixedArgs: true });
    for (let waited = 0; waited < STOP_TIMEOUT_MS; waited += 200) {
      if (!alive(pid)) return;
      await sleep(200);
    }
    throw new HttpError(409, failure);
  }

  return {
    async start({ cwd, prompt, name, permissionMode, model, images }) {
      await assertDirectory(cwd);
      const args = ['--bg', '--name', name];
      if (permissionMode) args.push('--permission-mode', permissionMode);
      if (model) args.push('--model', model);
      let fullPrompt = prompt;
      if (images.length) {
        if (!attachments) throw new HttpError(400, 'Image attachments are not available.');
        fullPrompt += describeAttachments(await attachments.paths(images));
        // Lets the agent read the images without asking for access outside the project.
        args.push('--add-dir', attachments.dir);
      }
      // `--` ends option parsing, so a prompt starting with "-" isn't read as a flag.
      const output = await runOrFail([...args, '--', fullPrompt], { cwd });
      return { id: /\b([0-9a-f]{8})\b/.exec(output)?.[1] ?? null };
    },

    async reply(agent, request) {
      const prompt = parsePrompt(isRecord(request) ? request.prompt : undefined);
      if (agent.state === 'working') {
        throw new HttpError(
          409,
          'This agent is still working. Wait until it is awaiting input, or stop it first.',
        );
      }
      await assertDirectory(agent.cwd);
      // An agent awaiting input keeps its process; stopping it first is what lets it continue.
      if (agent.pid !== null) {
        await stopAndWait(
          agent,
          agent.pid,
          'Could not stop this agent to continue it. Use the Terminal button to answer it directly.',
        );
      }
      await runOrFail(['--bg', '--resume', agent.sessionId, '--', prompt], { cwd: agent.cwd });
    },

    async stop(agent) {
      if (agent.pid === null && agent.state !== 'working') {
        throw new HttpError(409, 'This agent is not running.');
      }
      checkId(agent);
      await runOrFail(['stop', agent.id], { fixedArgs: true });
    },

    async remove(agent) {
      checkId(agent);
      // Finished and waiting agents can keep their process too; stop it so nothing is left running.
      if (agent.pid !== null) {
        await stopAndWait(agent, agent.pid, 'Could not stop this agent to delete it. Try again.');
      }
      // `claude rm` refuses on its own when a worktree has unpushed work, and says why.
      await runOrFail(['rm', agent.id], { fixedArgs: true });
    },
  };
}
