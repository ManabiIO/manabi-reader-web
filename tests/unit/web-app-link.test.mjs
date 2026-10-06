/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { admittedWebAppLink } from '../../apps/web/src/runtime/web-app-link.ts';
function fixture(run, href = 'https://reader.example/reader-web/b?id=1') {
  const dom = new JSDOM('<section><a><span>Go</span></a></section>', { url: href });
  const anchor = dom.window.document.querySelector('a');
  function admit(url, attributes = {}, eventOptions = {}) {
    for (const attribute of Array.from(anchor.attributes)) anchor.removeAttribute(attribute.name);
    anchor.href = url;
    for (const [name, value] of Object.entries(attributes)) anchor.setAttribute(name, value);
    const event = new dom.window.MouseEvent('click', {
      button: 0,
      cancelable: true,
      ...eventOptions
    });
    Object.defineProperty(event, 'target', { value: anchor.firstElementChild });
    return { event, result: () => admittedWebAppLink(event, new URL(href), '/reader-web') };
  }
  try {
    run({ anchor, admit, dom });
  } finally {
    dom.window.close();
  }
}

test('only verified Expo pages under the exact deployment base enter app navigation', () =>
  fixture(({ admit }) => {
    for (const page of [
      '',
      '/',
      '/manage',
      '/b',
      '/settings',
      '/connections',
      '/import-ttu',
      '/shared-library',
      '/snippets',
      '/statistics',
      '/videos'
    ])
      assert.equal(
        admit('/reader-web' + page + '?q=a&q=b#part').result()?.url.href,
        'https://reader.example/reader-web' + page + '?q=a&q=b#part'
      );
    for (const path of [
      '/reader-web/auth',
      '/reader-web/account',
      '/reader-web/api/books',
      '/reader-web/book.epub',
      '/reader-web/b/',
      '/reader-web/%62',
      '/reader-web/manage/unknown',
      '/reader-web-sibling/manage',
      '/other/manage',
      '/manage'
    ])
      assert.equal(admit(path).result(), undefined, path);
    assert.equal(
      admit('settings?font=1#fonts').result()?.url.href,
      'https://reader.example/reader-web/settings?font=1#fonts'
    );
  }));

test('plain self and fragment links retain their distinct semantics and inherited navigation options', () =>
  fixture(({ admit, anchor }) => {
    assert.equal(admit('?id=1').result().sameUrl, true);
    assert.equal(admit('#chapter').result().fragment, true);
    assert.equal(admit('?id=2#chapter').result().fragment, false);
    anchor.parentElement.setAttribute('data-sveltekit-noscroll', '');
    anchor.parentElement.setAttribute('data-sveltekit-keepfocus', 'true');
    anchor.parentElement.setAttribute('data-sveltekit-replacestate', '');
    assert.deepEqual(admit('settings', { 'data-sveltekit-noscroll': 'false' }).result().options, {
      noScroll: false,
      keepFocus: true,
      replaceState: true
    });
  }));

test('native click, authentication, external, reload and credential contracts are never captured', () =>
  fixture(({ admit, anchor }) => {
    for (const options of [
      { button: 1 },
      { button: 2 },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true }
    ])
      assert.equal(admit('settings', {}, options).result(), undefined);
    for (const attributes of [
      { target: '_self' },
      { target: '_blank' },
      { target: '' },
      { download: '' },
      { rel: 'nofollow external' },
      { rel: 'EXTERNAL' },
      { 'data-sveltekit-reload': '' }
    ])
      assert.equal(admit('settings', attributes).result(), undefined);
    const prevented = admit('settings');
    prevented.event.preventDefault();
    assert.equal(prevented.result(), undefined);
    for (const href of [
      'https://other.example/reader-web/settings',
      'https://user:secret@reader.example/reader-web/settings',
      'https://user@reader.example/reader-web/settings',
      'mailto:user@example.com',
      'javascript:void(0)'
    ])
      assert.equal(admit(href).result(), undefined);
    anchor.parentElement.setAttribute('data-sveltekit-reload', '');
    assert.equal(admit('settings').result(), undefined);
    assert.ok(admit('settings', { 'data-sveltekit-reload': 'false' }).result());
  }));

test('deployment-base matching also supports an exact custom prefix and the root deployment', () => {
  for (const [base, href, accepted, rejected] of [
    [
      '/custom/reader',
      'https://reader.example/custom/reader/b?id=1',
      '/custom/reader/manage',
      '/custom/reader-sibling/manage'
    ],
    ['', 'https://reader.example/b?id=1', '/manage', '/reader-web/manage']
  ]) {
    fixture(({ anchor, dom }) => {
      const event = new dom.window.MouseEvent('click', { button: 0 });
      Object.defineProperty(event, 'target', { value: anchor });
      anchor.href = accepted;
      assert.ok(admittedWebAppLink(event, new URL(href), base));
      anchor.href = rejected;
      assert.equal(admittedWebAppLink(event, new URL(href), base), undefined);
    }, href);
  }
});
