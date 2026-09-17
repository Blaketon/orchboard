import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { encodeProjectDir, readTailLines, TranscriptReader } from './transcript-reader.ts';

const SESSION = '0f8e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b';
const prompt = (text: string) =>
  JSON.stringify({ type: 'user', timestamp: 't', message: { role: 'user', content: text } });

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    assert.equal(encodeProjectDir('C:\\Git\\my_app'), 'C--Git-my-app');
    assert.equal(encodeProjectDir('/home/me/site.dev'), '-home-me-site-dev');
  });
});

describe('TranscriptReader', () => {
  let claudeDir: string;
  const cwd = path.resolve('/work/storefront');

  async function writeTranscript(
    projectFolder: string,
    ...contentLines: string[]
  ): Promise<string> {
    const dir = path.join(claudeDir, 'projects', projectFolder);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${SESSION}.jsonl`);
    await fs.writeFile(file, `${contentLines.join('\n')}\n`);
    return file;
  }

  beforeEach(async () => {
    claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-claude-'));
  });

  afterEach(async () => {
    await fs.rm(claudeDir, { recursive: true, force: true });
  });

  it("reads the transcript from the working directory's project folder", async () => {
    await writeTranscript(encodeProjectDir(cwd), prompt('hello'));
    const { entries, usage } = await new TranscriptReader(claudeDir).read({
      cwd,
      sessionId: SESSION,
    });
    assert.deepEqual(entries[0]?.parts, [{ type: 'text', text: 'hello' }]);
    assert.equal(usage?.tokens.output, 0);
  });

  it('finds a transcript that moved to a worktree folder', async () => {
    const file = await writeTranscript(
      encodeProjectDir(path.join(cwd, '.claude', 'worktrees', 'fix-tests')),
      prompt('from worktree'),
    );
    const reader = new TranscriptReader(claudeDir);
    assert.equal(await reader.locate({ cwd, sessionId: SESSION }), file);
    assert.equal((await reader.read({ cwd, sessionId: SESSION })).entries.length, 1);
  });

  it('returns no entries when the session has no transcript yet', async () => {
    assert.deepEqual(await new TranscriptReader(claudeDir).read({ cwd, sessionId: SESSION }), {
      entries: [],
      usage: null,
    });
  });

  it('rejects session ids that could escape the projects folder', async () => {
    await assert.rejects(
      new TranscriptReader(claudeDir).read({ cwd, sessionId: '../../secrets' }),
      /Invalid session id/,
    );
  });
});

describe('readTailLines', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchboard-tail-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns every line of a small file', async () => {
    const file = path.join(dir, 'small.jsonl');
    await fs.writeFile(file, 'one\ntwo\n');
    assert.deepEqual(await readTailLines(file, 1024), ['one', 'two', '']);
  });

  it('drops the line cut in half by the byte limit, including multi-byte text', async () => {
    const file = path.join(dir, 'big.jsonl');
    await fs.writeFile(file, 'ääääääääää\nlast complete line\n');
    // 25 bytes from the end starts in the middle of a two-byte 'ä'.
    const lines = await readTailLines(file, Buffer.byteLength('last complete line\n') + 6);
    assert.deepEqual(lines, ['last complete line', '']);
  });
});
