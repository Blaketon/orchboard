import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunClaudeOptions {
  readonly cwd?: string;
  /**
   * True only when every argument is a fixed constant. On Windows, an npm install of Claude Code
   * provides `claude.cmd`, which can only start through a shell; passing user text (like a
   * prompt) through a shell would let it run commands, so that fallback is refused otherwise.
   */
  readonly fixedArgs?: boolean;
}

export type RunClaude = (args: readonly string[], options?: RunClaudeOptions) => Promise<string>;

export class ClaudeCliMissingError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'Could not find the `claude` CLI on your PATH. Install Claude Code (https://code.claude.com) and restart Orchboard.',
    );
    this.name = 'ClaudeCliMissingError';
  }
}

/** Runs the `claude` CLI and returns its standard output. */
export const runClaude: RunClaude = async (args, options = {}) => {
  try {
    if (process.platform !== 'win32') return await execText('claude', args, options.cwd);
    try {
      // The native installer provides claude.exe, which runs without a shell.
      return await execText('claude.exe', args, options.cwd);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      if (!options.fixedArgs) {
        throw new ClaudeCliMissingError(
          'Starting and replying to tasks on Windows needs the native Claude Code installer (claude.exe). Install it from https://code.claude.com.',
        );
      }
      return await execText('claude.cmd', args, options.cwd, true);
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw new ClaudeCliMissingError();
    throw error;
  }
};

async function execText(
  file: string,
  args: readonly string[],
  cwd: string | undefined,
  shell = false,
): Promise<string> {
  const { stdout } = await execFileAsync(file, [...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    shell,
    ...(cwd === undefined ? {} : { cwd }),
  });
  return stdout;
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** The most useful part of a failed CLI call: its stderr if any, else the error message. */
export function cliErrorMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') {
    const stderr = error.stderr.trim();
    if (stderr) return stderr;
  }
  return error instanceof Error ? error.message : String(error);
}
