import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  commitTransaction,
  explainBookStorageError
} from '../../apps/web/src/lib/data/database/books-db/commit-transaction.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('successful requests do not publish a book before the transaction commits', async () => {
  const done = deferred();
  let published = false;
  const book = { id: 7 };
  const result = commitTransaction(
    { done: done.promise, abort: assert.fail },
    async () => book
  ).then((value) => {
    published = true;
    return value;
  });
  await setImmediate();
  assert.equal(published, false);
  done.resolve();
  assert.equal(await result, book);
});

test('request failure observes the separate abort rejection even when abort throws', async () => {
  const done = deferred();
  const request = deferred();
  const failure = new DOMException('Image Blob refused', 'UnknownError');
  const tx = {
    done: done.promise,
    abort() {
      throw new DOMException('Already aborted', 'InvalidStateError');
    }
  };
  const result = commitTransaction(tx, () => request.promise);
  const rejected = assert.rejects(result, (error) => error === failure);
  done.reject(new DOMException('Aborted', 'AbortError'));
  // Completion can reject a task before the request's own rejection arrives.
  await setImmediate();
  request.reject(failure);
  await rejected;
});

test('a synchronous request failure aborts and waits for rollback before rejecting', async () => {
  const done = deferred();
  let aborted = false;
  let settled = false;
  const failure = new DOMException('Cannot clone this value', 'DataCloneError');
  const result = commitTransaction(
    { done: done.promise, abort: () => (aborted = true) },
    () => {
      throw failure;
    }
  );
  const rejected = assert.rejects(result, (error) => error === failure).then(() => {
    settled = true;
  });
  await setImmediate();
  assert.equal(aborted, true);
  assert.equal(settled, false);
  done.reject(new DOMException('Aborted', 'AbortError'));
  await rejected;
});

test('a commit-time failure cannot turn successful requests into successful saves', async () => {
  const failure = new DOMException('No space', 'QuotaExceededError');
  await assert.rejects(
    commitTransaction({ done: Promise.reject(failure), abort() {} }, async () => 7),
    (error) => error === failure
  );
});

test('falsy rejection reasons are still failures', async () => {
  for (const failure of [undefined, null, false, 0, '']) {
    let rejected = false;
    await commitTransaction({ done: Promise.reject(failure), abort() {} }, () => 7).catch(
      (error) => {
        rejected = true;
        assert.equal(error, failure);
      }
    );
    assert.equal(rejected, true);
  }
});

test('a failed save does not poison later transactions', async () => {
  const failure = new DOMException('Aborted', 'AbortError');
  await assert.rejects(
    commitTransaction({ done: Promise.reject(failure), abort() {} }, () => 7)
  );
  assert.equal(
    await commitTransaction({ done: Promise.resolve(), abort: assert.fail }, () => 8),
    8
  );
});

test('binary refusals have actionable context while unrelated errors keep their identity', () => {
  for (const failure of [
    new DOMException('Error preparing Blob/File data to be stored in object store', 'UnknownError'),
    new DOMException('BlobURLs are not yet supported', 'DataCloneError')
  ]) {
    const explained = explainBookStorageError(failure);
    assert.equal(explained.cause, failure);
    assert.match(explained.message, /regular browser window/);
    assert.match(explained.message, /original book file has not been changed/);
  }
  for (const failure of [
    new DOMException('No space', 'QuotaExceededError'),
    new DOMException('Cannot clone', 'DataCloneError'),
    new DOMException('Aborted', 'AbortError'),
    new DOMException('Unrelated engine error', 'UnknownError'),
    undefined,
    'failure'
  ]) {
    assert.equal(explainBookStorageError(failure), failure);
  }
});
