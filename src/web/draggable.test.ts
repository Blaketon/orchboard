import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampOffset, parseOffset } from './draggable.ts';

const size = { width: 200, height: 100 };
const viewport = { width: 1000, height: 800 };

describe('clampOffset', () => {
  it('keeps an offset that already fits', () => {
    assert.deepEqual(clampOffset({ right: 300, bottom: 400 }, size, viewport, 8), {
      right: 300,
      bottom: 400,
    });
  });

  it('pulls an element back inside every edge', () => {
    assert.deepEqual(clampOffset({ right: -50, bottom: -20 }, size, viewport, 8), {
      right: 8,
      bottom: 8,
    });
    assert.deepEqual(clampOffset({ right: 950, bottom: 790 }, size, viewport, 8), {
      right: 792,
      bottom: 692,
    });
  });

  it('pins to the bottom-right margin when the window is too small', () => {
    assert.deepEqual(clampOffset({ right: 40, bottom: 40 }, size, { width: 150, height: 90 }, 8), {
      right: 8,
      bottom: 8,
    });
  });

  it('rounds to whole pixels', () => {
    assert.deepEqual(clampOffset({ right: 10.6, bottom: 20.2 }, size, viewport), {
      right: 11,
      bottom: 20,
    });
  });
});

describe('parseOffset', () => {
  it('reads a stored offset', () => {
    assert.deepEqual(parseOffset({ right: 12, bottom: 34 }), { right: 12, bottom: 34 });
  });

  it('rejects missing or unreadable values', () => {
    assert.equal(parseOffset(null), null);
    assert.equal(parseOffset('12,34'), null);
    assert.equal(parseOffset({ right: 12 }), null);
    assert.equal(parseOffset({ right: '12', bottom: 34 }), null);
    assert.equal(parseOffset({ right: Number.NaN, bottom: 34 }), null);
  });
});
