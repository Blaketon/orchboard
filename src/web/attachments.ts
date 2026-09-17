import type { Attachment } from '../shared/api.ts';
import { errorMessage, readResponse } from './api.ts';
import { el } from './dom.ts';
import { showToast } from './toast.ts';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES = 10;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Why an image can't be attached, or null when it can. */
export function imageProblem(blob: {
  readonly type: string;
  readonly size: number;
}): string | null {
  if (!IMAGE_TYPES.includes(blob.type)) return 'Attach a PNG, JPEG, GIF, or WebP image.';
  if (blob.size > MAX_IMAGE_BYTES) return 'Images can be at most 10 MB.';
  return null;
}

export async function uploadImage(blob: Blob): Promise<Attachment> {
  const problem = imageProblem(blob);
  if (problem) throw new Error(problem);
  const response = await fetch('/api/attachments', {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  });
  return readResponse<Attachment>(response);
}

/** Image files in a paste or drop. */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return [...data.files].filter((file) => file.type.startsWith('image/'));
}

export interface AttachmentPicker {
  readonly element: HTMLElement;
  /** Uploaded attachment ids, in the order they were added. */
  ids(): string[];
  reset(ids: readonly string[]): void;
  isUploading(): boolean;
  attach(images: readonly Blob[]): Promise<void>;
  /** Pastes, Alt+V, and drops on `target` attach images too. */
  listenOn(target: HTMLElement): void;
}

/** Thumbnails of a task's images with add and remove controls. */
export function createAttachmentPicker(): AttachmentPicker {
  let ids: string[] = [];
  let uploading = 0;
  // Bumped on reset, so uploads that finish after the form moved on to another task are dropped.
  let generation = 0;

  const list = el('ul', { className: 'attachment-list' });
  const input = el('input', {
    attrs: { type: 'file', accept: IMAGE_TYPES.join(','), multiple: '', hidden: '' },
  });
  const add = el('button', {
    className: 'button button-small',
    text: 'Attach image',
    attrs: { type: 'button' },
    on: {
      click: () => {
        input.click();
      },
    },
  });
  const hint = el('span', { className: 'field-hint', text: 'or paste (Ctrl+V / Alt+V) or drop' });
  const element = el('div', { className: 'attachments' }, [
    list,
    el('div', { className: 'attachment-controls' }, [add, hint, input]),
  ]);

  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    void attach(files);
  });

  function render(): void {
    list.replaceChildren(
      ...ids.map((id, index) =>
        el('li', { className: 'attachment' }, [
          el('img', {
            className: 'attachment-image',
            attrs: { src: `/api/attachments/${encodeURIComponent(id)}`, alt: `Image ${index + 1}` },
          }),
          el('button', {
            className: 'attachment-remove',
            text: '×',
            attrs: { type: 'button', 'aria-label': `Remove image ${index + 1}`, title: 'Remove' },
            on: {
              click: () => {
                ids = ids.filter((item) => item !== id);
                render();
              },
            },
          }),
        ]),
      ),
      ...Array.from({ length: uploading }, () =>
        el('li', { className: 'attachment attachment-pending', text: 'Uploading…' }),
      ),
    );
    list.hidden = ids.length + uploading === 0;
    add.disabled = ids.length + uploading >= MAX_IMAGES;
  }

  async function attach(images: readonly Blob[]): Promise<void> {
    const room = MAX_IMAGES - ids.length - uploading;
    if (images.length > room) showToast(`A task can have at most ${MAX_IMAGES} images.`, 'error');
    const started = generation;
    await Promise.all(
      images.slice(0, Math.max(0, room)).map(async (image) => {
        uploading++;
        render();
        try {
          const { id } = await uploadImage(image);
          if (started === generation) ids = [...ids, id];
        } catch (error) {
          if (started === generation) {
            showToast(`Could not attach the image: ${errorMessage(error)}`, 'error');
          }
        } finally {
          if (started === generation) {
            uploading--;
            render();
          }
        }
      }),
    );
  }

  async function pasteFromClipboard(): Promise<void> {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (type) {
          await attach([await item.getType(type)]);
          return;
        }
      }
      showToast('There is no image on the clipboard.', 'error');
    } catch (error) {
      showToast(`Could not read the clipboard: ${errorMessage(error)}`, 'error');
    }
  }

  render();
  return {
    element,
    ids: () => [...ids],
    reset(next) {
      generation++;
      ids = [...next];
      uploading = 0;
      render();
    },
    isUploading: () => uploading > 0,
    attach,
    listenOn(target) {
      target.addEventListener('paste', (event) => {
        const images = imageFiles(event.clipboardData);
        // Copying from office apps puts text and a picture of it on the clipboard: paste the text.
        if (!images.length || event.clipboardData?.types.includes('text/plain')) return;
        event.preventDefault();
        void attach(images);
      });
      target.addEventListener('keydown', (event) => {
        if (event.altKey && !event.ctrlKey && event.key.toLowerCase() === 'v') {
          event.preventDefault();
          void pasteFromClipboard();
        }
      });
      target.addEventListener('dragover', (event) => {
        if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
      });
      target.addEventListener('drop', (event) => {
        const images = imageFiles(event.dataTransfer);
        if (!images.length) return;
        event.preventDefault();
        void attach(images);
      });
    },
  };
}
