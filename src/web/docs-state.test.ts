import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectDoc } from '../shared/api.ts';
import {
  discardEdits,
  fromDisk,
  hasConflict,
  isDirty,
  keepEdits,
  withDiskVersion,
} from './docs-state.ts';

const doc = (content: string, modifiedAt: number | null = 1): ProjectDoc => ({
  name: 'CLAUDE.md',
  exists: modifiedAt !== null,
  content,
  modifiedAt,
});

describe('docs state', () => {
  it('treats CRLF files as clean until the text changes', () => {
    const state = fromDisk(doc('one\r\ntwo'));
    assert.equal(state.text, 'one\ntwo');
    assert.equal(isDirty(state), false);
    assert.equal(isDirty({ ...state, text: 'one\ntwo\nthree' }), true);
  });

  it('follows the disk while there are no edits', () => {
    const next = withDiskVersion(fromDisk(doc('old')), doc('new', 2));
    assert.equal(next.text, 'new');
    assert.equal(hasConflict(next), false);
  });

  it('keeps edits and flags a conflict when the file changes on disk', () => {
    const edited = { ...fromDisk(doc('old')), text: 'mine' };
    const next = withDiskVersion(edited, doc('theirs', 2));
    assert.equal(next.text, 'mine');
    assert.equal(next.base.modifiedAt, 1);
    assert.equal(hasConflict(next), true);

    assert.equal(withDiskVersion(edited, doc('old')).latest.modifiedAt, 1);
    assert.equal(hasConflict(withDiskVersion(edited, doc('old'))), false);
  });

  it('resolves a conflict by discarding or keeping the edits', () => {
    const conflicted = withDiskVersion({ ...fromDisk(doc('old')), text: 'mine' }, doc('theirs', 2));

    const discarded = discardEdits(conflicted);
    assert.equal(discarded.text, 'theirs');
    assert.equal(hasConflict(discarded), false);

    const kept = keepEdits(conflicted);
    assert.equal(kept.text, 'mine');
    assert.equal(kept.base.modifiedAt, 2);
    assert.equal(hasConflict(kept), false);
  });
});
