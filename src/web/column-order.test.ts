import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeOrder, moveColumn, orderColumns, queueColumnKey } from './column-order.ts';

describe('orderColumns', () => {
  it('keeps the default order when nothing is saved', () => {
    assert.deepEqual(orderColumns(['blocked', 'working', 'done'], []), [
      'blocked',
      'working',
      'done',
    ]);
  });

  it('follows the saved order and puts unsaved columns last', () => {
    assert.deepEqual(
      orderColumns(
        ['blocked', 'working', 'done', 'queue:a', 'queue:new'],
        ['queue:a', 'done', 'queue:other-project', 'blocked', 'working'],
      ),
      ['queue:a', 'done', 'blocked', 'working', 'queue:new'],
    );
  });
});

describe('moveColumn', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('moves a column to an index among the other columns', () => {
    assert.deepEqual(moveColumn(order, 'd', 0), ['d', 'a', 'b', 'c']);
    assert.deepEqual(moveColumn(order, 'a', 2), ['b', 'c', 'a', 'd']);
    assert.deepEqual(moveColumn(order, 'b', 3), ['a', 'c', 'd', 'b']);
  });

  it('clamps the index and ignores unknown columns', () => {
    assert.deepEqual(moveColumn(order, 'a', 99), ['b', 'c', 'd', 'a']);
    assert.deepEqual(moveColumn(order, 'c', -1), ['c', 'a', 'b', 'd']);
    assert.deepEqual(moveColumn(order, 'x', 0), order);
  });
});

describe('mergeOrder', () => {
  it('reorders the shown columns and leaves the hidden ones in place', () => {
    const saved = ['queue:a', 'blocked', 'working', 'done', 'queue:b'];
    // Project B is selected, so queue:a is not shown; queue:b moves to the front.
    assert.deepEqual(mergeOrder(saved, ['queue:b', 'blocked', 'working', 'done']), [
      'queue:a',
      'queue:b',
      'blocked',
      'working',
      'done',
    ]);
  });

  it('adds shown columns that were never saved', () => {
    assert.deepEqual(mergeOrder([], ['done', 'blocked', 'working']), [
      'done',
      'blocked',
      'working',
    ]);
    assert.deepEqual(mergeOrder(['working', 'blocked'], ['blocked', 'working', 'queue:c']), [
      'blocked',
      'working',
      'queue:c',
    ]);
  });
});

describe('queueColumnKey', () => {
  it('cannot clash with a status column', () => {
    assert.equal(queueColumnKey('done'), 'queue:done');
  });
});
