import type { FolderEntry, FolderListing } from '../shared/api.ts';
import { errorMessage, requestJson } from './api.ts';
import { el } from './dom.ts';

/** The API URL listing the folders inside `folder`, or inside the home folder. */
export function folderListUrl(folder: string | null): string {
  return folder ? `/api/folders?path=${encodeURIComponent(folder)}` : '/api/folders';
}

/** Names a place browsing can start over from; the first root is the home folder. */
export function rootLabel(root: string, index: number): string {
  return index === 0 ? `Home (${root})` : root;
}

/**
 * Lets the user pick a folder by browsing the computer. A browser can't reveal a folder's full
 * path, so the server lists the folders. Starts at `start` when it is a folder, else at home, and
 * resolves with the chosen path, or null when cancelled.
 */
export function pickFolder(start: string): Promise<string | null> {
  return new Promise((resolve) => {
    let current: FolderListing | null = null;
    let chosen: string | null = null;
    let latest = 0;

    const location = el('input', {
      className: 'field-input folder-location',
      attrs: { 'aria-label': 'Folder path', autocomplete: 'off', spellcheck: 'false' },
    });
    const up = el('button', {
      className: 'button',
      text: '↑ Up',
      attrs: { type: 'button', title: 'Parent folder' },
    });
    const roots = el('select', {
      className: 'field-input folder-roots',
      attrs: { 'aria-label': 'Go to' },
    });
    const list = el('ul', { className: 'folder-list', attrs: { 'aria-label': 'Folders' } });
    const status = el('p', { className: 'folder-status' });
    status.hidden = true;
    const error = el('p', { className: 'form-error', attrs: { role: 'alert' } });
    error.hidden = true;
    const choose = el('button', {
      className: 'button button-primary',
      text: 'Use this folder',
      attrs: { type: 'submit' },
    });
    const cancel = el('button', { className: 'button', text: 'Cancel', attrs: { type: 'button' } });
    const form = el('form', { className: 'form' }, [
      el('h2', { className: 'form-title', text: 'Choose a project folder' }),
      el('div', { className: 'folder-toolbar' }, [up, location, roots]),
      list,
      status,
      error,
      el('div', { className: 'form-actions' }, [cancel, choose]),
    ]);
    const dialog = el('dialog', { className: 'modal' }, [form]);
    document.body.append(dialog);

    const pick = (folder: string) => {
      chosen = folder;
      dialog.close();
    };

    /** Lists `folder`, then focuses `focusPath`'s entry, e.g. the folder just left by going up. */
    const open = async (folder: string | null, focusPath?: string): Promise<boolean> => {
      const request = ++latest;
      const keepFocus = list.contains(document.activeElement);
      error.hidden = true;
      list.setAttribute('aria-busy', 'true');
      try {
        const listing = await requestJson<FolderListing>('GET', folderListUrl(folder));
        // A slow answer for a folder the user already clicked past is dropped.
        if (request !== latest) return false;
        show(listing);
        const target =
          [...list.querySelectorAll<HTMLButtonElement>('.folder')].find(
            (button) => button.dataset.path === focusPath,
          ) ?? (keepFocus ? list.querySelector<HTMLButtonElement>('.folder') : null);
        target?.focus();
        return true;
      } catch (caught) {
        if (request === latest) {
          error.textContent = errorMessage(caught);
          error.hidden = false;
          if (current) location.value = current.path;
        }
        return false;
      } finally {
        if (request === latest) list.removeAttribute('aria-busy');
      }
    };

    const show = (listing: FolderListing) => {
      current = listing;
      location.value = listing.path;
      // Long paths show their end, where the folder's own name is.
      location.scrollLeft = location.scrollWidth;
      up.disabled = listing.parent === null;
      roots.replaceChildren(
        el('option', { text: 'Go to…', attrs: { value: '' } }),
        ...listing.roots.map((root, index) =>
          el('option', { text: rootLabel(root, index), attrs: { value: root } }),
        ),
      );
      list.replaceChildren(...listing.folders.map((folder) => item(folder)));
      status.textContent = !listing.folders.length
        ? 'No folders in here.'
        : listing.truncated
          ? `Showing the first ${listing.folders.length} folders. Type a path to go further.`
          : '';
      status.hidden = !status.textContent;
    };

    const item = (folder: FolderEntry) =>
      el('li', { className: 'folder-item' }, [
        el(
          'button',
          {
            className: 'folder',
            attrs: { type: 'button', 'data-path': folder.path, title: folder.path },
            on: {
              click: () => {
                void open(folder.path);
              },
            },
          },
          [
            el('span', { className: 'folder-name', text: folder.name }),
            folder.repository ? el('span', { className: 'folder-tag', text: 'git' }) : null,
          ],
        ),
        // Repositories are usually the project itself, so they can be picked without opening.
        folder.repository
          ? el('button', {
              className: 'button button-small',
              text: 'Use',
              attrs: { type: 'button', 'aria-label': `Use ${folder.name}` },
              on: {
                click: () => {
                  pick(folder.path);
                },
              },
            })
          : null,
      ]);

    up.addEventListener('click', () => {
      if (current?.parent) void open(current.parent, current.path);
    });
    roots.addEventListener('change', () => {
      if (roots.value) void open(roots.value);
    });
    // Enter in the path box goes to the typed folder; the button picks the folder shown.
    location.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void open(location.value);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      // A path typed but not yet opened is checked first, so only a real folder is picked.
      const typed = location.value.trim();
      if (current?.path === typed) {
        pick(typed);
        return;
      }
      void open(typed).then((opened) => {
        if (opened && current) pick(current.path);
      });
    });
    cancel.addEventListener('click', () => {
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(chosen);
    });

    dialog.showModal();
    location.focus();
    const initial = start.trim();
    void open(initial || null).then(async (opened) => {
      if (!opened && initial && !current) await open(null);
    });
  });
}
