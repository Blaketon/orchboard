import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Agent } from '../../shared/api.ts';
import { HttpError } from '../http-error.ts';
import { openAgentTerminal, terminalCommand, type TerminalCommand } from './terminal.ts';

describe('terminalCommand', () => {
  it('runs an encoded PowerShell script on Windows, safe for any folder name', () => {
    const { file, args, verbatim } = terminalCommand('win32', "C:\\Git\\it's & weird", '1a2b3c4d');
    assert.equal(file, 'cmd.exe');
    assert.equal(verbatim, true);
    // Only fixed text and base64 reach cmd.exe, so nothing in the folder name can be interpreted.
    const match =
      /^start "" powershell\.exe -NoExit -NoProfile -EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(
        args[3] ?? '',
      );
    assert.ok(match?.[1]);
    const script = Buffer.from(match[1], 'base64').toString('utf16le');
    assert.equal(
      script,
      "Set-Location -LiteralPath 'C:\\Git\\it''s & weird'; claude attach 1a2b3c4d",
    );
  });

  it('opens Terminal.app on macOS with the folder quoted for the shell and AppleScript', () => {
    const { file, args } = terminalCommand('darwin', '/Users/me/my "app"', '1a2b3c4d');
    assert.equal(file, 'osascript');
    assert.equal(
      args[1],
      `tell application "Terminal" to do script "cd '/Users/me/my \\"app\\"' && claude attach 1a2b3c4d"`,
    );
  });

  it('uses the default terminal emulator on Linux', () => {
    const { file, args } = terminalCommand('linux', "/home/me/it's", '1a2b3c4d');
    assert.equal(file, 'x-terminal-emulator');
    assert.deepEqual(args, [
      '-e',
      'bash',
      '-c',
      "cd '/home/me/it'\\''s' && claude attach 1a2b3c4d; exec bash",
    ]);
  });

  it('rejects agent ids that are not plain identifiers', () => {
    assert.throws(() => terminalCommand('linux', '/tmp', 'x; rm -rf ~'), HttpError);
  });
});

describe('openAgentTerminal', () => {
  const agent: Agent = {
    id: '1a2b3c4d',
    provider: 'claude',
    sessionId: 's',
    name: 'Task',
    cwd: '/work',
    startedAt: 0,
    state: 'blocked',
    pid: null,
  };

  it('launches the command for the current platform', async () => {
    const launched: TerminalCommand[] = [];
    await openAgentTerminal(
      agent,
      (command) => {
        launched.push(command);
        return Promise.resolve();
      },
      'linux',
    );
    assert.equal(launched[0]?.file, 'x-terminal-emulator');
  });

  it('reports launch failures as a server error', async () => {
    await assert.rejects(
      openAgentTerminal(agent, () => Promise.reject(new Error('spawn ENOENT')), 'linux'),
      (error: unknown) => error instanceof HttpError && error.status === 500,
    );
  });
});
