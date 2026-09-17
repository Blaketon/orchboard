import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCliArgs } from './cli-args.ts';

describe('parseCliArgs', () => {
  it('defaults to a plain run', () => {
    assert.deepEqual(parseCliArgs([]), {
      demo: false,
      open: false,
      help: false,
      version: false,
    });
  });

  it('reads flags with separate or inline values', () => {
    assert.deepEqual(parseCliArgs(['--port', '4400', '--host', '0.0.0.0', '--demo', '--open']), {
      port: 4400,
      host: '0.0.0.0',
      demo: true,
      open: true,
      help: false,
      version: false,
    });
    assert.equal(parseCliArgs(['-p=4500']).port, 4500);
    assert.equal(parseCliArgs(['--host=localhost']).host, 'localhost');
    assert.equal(parseCliArgs(['-h']).help, true);
    assert.equal(parseCliArgs(['-v']).version, true);
  });

  it('rejects bad input with a message for the terminal', () => {
    assert.throws(() => parseCliArgs(['--port']), /Missing value for --port/);
    assert.throws(() => parseCliArgs(['--port', '--open']), /Missing value for --port/);
    assert.throws(() => parseCliArgs(['--port', 'abc']), /Invalid port/);
    assert.throws(() => parseCliArgs(['--port', '70000']), /Invalid port/);
    assert.throws(() => parseCliArgs(['--wat']), /Unknown option "--wat"/);
  });
});
