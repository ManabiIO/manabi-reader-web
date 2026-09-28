import { MediaStore } from '../../.cache/media-test-build/store.js';
import { VideoWorkspace } from '../../.cache/media-test-build/workspace.js';
import { localSource, identify } from '../../.cache/media-test-build/sources.js';
import { splitTrack } from '../../.cache/media-test-build/replica.js';

const scope = 'guest';
const info = (title) => ({ version: 1, title, duration: 12, width: 320, height: 180, addedAt: 1 });
const subtitle = (text) =>
  new File([`1\n00:00:00,000 --> 00:00:01,000\n${text}\n`], 'Movie.ja.srt');
const movie = () =>
  localSource(new File(['same verified video bytes'], 'Movie.mp4', { lastModified: 1 }));
const cloud = { connectionId: '11111111-1111-4111-8111-111111111111', root: 'root', id: 'movie' };
const equal = (a, b, message) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw Error(message + ': ' + JSON.stringify({ actual: a, expected: b }));
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const timeout = async (promise) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Scenario did not reach its barrier')), 3000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};
function workspace(store, selectedScope = scope) {
  // Production import methods, with only the surrounding UI/lifetime shell replaced.
  // No monkey patch of import, identity, caption, or transaction behavior.
  return Object.assign(Object.create(VideoWorkspace.prototype), {
    store,
    options: { scope: selectedScope },
    lifetime: new AbortController(),
    closed: false,
    sources: new Map(),
    verifiedSources: new WeakMap(),
    notice() {},
    refresh: async () => {}
  });
}
async function harness(factory, run) {
  const name = 'media-import-review-' + crypto.randomUUID();
  const first = new MediaStore(factory, name),
    second = new MediaStore(factory, name);
  try {
    return await run(first, second);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}
async function keyFor(source = movie()) {
  return await identify(source, new AbortController().signal);
}
function authored(key, overrides = {}) {
  return {
    version: 1,
    id: crypto.randomUUID(),
    mediaKey: key,
    label: 'Saved captions',
    language: 'ja',
    kind: 'transcription',
    origin: 'sidecar',
    complete: true,
    forced: false,
    createdAt: 1,
    cues: [{ id: 'cue-0', start: 0, end: 1, text: '日本語の字幕です。' }],
    ...overrides
  };
}
export const cases = [
  {
    name: 'A plain-file import retains an earlier persistent local locator',
    run: (factory) =>
      harness(factory, async (store) => {
        const w = workspace(store),
          source = movie(),
          key = await keyFor(source);
        const handle = { kind: 'file', name: 'Retained.mp4', token: 'saved-handle' };
        await store.putLocal(scope, 'aliases', key, { key, name: 'Original.mp4', handle });
        await w.register(source, []);
        const saved = await store.local(scope, 'aliases', key);
        equal(saved.handle, handle, 'Plain File discarded the saved handle');
        equal(saved.key, key, 'Alias identity changed');
        return { retained: true };
      })
  },
  {
    name: 'A plain-file import retains an earlier authenticated cloud locator',
    run: (factory) =>
      harness(factory, async (store) => {
        const w = workspace(store),
          source = movie(),
          key = await keyFor(source);
        await store.putLocal(scope, 'aliases', key, { key, name: 'Cloud.mp4', cloud });
        await w.register(source, []);
        equal(
          (await store.local(scope, 'aliases', key)).cloud,
          cloud,
          'Plain File discarded the cloud locator'
        );
      })
  },
  {
    name: 'An explicitly supplied new locator replaces rather than mixes old providers',
    run: (factory) =>
      harness(factory, async (store) => {
        const w = workspace(store),
          source = movie(),
          key = await keyFor(source);
        await store.putLocal(scope, 'aliases', key, { key, name: 'Cloud.mp4', cloud });
        const handle = { kind: 'file', name: 'Movie.mp4', token: 'new-handle' };
        await w.register(source, [], handle);
        const saved = await store.local(scope, 'aliases', key);
        equal(saved.handle, handle, 'New explicit handle was ignored');
        equal(saved.cloud, undefined, 'Old cloud locator survived replacement');
      })
  },
  {
    name: 'Metadata arriving while import waits is not overwritten by filename defaults',
    run: (factory) =>
      harness(factory, async (store, other) => {
        const w = workspace(store),
          source = movie(),
          key = await keyFor(source);
        const entered = deferred(),
          release = deferred(),
          change = store.change.bind(store);
        store.change = async (...args) => {
          if (args[1] === 'video_info') {
            entered.resolve();
            await release.promise;
          }
          return change(...args);
        };
        const importing = w.register(source, []);
        try {
          await timeout(entered.promise);
          await other.accept(scope, {
            kind: 'video_info',
            entity_id: key,
            book_key: key,
            revision: 1,
            payload: info('Synced title'),
            deleted: false
          });
        } finally {
          release.resolve();
        }
        await importing;
        const saved = await store.get(scope, 'video_info', key);
        equal(saved.payload, info('Synced title'), 'Import overwrote committed remote metadata');
        equal(saved.dirty, false, 'Import turned remote metadata into an unsolicited local edit');
        equal(saved.revision, 1, 'Remote revision was lost');
      })
  },
  {
    name: 'Concurrent sidecar imports in independent stores create one caption version',
    run: (factory) =>
      harness(factory, async (store, other) => {
        const key = await keyFor(),
          text = '日本語の字幕です。';
        await Promise.all([
          workspace(store).saveSubtitle(key, 'Movie.mp4', subtitle(text)),
          workspace(other).saveSubtitle(key, 'Movie.mp4', subtitle(text))
        ]);
        const tracks = await store.tracks(scope, key);
        equal(tracks.length, 1, 'Concurrent sidecars became ambiguous duplicate tracks');
        equal(tracks[0].cues[0].text, text, 'Caption changed');
      })
  },
  {
    name: 'Concurrent embedded discovery creates one version, not duplicate tracks',
    run: (factory) =>
      harness(factory, async (store, other) => {
        const key = await keyFor(),
          track = authored(key, { origin: 'embedded' }),
          signal = new AbortController().signal;
        await Promise.all([
          workspace(store).saveEmbedded(key, [track], signal),
          workspace(other).saveEmbedded(key, [track], signal)
        ]);
        equal(
          (await store.tracks(scope, key)).length,
          1,
          'Concurrent embedded discovery duplicated captions'
        );
      })
  },
  {
    name: 'Forced sidecars and full sidecars stay distinct despite equal cue text',
    run: (factory) =>
      harness(factory, async (store) => {
        const w = workspace(store),
          key = await keyFor(),
          normal = subtitle('日本語の字幕です。');
        const forced = new File([await normal.text()], 'Movie.ja.forced.srt');
        await Promise.all([
          w.saveSubtitle(key, 'Movie.mp4', normal),
          w.saveSubtitle(key, 'Movie.mp4', forced)
        ]);
        equal(
          (await store.tracks(scope, key)).map((t) => t.forced).sort(),
          [false, true],
          'Forced/full roles were collapsed'
        );
      })
  },
  {
    name: 'Subtitle deduplication remains separated by account and origin',
    run: (factory) =>
      harness(factory, async (store, other) => {
        const key = await keyFor(),
          file = subtitle('日本語の字幕です。');
        await Promise.all([
          workspace(store).saveSubtitle(key, 'Movie.mp4', file),
          workspace(other, 'account:other').saveSubtitle(key, 'Movie.mp4', file)
        ]);
        const sidecar = (await store.tracks(scope, key))[0];
        await workspace(store).saveEmbedded(
          key,
          [{ ...sidecar, origin: 'embedded' }],
          new AbortController().signal
        );
        equal(
          (await store.tracks(scope, key)).length,
          2,
          'Embedded and sidecar identities were collapsed'
        );
        equal((await store.tracks('account:other', key)).length, 1, 'Account partition changed');
      })
  },
  {
    name: 'A matching manifest without its pages cannot swallow a usable sidecar import',
    run: (factory) =>
      harness(factory, async (store) => {
        const key = await keyFor(),
          w = workspace(store),
          file = subtitle('日本語の字幕です。');
        await w.saveSubtitle(key, 'Movie.mp4', file);
        const original = (await store.tracks(scope, key))[0],
          piece = splitTrack(original)[0];
        await store.edit(scope, 'video_chunk', piece.id, key, null);
        equal((await store.tracks(scope, key)).length, 0, 'Fixture still has a complete track');
        await w.saveSubtitle(key, 'Movie.mp4', file);
        const tracks = await store.tracks(scope, key);
        equal(tracks.length, 1, 'Incomplete manifest blocked local import');
        if (tracks[0].id === original.id) throw Error('Import resurrected the tombstoned page');
        equal(
          (await store.get(scope, 'video_chunk', piece.id)).payload,
          null,
          'Deleted page was resurrected'
        );
      })
  },
  {
    name: 'A matching manifest with damaged page content cannot swallow an import',
    run: (factory) =>
      harness(factory, async (store) => {
        const key = await keyFor(),
          w = workspace(store),
          file = subtitle('日本語の字幕です。');
        await w.saveSubtitle(key, 'Movie.mp4', file);
        const original = (await store.tracks(scope, key))[0],
          piece = splitTrack(original)[0];
        piece.payload.cues[0].text = 'Changed page bytes';
        await store.edit(scope, 'video_chunk', piece.id, key, piece.payload);
        await w.saveSubtitle(key, 'Movie.mp4', file);
        const tracks = await store.tracks(scope, key);
        equal(tracks.length, 1, 'Damaged page blocked import');
        if (tracks[0].id === original.id)
          throw Error('Import silently repaired an immutable existing version');
      })
  },
  {
    name: 'Repeated import keeps the original track and replica state byte-identical',
    run: (factory) =>
      harness(factory, async (store) => {
        const key = await keyFor(),
          w = workspace(store),
          file = subtitle('日本語の字幕です。');
        await w.saveSubtitle(key, 'Movie.mp4', file);
        const before = await store.records(scope);
        await w.saveSubtitle(key, 'Movie.mp4', file);
        equal(await store.records(scope), before, 'Deduplication changed a saved replica/version');
      })
  },
  {
    name: 'Cancel during delayed subtitle file reading cannot publish into a shared store',
    run: (factory) =>
      harness(factory, async (store) => {
        const key = await keyFor(),
          w = workspace(store),
          file = subtitle('日本語の字幕です。'),
          entered = deferred(),
          release = deferred();
        const text = await file.text();
        file.text = async () => {
          entered.resolve();
          await release.promise;
          return text;
        };
        const importing = w.saveSubtitle(key, 'Movie.mp4', file).then(
          () => ({ ok: true }),
          (reason) => ({ ok: false, reason })
        );
        await timeout(entered.promise);
        const reason = new DOMException('Workspace closed', 'AbortError');
        w.closed = true;
        w.lifetime.abort(reason);
        release.resolve();
        const result = await importing;
        if (result.ok) throw Error('Cancelled import reported publication success');
        equal(
          (await store.tracks(scope, key)).length,
          0,
          'Cancelled subtitle import published a track'
        );
      })
  },
  {
    name: 'Cancelled embedded discovery cannot begin publication after delayed admission',
    run: (factory) =>
      harness(factory, async (store) => {
        const key = await keyFor(),
          w = workspace(store),
          controller = new AbortController(),
          entered = deferred(),
          release = deferred();
        // Hold publication admission after discovery has checked its lifetime.
        // Readonly lookups are not delayed, including the preceding implementation's
        // non-atomic duplicate check. The actual transaction callbacks remain intact.
        const tx = store.tx.bind(store);
        let held = false;
        store.tx = async (...args) => {
          if (args[1] === 'readwrite' && !held) {
            held = true;
            entered.resolve();
            await release.promise;
          }
          return tx(...args);
        };
        const saving = w
          .saveEmbedded(key, [authored(key, { origin: 'embedded' })], controller.signal)
          .then(
            () => ({ ok: true }),
            (reason) => ({ ok: false, reason })
          );
        await timeout(entered.promise);
        controller.abort(0);
        release.resolve();
        await saving;
        equal((await store.tracks(scope, key)).length, 0, 'Cancelled discovery published a track');
      })
  },
  {
    name: 'Concurrent plain-file and retained-handle imports preserve the durable locator',
    run: (factory) =>
      harness(factory, async (store, other) => {
        const source = movie(),
          key = await keyFor(source),
          handle = { kind: 'file', name: 'Retained.mp4', token: 'concurrent' };
        await Promise.all([
          workspace(store).register(source, [], handle),
          workspace(other).register(movie(), [])
        ]);
        equal(
          (await store.local(scope, 'aliases', key)).handle,
          handle,
          'Transient import erased the concurrently supplied handle'
        );
      })
  },
  {
    name: 'Imported defaults preserve a deleted metadata record instead of resurrecting it',
    run: (factory) =>
      harness(factory, async (store) => {
        const source = movie(),
          key = await keyFor(source);
        await store.edit(scope, 'video_info', key, key, null);
        const before = await store.get(scope, 'video_info', key);
        await workspace(store).register(source, []);
        equal(
          await store.get(scope, 'video_info', key),
          before,
          'A deleted metadata record was changed'
        );
      })
  },
  {
    name: 'A mismatched saved alias is rejected without overwriting its evidence',
    run: (factory) =>
      harness(factory, async (store) => {
        const source = movie(),
          key = await keyFor(source),
          before = { key: 'content:' + 'a'.repeat(64), name: 'Wrong identity', cloud };
        await store.putLocal(scope, 'aliases', key, before);
        const result = await workspace(store)
          .register(source, [])
          .then(
            () => ({ ok: true }),
            (reason) => ({ ok: false, reason })
          );
        if (result.ok) throw Error('Misbound alias accepted');
        equal(
          await store.local(scope, 'aliases', key),
          before,
          'Invalid alias was silently overwritten'
        );
      })
  },
  {
    name: 'Close while alias admission waits prevents later alias and metadata writes',
    run: (factory) =>
      harness(factory, async (store) => {
        const source = movie(),
          key = await keyFor(source),
          w = workspace(store),
          entered = deferred(),
          release = deferred();
        const tx = store.tx.bind(store);
        let held = false;
        store.tx = async (...args) => {
          if (args[0] === 'local' && args[1] === 'readwrite' && !held) {
            held = true;
            entered.resolve();
            await release.promise;
          }
          return tx(...args);
        };
        const importing = w.register(source, []).then(
          () => ({ ok: true }),
          (reason) => ({ ok: false, reason })
        );
        await timeout(entered.promise);
        w.closed = true;
        w.lifetime.abort(null);
        release.resolve();
        await importing;
        equal(
          await store.local(scope, 'aliases', key),
          undefined,
          'Closed alias admission wrote a locator'
        );
        equal(await store.get(scope, 'video_info', key), undefined, 'Closed import wrote metadata');
      })
  },
  {
    name: 'One complete matching version is sufficient even when another matching version lost a page',
    run: (factory) =>
      harness(factory, async (store) => {
        const key = await keyFor(),
          w = workspace(store),
          file = subtitle('日本語の字幕です。');
        await w.saveSubtitle(key, 'Movie.mp4', file);
        const complete = (await store.tracks(scope, key))[0],
          incomplete = { ...complete, id: crypto.randomUUID() };
        await store.saveTrack(scope, incomplete);
        const missing = splitTrack(incomplete)[0];
        await store.edit(scope, 'video_chunk', missing.id, key, null);
        const before = await store.records(scope);
        await w.saveSubtitle(key, 'Movie.mp4', file);
        equal(
          await store.records(scope),
          before,
          'An incomplete candidate hid the valid matching track'
        );
      })
  }
];

// These scenarios require native handles and are deliberately not run by Node's
// transaction double. The same methods use a real OPFS FileSystemFileHandle.
export const nativeCases = [
  {
    name: 'Retained native file handle survives a plain import and database connection reopening',
    run: (factory) =>
      harness(factory, async (store, other) => {
        const root = await navigator.storage.getDirectory(),
          name = 'media-import-' + crypto.randomUUID() + '.mp4';
        try {
          const handle = await root.getFileHandle(name, { create: true });
          const writer = await handle.createWritable();
          await writer.write('same verified video bytes');
          await writer.close();
          const source = movie(),
            key = await keyFor(source);
          await workspace(store).register(localSource(await handle.getFile()), [], handle);
          await workspace(store).register(source, []);
          await store.close();
          const alias = await other.local(scope, 'aliases', key);
          if (!alias?.handle || !(await alias.handle.isSameEntry(handle)))
            throw Error('Native handle lost across reconnection');
          equal(
            await identify(localSource(await alias.handle.getFile()), new AbortController().signal),
            key,
            'Reopened handle points to different bytes'
          );
          return { nativeHandle: true, reopenedConnection: true };
        } finally {
          await root.removeEntry(name);
        }
      })
  }
];
