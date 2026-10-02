/** @license BSD-3-Clause */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeOwner, deferred } from './fixtures/runtime-owner.mjs';

const openPayload = (id) => ({ bookId: id, libraryToken: `library_${id}`, libraryKeys: [id] });
const success = (reply) => {
  assert.equal(reply.ok, true, reply.error);
  assert.equal(reply.stale, false);
  return reply.value;
};

test('the DOM owner retains a real book authority beyond its bridge reply and retires it only on replacement or allowed close', async (t) => {
  const f = await runtimeOwner(t);
  assert.deepEqual(success(await f.command('open', openPayload(1))), { bookId: 1 });
  const first = f.sessions.at(-1),
    operation = f.operations.at(-1);
  assert.equal(f.book, '1');
  assert.equal(operation.stopped, 0);
  assert.equal(first.bookAuthority.signal.aborted, false);
  assert.doesNotThrow(first.bookAuthority.assertCurrent);
  f.books[0].title = 'Later storage mutation';
  assert.equal(
    first.expectedBook.title,
    'Book 1',
    'the reader receives the admitted immutable identity snapshot'
  );
  success(await f.command('snapshot'));
  success(await f.command('route', { path: '/b' }));
  assert.equal(
    first.bookAuthority.signal.aborted,
    false,
    'ordinary bridge completions do not retire the reader'
  );

  success(await f.command('open', openPayload(1)));
  const second = f.sessions.at(-1);
  assert.notEqual(
    second,
    first,
    'same book ID with fresh authority remounts the actual ReaderScreen wrapper'
  );
  assert.equal(operation.stopped, 1);
  assert.equal(first.bookAuthority.signal.aborted, true);
  assert.throws(first.bookAuthority.assertCurrent);
  assert.doesNotThrow(second.bookAuthority.assertCurrent);
  f.confirmClose = async () => false;
  assert.deepEqual(success(await f.command('close')), { allowed: false, destination: '/manage' });
  assert.equal(f.book, '1');
  assert.equal(second.bookAuthority.signal.aborted, false);
  f.confirmClose = async () => true;
  assert.deepEqual(success(await f.command('close')), { allowed: true, destination: '/manage' });
  assert.equal(f.book, undefined);
  assert.equal(second.bookAuthority.signal.aborted, true);
  assert.equal(f.operations.filter((entry) => !entry.stopped).length, 0);
});

test('a delayed older book open cannot replace the newer DOM reader', async (t) => {
  const f = await runtimeOwner(t),
    gate = deferred();
  f.admit = async ({ keys }) => {
    if (keys[0] === 1) await gate.promise;
  };
  const older = await f.start('open', openPayload(1));
  const abandoned = f.operations.at(-1);
  assert.equal(f.book, undefined);
  success(await f.command('open', openPayload(2)));
  const current = f.sessions.at(-1);
  await f.settle(() => gate.resolve());
  const reply = await f.finish(older);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /newer reader navigation/);
  assert.equal(f.book, '2');
  assert.equal(abandoned.stopped, 1);
  assert.doesNotThrow(current.bookAuthority.assertCurrent);
});

test('close fences pending opens even before there is a mounted reader', async (t) => {
  const f = await runtimeOwner(t),
    gate = deferred();
  f.admit = async () => gate.promise;
  const opening = await f.start('open', openPayload(1));
  assert.deepEqual(success(await f.command('close')), { allowed: true, destination: '/manage' });
  await f.settle(() => gate.resolve());
  assert.match((await f.finish(opening)).error, /newer reader navigation/);
  assert.equal(f.book, undefined);
  assert.equal(f.sessions.length, 0);
  assert.ok(f.operations.every((entry) => entry.stopped === 1));
});

test('an old asynchronous close confirmation cannot retire a replacement reader', async (t) => {
  const f = await runtimeOwner(t),
    confirmation = deferred();
  success(await f.command('open', { bookId: 1 }));
  const first = f.sessions.at(-1);
  f.confirmClose = () => confirmation.promise;
  const closing = await f.start('close');
  assert.equal(f.closes.length, 1);
  success(await f.command('open', { bookId: 2 }));
  const replacement = f.sessions.at(-1);
  await f.settle(() => confirmation.resolve(true));
  assert.deepEqual(success(await f.finish(closing)), { allowed: false, destination: '/manage' });
  assert.equal(f.book, '2');
  assert.equal(first.bookAuthority.signal.aborted, true);
  assert.equal(replacement.bookAuthority.signal.aborted, false);
  assert.doesNotThrow(replacement.bookAuthority.assertCurrent);
});

