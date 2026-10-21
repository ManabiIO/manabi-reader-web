/** @license BSD-3-Clause */
// Real IndexedDB, production archive composition, ZIP codec and restore reader.
// This does not qualify the Android system folder chooser or native file I/O.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';

const engine = process.env.EXPORT_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engine));
// BaseStorageHandler imports only this constant from the circular application
// replicator. Keep its exact source declaration while omitting unrelated app UI.
const replicator = await readFile('apps/web/src/lib/functions/replication/replicator.ts', 'utf8');
const declaration = replicator.match(/export const exporterVersion = \d+;/)?.[0];
assert.ok(declaration);
const { outputFiles } = await build({
  stdin: {
    contents: `
    export { createNativeBookArchive } from './apps/web/src/native-library/export-dom';
    export { BackupStorageHandler } from './apps/web/src/lib/data/storage/handler/backup-handler';
    export { encodeBook } from './apps/web/src/lib/data/database/books-db/book-binary';
    export { ensureBooksSchema } from './apps/web/src/lib/data/database/books-db/schema';
    export { openDB, unwrap } from 'idb';
    export { configure } from './apps/web/node_modules/@zip.js/zip.js/index.js';
  `,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'exportFixture',
  tsconfig: 'apps/web/tsconfig.json',
  define: { 'process.env': '{}' },
  logLevel: 'silent',
  plugins: [
    {
      name: 'exporter-version-only',
      setup(b) {
        b.onResolve({ filter: /^\$lib\/functions\/replication\/replicator$/ }, () => ({
          path: 'version',
          namespace: 'version'
        }));
        b.onLoad({ filter: /.*/, namespace: 'version' }, () => ({ contents: declaration }));
      }
    }
  ]
});
const server = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><title>Native book ZIP round trip</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser, context;
try {
  browser = await { chromium, webkit }[engine].launch({
    headless: true,
    ...(engine === 'chromium' && process.platform === 'darwin'
      ? { args: ['--disable-features=MacAppCodeSignClone'] }
      : {})
  });
  context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.addScriptTag({ content: outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const {
      createNativeBookArchive,
      BackupStorageHandler,
      encodeBook,
      ensureBooksSchema,
      openDB,
      unwrap,
      configure
    } = globalThis.exportFixture;
    configure({ useWebWorkers: false });
    const db = await openDB('native-export-round-trip', 13, {
      upgrade(db, _old, _next, tx) {
        ensureBooksSchema(unwrap(db), unwrap(tx));
      }
    });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      canvas.getContext('2d').fillRect(0, 0, 2, 2);
      const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const hash = 'ab'.repeat(32),
        title = 'Native export 漢字',
        stamp = 1792444800000;
      const book = {
        id: 1,
        title,
        contentHash: hash,
        lastBookModified: stamp,
        lastBookOpen: stamp,
        characters: 2,
        elementHtml: '<p><ruby>漢<rt>かん</rt></ruby>字<img src="image.png"></p>',
        styleSheet: 'p { color: red; }',
        sections: [],
        blobs: { 'image.png': image },
        coverImage: image
      };
      await db.put('data', await encodeBook(book));
      await db.put('bookmark', {
        dataId: 1,
        exploredCharCount: 1,
        progress: 0.5,
        lastBookmarkModified: stamp,
        completion: { state: 'finished', finishedOn: '2026-10-20' }
      });
      await db.put('statistic', {
        title,
        dateKey: '2026-10-20',
        charactersRead: 2,
        readingTime: 1,
        minReadingSpeed: 120,
        altMinReadingSpeed: 120,
        lastReadingSpeed: 120,
        maxReadingSpeed: 120,
        lastStatisticModified: stamp
      });
      await db.put('audioBook', { title, playbackPosition: 12.5, lastAudioBookModified: stamp });
      await db.put('subtitle', {
        title,
        subtitleData: { name: 'book.srt', subtitles: [] },
        lastSubtitleDataModified: stamp
      });
      const identity = {
        bookId: 1,
        title,
        contentHash: hash,
        readerBookKey: `content:${hash}`,
        lastBookModified: stamp
      };
      const controller = new AbortController();
      const authority = {
        profileId: null,
        signal: controller.signal,
        assertCurrent() {
          controller.signal.throwIfAborted();
        }
      };
      const progress = [];
      const archive = await createNativeBookArchive(
        db,
        [identity],
        ['data', 'bookmark', 'statistic', 'audioBook', 'subtitle'],
        authority,
        (value) => progress.push(value)
      );
      const restore = new BackupStorageHandler(window, 'backup');
      restore.updateSettings(window, true, 'overwrite', 'merge', 'merge');
      try {
        const contexts = await restore.setBackupZip(archive.blob);
        restore.startContext(contexts[0]);
        const restored = await restore.getBook();
        const position = await restore.getProgress();
        const statistics = await restore.getStatistics();
        const audio = await restore.getAudioBook();
        const subtitle = await restore.getSubtitleData();
        const sameBytes = async (left, right) => {
          const a = new Uint8Array(await left.arrayBuffer()),
            b = new Uint8Array(await right.arrayBuffer());
          return a.length === b.length && a.every((byte, index) => byte === b[index]);
        };
        let collision = '';
        try {
          await createNativeBookArchive(db, [identity, identity], ['data'], authority, () => {});
        } catch (cause) {
          collision = cause.message;
        }
        let partial = '';
        try {
          await createNativeBookArchive(
            db,
            [identity, { ...identity, bookId: 99, title: 'Missing second book' }],
            ['data'],
            authority,
            () => {}
          );
        } catch (cause) {
          partial = cause.message;
        }
        return {
          filename: archive.filename,
          size: archive.blob.size,
          progress,
          count: contexts.length,
          title: restored.title,
          html: restored.elementHtml,
          image: await sameBytes(restored.blobs['image.png'], image),
          cover: await sameBytes(restored.coverImage, image),
          completion: position.completion,
          position: position.progress,
          statistics: statistics.statistics,
          audio: audio.playbackPosition,
          subtitle: subtitle.subtitleData.name,
          collision,
          partial
        };
      } finally {
        await restore.closeBackupZip();
      }
    } finally {
      db.close();
    }
  });
  assert.match(result.filename, /^ttu-reader-export-[\d-]+\.zip$/);
  assert.ok(result.size > 0);
  assert.deepEqual(result.progress, [1]);
  assert.equal(result.count, 1);
  assert.equal(result.title, 'Native export 漢字');
  assert.match(result.html, /<ruby>漢<rt>かん<\/rt><\/ruby>/);
  assert.equal(result.image, true);
  assert.equal(result.cover, true);
  assert.equal(result.position, 0.5);
  assert.deepEqual(result.completion, { state: 'finished', finishedOn: '2026-10-20' });
  assert.equal(result.statistics[0].charactersRead, 2);
  assert.equal('bookKey' in result.statistics[0], false);
  assert.equal(result.audio, 12.5);
  assert.equal(result.subtitle, 'book.srt');
  assert.match(result.collision, /each copy separately/);
  assert.match(result.partial, /changed/);
  console.log(JSON.stringify({ engine, ...result }));
} finally {
  try {
    await context?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}
