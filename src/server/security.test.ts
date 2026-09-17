import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isLoopbackHost, isTrustedRequest } from './security.ts';

const loopbackOnly = { allowAnyHost: false };
const anyHost = { allowAnyHost: true };

describe('isLoopbackHost', () => {
  it('recognizes loopback bind addresses', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
      assert.equal(isLoopbackHost(host), true, host);
    }
  });

  it('rejects network bind addresses', () => {
    for (const host of ['0.0.0.0', '192.168.1.5', 'my-machine']) {
      assert.equal(isLoopbackHost(host), false, host);
    }
  });
});

describe('isTrustedRequest', () => {
  it('trusts loopback hosts without an Origin', () => {
    for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317']) {
      assert.equal(isTrustedRequest({ host }, loopbackOnly), true, host);
    }
  });

  it('rejects a missing Host header', () => {
    assert.equal(isTrustedRequest({}, loopbackOnly), false);
  });

  it('rejects non-loopback hosts (DNS rebinding)', () => {
    assert.equal(isTrustedRequest({ host: 'evil.example:4317' }, loopbackOnly), false);
  });

  it('rejects malformed hosts that URL parsing would accept', () => {
    for (const host of ['evil@localhost:4317', 'localhost:4317/path', 'localhost:4317?x=1']) {
      assert.equal(isTrustedRequest({ host }, loopbackOnly), false, host);
    }
  });

  it('trusts an Origin that matches the Host, ignoring case', () => {
    const headers = { host: 'LOCALHOST:4317', origin: 'http://localhost:4317' };
    assert.equal(isTrustedRequest(headers, loopbackOnly), true);
  });

  it('rejects cross-site, null, and non-http Origins (CSRF)', () => {
    for (const origin of ['https://evil.example', 'null', 'https://localhost:4317']) {
      assert.equal(
        isTrustedRequest({ host: 'localhost:4317', origin }, loopbackOnly),
        false,
        origin,
      );
    }
  });

  it('trusts network hosts only when allowed, and still checks Origin', () => {
    const host = '192.168.1.5:4317';
    assert.equal(isTrustedRequest({ host }, loopbackOnly), false);
    assert.equal(isTrustedRequest({ host, origin: 'http://192.168.1.5:4317' }, anyHost), true);
    assert.equal(isTrustedRequest({ host, origin: 'http://evil.example' }, anyHost), false);
  });
});
