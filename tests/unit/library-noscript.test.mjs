/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { libraryNoScriptDocument } from '../../scripts/library-noscript.mjs';
const source = '<!doctype html><html><body><div id="root"></div></body></html>';

test('the actual no-script Library provides a disabled labelled search without stored data or active code', () => {
  const dom = new JSDOM(libraryNoScriptDocument(source));
  try {
    const { document } = dom.window;
    assert.equal(document.querySelectorAll('#root').length, 1);
    assert.equal(document.querySelectorAll('noscript').length, 1);
    const input = document.querySelector('input[type=search]');
    assert.equal(input.disabled, true);
    assert.equal(input.getAttribute('aria-label'), 'Search library');
    assert.equal(input.value, '');
    assert.match(document.querySelector('main').textContent, /Enable JavaScript/);
    assert.equal(document.querySelectorAll('script,form,[onclick],[onchange]').length, 0);
  } finally {
    dom.window.close();
  }
});

test('scripts-enabled documents keep the no-script fallback inert with no duplicate input or layout rules', () => {
  const dom = new JSDOM(libraryNoScriptDocument(source), { runScripts: 'dangerously' });
  try {
    const { document } = dom.window;
    assert.equal(document.querySelector('input'), null);
    assert.equal(document.querySelector('main'), null);
    assert.equal(document.querySelector('style'), null);
    assert.ok(document.getElementById('root'));
  } finally {
    dom.window.close();
  }
  assert.throws(() => libraryNoScriptDocument(''), /root marker/);
  assert.throws(() => libraryNoScriptDocument(source + '<div id="root"></div>'), /root marker/);
});