test('canceling close keeps the current reader but still revokes an older pending open', async (t) => {
  const f = await runtimeOwner(t),
    gate = deferred();
  success(await f.command('open', { bookId: 1 }));
  const current = f.sessions.at(-1);
  f.admit = () => gate.promise;
  const opening = await f.start('open', openPayload(2));
  f.confirmClose = async () => false;
  assert.equal(success(await f.command('close')).allowed, false);
  await f.settle(() => gate.resolve());
  assert.match((await f.finish(opening)).error, /newer reader navigation/);
  assert.equal(f.book, '1');
  assert.doesNotThrow(current.bookAuthority.assertCurrent);
});

test('account A→B→A permanently invalidates a pending open and its correlated receipt', async (t) => {
  const f = await runtimeOwner(t),
    gate = deferred();
  f.admit = () => gate.promise;
  const before = f.scope;
  const opening = await f.start('open', openPayload(1));
  const captured = f.operations.at(-1);
  await f.changeAccount('bob');
  await f.changeAccount('alice');
  assert.equal(f.scope.epoch, before.epoch + 2);
  assert.equal(captured.operation.signal.aborted, true);
  await f.settle(() => gate.resolve());
  const reply = await f.finish(opening);
  assert.equal(reply.id, opening.request.id);
  assert.equal(reply.epoch, before.epoch);
  assert.equal(reply.ok, false);
  assert.equal(reply.stale, true);
  assert.equal(reply.outcome, 'unknown');
  assert.equal(f.book, undefined);
  assert.equal(captured.stopped, 1);
  const replay = await f.command('open', openPayload(1), opening.request);
  assert.equal(replay.stale, true);
  assert.equal(replay.ok, false);
  assert.equal(f.operations.length, 1, 'an old receipt cannot replay work after account ABA');
  success(await f.command('open', { bookId: 2 }));
  assert.equal(f.book, '2');
});

for (const change of ['same-user generation', 'account ABA', 'unmount'])
  test(`${change} aborts the DOM owner's delete signal after the final request and before commit`, async (t) => {
    const f = await runtimeOwner(t),
      commit = deferred();
    let signal,
      aborted = 0,
      committed = 0;
    f.deleteData = async (ids, _names, cancellation, keep, profile, assertCurrent, identities) => {
      assert.deepEqual(ids, [1]);
      assert.equal(keep, true);
      assert.equal(profile, 'alice');
      assert.equal(identities.get(1).contentHash, '1'.repeat(64));
      signal = cancellation;
      signal.addEventListener('abort', () => aborted++, { once: true });
      // This domain boundary is the transaction's last successful request. The
      // companion native-book-access tests cover real IndexedDB rollback here.
      await commit.promise;
      signal.throwIfAborted();
      assertCurrent();
      committed++;
      return { error: '', deleted: [1] };
    };
    const deleting = await f.start('delete', {
      ids: [1],
      keepStatistics: true,
      libraryToken: 'selection',
      libraryKeys: [1]
    });
    assert.ok(signal);
    assert.equal(signal.aborted, false);
    const originalOperation = f.operations[0];
    if (change === 'same-user generation') {
      await f.refreshGeneration();
      assert.equal(
        originalOperation.operation.signal.aborted,
        false,
        'local profile scope alone cannot revoke a same-user auth generation'
      );
    } else if (change === 'account ABA') {
      await f.changeAccount('bob');
      await f.changeAccount('alice');
    } else await f.unmount();
    assert.equal(
      signal.aborted,
      true,
      'the component must deliver cancellation before storage can commit'
    );
    assert.equal(aborted, 1);
    await f.settle(() => commit.resolve());
    const reply = await f.finish(deleting);
    assert.equal(committed, 0);
    assert.equal(reply.ok, false);
    assert.equal(reply.stale, true);
    assert.equal(reply.outcome, 'unknown');
    assert.equal(originalOperation.stopped, 1);
  });

test('same-user authentication generation retires an already-open reader while a fresh owner remains usable', async (t) => {
  const f = await runtimeOwner(t);
  success(await f.command('open', { bookId: 1 }));
  const first = f.sessions.at(-1),
    retained = f.operations.at(-1),
    epoch = f.scope.epoch;
  await f.refreshGeneration();
  assert.equal(f.scope.epoch, epoch + 1);
  assert.equal(f.book, undefined);
  assert.equal(first.bookAuthority.signal.aborted, true);
  assert.throws(first.bookAuthority.assertCurrent);
  assert.equal(retained.stopped, 1);
  success(await f.command('open', { bookId: 1 }));
  assert.doesNotThrow(f.sessions.at(-1).bookAuthority.assertCurrent);
});

