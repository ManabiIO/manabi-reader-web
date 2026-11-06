/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import createDOMPurify from '../../apps/web/node_modules/dompurify/dist/purify.es.mjs';
import { ReaderLanguageBook } from '../../apps/web/src/lib/preprocessing/reader-book.mjs';
import { loadOfflineModule } from './fixtures/offline-module.mjs';

const placeholder =
  'data:image/gif;ttu:picture.png;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
function fixture() {
  const dom = new JSDOM('', { url: 'https://reader.example/manabitan-reader/' });
  const { api } = loadOfflineModule('apps/web/src/reader-react/reader-language.ts', {
    globals: { document: dom.window.document },
    modules: {
      react: {},
      dompurify: createDOMPurify,
      '$lib/preprocessing/reader-book.mjs': { ReaderLanguageBook },
      '$lib/search/dictionary-runtime': {},
      '$lib/search/reader-dictionary-interaction': {
        attachReaderDictionaryInteraction: () => () => {}
      }
    }
  });
  return { api, dom };
}
function runtime(preprocess) {
  return {
    preprocessor: {
      protocol: 1,
      id: 'test-only',
      release: '1',
      fingerprint: async () => '1',
      preprocess,
      mount: () => () => {},
      dispose() {}
    }
  };
}
test('production source composition removes current Blob URLs before analysis and restores only loader-owned resources', async () => {
  const { api, dom } = fixture();
  let input;
  const book = await api.createReaderLanguageBook({
    bookKey: 'book',
    htmlContent:
      '<div id="chapter"><p>猫𠮷<ruby>字<rt>じ</rt></ruby></p><img src="blob:current"></div>',
    imageBindings: new Map([
      [placeholder, 'blob:current'],
      ['ttu:picture.png', 'blob:current']
    ]),
    runtime: runtime(async (value) => {
      input = value;
      return {
        protocol: 1,
        fingerprint: value.fingerprint,
        html: value.html.replace('猫', '<m-m>猫</m-m>'),
        sidecar: { semantic: true },
        vocabulary: []
      };
    })
  });
  try {
    const root = dom.window.document.createElement('div');
    await book.open(0, root, { prepare: async () => {}, commit() {} });
    assert.equal(input.html.includes('blob:current'), false);
    assert.ok(input.html.includes(placeholder));
    assert.equal(root.querySelector('img').getAttribute('src'), 'blob:current');
    assert.equal(root.querySelector('m-m').textContent, '猫');
    assert.equal(root.querySelector('rt').textContent, 'じ');
    assert.equal(book.chapters[0].id, 'chapter');
  } finally {
    book.dispose();
    dom.window.close();
  }
});
test('analysis cannot change canonical source coordinates or inject an image URL', async () => {
  const { api, dom } = fixture();
  const output = (input, html) => ({
    protocol: 1,
    fingerprint: input.fingerprint,
    html,
    sidecar: {},
    vocabulary: []
  });
  let book;
  try {
    book = await api.createReaderLanguageBook({
      bookKey: 'book',
      htmlContent: '<div><p>猫</p></div>',
      runtime: runtime(async (input) => output(input, '<p>犬</p>'))
    });
    await assert.rejects(
      book.open(0, dom.window.document.createElement('div'), {
        prepare: async () => {},
        commit() {}
      }),
      /source text/
    );
    book.dispose();
    book = await api.createReaderLanguageBook({
      bookKey: 'book',
      htmlContent: '<div><p>猫</p></div>',
      runtime: runtime(async (input) =>
        output(
          input,
          '<p>猫</p><img src="blob:foreign"><img src="https://tracker.invalid/image"><script>bad()</script>'
        )
      )
    });
    const root = dom.window.document.createElement('div');
    await book.open(0, root, { prepare: async () => {}, commit() {} });
    assert.equal(root.querySelector('script'), null);
    assert.equal(root.querySelectorAll('img[src]').length, 0);
  } finally {
    book?.dispose();
    dom.window.close();
  }
});
test('missing resource ownership and mismatched manifest reject before a book can open', async () => {
  const { api, dom } = fixture();
  try {
    await assert.rejects(
      api.createReaderLanguageBook({
        bookKey: 'book',
        htmlContent: '<div><img src="blob:unowned"></div>'
      }),
      /resource binding/
    );
    await assert.rejects(
      api.createReaderLanguageBook({
        bookKey: 'book',
        htmlContent: '<div>猫</div>',
        manifest: { version: 1, resources: [] }
      }),
      /identities/
    );
  } finally {
    dom.window.close();
  }
});
