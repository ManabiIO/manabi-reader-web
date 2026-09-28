import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLifetime } from '../../.cache/media-test-build/sources.js';
test('a source without an account lifetime stays compatible', () => {
  const check = sourceLifetime({});
  assert.doesNotThrow(check);
  assert.doesNotThrow(check);
});
test('capture preserves predicate receiver and latches original failures', () => {
  const source = {
    valid: true,
    isCurrent() {
      return this.valid;
    }
  };
  const check = sourceLifetime(source);
  check();
  source.valid = false;
  assert.throws(check, /source.*current/i);
  source.valid = true;
  source.isCurrent = () => true;
  assert.throws(check, /source.*current/i);
});
test('a throwing lifetime predicate is not interpreted as permission or retried', () => {
  let calls = 0;
  const reason = new Error('provider revoked');
  const check = sourceLifetime({
    isCurrent() {
      calls++;
      throw reason;
    }
  });
  for (let n = 0; n < 2; n++) assert.throws(check, (error) => error === reason);
  assert.equal(calls, 1);
});