test('execute/onReply preserves asynchronous correlation, request deduplication and conflicting-ID rejection', async (t) => {
  const f = await runtimeOwner(t),
    slow = deferred();
  let mutations = 0;
  f.libraryAction = async ({ value }) => {
    mutations++;
    if (value === 'slow') await slow.promise;
    return { value };
  };
  const first = await f.start('library.action', { value: 'slow' });
  assert.equal(f.replies.length, 0);
  const duplicate = await f.start('library.action', { value: 'slow' }, { id: first.request.id });
  const second = await f.command('library.action', { value: 'fast' });
  assert.deepEqual(success(second), { value: 'fast' });
  assert.equal(f.replies[0].id, second.id);
  assert.equal(mutations, 2, 'in-flight duplicate shares a single admitted operation');
  await f.settle(() => slow.resolve());
  assert.deepEqual(success(await f.finish(first)), { value: 'slow' });
  assert.deepEqual(await f.finish(duplicate), await first.reply);
  const replay = await f.command('library.action', { value: 'slow' }, { id: first.request.id });
  assert.deepEqual(success(replay), { value: 'slow' });
  assert.equal(mutations, 2);
  const conflict = await f.command(
    'library.action',
    { value: 'different' },
    { id: first.request.id }
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.outcome, 'not-started');
  assert.match(conflict.error, /identity was reused/);
  assert.equal(mutations, 2);
  assert.ok(f.operations.every((entry) => entry.stopped === 1));
});

test('onReply acknowledgement precedes the follow-up snapshot and does not release book ownership', async (t) => {
  const f = await runtimeOwner(t),
    received = deferred();
  f.replyBarrier = () => received.promise;
  const before = f.snapshots.length;
  success(await f.command('open', { bookId: 1 }));
  const owned = f.sessions.at(-1);
  assert.equal(f.snapshots.length, before);
  assert.equal(owned.bookAuthority.signal.aborted, false);
  await f.settle(() => received.resolve());
  assert.equal(f.snapshots.length, before + 1);
  assert.equal(owned.bookAuthority.signal.aborted, false);
});

test('native route commands synchronize the virtual DOM page without replacing the bundled URL or reader /b identity', async (t) => {
  const f = await runtimeOwner(t),
    realURL = f.dom.window.location.href;
  success(await f.command('route', { path: '/reader-web/snippets?query=book#saved' }));
  assert.equal(f.pages.at(-1).url.pathname, '/reader-web/snippets');
  assert.equal(f.pages.at(-1).url.search, '?query=book');
  success(await f.command('open', { bookId: 2 }));
  const readerPage = f.pages.at(-1);
  assert.equal(readerPage.url.pathname, '/reader-web/b');
  assert.equal(readerPage.url.searchParams.get('id'), '2');
  success(await f.command('route', { path: '/b' }));
  assert.equal(
    f.pages.at(-1),
    readerPage,
    'the shell /b notification must not discard the active book ID'
  );
  const rejected = await f.command('route', { path: 'https://attacker.invalid/settings' });
  assert.equal(rejected.ok, false);
  assert.equal(f.pages.at(-1), readerPage);
  assert.equal(f.dom.window.location.href, realURL);
});

for (const path of ['service read', 'deep-link open'])
  test(`snippet ${path} renders the scoped document snapshot and close waits for its position flush`, async (t) => {
    const f = await runtimeOwner(t),
      flush = deferred();
    const saved = f.addSnippet(),
      original = structuredClone(saved.document);
    const foreign = f.addSnippet('account:bob', 'Foreign copy');
    foreign.document.id = saved.document.id;
    f.records.set(`account:bob:${saved.document.id}`, foreign);
    if (path === 'service read') {
      const state = success(await f.command('snippets.state'));
      assert.equal(state.items.length, 1);
      assert.deepEqual(
        success(
          await f.command('snippets.action', {
            type: 'read',
            token: state.token,
            key: state.items[0].key
          })
        ),
        { readerId: saved.document.id, readerRevision: saved.document.revision }
      );
    } else success(await f.command('open', { snippetId: saved.document.id }));
    assert.equal(f.snippet, saved.document.id);
    assert.equal(f.book, undefined);
    const reader = f.snippetSessions.at(-1),
      operation = f.operations.at(-1);
    assert.equal(reader.selectedScope.owner, 'account:alice');
    assert.deepEqual(reader.document, original);
    assert.deepEqual(reader.locator, saved.progress);
    assert.notEqual(reader.document, saved.document);
    saved.document.title.text = 'Changed in storage';
    assert.deepEqual(
      reader.document,
      original,
      'an open reader owns its selected revision, not a live mutable record'
    );
    assert.equal(operation.stopped, 0);
    assert.doesNotThrow(reader.selectedScope.guard);
    f.flushSnippet = () => flush.promise;
    const closing = await f.start('close');
    assert.equal(f.snippet, saved.document.id);
    assert.equal(f.flushes.length, 0);
    await f.settle(() => flush.resolve());
    assert.deepEqual(success(await f.finish(closing)), { allowed: true, destination: '/snippets' });
    assert.deepEqual(f.flushes, [
      { owner: 'account:alice', id: original.id, revision: original.revision }
    ]);
    assert.equal(f.snippet, undefined);
    assert.equal(operation.stopped, 1);
    assert.throws(reader.selectedScope.guard);
  });

