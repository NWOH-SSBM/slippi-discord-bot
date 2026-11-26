import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidConnectCode, normalizeConnectCode } from '../dist/domain/connect-code.js';

test('normalizes Connect Code case and surrounding whitespace', () => {
  assert.equal(normalizeConnectCode('  mang#0  '), 'MANG#0');
});

test('normalizes a single space as the Connect Code separator', () => {
  assert.equal(normalizeConnectCode('mang 0'), 'MANG#0');
});

test('normalizes a hyphen as the Connect Code separator', () => {
  assert.equal(normalizeConnectCode('mang-0'), 'MANG#0');
});

test('validates canonical and alternative Connect Code separators', () => {
  assert.equal(isValidConnectCode('MANG#0'), true);
  assert.equal(isValidConnectCode('MANG 0'), true);
  assert.equal(isValidConnectCode('MANG-0'), true);
});

test('rejects malformed Connect Codes and unsupported separators', () => {
  for (const value of ['', 'MANG  0', 'MANG #0', 'MANG_0', 'MANG#', '#0', 'not a code']) {
    assert.equal(isValidConnectCode(value), false, `Expected ${value} to be invalid`);
  }
});
