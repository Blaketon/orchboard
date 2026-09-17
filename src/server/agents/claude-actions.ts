import fs from 'node:fs/promises';
import path from 'node:path';
import type { Agent, StartTaskRequest, StartTaskResponse } from '../../shared/api.ts';
import { isPermissionMode } from '../../shared/permission-modes.ts';
import {
  describeAttachments,
  parseAttachmentIds,
  type AttachmentStore,
} from '../attachments/attachment-store.ts';
import { HttpError, isRecord } from '../http-error.ts';
import { cliErrorMessage, ClaudeCliMissingError, runClaude, type RunClaude } from './claude-cli.ts';

export const MAX_PROMPT_CHARS = 100_000;
export const MAX_NAME_CHARS = 120;
const AGENT_ID = /^[A-Za-z0-9_-]+$/;

export interface ClaudeActions {
  start(request: unknown): Promise<StartTaskResponse>;
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
    async start(request) {
      const { cwd, prompt, name, permissionMode, images } = parseStartRequest(request);
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

function parseStartRequest(
  request: unknown,
): Required<Omit<StartTaskRequest, 'permissionMode'>> & Pick<StartTaskRequest, 'permissionMode'> {
  if (!isRecord(request)) throw new HttpError(400, 'Expected a JSON object.');
  const { cwd, name, permissionMode } = request;

  if (typeof cwd !== 'string' || !path.isAbsolute(cwd.trim())) {
    throw new HttpError(400, 'Choose a project folder (an absolute path).');
  }
  const prompt = parsePrompt(request.prompt);

  let taskName = typeof name === 'string' ? name.trim() : '';
  if (taskName.length > MAX_NAME_CHARS) {
    throw new HttpError(400, `Task names can be at most ${MAX_NAME_CHARS} characters.`);
  }
  taskName ||= defaultName(prompt);

  if (permissionMode !== undefined && !isPermissionMode(permissionMode)) {
    throw new HttpError(400, 'Unknown permission mode.');
  }
  return {
    cwd: cwd.trim(),
    prompt,
    name: taskName,
    images: parseAttachmentIds(request.images),
    ...(permissionMode === undefined ? {} : { permissionMode }),
  };
}

function parsePrompt(value: unknown): string {
  const prompt = typeof value === 'string' ? value.trim() : '';
  if (!prompt) throw new HttpError(400, 'Write a prompt for the agent.');
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new HttpError(
      400,
      `Prompts can be at most ${MAX_PROMPT_CHARS.toLocaleString('en')} characters.`,
    );
  }
  return prompt;
}

/** The prompt's first line, shortened, so every task gets a readable name. */
export function defaultName(prompt: string): string {
  const firstLine = prompt.split('\n').find((line) => line.trim()) ?? prompt;
  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  return collapsed.length > 60 ? `${collapsed.slice(0, 59)}…` : collapsed;
}

async function assertDirectory(dir: string): Promise<void> {
  try {
    if ((await fs.stat(dir)).isDirectory()) return;
  } catch {
    // Fall through to the error below.
  }
  throw new HttpError(400, `Folder not found: ${dir}`);
}