test('failed snippet flush cancels close and preserves the active reader for a retry', async (t) => {
  const f = await runtimeOwner(t),
    record = f.addSnippet();
  success(await f.command('open', { snippetId: record.document.id }));
  f.flushSnippet = async () => {
    throw new Error('Position store is temporarily unavailable');
  };
  assert.deepEqual(success(await f.command('close')), { allowed: false, destination: '/snippets' });
  assert.equal(f.snippet, record.document.id);
  assert.match(
    f.dom.window.document.querySelector('[role="alert"]').textContent,
    /temporarily unavailable/
  );
  assert.doesNotThrow(f.snippetSessions.at(-1).selectedScope.guard);
  f.flushSnippet = undefined;
  assert.equal(success(await f.command('close')).allowed, true);
  assert.equal(f.snippet, undefined);
});

for (const path of ['service read', 'deep-link open'])
  test(`delayed snippet ${path} cannot replace a newer book open`, async (t) => {
    const f = await runtimeOwner(t),
      gate = deferred(),
      record = f.addSnippet();
    f.readSnippet = () => gate.promise;
    let pending;
    if (path === 'service read') {
      const state = success(await f.command('snippets.state'));
      pending = await f.start('snippets.action', {
        type: 'read',
        token: state.token,
        key: state.items[0].key
      });
    } else pending = await f.start('open', { snippetId: record.document.id });
    success(await f.command('open', { bookId: 2 }));
    await f.settle(() => gate.resolve());
    const rejected = await f.finish(pending);
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /newer reader navigation/);
    assert.equal(f.book, '2');
    assert.equal(f.snippet, undefined);
    assert.doesNotThrow(f.sessions.at(-1).bookAuthority.assertCurrent);
  });

