import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { matchesSetting } from '../../apps/web/src/lib/components/settings/settings-context.ts';
import { readerUIOwnsEvent } from '../../apps/web/src/lib/functions/reader-ui-events.ts';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('all 65 pre-modernization setting groups retain their exact value bindings', () => {
  const manifest = JSON.parse(read('tests/fixtures/settings-manifest.json'));
  const content = read('apps/web/src/lib/components/settings/settings-content.svelte');
  assert.equal(manifest.length, 65);
  assert.equal(new Set(manifest.map((field) => field.id)).size, 65);
  for (const field of manifest) {
    assert.ok(content.includes(`settingId="${field.id}"`), field.id);
    if (field.binding)
      assert.ok(content.includes(`{${field.binding}}`), `${field.id} preserves its value`);
  }
  const route = read('apps/web/src/routes/settings/+page.svelte');
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
    assert.ok(route.includes(`bind:${key}={$${key}$}`), key);
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
  const header = read('apps/web/src/lib/components/book-reader/book-reader-header.svelte');
  const route = read('apps/web/src/routes/b/+page.svelte');
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
    assert.ok(route.includes(`on:${command}=`), command);
  }
});

test('reader controls and overlays own keyboard and wheel events', () => {
  const oldDoc = globalThis.document,
    oldElement = globalThis.Element;
  let overlay = null;
  class Target {
    constructor(interactive) {
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
    overlay = {};
    assert.ok(readerUIOwnsEvent({ target: new Target(false) }));
  } finally {
    if (oldDoc === undefined) delete globalThis.document;
    else globalThis.document = oldDoc;
    if (oldElement === undefined) delete globalThis.Element;
    else globalThis.Element = oldElement;
  }
});

test('Rhea is native Svelte with Lucide and no Font Awesome or Popper imports', () => {
  const config = JSON.parse(read('apps/web/components.json'));
  assert.equal(config.style, 'rhea');
  const pkg = JSON.parse(read('apps/web/package.json'));
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
      else if (/\.(svelte|ts|js)$/.test(entry.name))
        assert.doesNotMatch(read(path), /from ['"](?:svelte-fa|@fortawesome\/|@popperjs\/)/, path);
    }
  }
  visit('apps/web/src');
});
