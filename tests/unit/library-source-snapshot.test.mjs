/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fixtureKey = 'manabi-library-source-snapshot';
const state = {
  profile: null,
  current: null,
  local: [],
  dav: [],
  cache: new Map(),
  live: [],
  requestError: null,
  requestHook: null,
  writes: []
};
globalThis[Symbol.for(fixtureKey)] = state;

const mocks = {
  '../snippets/document': `export const isSnippetFile = () => false;`,
  './source-binding': `export const boundLibrarySource = (source) => source;`,
  '$lib/manabi/client': `
    const state = globalThis[Symbol.for('manabi-library-source-snapshot')];
    export const localProfileUser = () => state.profile ? { id: state.profile } : null;
    export const currentUser = () => state.current ? { id: state.current } : null;
    export const request = async () => {
      await state.requestHook?.();
      if (state.requestError) throw state.requestError;
      return { items: state.live };
    };`,
  '$lib/manabi/persistence': `
    const state = globalThis[Symbol.for('manabi-library-source-snapshot')];
    export const integrationDB = async () => ({
      getAll: async (name) => name === 'localLibraries' ? structuredClone(state.local) : []
    });
    export const metadata = async (key) => structuredClone(state.cache.get(key));
    export const setMetadata = async (key, value) => {
      state.writes.push([key, structuredClone(value)]);
      state.cache.set(key, structuredClone(value));
    };`,
  '$lib/manabi/sources': `
    export class CloudLibrary {}
    export class LocalLibrarySource {}
    export const supportedBook = () => false;`,
  '$lib/webdav/source': `
    const state = globalThis[Symbol.for('manabi-library-source-snapshot')];
    export const davSources = async () => structuredClone(state.dav);
    export const davSource = async () => { throw new Error('unused'); };`,
  './organization': `export const sourceKey = (source) =>
    JSON.stringify([source.owner, source.id, source.root]);`,
  './series-metadata': `
    export const isSeriesMetadataFilename = () => false;
    export const seriesMetadataFilename = '.manabi-reader.yaml';`
};

const result = await build({
  stdin: {
    contents: `export { sourceSnapshot, sourceDescriptors } from './src/lib/library/catalog.ts';`,
    resolveDir: fileURLToPath(new URL('../../apps/web/', import.meta.url))
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  write: false,
  plugins: [
    {
      name: 'source-snapshot-fixture',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'fixture' } : undefined
        );
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: mocks[args.path],
          loader: 'js'
        }));
      }
    }
  ]
});
const { sourceSnapshot, sourceDescriptors } = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);

function reset() {
  state.profile = null;
  state.current = null;
  state.local = [];
  state.dav = [];
  state.cache.clear();
  state.live = [];
  state.requestError = null;
  state.requestHook = null;
  state.writes = [];
}
const local = (id = 'local-1') => ({ id, name: 'Local', handle: {}, writable: true });
const dav = (id = 'webdav-1') => ({
  id,
  name: 'DAV',
  url: 'https://dav.test/books/',
  username: '',
  writable: false
});
const cloud = (id, provider = 'dropbox', root = 'Books') => ({
  id,
  provider,
  roots: [root],
  needs_reconnect: false
});

test('no-account source snapshot is locally authoritative and unchanged for sourceDescriptors callers', async () => {
  reset();
  state.local = [local()];
  state.dav = [dav()];
  const snapshot = await sourceSnapshot();
  assert.equal(snapshot.cloudAuthoritative, true);
  assert.deepEqual(
    snapshot.sources.map((source) => source.provider),
    ['local', 'webdav']
  );
  assert.deepEqual(await sourceDescriptors(), snapshot.sources);
  assert.deepEqual(state.writes, []);
});

test('successful live cloud refresh replaces cached sources and marks absence authoritative', async () => {
  reset();
  state.profile = state.current = 'alice';
  state.cache.set('library-sources:alice', [
    {
      id: 'cached',
      owner: 'alice',
      root: 'Old',
      name: 'Old',
      provider: 'dropbox'
    }
  ]);
  state.live = [cloud('live-google', 'google', 'Drive'), cloud('live-dropbox')];
  const snapshot = await sourceSnapshot();
  assert.equal(snapshot.cloudAuthoritative, true);
  assert.deepEqual(
    snapshot.sources.map((source) => source.id),
    ['live-google', 'live-dropbox']
  );
  assert.equal(state.writes.length, 1);
  assert.deepEqual(state.cache.get('library-sources:alice'), snapshot.sources);
});

test('failed cloud refresh preserves cached sources but never treats their absence as authoritative', async () => {
  reset();
  state.profile = state.current = 'alice';
  const cached = {
    id: 'cached',
    owner: 'alice',
    root: 'Books',
    name: 'Books',
    provider: 'dropbox'
  };
  state.cache.set('library-sources:alice', [cached]);
  state.requestError = new Error('offline');
  const snapshot = await sourceSnapshot();
  assert.equal(snapshot.cloudAuthoritative, false);
  assert.deepEqual(snapshot.sources, [cached]);
  assert.deepEqual(state.writes, []);
});

test('profile/current-account mismatch can use cache for display but not disconnect evidence', async () => {
  reset();
  state.profile = 'alice';
  state.current = 'bob';
  const cached = {
    id: 'cached',
    owner: 'alice',
    root: 'Books',
    name: 'Books',
    provider: 'dropbox'
  };
  state.cache.set('library-sources:alice', [cached]);
  state.live = [cloud('must-not-request')];
  const snapshot = await sourceSnapshot();
  assert.equal(snapshot.cloudAuthoritative, false);
  assert.deepEqual(snapshot.sources, [cached]);
  assert.deepEqual(state.writes, []);
});

test('account change during live connection fetch suppresses cloud publication and authority', async () => {
  reset();
  state.profile = state.current = 'alice';
  state.local = [local()];
  state.live = [cloud('late')];
  state.requestHook = async () => {
    state.current = 'bob';
  };
  const snapshot = await sourceSnapshot();
  assert.equal(snapshot.cloudAuthoritative, false);
  assert.deepEqual(
    snapshot.sources.map((source) => source.provider),
    ['local']
  );
  assert.deepEqual(state.writes, []);
});
