import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SETTINGS, parseSettings } from './settings-store.ts';

describe('parseSettings', () => {
  it('uses defaults for missing or unreadable values', () => {
    assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(
      parseSettings({ theme: 'neon', toastOnDone: 'yes', volume: 'loud' }),
      DEFAULT_SETTINGS,
    );
  });

  it('keeps valid values', () => {
    const settings = parseSettings({ theme: 'dark', soundOnBlocked: true, toastSeconds: 12 });
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.soundOnBlocked, true);
    assert.equal(settings.toastSeconds, 12);
  });

  it('clamps numbers to their allowed range', () => {
    const settings = parseSettings({ volume: 3, toastSeconds: 0 });
    assert.equal(settings.volume, 1);
    assert.equal(settings.toastSeconds, 2);
  });
});
