import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Attachment } from '../../shared/api.ts';
import { HttpError } from '../http-error.ts';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_TASK = 10;

export type ImageType = 'png' | 'jpg' | 'gif' | 'webp';

export const IMAGE_CONTENT_TYPES: Readonly<Record<ImageType, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const ATTACHMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

/** Identifies an image by its leading bytes; the declared content type is not trusted. */
export function detectImageType(bytes: Uint8Array): ImageType | undefined {
  const starts = (signature: readonly number[], offset = 0) =>
    signature.every((byte, i) => bytes[offset + i] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'gif';
  // "RIFF", four size bytes, then "WEBP".
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return undefined;
}

export function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && ATTACHMENT_ID.test(value);
}

/** Validates a list of attachment ids from a request, without checking the files exist. */
export function parseAttachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isAttachmentId)) {
    throw new HttpError(400, 'Unknown image attachment.');
  }
  if (value.length > MAX_IMAGES_PER_TASK) {
    throw new HttpError(400, `A task can have at most ${MAX_IMAGES_PER_TASK} images.`);
  }
  return [...new Set(value)];
}

/**
 * Images pasted into task prompts, kept as files under `<dataDir>/attachments` so agents can
 * open them with their file tools. Files are named by random id, so a request can only ever
 * refer to files this store created.
 */
export class AttachmentStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'attachments');
  }

  async save(bytes: Uint8Array): Promise<Attachment> {
    const type = detectImageType(bytes);
    if (!type) throw new HttpError(415, 'Attach a PNG, JPEG, GIF, or WebP image.');
    if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Images can be at most 10 MB.');
    const id = `${randomUUID()}.${type}`;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, id), bytes, { flag: 'wx' });
    return { id };
  }

  /** Reads an attachment for display. */
  async read(id: string): Promise<{ bytes: Buffer; contentType: string }> {
    if (!isAttachmentId(id)) throw new HttpError(404, 'Attachment not found.');
    try {
      const bytes = await fs.readFile(path.join(this.dir, id));
      return { bytes, contentType: IMAGE_CONTENT_TYPES[extension(id)] };
    } catch {
      throw new HttpError(404, 'Attachment not found.');
    }
  }

  /** Absolute paths for attachment ids, checking that every file still exists. */
  async paths(ids: readonly string[]): Promise<string[]> {
    return Promise.all(
      ids.map(async (id) => {
        const file = path.join(this.dir, id);
        try {
          await fs.access(file);
        } catch {
          throw new HttpError(400, 'An attached image no longer exists. Remove it and try again.');
        }
        return file;
      }),
    );
  }

  /** Deletes attachments older than `maxAgeMs`, except those still referenced (e.g. queued). */
  async prune(options: {
    readonly maxAgeMs: number;
    readonly keep: ReadonlySet<string>;
    readonly now?: number;
  }): Promise<number> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return 0;
    }
    const cutoff = (options.now ?? Date.now()) - options.maxAgeMs;
    let removed = 0;
    for (const name of names) {
      if (!isAttachmentId(name) || options.keep.has(name)) continue;
      const file = path.join(this.dir, name);
      try {
        if ((await fs.stat(file)).mtimeMs < cutoff) {
          await fs.rm(file);
          removed++;
        }
      } catch {
        // Already gone or locked; try again next time.
      }
    }
    return removed;
  }
}

function extension(id: string): ImageType {
  const ext = id.slice(id.lastIndexOf('.') + 1);
  return ext === 'jpg' || ext === 'gif' || ext === 'webp' ? ext : 'png';
}

/** The prompt text that points the agent at its attached images. */
export function describeAttachments(paths: readonly string[]): string {
  if (!paths.length) return '';
  const list = paths.map((file) => `- ${file}`).join('\n');
  return `\n\nAttached image${paths.length === 1 ? '' : 's'} (open with the Read tool):\n${list}`;
}
