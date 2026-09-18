import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { folderListUrl, rootLabel } from './folder-picker.ts';

describe('folderListUrl', () => {
  it('asks for the home folder without a path', () => {
    assert.equal(folderListUrl(null), '/api/folders');
    assert.equal(folderListUrl(''), '/api/folders');
  });

  it('encodes the path into the query string', () => {
    assert.equal(folderListUrl('C:\\Git\\my app'), '/api/folders?path=C%3A%5CGit%5Cmy%20app');
    assert.equal(folderListUrl('/srv/a&b'), '/api/folders?path=%2Fsrv%2Fa%26b');
  });
});

describe('rootLabel', () => {
  it('names the home folder and shows drives as they are', () => {
    assert.equal(rootLabel('/home/me', 0), 'Home (/home/me)');
    assert.equal(rootLabel('D:\\', 2), 'D:\\');
  });
});
