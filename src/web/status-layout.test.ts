import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_STATUS_LAYOUT, parseStatusLayout, toggleOpen } from './status-layout.ts';

describe('parseStatusLayout', () => {
  it('uses the default for missing or unreadable values', () => {
    assert.deepEqual(parseStatusLayout(null), DEFAULT_STATUS_LAYOUT);
    assert.deepEqual(parseStatusLayout('collapsed'), DEFAULT_STATUS_LAYOUT);
    assert.deepEqual(parseStatusLayout({ collapsed: 'yes', open: 'done' }), DEFAULT_STATUS_LAYOUT);
  });

  it('keeps known states in board order, once each', () => {
    assert.deepEqual(
      parseStatusLayout({ collapsed: true, open: ['done', 'gone', 'blocked', 'done'] }),
      {
        collapsed: true,
        open: ['blocked', 'done'],
      },
    );
  });
});

describe('toggleOpen', () => {
  it('opens a state in board order, keeping the others', () => {
    const layout = toggleOpen({ collapsed: true, open: ['done'] }, 'blocked');
    assert.deepEqual(layout, { collapsed: true, open: ['blocked', 'done'] });
  });

  it('closes an open state', () => {
    const layout = toggleOpen({ collapsed: true, open: ['blocked', 'working'] }, 'blocked');
    assert.deepEqual(layout, { collapsed: true, open: ['working'] });
  });
});
