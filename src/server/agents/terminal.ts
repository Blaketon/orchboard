import { spawn } from 'node:child_process';
import type { Agent } from '../../shared/api.ts';
import { HttpError } from '../http-error.ts';

/** Command words are program names and ids only, so they never need quoting. */
const COMMAND_WORD = /^[A-Za-z0-9_.-]+$/;

export interface TerminalCommand {
  readonly file: string;
  readonly args: readonly string[];
  /** Pass arguments to Windows exactly as written (needed for cmd.exe's own quoting). */
  readonly verbatim?: boolean;
}

/**
 * The command that opens a new terminal window running `command` (e.g. `claude attach <id>`)
 * in the agent's folder. The folder is escaped for the shell it ends up in.
 */
export function terminalCommand(
  platform: NodeJS.Platform,
  cwd: string,
  command: readonly string[],
): TerminalCommand {
  if (!command.length || !command.every((word) => COMMAND_WORD.test(word))) {
    throw new HttpError(400, 'Invalid agent id.');
  }
  const commandLine = command.join(' ');

  if (platform === 'win32') {
    // An encoded command sidesteps PowerShell and cmd quoting rules entirely.
    const script = `Set-Location -LiteralPath '${cwd.replace(/'/g, "''")}'; ${commandLine}`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    // `start` opens a new console window. The command line holds only fixed text and base64,
    // so cmd.exe has nothing to interpret.
    return {
      file: 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        `start "" powershell.exe -NoExit -NoProfile -EncodedCommand ${encoded}`,
      ],
      verbatim: true,
    };
  }

  const shellCommand = `cd ${shellQuote(cwd)} && ${commandLine}`;
  if (platform === 'darwin') {
    const appleScriptString = shellCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      file: 'osascript',
      args: [
        '-e',
        `tell application "Terminal" to do script "${appleScriptString}"`,
        '-e',
        'tell application "Terminal" to activate',
      ],
    };
  }
  return { file: 'x-terminal-emulator', args: ['-e', 'bash', '-c', `${shellCommand}; exec bash`] };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type LaunchTerminal = (command: TerminalCommand) => Promise<void>;

/** Starts the terminal detached, so it stays open independently of Orchboard. */
export const launchTerminal: LaunchTerminal = (command) =>
  new Promise((resolve, reject) => {
    const child = spawn(command.file, [...command.args], {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: command.verbatim ?? false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

export async function openAgentTerminal(
  agent: Agent,
  launch: LaunchTerminal = launchTerminal,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  try {
    await launch(terminalCommand(platform, agent.cwd, attachCommand(agent)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      500,
      `Could not open a terminal: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The CLI command that continues an agent's session interactively. */
export function attachCommand(agent: Agent): string[] {
  if (agent.provider === 'claude') return ['claude', 'attach', agent.id];
  if (!agent.sessionId) throw new HttpError(409, 'Codex has not started this task yet.');
  if (agent.pid !== null) {
    throw new HttpError(409, 'This task is running in Orchboard. Open a terminal once it stops.');
  }
  return ['codex', 'resume', agent.sessionId];
}