test('native snippet service receipt is revision-fenced again at the final DOM document read', async (t) => {
  const f = await runtimeOwner(t),
    record = f.addSnippet();
  const state = success(await f.command('snippets.state'));
  f.readSnippet = () => {
    record.document.revision = crypto.randomUUID();
  };
  const rejected = await f.command('snippets.action', {
    type: 'read',
    token: state.token,
    key: state.items[0].key
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /snippet changed/);
  assert.equal(f.snippet, undefined);
  assert.equal(f.snippetSessions.length, 0);
  assert.ok(f.operations.every((entry) => entry.stopped === 1));
});

test('deep links reject foreign, trashed and malformed snippet identities without mounting a reader', async (t) => {
  const f = await runtimeOwner(t),
    foreign = f.addSnippet('account:bob'),
    trashed = f.addSnippet();
  trashed.document.trashedAt = Date.now();
  for (const payload of [
    { snippetId: foreign.document.id },
    { snippetId: trashed.document.id },
    { snippetId: 'not-a-uuid' },
    { snippetId: trashed.document.id, bookId: 1 }
  ]) {
    const rejected = await f.command('open', payload);
    assert.equal(rejected.ok, false);
    assert.equal(f.snippet, undefined);
  }
  assert.equal(f.snippetSessions.length, 0);
  assert.ok(f.operations.every((entry) => entry.stopped === 1));
});

test('real StrictMode effect teardown/replay keeps one active owner and final unmount removes subscriptions and authority', async (t) => {
  const f = await runtimeOwner(t, { strict: true });
  assert.equal(f.routers.size, 1);
  assert.equal(f.changed.listeners.size, 1);
  assert.equal(f.bookmarks.listeners.size, 1);
  assert.equal(f.account.listeners.size, f.baseline.account + 1);
  assert.equal(f.localUser.listeners.size, f.baseline.user + 1);
  assert.equal(
    f.library.disposed,
    0,
    'the replayed owner must not be disposed by the queued cleanup'
  );
  success(await f.command('open', { bookId: 1 }));
  const reader = f.sessions.at(-1),
    operation = f.operations.at(-1),
    handle = f.ref.current;
  assert.equal(
    f.localUser.listeners.size,
    f.baseline.user + 2,
    'one runtime listener plus one retained real operation'
  );
  assert.doesNotThrow(reader.bookAuthority.assertCurrent);
  await f.unmount();
  assert.equal(f.routers.size, 0);
  assert.equal(f.changed.listeners.size, 0);
  assert.equal(f.bookmarks.listeners.size, 0);
  assert.equal(f.account.listeners.size, f.baseline.account);
  assert.equal(f.localUser.listeners.size, f.baseline.user);
  assert.equal(reader.bookAuthority.signal.aborted, true);
  assert.equal(operation.stopped, 1);
  assert.equal(f.library.disposed, 1);
  assert.equal(f.ref.current, null);
  const count = f.snapshots.length;
  await f.settle(() => {
    f.changed.next();
    f.bookmarks.next();
  });
  assert.equal(f.snapshots.length, count);
  await f.settle(() =>
    handle.execute({
      version: 1,
      ...f.scope,
      id: 'after_unmount',
      method: 'open',
      payload: { bookId: 2 }
    })
  );
  assert.equal(f.replies.at(-1).outcome, 'not-started');
  assert.equal(
    f.operations.length,
    1,
    'a retained imperative handle cannot admit work after unmount'
  );
});

test('late observer and command snapshots never publish after final DOM teardown', async (t) => {
  const f = await runtimeOwner(t),
    gate = deferred();
  f.replyBarrier = async () => {
    f.readSummaries = () => gate.promise;
  };
  success(await f.command('open', { bookId: 1 }));
  const delivered = f.snapshots.length;
  await f.settle(() => f.changed.next());
  await f.unmount();
  await f.settle(() => gate.resolve());
  assert.equal(f.snapshots.length, delivered, 'both emission paths must suppress late snapshots');
});

test('DOM router cancellation and a stale pending router close cannot navigate away from a newer book', async (t) => {
  const f = await runtimeOwner(t),
    gate = deferred();
  success(await f.command('open', { bookId: 1 }));
  const router = [...f.routers][0];
  f.confirmClose = async () => false;
  await f.settle(() => router.push('/reader-web/settings'));
  assert.deepEqual(f.navigations, []);
  assert.equal(f.book, '1');
  f.confirmClose = () => gate.promise;
  await f.settle(() => router.replace('/reader-web/statistics'));
  success(await f.command('open', { bookId: 2 }));
  await f.settle(() => gate.resolve(true));
  assert.deepEqual(f.navigations, []);
  assert.equal(f.book, '2');
  f.confirmClose = async () => true;
  await f.settle(() => router.push('/reader-web/settings'));
  assert.deepEqual(f.navigations, ['/settings']);
  assert.equal(f.book, undefined);
});

test('a newer snippet open fences an older book open and retains only the snippet operation', async (t) => {
  const f = await runtimeOwner(t),
    record = f.addSnippet(),
    gate = deferred();
  f.admit = () => gate.promise;
  const opening = await f.start('open', openPayload(1));
  const abandoned = f.operations.at(-1);
  success(await f.command('open', { snippetId: record.document.id }));
  const current = f.snippetSessions.at(-1);
  await f.settle(() => gate.resolve());
  assert.match((await f.finish(opening)).error, /newer reader navigation/);
  assert.equal(f.book, undefined);
  assert.equal(f.snippet, record.document.id);
  assert.equal(abandoned.stopped, 1);
  assert.doesNotThrow(current.selectedScope.guard);
  assert.equal(f.operations.filter((entry) => !entry.stopped).length, 1);
});

test('a pending snippet close cannot retire a replacement book when the position flush returns', async (t) => {
  const f = await runtimeOwner(t),
    record = f.addSnippet(),
    gate = deferred();
  success(await f.command('open', { snippetId: record.document.id }));
  const old = f.snippetSessions.at(-1);
  f.flushSnippet = () => gate.promise;
  const closing = await f.start('close');
  success(await f.command('open', { bookId: 2 }));
  await f.settle(() => gate.resolve());
  assert.deepEqual(success(await f.finish(closing)), { allowed: false, destination: '/snippets' });
  assert.equal(f.book, '2');
  assert.equal(f.snippet, undefined);
  assert.equal(f.flushes.length, 0);
  assert.throws(old.selectedScope.guard);
  assert.doesNotThrow(f.sessions.at(-1).bookAuthority.assertCurrent);
});

test('account ABA revokes the retained snippet read scope even after the original account returns', async (t) => {
  const f = await runtimeOwner(t),
    record = f.addSnippet();
  success(await f.command('open', { snippetId: record.document.id }));
  const old = f.snippetSessions.at(-1),
    operation = f.operations.at(-1);
  await f.changeAccount('bob');
  await f.changeAccount('alice');
  assert.equal(f.snippet, undefined);
  assert.throws(old.selectedScope.guard);
  assert.equal(operation.stopped, 1);
  success(await f.command('open', { snippetId: record.document.id }));
  const current = f.snippetSessions.at(-1);
  assert.notEqual(current, old);
  assert.doesNotThrow(current.selectedScope.guard);
});

test('native passage admission keeps the canonical locator in DOM and survives Library search cleanup', async (t) => {
  const f = await runtimeOwner(t);
  const locator = {
    version: 1,
    bookKey: `content:${'1'.repeat(64)}`,
    marker: 'DOM-only original match'
  };
  let current = true;
  f.contentAdmit = async (payload, authority) => {
    assert.deepEqual(payload, { token: 'search-1', hit: 'hit-1' });
    authority.assertCurrent();
    return {
      identity: {
        bookId: 1,
        contentHash: '1'.repeat(64),
        readerBookKey: locator.bookKey,
        title: 'Book 1',
        lastBookModified: 10
      },
      locator,
      assertCurrent() {
        assert.ok(current);
      }
    };
  };
  assert.deepEqual(
    success(
      await f.command('open', {
        bookId: 1,
        librarySearchToken: 'search-1',
        librarySearchHit: 'hit-1'
      })
    ),
    { bookId: 1 }
  );
  const session = f.sessions.at(-1),
    url = f.pages.at(-1).url;
  assert.equal(session.expectedBook.readerBookKey, locator.bookKey);
  assert.equal(url.pathname, '/reader-web/b');
  const token = url.searchParams.get('library-search');
  assert.ok(token);
  assert.ok(!url.href.includes(locator.marker));
  assert.deepEqual(f.libraryLocation.takeLibraryLocation(1, 'alice', token), locator);
  assert.equal(f.libraryLocation.takeLibraryLocation(1, 'alice', token), undefined);
  current = false; // Leaving the native Library retires only its search, not the admitted book.
  assert.doesNotThrow(session.bookAuthority.assertCurrent);
  assert.equal(session.bookAuthority.signal.aborted, false);
});

test('a replaced passage admission is rejected before any reader or locator is mounted', async (t) => {
  const f = await runtimeOwner(t);
  f.contentAdmit = async () => ({
    identity: { bookId: 1, contentHash: '1'.repeat(64), title: 'Book 1', lastBookModified: 10 },
    locator: {},
    assertCurrent() {
      throw new Error('Passage search cancelled');
    }
  });
  const reply = await f.command('open', {
    bookId: 1,
    librarySearchToken: 'search-1',
    librarySearchHit: 'hit-1'
  });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /cancelled/);
  assert.equal(f.book, undefined);
  assert.equal(f.operations.filter((entry) => !entry.stopped).length, 0);
});

