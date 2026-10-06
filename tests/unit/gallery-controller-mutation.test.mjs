/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { firstValueFrom } from 'rxjs';
import 'fake-indexeddb/auto';

const directory = mkdtempSync(join(tmpdir(), 'gallery-controller-mutation-'));
let production;
try {
  await build({
    stdin: {
      contents: `
      export {createSession} from './apps/web/src/reader-react/session-controller';
      export {createGallery} from './apps/web/src/reader-react/gallery-controller';
      export {hideSpoilerImage$} from './apps/web/src/lib/data/store';
      export {readerImageGalleryPictures$, toggleImageGalleryPictureSpoiler$} from './apps/web/src/lib/components/book-reader/book-reader-image-gallery/book-reader-image-gallery';
    `,
      resolveDir: process.cwd()
    },
    outfile: join(directory, 'gallery.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    conditions: ['browser'],
    tsconfig: 'apps/web/tsconfig.json',
    loader: { '.css': 'empty', '.woff2': 'file', '.woff': 'file' },
    logLevel: 'silent'
  });
  production = createRequire(import.meta.url)(join(directory, 'gallery.cjs'));
} finally {
  rmSync(directory, { recursive: true, force: true });
}

test('the gallery viewer tracks the actual session reducer mutating the selected picture in place', async () => {
  const dom = new JSDOM('', { url: 'https://reader.example/reader-web/b?id=1' });
  dom.window.matchMedia = () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {}
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  const {
    createSession,
    createGallery,
    hideSpoilerImage$,
    readerImageGalleryPictures$,
    toggleImageGalleryPictureSpoiler$
  } = production;
  const pictures = [
    { url: 'blob:first', unspoilered: true },
    { url: 'blob:second', unspoilered: true }
  ];
  hideSpoilerImage$.next(true);
  readerImageGalleryPictures$.next(pictures);
  const session = createSession({ routeUrl: dom.window.location.href });
  const collect = session.collectReaderImageGallerySpoilerToggles$.subscribe();
  const gallery = createGallery({});
  gallery.selectedImageIndex = 1;
  gallery.controller.start();
  try {
    assert.equal(gallery.selectedIsHidden, false);
    for (const visible of [false, true, false]) {
      const applied = firstValueFrom(session.handleUpdateImageGalleryPictureSpoilers$);
      toggleImageGalleryPictureSpoiler$.next({ url: 'blob:second', unspoilered: visible });
      await applied;
      for (let i = 0; i < 5; i++) await Promise.resolve();
      assert.equal(
        gallery.$readerImageGalleryPictures$[1],
        pictures[1],
        'the real reducer retains picture identity'
      );
      assert.equal(gallery.selectedImage, pictures[1]);
      assert.equal(gallery.selectedImage.unspoilered, visible);
      assert.equal(
        gallery.selectedIsHidden,
        !visible,
        'viewer reveal state must agree with its thumbnail after a mutable publication'
      );
    }
  } finally {
    collect.unsubscribe();
    gallery.controller.destroy();
    session.controller.destroy();
    dom.window.close();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  }
});
