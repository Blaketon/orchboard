import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imageProblem, MAX_IMAGE_BYTES } from './attachments.ts';

describe('imageProblem', () => {
  it('accepts the image formats agents can read, up to the size limit', () => {
    assert.equal(imageProblem({ type: 'image/png', size: 1000 }), null);
    assert.equal(imageProblem({ type: 'image/webp', size: MAX_IMAGE_BYTES }), null);
    assert.match(imageProblem({ type: 'image/svg+xml', size: 10 }) ?? '', /PNG, JPEG/);
    assert.match(imageProblem({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 }) ?? '', /10 MB/);
  });
});
