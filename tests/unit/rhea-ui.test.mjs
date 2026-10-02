import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { matchesSetting } from '../../apps/web/src/lib/components/settings/settings-context.ts';
import { clickOutside } from '../../apps/web/src/lib/functions/use-click-outside.ts';
import { readerUIOwnsEvent } from '../../apps/web/src/lib/functions/reader-ui-events.ts';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('all 65 pre-modernization setting groups retain their exact value bindings', () => {
  const manifest = JSON.parse(read('tests/fixtures/settings-manifest.json'));
  const content = read('apps/web/src/settings-react/settings-content.tsx');
  assert.equal(manifest.length, 65);
  assert.equal(new Set(manifest.map((field) => field.id)).size, 65);
  for (const field of manifest) {
    assert.ok(content.includes(`settingId={"${field.id}"}`), field.id);
    if (field.binding)
      assert.ok(content.includes(`c.${field.binding}`), `${field.id} preserves its value`);
  }
  const route = read('apps/web/src/settings-react/settings-screen.tsx');
  for (const key of [
    'fontFamilyGroupOne',
    'fontFamilyGroupTwo',
    'manualBookmark',
    'statisticsEnabled',
    'readingGoalsMergeMode',
    'hideFurigana',
    'pageColumns',
    'replicationSaveBehavior'
  ])
    assert.ok(route.includes(`${key}={c.$${key}$}`) && route.includes(`c.$${key}$ = value`), key);
});

test('settings search is global, case-insensitive and requires every word', () => {
  assert.ok(
    matchesSetting(
      { category: 'appearance', query: 'auto BOOKMARK' },
      'reading',
      'Auto bookmark time seconds'
    )
  );
  assert.equal(
    matchesSetting({ category: 'appearance', query: '' }, 'reading', 'Auto bookmark'),
    false
  );
  assert.ok(matchesSetting({ category: 'all', query: '  ' }, 'reading', 'Auto bookmark'));
  assert.equal(
    matchesSetting({ category: 'all', query: 'bookmark nonexistent' }, 'reading', 'Auto bookmark'),
    false
  );
  assert.ok(matchesSetting({ category: 'all', query: '日本語' }, 'typography', '日本語 Fonts'));
});

test('every reader toolbar command retains the original event contract', () => {
  const header = read('apps/web/src/reader-react/header.tsx');
  const route = read('apps/web/src/reader-react/session.tsx');
  const commands = [
    'tocClick',
    'bookmarkClick',
    'scrollToBookmarkClick',
    'jumpClick',
    'completeBook',
    'fullscreenClick',
    'showCustomReadingPoint',
    'setCustomReadingPoint',
    'resetCustomReadingPoint',
    'statisticsClick',
    'readerImageGalleryClick',
    'settingsClick',
    'domainHintClick',
    'bookManagerClick'
  ];
  for (const command of commands) {
    assert.ok(header.includes(`dispatch('${command}'`), command);
    assert.match(route, new RegExp(`["']?${command}["']?\\s*:`), command);
  }
});

test('reader controls and overlays own keyboard and wheel events', () => {
  const oldDoc = globalThis.document,
    oldElement = globalThis.Element;
  let overlay = null;
  class Target {
    constructor(interactive) {
      this.nodeType = 1;
      this.interactive = interactive;
    }
    closest() {
      return this.interactive ? this : null;
    }
  }
  try {
    globalThis.Element = Target;
    globalThis.document = { querySelector: () => overlay };
    assert.ok(readerUIOwnsEvent({ defaultPrevented: true }));
    assert.ok(readerUIOwnsEvent({ target: new Target(true) }));
    assert.equal(readerUIOwnsEvent({ target: new Target(false) }), false);
    // Child-frame elements do not share the parent's Element constructor.
    assert.ok(readerUIOwnsEvent({ target: { nodeType: 1, closest: () => ({}) } }));
    overlay = {};
    assert.ok(readerUIOwnsEvent({ target: new Target(false) }));
  } finally {
    if (oldDoc === undefined) delete globalThis.document;
    else globalThis.document = oldDoc;
    if (oldElement === undefined) delete globalThis.Element;
    else globalThis.Element = oldElement;
  }
});

