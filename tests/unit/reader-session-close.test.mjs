/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';

const directory = mkdtempSync(join(tmpdir(), 'reader-session-close-'));
const require = createRequire(import.meta.url);
let production;
try {
  await build({
    stdin: {
      contents: `
      export {createSession} from './apps/web/src/reader-react/session-controller';
      export {database,manualBookmark$,statisticsEnabled$,confirmClose$} from './apps/web/src/lib/data/store';
      export {dialogManager} from './apps/web/src/lib/data/dialog-manager';
      export {account} from './apps/web/src/lib/manabi/client';
      export {StorageDataType, StorageKey} from './apps/web/src/lib/data/storage/storage-types';
    `,
      resolveDir: process.cwd()
    },
    outfile: join(directory, 'session.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    conditions: ['browser'],
    tsconfig: 'apps/web/tsconfig.json',
    loader: { '.css': 'empty', '.woff2': 'file', '.woff': 'file' },
    logLevel: 'silent'
  });
  production = require(join(directory, 'session.cjs'));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
const {
  createSession,
  database,
  manualBookmark$,
  statisticsEnabled$,
  confirmClose$,
  dialogManager,
  account,
  StorageDataType,
  StorageKey
} = production;
const turn = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function user(id) {
  account.set({ status: 'ready', session: id ? { user: { id, username: id } } : null });
}
function fixture(t, options = {}) {
  user(options.user ?? null);
  manualBookmark$.next(false);
  statisticsEnabled$.next(!!options.statistics);
  confirmClose$.next(!!options.confirm);
  dialogManager.dialogs$.next([]);
  const originalFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  globalThis.requestAnimationFrame = (callback) => {
    queueMicrotask(callback);
    return 1;
  };
  const originals = { putBookmark: database.putBookmark, deleteLastItem: database.deleteLastItem };
  const writes = [];
  let deletions = 0;
  database.putBookmark = async (data) => {
    writes.push(structuredClone(data));
    await options.write?.(data);
  };
  database.deleteLastItem = async () => {
    deletions++;
  };
  const c = createSession({ routeUrl: 'https://reader.example/reader-web/b?id=7' });
  c.bookmarkManager = {
    formatBookmarkData: (id) => ({
      dataId: id,
      title: 'Close fixture',
      progress: 0.4,
      exploredCharCount: 40,
      lastBookmarkModified: Date.now()
    })
  };
  t.after(() => {
    c.controller.destroy();
    Object.assign(database, originals);
    user(null);
    dialogManager.dialogs$.next([]);
    if (originalFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', originalFrame);
    else delete globalThis.requestAnimationFrame;
  });
  return { c, writes, deletions: () => deletions };
}

test('preserve-resume suspension saves before settlement while explicit close retains resume deletion', async (t) => {
  const h = fixture(t);
  assert.equal(await h.c.requestSuspend(), true);
  assert.equal(h.deletions(), 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.c.controller.disposed, false, 'flush approval does not detach the reader');
  assert.equal(await h.c.requestClose(), true);
  assert.equal(h.deletions(), 1);
});

test('another navigation guard can resume an approved suspension without losing the live reader', async (t) => {
  const h = fixture(t);
  assert.equal(await h.c.requestSuspend(), true);
  assert.equal(h.c.blockDataUpdates, true);
  h.c.resumeAfterCanceledSuspend();
  assert.equal(h.c.blockDataUpdates, false);
  await h.c.saveBookmark();
  assert.equal(h.writes.length, 2);
  assert.equal(h.c.controller.disposed, false);
});

test('account ABA prevents an older approved suspension from resuming autosaves', async (t) => {
  const h = fixture(t);
  assert.equal(await h.c.requestSuspend(), true);
  user('bob');
  user(null);
  h.c.resumeAfterCanceledSuspend();
  assert.equal(h.c.blockDataUpdates, true);
  await h.c.saveBookmark();
  assert.equal(h.writes.length, 1);
});

test('suspension waits for an already-running bookmark write and fences later autosaves', async (t) => {
  const gate = deferred();
  let first = true;
  const h = fixture(t, {
    write: () => {
      if (first) {
        first = false;
        return gate.promise;
      }
    }
  });
  const background = h.c.saveBookmark();
  await turn();
  let ended = false;
  const closing = h.c.requestSuspend().then((value) => {
    ended = true;
    return value;
  });
  await turn();
  assert.equal(ended, false);
  assert.equal(h.writes.length, 1, 'the closing snapshot waits behind existing persistence');
  await h.c.saveBookmark();
  assert.equal(
    h.writes.length,
    1,
    'late auto-bookmark events cannot start another write during departure'
  );
  gate.resolve();
  await background;
  assert.equal(await closing, true);
  assert.equal(h.writes.length, 2, 'close persists one final trustworthy location');
});

test('a failed pending bookmark keeps the session live and a later explicit suspension can retry', async (t) => {
  const gate = deferred();
  let first = true;
  const h = fixture(t, {
    write: () => {
      if (first) {
        first = false;
        return gate.promise;
      }
    }
  });
  const background = h.c.saveBookmark();
  const observed = background.catch((error) => error);
  await turn();
  const closing = h.c.requestSuspend();
  await turn();
  gate.reject(new Error('Storage unavailable'));
  await observed;
  assert.equal(await closing, false);
  assert.equal(h.c.controller.disposed, false);
  assert.equal(h.c.blockDataUpdates, false);
  assert.equal(dialogManager.dialogs$.getValue()[0].props.message, 'Storage unavailable');
  assert.equal(await h.c.requestSuspend(), true);
  assert.equal(h.deletions(), 0);
});

test('late old-account close settlement and teardown cannot replace a newer dialog', async (t) => {
  const gate = deferred();
  const h = fixture(t, { user: 'alice', write: () => gate.promise });
  const closing = h.c.requestSuspend();
  await turn();
  user('bob');
  user('alice');
  const newer = [{ component: 'new-owner-dialog', props: { title: 'New owner' } }];
  dialogManager.dialogs$.next(newer);
  gate.resolve();
  assert.equal(await closing, false);
  assert.equal(dialogManager.dialogs$.getValue(), newer);
  h.c.controller.destroy();
  assert.equal(dialogManager.dialogs$.getValue(), newer);
});

test('destroying an older reader clears only the dialog array it actually published', async (t) => {
  const h = fixture(t);
  h.c.onDomainHintClick();
  const newer = [{ component: 'settings-dialog' }];
  dialogManager.dialogs$.next(newer);
  h.c.controller.destroy();
  assert.equal(dialogManager.dialogs$.getValue(), newer);
});

test('confirmation cancellation retains the same usable reader and coalesces repeated departure requests', async (t) => {
  const h = fixture(t, { confirm: true });
  h.c.exploredCharCount = 40;
  const closing = h.c.requestSuspend();
  assert.equal(h.c.requestSuspend(), closing);
  assert.equal(h.c.requestClose(), closing);
  await turn();
  const dialog = dialogManager.dialogs$.getValue()[0];
  assert.equal(dialog.props.dialogHeader, 'Confirm Exit');
  dialog.props.resolver(true);
  assert.equal(await closing, false);
  assert.equal(h.c.controller.disposed, false);
  assert.equal(h.c.blockDataUpdates, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.deletions(), 0);
  assert.equal(dialogManager.dialogs$.getValue().length, 0);
});

test('account revocation settles an open confirmation without clearing another owner dialog', async (t) => {
  const h = fixture(t, { user: 'alice', confirm: true });
  h.c.exploredCharCount = 40;
  const closing = h.c.requestSuspend();
  await turn();
  user('bob');
  const newer = [{ component: 'new-profile' }];
  dialogManager.dialogs$.next(newer);
  assert.equal(await closing, false);
  assert.equal(h.writes.length, 0);
  assert.equal(dialogManager.dialogs$.getValue(), newer);
});

test('suspension awaits the tracker barrier and a tracker error keeps close retryable', async (t) => {
  const gate = deferred();
  const h = fixture(t, { statistics: true });
  let flushes = 0;
  h.c.trackerElm = {
    flushUpdates: (force) => {
      assert.equal(force, true);
      flushes++;
      return flushes === 1 ? gate.promise : Promise.resolve([false, 1]);
    }
  };
  let done = false;
  const closing = h.c.requestSuspend().then((value) => {
    done = true;
    return value;
  });
  await turn();
  assert.equal(done, false);
  assert.equal(flushes, 1);
  gate.resolve([true, 1]);
  assert.equal(await closing, false);
  assert.equal(h.c.blockDataUpdates, false);
  assert.equal(h.c.controller.disposed, false);
  assert.equal(await h.c.requestSuspend(), true);
  assert.equal(h.deletions(), 0);
});

async function admittedBook(t, h) {
  const dom = new JSDOM('', { url: 'https://reader.example/reader-web/b?id=7' });
  const originals = new Map();
  for (const name of ['window', 'document']) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
  t.after(() => {
    for (const [name, value] of originals) {
      if (value) Object.defineProperty(globalThis, name, value);
      else delete globalThis[name];
    }
    dom.window.close();
  });
  const db = await database.db;
  await db.put('data', {
    id: 7,
    title: 'Close fixture',
    elementHtml: '<p>Close fixture text</p>',
    styleSheet: '',
    sections: [],
    blobs: {},
    characters: 18,
    lastBookModified: 1,
    lastBookOpen: 0,
    libraryOwner: null
  });
  await db.put('bookmark', {
    dataId: 7,
    title: 'Close fixture',
    exploredCharCount: 4,
    progress: 0.4,
    lastBookmarkModified: 1
  });
  h.c.controller.prepare();
  const deadline = Date.now() + 2000;
  while (!h.c.$rawBookData$ && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(h.c.$rawBookData$?.id, 7);
  h.c.upSyncEnabled = true;
  h.c.bookmarkManager.formatBookmarkDataByRange = h.c.bookmarkManager.formatBookmarkData;
}

test('custom reading point cannot borrow a retained book when its admitted content is absent', async (t) => {
  const h = fixture(t);
  await admittedBook(t, h);
  const previous = globalThis.document.createElement('article');
  previous.className = 'book-content';
  previous.textContent = 'A retained previous reader';
  globalThis.document.body.append(previous);
  h.c.isPaginated = true;
  h.c.bookReaderComponent = { activeContentElement: () => undefined };
  let stopped = 0;
  h.c.autoScroller = {
    off() {
      stopped++;
    }
  };
  h.c.handleSetCustomReadingPoint();
  assert.equal(stopped, 0);
  assert.equal(h.c.isSelectingCustomReadingPoint, false);
  assert.equal(globalThis.document.body.classList.contains('cursor-crosshair'), false);
});

test('close joins existing replication and an old-account error cannot replace newer UI', async (t) => {
  const h = fixture(t);
  await admittedBook(t, h);
  const gate = deferred();
  let uploading = false;
  h.c.externalStorageHandler = {
    storageType: StorageKey.GDRIVE,
    isCacheDisabled: () => false,
    startContext() {},
    updateSettings() {},
    isProgressPresentAndUpToDate: async () => false,
    saveProgress: () => {
      uploading = true;
      return gate.promise;
    }
  };
  h.c.dataToReplicate = [StorageDataType.PROGRESS];
  const background = h.c.executeReplication(false);
  const deadline = Date.now() + 2000;
  while (!uploading && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(uploading, true);
  let finished = false;
  const closing = h.c.requestSuspend().then((value) => {
    finished = true;
    return value;
  });
  await turn();
  assert.equal(finished, false, 'close cannot skip an existing replication owner');
  user('bob');
  user(null);
  const newer = [{ component: 'newer-screen-dialog' }];
  dialogManager.dialogs$.next(newer);
  gate.reject(new Error('Old upload failed'));
  await background;
  assert.equal(await closing, false);
  assert.equal(dialogManager.dialogs$.getValue(), newer);
});

test('a thrown replication preparation releases its owner so close can retry the queued progress', async (t) => {
  const h = fixture(t);
  await admittedBook(t, h);
  let throws = true;
  let uploads = 0;
  h.c.externalStorageHandler = {
    storageType: StorageKey.GDRIVE,
    isCacheDisabled: () => false,
    startContext() {},
    updateSettings() {
      if (throws) throw new Error('Storage preparation failed');
    },
    isProgressPresentAndUpToDate: async () => false,
    saveProgress: async () => {
      uploads++;
    },
    saveCover: async () => {}
  };
  h.c.dataToReplicate = [StorageDataType.PROGRESS];
  assert.equal(await h.c.requestSuspend(), false);
  assert.equal(h.c.isReplicating, false, 'the failed preparation cannot strand the upload flag');
  assert.equal(h.c.blockDataUpdates, false);
  assert.ok(h.c.dataToReplicate.includes(StorageDataType.PROGRESS));
  assert.equal(uploads, 0);
  throws = false;
  assert.equal(await h.c.requestSuspend(), true);
  assert.equal(h.c.isReplicating, false);
  assert.equal(uploads, 1);
  assert.deepEqual(h.c.dataToReplicate, []);
});
