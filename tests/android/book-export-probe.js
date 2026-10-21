/* SPDX-License-Identifier: BSD-3-Clause */
// Read-only observation of the book imported through the real Android controls.
// This probe neither inserts fixture records nor invokes product bridge methods.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (config) => {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  assert(/^[a-f0-9]{32}$/.test(config.id), 'Invalid book export qualification identity');
  assert(['empty', 'imported'].includes(config.operation), 'Unknown book export probe operation');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('books');
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    const tx = db.transaction(['data', 'bookmark'], 'readonly');
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('Book inspection aborted'));
    });
    const read = (request) =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const [books, bookmarks] = await Promise.all([
      read(tx.objectStore('data').getAll()),
      read(tx.objectStore('bookmark').getAll()),
      done
    ]);
    if (config.operation === 'empty') {
      assert(books.length === 0 && bookmarks.length === 0, 'Expected an empty disposable Library');
      return { empty: true };
    }
    const title = `manabi-export-${config.id}`;
    assert(
      books.length === 1 && books[0].title === title,
      'Native import did not save the exact book'
    );
    const book = books[0];
    assert(book.sourceFormat === 'txt', 'Expected the real text importer');
    assert(
      /^[a-f0-9]{64}$/.test(book.contentHash),
      'Imported book lacks its canonical content hash'
    );
    assert(
      typeof book.elementHtml === 'string' &&
        book.elementHtml.includes(`日本語の読書 ${config.id}`),
      'Imported Japanese text is missing'
    );
    assert(
      bookmarks.every((row) => row.dataId === book.id),
      'An unrelated bookmark is present'
    );
    const html = new TextEncoder().encode(book.elementHtml);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', html)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    return {
      title,
      contentHash: book.contentHash,
      htmlBytes: html.byteLength,
      htmlSha256: sha256,
      progress: bookmarks[0] || null
    };
  } finally {
    db.close();
  }
};
