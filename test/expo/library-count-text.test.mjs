/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const output = await build({
  stdin: {
    contents: `
      export { WorkspaceView } from './apps/web/src/library-react/workspace';
      export { WorkspaceController } from './apps/web/src/library-react/workspace-controller';
      export { organization } from './apps/web/src/lib/library/organization';
      export { allLinkedBooks } from './apps/web/src/lib/manabi/books';
    `,
    resolveDir: process.cwd()
  },
  outfile: '/tmp/library-count-text-unwritten.cjs',
  write: false,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  conditions: ['browser'],
  tsconfig: 'apps/web/tsconfig.json',
  loader: { '.css': 'empty', '.woff': 'file', '.woff2': 'file' },
  logLevel: 'silent',
  plugins: [
    {
      name: 'host-react',
      setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$|^react-dom(?:\/.*)?$/ }, (args) => ({
          path: require.resolve(args.path),
          external: true
        }));
      }
    }
  ]
});
const module = { exports: {} };
compileFunction(output.outputFiles.find((file) => file.path.endsWith('.cjs')).text, [
  'require',
  'module',
  'exports'
])(require, module, module.exports);
const { WorkspaceView, WorkspaceController, organization, allLinkedBooks } = module.exports;

for (const count of [1, 2]) {
  for (const view of ['series', 'finished series', 'shelf', 'finished timeline']) {
    test(`${view} renders the ${count === 1 ? 'singular' : 'plural'} book count with a real text separator`, () => {
      const series = view.includes('series');
      const finished = view.includes('finished');
      const url = new URL('https://reader.test/reader-web/manage');
      if (series) url.searchParams.set('series', 'personal-series:Nested');
      if (finished) url.searchParams.set('collection', 'finished');
      // Real controller, organization store, shelf projection and WorkspaceView.
      // SSR needs no browser/storage mocks or substituted child components.
      allLinkedBooks.set([]);
      organization.set({
        version: 1,
        collections: [],
        books: series
          ? Object.fromEntries(
              Array.from({ length: count }, (_, index) => [
                `book:${index + 1}`,
                { series: { name: 'Nested' }, modifiedAt: 1 }
              ])
            )
          : {}
      });
      const controller = new WorkspaceController(url.href);
      controller.bookCards = Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        title: `Volume ${index + 1}`,
        imagePath: '',
        characters: 100,
        lastBookModified: 1,
        lastBookOpen: 0,
        progress: 1,
        lastBookmarkModified: 1,
        isPlaceholder: false,
        completion: { state: 'finished', finishedOn: '2026-10-02', modifiedAt: 1 }
      }));
      const dom = new JSDOM(
        renderToStaticMarkup(React.createElement(WorkspaceView, { c: controller }))
      );
      try {
        const document = dom.window.document;
        if (series) {
          const hero = document.querySelector('.series-hero');
          assert.ok(hero);
          assert.ok(
            hero.textContent.includes(
              `Series · ${count} ${count === 1 ? 'Book' : 'Books'}${finished ? ' in Finished' : ''}`
            )
          );
        }
        if (view === 'finished timeline')
          assert.ok(document.querySelector('[aria-label="Finished books"]'));
        assert.ok(
          [...document.querySelectorAll('p')].some(
            (element) => element.textContent.trim() === `${count} ${count === 1 ? 'book' : 'books'}`
          ),
          'the rendered shelf/timeline footer separates the number from its noun'
        );
      } finally {
        dom.window.close();
      }
    });
  }
}