test('Rhea styling is retained by Expo React without Font Awesome or Popper imports', () => {
  const config = JSON.parse(read('apps/web/components.json'));
  assert.equal(config.style, 'rhea');
  const pkg = JSON.parse(read('apps/web/package.json'));
  assert.ok(pkg.dependencies.react);
  assert.ok(pkg.dependencies.expo);
  assert.equal(pkg.dependencies.svelte, undefined);
  for (const name of [
    '@fortawesome/free-solid-svg-icons',
    '@fortawesome/fontawesome-svg-core',
    'svelte-fa',
    '@popperjs/core'
  ])
    assert.equal(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name], undefined);
  function visit(dir) {
    for (const entry of readdirSync(new URL('../../' + dir + '/', import.meta.url), {
      withFileTypes: true
    })) {
      const path = dir + '/' + entry.name;
      if (entry.isDirectory()) visit(path);
      else if (/\.(svelte|tsx?|js)$/.test(entry.name))
        assert.doesNotMatch(read(path), /from ['"](?:svelte-fa|@fortawesome\/|@popperjs\/)/, path);
    }
  }
  visit('apps/web/src');
});

test('theme token migration does not rewrite valid EPUB CSS property names', () => {
  const sanitizer = read('apps/web/src/lib/functions/book-security/book-content-security.ts');
  assert.match(sanitizer, /'text-decoration-line'/);
  assert.doesNotMatch(sanitizer, /'text-decoration-border'/);
});

test('persisted backgrounds avoid navigation-scoped Blob URLs in WebKit', () => {
  const backgrounds = read('apps/web/src/lib/appearance/backgrounds.ts');
  assert.match(backgrounds, /dataUrl: bytesToDataUrl\(bytes, blob\.type\)/);
  assert.doesNotMatch(backgrounds, /URL\.createObjectURL/);
});

test('persisted library previews do not store WebKit-sensitive Blob wrappers', () => {
  const previews = read('apps/web/src/lib/library/previews.ts');
  assert.match(previews, /imageData: await imagePath\.arrayBuffer\(\)/);
  assert.match(previews, /new Blob\(\[saved\.imageData\]/);
  assert.doesNotMatch(previews, /tx\.store\.put\(value\)/);
});

test('outside dismissal uses original pointer ownership, never retargeted clicks', () => {
  const originalElement = globalThis.Element;
  const listeners = new Map();
  let calls = 0;
  class Target {
    constructor(kind) {
      this.kind = kind;
    }
    closest() {
      return this.kind === 'portal' ? this : null;
    }
  }
  const ownerDocument = {
    addEventListener(type, callback, capture) {
      assert.equal(capture, true);
      listeners.set(type, callback);
    },
    removeEventListener(type, callback, capture) {
      assert.equal(capture, true);
      assert.equal(listeners.get(type), callback);
      listeners.delete(type);
    }
  };
  try {
    globalThis.Element = Target;
    const node = { ownerDocument, contains: (target) => target.kind === 'trigger' };
    const stop = clickOutside(node, () => calls++);
    assert.deepEqual([...listeners.keys()], ['pointerdown']);
    const pointer = (kind, defaultPrevented = false) =>
      listeners.get('pointerdown')({
        composedPath: () => [new Target(kind), ownerDocument],
        defaultPrevented
      });
    pointer('trigger');
    pointer('portal');
    pointer('outside', true);
    assert.equal(calls, 0);
    pointer('outside');
    assert.equal(calls, 1);
    stop.destroy();
    assert.equal(listeners.size, 0);
  } finally {
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
  }
});

test('persistent storage is automatic infrastructure with status-only settings', () => {
  const content = read('apps/web/src/settings-react/settings-content.tsx');
  const route = read('apps/web/src/settings-react/settings-screen.tsx');
  const replicator = read('apps/web/src/lib/functions/replication/replicator.ts');
  assert.ok(content.includes('Protected from automatic browser eviction'));
  assert.ok(content.includes('Using best-effort browser storage'));
  assert.equal(
    content.includes('selectedOptionId={c.persistentStorage}'),
    false,
    'persistent storage must not look like an offline opt-in toggle'
  );
  assert.ok(route.includes('requestPersistentStorage={c.requestPersistentStorage}'));
  assert.equal(route.includes('setPersistentStorage$'), false);
  assert.equal(replicator.includes('requestPersistentStorage$.getValue()'), false);
});