test('native passage commands share reader account authority and retire on generation changes', async (t) => {
  const f = await runtimeOwner(t);
  const calls = [];
  for (const method of ['Start', 'Read', 'Cancel'])
    f[`content${method}`] = (payload, authority) => {
      calls.push({ payload, authority });
      return { result: method };
    };
  for (const method of ['start', 'read', 'cancel'])
    success(await f.command(`library.content.${method}`, { token: 'search-1' }));
  assert.equal(calls.length, 3);
  for (const call of calls) assert.doesNotThrow(call.authority.assertCurrent);
  const disposed = f.contentSearch.disposed;
  await f.refreshGeneration();
  assert.equal(f.contentSearch.disposed, disposed + 1);
  for (const call of calls) {
    assert.equal(call.authority.signal.aborted, true);
    assert.throws(call.authority.assertCurrent);
  }
});

test('native cover reads and cancellation use the trusted runtime authority without exposing it as payload', async (t) => {
  const f = await runtimeOwner(t),
    calls = [];
  f.coverRead = (payload, authority) => {
    calls.push({ payload, authority });
    return { data: 'data:image/webp;base64,YQ==' };
  };
  f.coverCancel = (payload, authority) => {
    calls.push({ payload, authority });
    return { cancelled: true };
  };
  success(
    await f.command('library.cover.read', { token: 'view-1', key: 'book-1', request: 'cover-1' })
  );
  success(await f.command('library.cover.cancel', { token: 'view-1', requests: ['cover-1'] }));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authority.key, `${f.scope.session}:${f.scope.epoch}`);
  assert.equal('authority' in calls[0].payload, false);
  await f.refreshGeneration();
  for (const call of calls) {
    assert.equal(call.authority.signal.aborted, true);
    assert.throws(call.authority.assertCurrent);
  }
});

async function catalogSelection(f) {
  const loading = success(await f.command('library.catalog.start'));
  assert.equal(loading.status, 'loading');
  const state = success(await f.command('library.catalog.read', { token: loading.token }));
  assert.equal(state.status, 'ready');
  assert.equal(state.items.length, 1);
  return { state, payload: { token: state.token, key: state.items[0].key } };
}

test('actual DOM catalog dispatch exposes bounded native metadata and retains canonical reader ownership after Open', async (t) => {
  const f = await runtimeOwner(t),
    { state, payload } = await catalogSelection(f);
  assert.deepEqual(Object.keys(state.items[0]).sort(), ['author', 'key', 'summary', 'title']);
  assert.equal(state.items[0].summary, 'Plain public summary');
  assert.notEqual(state.items[0].key, f.catalogPicks[0].id);
  assert.doesNotMatch(JSON.stringify(state), /https:|bookUrl|coverUrl|<p>/);
  assert.equal(f.catalogLoads[0].authority.key, `${f.scope.session}:${f.scope.epoch}`);
  assert.deepEqual(success(await f.command('library.catalog.open', payload)), { bookId: 1 });
  assert.equal(f.catalogPreparations.length, 1);
  assert.equal(f.book, '1');
  const reader = f.sessions.at(-1),
    retained = f.operations.at(-1);
  assert.deepEqual(reader.expectedBook, {
    bookId: 1,
    readerBookKey: `content:${'1'.repeat(64)}`,
    contentHash: '1'.repeat(64),
    title: 'Book 1',
    lastBookModified: 10
  });
  assert.equal(retained.stopped, 0);
  assert.doesNotThrow(reader.bookAuthority.assertCurrent);
  success(await f.command('library.catalog.cancel', { token: state.token }));
  assert.equal(f.catalogPreparations[0].authority.signal.aborted, true);
  assert.equal(
    reader.bookAuthority.signal.aborted,
    false,
    'catalog cleanup does not revoke the handed-off reader'
  );
  success(await f.command('snapshot'));
  assert.doesNotThrow(reader.bookAuthority.assertCurrent);
  success(await f.command('close', { catalogToken: state.token }));
  assert.equal(f.book, undefined);
  assert.equal(reader.bookAuthority.signal.aborted, true);
  assert.equal(retained.stopped, 1);
});

