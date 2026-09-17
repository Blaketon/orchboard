import type { Agent, StartTaskResponse } from '../../shared/api.ts';
import { describeAttachments, type AttachmentStore } from '../attachments/attachment-store.ts';
import { HttpError, isRecord } from '../http-error.ts';
import { cliErrorMessage, ClaudeCliMissingError, runClaude, type RunClaude } from './claude-cli.ts';
import { assertDirectory, parsePrompt, type TaskRequest } from './task-request.ts';

const AGENT_ID = /^[A-Za-z0-9_-]+$/;

export interface ClaudeActions {
  start(task: TaskRequest): Promise<StartTaskResponse>;
  reply(agent: Agent, request: unknown): Promise<void>;
  stop(agent: Agent): Promise<void>;
  remove(agent: Agent): Promise<void>;
}

/** Starts, continues, and stops Claude Code background agents through the `claude` CLI. */
export function createClaudeActions(
  run: RunClaude = runClaude,
  attachments?: Pick<AttachmentStore, 'dir' | 'paths'>,
): ClaudeActions {
  async function runOrFail(
    args: readonly string[],
    options: Parameters<RunClaude>[1],
  ): Promise<string> {
    try {
      return await run(args, options);
    } catch (error) {
      if (error instanceof ClaudeCliMissingError) throw new HttpError(503, error.message);
      throw new HttpError(502, `Claude Code reported an error: ${cliErrorMessage(error)}`);
    }
  }

  return {
    async start({ cwd, prompt, name, permissionMode, images }) {
      await assertDirectory(cwd);
      const args = ['--bg', '--name', name];
      if (permissionMode) args.push('--permission-mode', permissionMode);
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
      // With a live process, `claude --bg --resume` would start a copy instead of continuing.
      if (agent.pid !== null) {
        throw new HttpError(
          409,
          'This agent is still running. Wait until it is awaiting input, or stop it first.',
        );
      }
      await assertDirectory(agent.cwd);
      await runOrFail(['--bg', '--resume', agent.sessionId, '--', prompt], { cwd: agent.cwd });
    },

    async stop(agent) {
      if (agent.pid === null && agent.state !== 'working') {
        throw new HttpError(409, 'This agent is not running.');
      }
      if (!AGENT_ID.test(agent.id)) throw new HttpError(400, 'Invalid agent id.');
      await runOrFail(['stop', agent.id], { fixedArgs: true });
    },

    async remove(agent) {
      if (agent.pid !== null || agent.state === 'working') {
        throw new HttpError(409, 'Stop the agent before deleting it.');
      }
      if (!AGENT_ID.test(agent.id)) throw new HttpError(400, 'Invalid agent id.');
      // `claude rm` refuses on its own when a worktree has unpushed work, and says why.
      await runOrFail(['rm', agent.id], { fixedArgs: true });
    },
  };
}
