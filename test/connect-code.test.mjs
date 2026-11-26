import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidConnectCode, normalizeConnectCode } from '../dist/domain/connect-code.js';

test('normalizes a Connect Code by trimming whitespace and uppercasing', () => {
  assert.equal(normalizeConnectCode('  abcd#123  '), 'ABCD#123');
});

test('does not otherwise rewrite the Connect Code', () => {
  assert.equal(normalizeConnectCode('AbC-123'), 'ABC-123');
});

test('validates the Connect Code tag and numeric suffix', () => {
  assert.equal(isValidConnectCode('ABCD#123'), true);
  assert.equal(isValidConnectCode('A#1'), true);
  assert.equal(isValidConnectCode('ABCDEFG#1234567'), true);
  assert.equal(isValidConnectCode('NOT-A-CODE'), false);
  assert.equal(isValidConnectCode('TOOLONGGG#123'), false);
  assert.equal(isValidConnectCode('ABCD#12345678'), false);
});