test('actual DOM catalog start/read/cancel rejects late feed results and delayed old cleanup leaves a replacement catalog usable', async (t) => {
  const f = await runtimeOwner(t),
    gate = deferred();
  f.catalogLoad = () => gate.promise;
  const old = success(await f.command('library.catalog.start'));
  const owned = f.catalogLoads[0].authority;
  assert.equal(
    success(await f.command('library.catalog.read', { token: old.token })).status,
    'loading'
  );
  success(await f.command('library.catalog.cancel', { token: old.token }));
  assert.equal(owned.signal.aborted, true);
  f.catalogLoad = undefined;
  const next = await catalogSelection(f);
  success(await f.command('library.catalog.cancel', { token: old.token }));
  await f.settle(() => gate.resolve(f.catalogPicks));
  assert.equal((await f.command('library.catalog.read', { token: old.token })).ok, false);
  assert.equal(
    success(await f.command('library.catalog.read', { token: next.state.token })).status,
    'ready'
  );
  success(await f.command('library.catalog.open', next.payload));
  assert.equal(f.book, '1');
});

test('actual DOM catalog Open receipts coalesce duplicate requests and reject concurrent activation before another import', async (t) => {
  const f = await runtimeOwner(t),
    { payload } = await catalogSelection(f),
    gate = deferred();
  f.catalogPrepare = async () => {
    await gate.promise;
  };
  const first = await f.start('library.catalog.open', payload);
  const duplicate = await f.start('library.catalog.open', payload, first.request);
  const conflicting = await f.command('library.catalog.open', payload);
  assert.equal(conflicting.ok, false);
  assert.match(conflicting.error, /Another file import/);
  assert.equal(f.catalogPreparations.length, 1);
  await f.settle(() => gate.resolve());
  assert.deepEqual(success(await f.finish(first)), { bookId: 1 });
  assert.deepEqual(success(await f.finish(duplicate)), { bookId: 1 });
  assert.equal(f.sessions.length, 1);
  assert.equal(f.operations.filter((entry) => !entry.stopped).length, 1);
});

for (const cancel of ['catalog cancel', 'native close'])
  test(`actual DOM ${cancel} aborts pending catalog import and fences its late reader admission`, async (t) => {
    const f = await runtimeOwner(t),
      { state, payload } = await catalogSelection(f),
      gate = deferred();
    f.catalogPrepare = async () => {
      await gate.promise;
    };
    const opening = await f.start('library.catalog.open', payload);
    const captured = f.catalogPreparations[0].authority;
    if (cancel === 'catalog cancel')
      success(await f.command('library.catalog.cancel', { token: state.token }));
    else
      assert.equal(success(await f.command('close', { catalogToken: state.token })).allowed, true);
    assert.equal(captured.signal.aborted, true);
    const replacement = await catalogSelection(f);
    assert.match(
      (await f.command('library.catalog.open', replacement.payload)).error,
      /Another file import/
    );
    await f.settle(() => gate.resolve());
    const failed = await f.finish(opening);
    assert.equal(failed.ok, false);
    assert.equal(failed.outcome, 'unknown');
    assert.equal(failed.stale, false);
    assert.equal(f.book, undefined);
    assert.equal(f.sessions.length, 0);
    f.catalogPrepare = undefined;
    success(await f.command('library.catalog.open', replacement.payload));
    assert.equal(f.book, '1');
  });

