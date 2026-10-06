/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

// The file is decoded before embedding in a style element; @charset applies
// only to external byte streams and JSDOM misparses it as a selector here.
const css = (name) =>
  readFileSync(new URL(`../../apps/web/src/${name}`, import.meta.url), 'utf8').replace(
    /^@charset [^;]+;/,
    ''
  );

test('the Library screen cannot shrink its sticky containing block below its document content', () => {
  const dom = new JSDOM(`<style>${css('library-react/library.css')}</style>
    <div style="display:flex;flex-direction:column;height:320px"><div class="library-react min-h-full">
      <div class="library-nav-shell" style="position:sticky;top:0"><div role="toolbar" aria-label="Book selection"></div></div>
      <main style="height:1138px"></main>
    </div></div>`);
  try {
    const screen = dom.window.document.querySelector('.library-react');
    assert.equal(dom.window.getComputedStyle(screen).flexShrink, '0');
    assert.equal(
      dom.window.getComputedStyle(screen.querySelector('.library-nav-shell')).position,
      'sticky'
    );
  } finally {
    dom.window.close();
  }
});

test('the full-screen gallery overrides default dialog padding and gap before laying out its scrollable viewer', () => {
  const dom =
    new JSDOM(`<style>${css('reader-react/primitives.css')}\n${css('reader-react/reader.css')}</style>
    <div class="react-reader-gallery"><div class="reader-modal reader-modal-center" role="dialog">
      <header class="gallery-header"><h2>Image gallery</h2><button>Close Image Gallery</button></header>
      <div class="gallery-layout has-selection"><div class="gallery-viewer"><div class="gallery-toolbar"></div><div class="gallery-art"></div></div></div>
    </div></div>`);
  try {
    const modal = dom.window.document.querySelector('[role=dialog]');
    const style = dom.window.getComputedStyle(modal);
    assert.equal(
      style.padding,
      '0px',
      'primitive modal defaults must not steal 48px of the small viewport'
    );
    assert.equal(style.gap, '0', 'the default dialog gap must not consume the viewer row');
    assert.equal(style.gridTemplateRows, 'auto minmax(0, 1fr)');
    const viewer = dom.window.getComputedStyle(modal.querySelector('.gallery-viewer'));
    assert.equal(viewer.display, 'grid');
    assert.equal(viewer.overflowY, 'auto');
    assert.equal(viewer.gridTemplateRows, 'auto minmax(128px, 1fr)');
  } finally {
    dom.window.close();
  }
});

test('the running title layers above Foliate as a session sibling', () => {
  const dom = new JSDOM(`<style>${css('reader-react/reader.css')}</style>
    <div class="react-reader-session"><div class="reader-context">Book title</div>
    <div class="react-reader-foliate"><div class="book-content"></div></div></div>`);
  try {
    const title = dom.window.document.querySelector('.reader-context');
    assert.equal(title.closest('.react-reader-foliate'), null);
    assert.equal(dom.window.getComputedStyle(title).position, 'fixed');
    assert.equal(dom.window.getComputedStyle(title).zIndex, '10');
  } finally {
    dom.window.close();
  }
});

test('Reading tools can shrink and scroll enlarged labels in a short viewport', () => {
  const dom = new JSDOM(`<style>${css('reader-react/primitives.css')}</style>
    <div class="reader-tools-menu" role="menu"><button role="menuitem">Save Reading Position</button></div>`);
  try {
    const menu = dom.window.document.querySelector('[role=menu]');
    const style = dom.window.getComputedStyle(menu);
    assert.equal(style.position, 'fixed');
    assert.equal(style.minWidth, '0');
    assert.equal(style.overflowY, 'auto');
    assert.equal(style.overflowX, 'hidden');
    assert.equal(style.writingMode, 'horizontal-tb');
    const item = dom.window.getComputedStyle(menu.firstElementChild);
    assert.equal(item.whiteSpace, 'normal');
    assert.equal(item.overflowWrap, 'anywhere');
  } finally {
    dom.window.close();
  }
});
