import fs from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';

export interface StaticRoots {
  /** Hand-written files: index.html, styles, images. */
  readonly publicDir: string;
  /** Build output. Only its `web/` and `shared/` folders are served, under `/app/`. */
  readonly buildDir: string;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// The page only ever loads its own files, so anything injected into it (say, through a
// transcript) can't run inline scripts or talk to other origins.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** Maps a URL path to a file inside one of the roots, or undefined if it isn't servable. */
export function resolveStaticPath(pathname: string, roots: StaticRoots): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded === '/') decoded = '/index.html';

  const isBuild = decoded.startsWith('/app/');
  const root = isBuild ? roots.buildDir : roots.publicDir;
  const relative = decoded.slice(isBuild ? '/app/'.length : 1);

  const segments = relative.split(/[/\\]/);
  // No hidden files and no way out of the root.
  if (segments.some((segment) => segment === '' || segment.startsWith('.'))) return undefined;
  // Compiled server code stays private.
  if (isBuild && segments[0] !== 'web' && segments[0] !== 'shared') return undefined;
  if (!(path.extname(relative) in CONTENT_TYPES)) return undefined;

  const file = path.resolve(root, ...segments);
  return file.startsWith(path.resolve(root) + path.sep) ? file : undefined;
}

/** Serves a static file for GET/HEAD requests. Returns false if there is no such file. */
export async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  roots: StaticRoots,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const file = resolveStaticPath(pathname, roots);
  if (!file) return false;

  let body: Buffer;
  try {
    body = await fs.readFile(file);
  } catch {
    return false;
  }

  const type = CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CONTENT_SECURITY_POLICY } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
