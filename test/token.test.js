import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { readSavedToken, saveToken, deleteSavedToken, resolveToken } from '../src/token.js';

describe('Token Resolution & Storage', () => {
  const testFile = join(tmpdir(), `figmacode-test-token-${Date.now()}.txt`);

  it('readSavedToken returns null when file does not exist', () => {
    assert.equal(readSavedToken(testFile), null);
  });

  it('saveToken persists token and readSavedToken retrieves it', () => {
    const ok = saveToken('cct_test12345', testFile);
    assert.equal(ok, true);
    assert.equal(readSavedToken(testFile), 'cct_test12345');
    rmSync(testFile, { force: true });
  });

  it('deleteSavedToken deletes existing token and returns true, or false if missing', () => {
    saveToken('cct_to_delete', testFile);
    assert.equal(deleteSavedToken(testFile), true);
    assert.equal(readSavedToken(testFile), null);
    assert.equal(deleteSavedToken(testFile), false);
  });

  it('resolveToken prioritizes explicit token argument', async () => {
    const res = await resolveToken({ token: 'cct_explicit', interactive: false });
    assert.equal(res, 'cct_explicit');
  });

  it('resolveToken reads saved token when env is absent', async () => {
    saveToken('cct_saved_value', testFile);
    const oldAccess = process.env.ACCESS_TOKEN;
    const oldOrigin = process.env.ORIGIN_TOKEN;
    delete process.env.ACCESS_TOKEN;
    delete process.env.ORIGIN_TOKEN;

    try {
      const res = await resolveToken({ interactive: false, customPath: testFile });
      assert.equal(res, 'cct_saved_value');
    } finally {
      if (oldAccess !== undefined) process.env.ACCESS_TOKEN = oldAccess;
      if (oldOrigin !== undefined) process.env.ORIGIN_TOKEN = oldOrigin;
      rmSync(testFile, { force: true });
    }
  });

  it('resolveToken prioritizes process.env over saved token', async () => {
    saveToken('cct_saved_value', testFile);
    const oldAccess = process.env.ACCESS_TOKEN;
    process.env.ACCESS_TOKEN = 'cct_from_env';

    try {
      const res = await resolveToken({ interactive: false, customPath: testFile });
      assert.equal(res, 'cct_from_env');
    } finally {
      if (oldAccess !== undefined) process.env.ACCESS_TOKEN = oldAccess;
      else delete process.env.ACCESS_TOKEN;
      rmSync(testFile, { force: true });
    }
  });
});
