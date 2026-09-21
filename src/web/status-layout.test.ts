import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_STATUS_LAYOUT,
  RAIL_WIDTH,
  clampStatusWidth,
  isCollapsed,
  parseStatusLayout,
  toggleOpen,
} from './status-layout.ts';

describe('parseStatusLayout', () => {
  it('uses the default for missing or unreadable values', () => {
    assert.deepEqual(parseStatusLayout(null), DEFAULT_STATUS_LAYOUT);
    assert.deepEqual(parseStatusLayout('collapsed'), DEFAULT_STATUS_LAYOUT);
    assert.deepEqual(parseStatusLayout({ width: 'wide', open: 'done' }), DEFAULT_STATUS_LAYOUT);
  });

  it('clamps a stored width to the rail floor and the max', () => {
    assert.deepEqual(parseStatusLayout({ width: 10, open: [] }), { width: RAIL_WIDTH, open: [] });
    assert.deepEqual(parseStatusLayout({ width: 9999, open: [] }), { width: 1200, open: [] });
  });

  it('keeps known states in board order, once each', () => {
    assert.deepEqual(parseStatusLayout({ width: 240, open: ['done', 'gone', 'blocked', 'done'] }), {
      width: 240,
      open: ['blocked', 'done'],
    });
  });
});

describe('clampStatusWidth', () => {
  it('keeps a width between the rail floor and the max', () => {
    assert.equal(clampStatusWidth(0), RAIL_WIDTH);
    assert.equal(clampStatusWidth(500), 500);
    assert.equal(clampStatusWidth(5000), 1200);
  });
});

describe('isCollapsed', () => {
  it('is false for the default, auto-width layout', () => {
    assert.equal(isCollapsed(DEFAULT_STATUS_LAYOUT), false);
  });

  it('is true once the width is dragged down to the rail floor', () => {
    assert.equal(isCollapsed({ width: RAIL_WIDTH, open: [] }), true);
    assert.equal(isCollapsed({ width: 500, open: [] }), false);
  });
});

describe('toggleOpen', () => {
  it('opens a state in board order, keeping the others', () => {
    const layout = toggleOpen({ width: RAIL_WIDTH, open: ['done'] }, 'blocked');
    assert.deepEqual(layout, { width: RAIL_WIDTH, open: ['blocked', 'done'] });
  });

  it('closes an open state', () => {
    const layout = toggleOpen({ width: RAIL_WIDTH, open: ['blocked', 'working'] }, 'blocked');
    assert.deepEqual(layout, { width: RAIL_WIDTH, open: ['working'] });
  });
});
