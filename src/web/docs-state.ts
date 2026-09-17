import type { ProjectDoc } from '../shared/api.ts';

/** One project doc as the editor sees it. */
export interface DocState {
  /** The version on disk that the editor's text started from. Saves are checked against it. */
  readonly base: ProjectDoc;
  /** The newest version read from disk. Differs from `base` when the file changed during an edit. */
  readonly latest: ProjectDoc;
  /** The editor's text, with LF line endings as browsers use in text areas. */
  readonly text: string;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function isDirty(state: DocState): boolean {
  return state.text !== normalizeNewlines(state.base.content);
}

/** True when the file changed on disk while it had unsaved edits. */
export function hasConflict(state: DocState): boolean {
  return state.latest.modifiedAt !== state.base.modifiedAt;
}

/**
 * Takes in a version just read from disk. A doc without unsaved edits follows the disk; one with
 * edits keeps them and remembers the newer version, so saving reports the conflict instead of
 * silently overwriting it.
 */
export function withDiskVersion(state: DocState | undefined, disk: ProjectDoc): DocState {
  if (!state || !isDirty(state)) return fromDisk(disk);
  return { ...state, latest: disk };
}

/** Throws away unsaved edits in favour of the newest disk version. */
export function discardEdits(state: DocState): DocState {
  return fromDisk(state.latest);
}

/** Keeps the edits and bases them on the newest disk version, so the next save replaces it. */
export function keepEdits(state: DocState): DocState {
  return { ...state, base: state.latest };
}

export function fromDisk(doc: ProjectDoc): DocState {
  return { base: doc, latest: doc, text: normalizeNewlines(doc.content) };
}
