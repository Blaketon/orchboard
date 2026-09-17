import type http from 'node:http';

/** An error with an HTTP status whose message is safe to show to the user. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/**
 * Reads a JSON request body. Requiring the JSON content type means a plain HTML form on another
 * site can't submit to the API, on top of the Origin check.
 */
export async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw new HttpError(415, 'Expected a JSON request body.');
  }

  const body = await readBody(req, maxBytes);
  try {
    return JSON.parse(body.toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON.');
  }
}

/** Reads a whole request body, failing with 413 once it grows past `maxBytes`. */
export async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (declared > maxBytes) throw new HttpError(413, 'Request body is too large.');

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, 'Request body is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