for (const change of ['same-user generation', 'account ABA', 'unmount'])
  test(`actual DOM ${change} revokes a pending catalog operation and preserves its unknown stale receipt`, async (t) => {
    const f = await runtimeOwner(t),
      { payload } = await catalogSelection(f),
      gate = deferred();
    f.catalogPrepare = async () => {
      await gate.promise;
    };
    const opening = await f.start('library.catalog.open', payload);
    const operation = f.operations.at(-1),
      captured = f.catalogPreparations[0].authority;
    if (change === 'same-user generation') await f.refreshGeneration();
    else if (change === 'account ABA') {
      await f.changeAccount('bob');
      await f.changeAccount('alice');
    } else await f.unmount();
    assert.equal(captured.signal.aborted, true);
    assert.throws(captured.assertCurrent);
    await f.settle(() => gate.resolve());
    const reply = await f.finish(opening);
    assert.equal(reply.id, opening.request.id);
    assert.equal(reply.ok, false);
    assert.equal(reply.outcome, 'unknown');
    assert.equal(reply.stale, true);
    assert.equal(f.book, undefined);
    assert.equal(operation.stopped, 1);
    if (change !== 'unmount') {
      const replay = await f.command('library.catalog.open', payload, opening.request);
      assert.equal(replay.stale, true);
      assert.equal(replay.outcome, 'unknown');
      assert.equal(f.catalogPreparations.length, 1);
      f.catalogPrepare = undefined;
      const next = await catalogSelection(f);
      success(await f.command('library.catalog.open', next.payload));
      assert.doesNotThrow(f.sessions.at(-1).bookAuthority.assertCurrent);
    }
  });

test('actual DOM catalog unknown outcome may leave a saved copy but cannot mount a reader or replay its import', async (t) => {
  const f = await runtimeOwner(t),
    { payload } = await catalogSelection(f);
  const saved = {
    id: 3,
    title: 'Committed catalog copy',
    contentHash: '3'.repeat(64),
    lastBookModified: 12,
    characters: 100
  };
  f.catalogPrepare = async () => {
    f.books.push(saved);
    throw new Error('Canonical storage result lost after commit');
  };
  const opening = await f.start('library.catalog.open', payload),
    reply = await f.finish(opening);
  assert.equal(reply.ok, false);
  assert.equal(reply.outcome, 'unknown');
  assert.equal(reply.stale, false);
  assert.equal(f.book, undefined);
  assert.match(reply.error, /copy may already be saved/);
  const snapshot = success(await f.command('snapshot'));
  assert.equal(snapshot.books.find((book) => book.id === 3).title, saved.title);
  const repeated = await f.command('library.catalog.open', payload, opening.request);
  assert.equal(repeated.outcome, 'unknown');
  assert.equal(f.catalogPreparations.length, 1);
  assert.equal(f.books.filter((book) => book.id === 3).length, 1);
  f.catalogPrepare = async () => ({
    bookId: saved.id,
    contentHash: saved.contentHash,
    readerBookKey: `content:${saved.contentHash}`,
    title: saved.title,
    lastBookModified: saved.lastBookModified
  });
  const next = await catalogSelection(f);
  success(await f.command('library.catalog.open', next.payload));
  assert.equal(f.book, '3');
  assert.equal(f.sessions.at(-1).expectedBook.readerBookKey, `content:${saved.contentHash}`);
});

test('completed catalog Open receipt becomes stale after account ABA without restoring its old reader or reimporting', async (t) => {
  const f = await runtimeOwner(t),
    { payload } = await catalogSelection(f);
  const opening = await f.start('library.catalog.open', payload);
  success(await f.finish(opening));
  const old = f.sessions.at(-1),
    retained = f.operations.at(-1);
  await f.changeAccount('bob');
  await f.changeAccount('alice');
  assert.equal(f.book, undefined);
  assert.equal(old.bookAuthority.signal.aborted, true);
  assert.equal(retained.stopped, 1);
  const replay = await f.command('library.catalog.open', payload, opening.request);
  assert.equal(replay.ok, true);
  assert.equal(replay.outcome, 'completed');
  assert.equal(replay.stale, true);
  assert.equal(f.book, undefined);
  assert.equal(f.catalogPreparations.length, 1);
  const stale = await f.command(
    'library.catalog.start',
    {},
    { session: opening.request.session, epoch: opening.request.epoch }
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.outcome, 'not-started');
  assert.equal(f.catalogLoads.length, 1);
});

test('a newer ordinary book admission fences a late catalog import without releasing the replacement reader', async (t) => {
  const f = await runtimeOwner(t),
    { payload } = await catalogSelection(f),
    gate = deferred();
  f.catalogPrepare = async () => {
    await gate.promise;
  };
  const opening = await f.start('library.catalog.open', payload),
    abandoned = f.operations.at(-1);
  success(await f.command('open', { bookId: 2 }));
  const replacement = f.sessions.at(-1);
  await f.settle(() => gate.resolve());
  const reply = await f.finish(opening);
  assert.equal(reply.ok, false);
  assert.equal(reply.outcome, 'unknown');
  assert.match(reply.error, /newer reader navigation/);
  assert.equal(f.book, '2');
  assert.equal(f.sessions.length, 1);
  assert.equal(abandoned.stopped, 1);
  assert.doesNotThrow(replacement.bookAuthority.assertCurrent);
  assert.equal(replacement.bookAuthority.signal.aborted, false);
  assert.equal(f.operations.filter((entry) => !entry.stopped).length, 1);
});
