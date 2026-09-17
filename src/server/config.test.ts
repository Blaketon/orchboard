import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_HOST, DEFAULT_PORT, loadConfig, parsePort } from './config.ts';

describe('loadConfig', () => {
  it('defaults to loopback on the default port', () => {
    assert.deepEqual(loadConfig({}), { port: DEFAULT_PORT, host: DEFAULT_HOST });
  });

  it('reads ORCHBOARD_PORT and ORCHBOARD_HOST', () => {
    assert.deepEqual(loadConfig({ ORCHBOARD_PORT: '5000', ORCHBOARD_HOST: '0.0.0.0' }), {
      port: 5000,
      host: '0.0.0.0',
    });
  });

  it('ignores unprefixed PORT and HOST', () => {
    assert.deepEqual(loadConfig({ PORT: '5000', HOST: 'my-machine' }), {
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
    });
  });

  it('falls back to the default host when ORCHBOARD_HOST is blank', () => {
    assert.equal(loadConfig({ ORCHBOARD_HOST: '  ' }).host, DEFAULT_HOST);
  });
});

describe('parsePort', () => {
  it('accepts ports from 0 to 65535', () => {
    assert.equal(parsePort('0'), 0);
    assert.equal(parsePort('65535'), 65535);
  });

  it('rejects values that are not valid ports', () => {
    for (const value of ['-1', '65536', '80.5', 'abc']) {
      assert.throws(() => parsePort(value), /Invalid ORCHBOARD_PORT/, value);
    }
  });
});
