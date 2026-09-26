/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * Observe transaction completion before the first request can fail. A request
 * and tx.done reject separately in idb; catching only the request leaks an
 * unhandled AbortError. Publish a result only after commit, and drain completion
 * even when abort() throws because the transaction has already terminated.
 * The operation must await only this transaction's IndexedDB requests.
 * @template T
 * @param {{done: Promise<unknown>, abort(): void}} transaction
 * @param {() => T | Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function commitTransaction(transaction, operation) {
  const completion = transaction.done.then(
    () => ({ failed: false, error: undefined }),
    (error) => ({ failed: true, error })
  );
  try {
    const result = await operation();
    const outcome = await completion;
    if (outcome.failed) throw outcome.error;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // Native abort() throws after automatic abort or commit. Still drain done.
    }
    await completion;
    throw error;
  }
}

/**
 * Explain native failures at the book-write boundary. Callers with an AbortSignal
 * must handle intentional cancellation first; a native abort is not cancellation.
 * Do not UA-sniff, detect private mode, drop images, or change the book format.
 * Other errors (including quota failures) retain their original identity.
 * @param {unknown} error
 * @returns {unknown}
 */
export function explainBookStorageError(error) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    // Replication treats AbortError as deliberate user cancellation. A native
    // write abort must instead reach the existing failure UI and allow retry.
    return new Error(
      'The book could not be saved because its local storage transaction was aborted. ' +
        'Try importing it again. Your original book file has not been changed.',
      { cause: error }
    );
  }
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    'message' in error &&
    typeof error.message === 'string' &&
    ((error.name === 'UnknownError' &&
      error.message.includes('Error preparing Blob/File data to be stored in object store')) ||
      (error.name === 'DataCloneError' && error.message.includes('BlobURLs are not yet supported')))
  ) {
    return new Error(
      'This browser could not save the book’s images or files. Storage restrictions, including ' +
        'private browsing in some browsers, can prevent this. Try a regular browser window and ' +
        'check available storage. Your original book file has not been changed.',
      { cause: error }
    );
  }
  return error;
}
