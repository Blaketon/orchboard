import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { DATA_DIR_NAME, DEFAULT_HOST, DEFAULT_PORT, loadConfig, parsePort } from './config.ts';

const home = path.resolve('/home/tester');

describe('loadConfig', () => {
  it('defaults to loopback, the default port, and a data dir in the home directory', () => {
    assert.deepEqual(loadConfig({}, home), {
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
      dataDir: path.join(home, DATA_DIR_NAME),
    });
  });

  it('reads ORCHBOARD_PORT, ORCHBOARD_HOST, and ORCHBOARD_DATA_DIR', () => {
    const dataDir = path.resolve('/srv/orchboard');
    assert.deepEqual(
      loadConfig(
        { ORCHBOARD_PORT: '5000', ORCHBOARD_HOST: '0.0.0.0', ORCHBOARD_DATA_DIR: dataDir },
        home,
      ),
      { port: 5000, host: '0.0.0.0', dataDir },
    );
  });

  it('resolves a relative ORCHBOARD_DATA_DIR to an absolute path', () => {
    const { dataDir } = loadConfig({ ORCHBOARD_DATA_DIR: 'state' }, home);
    assert.equal(dataDir, path.resolve('state'));
  });

  it('ignores unprefixed PORT and HOST', () => {
    const config = loadConfig({ PORT: '5000', HOST: 'my-machine' }, home);
    assert.equal(config.port, DEFAULT_PORT);
    assert.equal(config.host, DEFAULT_HOST);
  });

  it('falls back to defaults when variables are blank', () => {
    const config = loadConfig({ ORCHBOARD_HOST: '  ', ORCHBOARD_DATA_DIR: '' }, home);
    assert.equal(config.host, DEFAULT_HOST);
    assert.equal(config.dataDir, path.join(home, DATA_DIR_NAME));
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
