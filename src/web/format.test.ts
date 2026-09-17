import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAge, formatAgo, formatCost, formatPercent, formatTokens } from './format.ts';

describe('formatAge', () => {
  const now = 10 * 24 * 3_600_000;
  const ago = (ms: number) => formatAge(now - ms, now);

  it('formats elapsed time compactly', () => {
    assert.equal(ago(5_000), 'just now');
    assert.equal(ago(12 * 60_000), '12m');
    assert.equal(ago(3 * 3_600_000), '3h');
    assert.equal(ago(3 * 3_600_000 + 5 * 60_000), '3h 5m');
    assert.equal(ago(4 * 24 * 3_600_000), '4d');
  });

  it('treats future timestamps as just now', () => {
    assert.equal(formatAge(now + 60_000, now), 'just now');
  });
});

describe('formatAgo', () => {
  it('reads as part of a sentence', () => {
    assert.equal(formatAgo(1_000, 5_000), 'just now');
    assert.equal(formatAgo(0, 12 * 60_000), '12m ago');
  });
});

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    assert.equal(formatTokens(950), '950');
    assert.equal(formatTokens(1000), '1k');
    assert.equal(formatTokens(12_345), '12.3k');
    assert.equal(formatTokens(1_200_000), '1.2M');
  });
});

describe('formatCost', () => {
  it('shows dollars, marks partial totals, and handles missing costs', () => {
    assert.equal(formatCost(0.4213, false), '$0.42');
    assert.equal(formatCost(1.2, true), '$1.20+');
    assert.equal(formatCost(null, false), '—');
  });
});

describe('formatPercent', () => {
  it('rounds and caps at 100%', () => {
    assert.equal(formatPercent(50_000, 200_000), '25%');
    assert.equal(formatPercent(250_000, 200_000), '100%');
    assert.equal(formatPercent(1, 0), '0%');
  });
});
