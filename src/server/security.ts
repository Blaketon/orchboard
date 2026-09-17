import type { IncomingHttpHeaders } from 'node:http';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface TrustOptions {
  /** True when the user opted into a non-loopback bind address, so any Host is expected. */
  readonly allowAnyHost: boolean;
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(host) || host === '::1';
}

/**
 * Orchboard's API can launch agents and write files, and any page open in the user's browser
 * can send requests to localhost. So a request is only trusted when its Host header is a
 * loopback address (blocks DNS rebinding) and its Origin, if present, is the dashboard itself
 * (blocks cross-site requests).
 */
export function isTrustedRequest(headers: IncomingHttpHeaders, options: TrustOptions): boolean {
  const host = parseHost(headers.host);
  if (!host) return false;
  if (!options.allowAnyHost && !LOOPBACK_HOSTNAMES.has(host.hostname)) return false;

  // Same-origin GETs and non-browser clients send no Origin header.
  if (headers.origin === undefined) return true;
  const origin = parseUrl(headers.origin);
  return origin?.protocol === 'http:' && origin.host === host.host;
}

function parseHost(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  const url = parseUrl(`http://${value}`);
  // Reject tricks like "evil@localhost" or "localhost/path" that URL parsing would accept.
  if (!url || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return undefined;
  }
  return url;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
