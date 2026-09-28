"""Native DOM tests of the production fallback and candidate helper.

The small DOM fixtures intentionally force escaped focus after synthetic Tab
capture; this is not the built app or a replacement for its modal acceptance.
"""
import os
from pathlib import Path
import subprocess
import unittest
from playwright.sync_api import expect, sync_playwright


class ModalTabFallbackBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.bundle = subprocess.check_output([
            'node', '--input-type=module', '-e', '''
              import {build} from 'esbuild';
              const result = await build({
                entryPoints: ['apps/web/src/lib/hooks/focus-trap-fallback.ts'],
                bundle: true, format: 'iife', globalName: 'ModalTabFallback',
                platform: 'browser', write: false, logLevel: 'silent'
              });
              process.stdout.write(result.outputFiles[0].text);
            '''
        ], cwd=root, text=True)
        cls.playwright = sync_playwright().start()
        cls.browser = getattr(cls.playwright, os.environ.get('LIBRARY_BROWSER', 'chromium')).launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.page.close()
        self.assertEqual([], self.errors)

    def fixture(self, controls):
        self.page.set_content('<button id="outside">Outside</button>'
                              '<div role="dialog" aria-label="Fixture" tabindex="-1" id="modal">'
                              + controls + '</div>')
        self.page.add_script_tag(content=self.bundle)
        self.page.evaluate('''() => {
          const modal = document.querySelector('#modal');
          modal.addEventListener('keydown', ModalTabFallback.containModalTab, true);
          window.escapeTab = (options = {}) => {
            modal.focus();
            modal.dispatchEvent(new KeyboardEvent('keydown', {
              key:'Tab', bubbles:true, cancelable:true, ...options
            }));
            document.querySelector('#outside').focus();
          };
        }''')

    def settle(self):
        self.page.evaluate('''() => new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)))''')

    def test_disabled_inert_hidden_and_negative_tab_stops_are_not_candidates(self):
        self.fixture('''<fieldset disabled><input id="fieldset-input"></fieldset>
          <button tabindex="-1">Not in tab order</button>
          <div aria-hidden="true"><button>Hidden from AT</button></div>
          <div inert><button>Inert</button></div>
          <button style="visibility:hidden">Invisible</button>
          <details><summary tabindex="-1">Closed details</summary><button>Closed</button></details>
          <button id="first">First</button><button id="last">Last</button>''')
        for backwards, target in ((False, '#first'), (True, '#last')):
            self.page.evaluate('shiftKey => escapeTab({shiftKey})', backwards)
            self.settle()
            expect(self.page.locator(target)).to_be_focused()

    def test_disabled_fieldset_first_legend_keeps_its_native_exception(self):
        self.fixture('''<fieldset disabled><legend><button id="legend">Legend</button></legend>
          <input></fieldset><button>Last</button>''')
        self.page.evaluate('escapeTab()')
        self.settle()
        expect(self.page.locator('#legend')).to_be_focused()

    def test_checked_radio_and_positive_tab_order_use_the_native_candidate_rules(self):
        self.fixture('''<input id="unchecked" type="radio" name="group">
          <input id="checked" type="radio" name="group" checked><button>Last</button>''')
        self.page.evaluate('escapeTab()')
        self.settle()
        expect(self.page.locator('#checked')).to_be_focused()
        self.fixture('<button tabindex="3">Third</button><button id="first" tabindex="1">First</button>')
        self.page.evaluate('escapeTab()')
        self.settle()
        expect(self.page.locator('#first')).to_be_focused()

    def test_editable_surface_is_still_a_tabbable_control(self):
        self.fixture('<div id="editor" contenteditable="true">Edit</div><button>Last</button>')
        self.page.evaluate('escapeTab()')
        self.settle()
        expect(self.page.locator('#editor')).to_be_focused()

    def test_late_bubble_prevention_is_not_overruled(self):
        self.fixture('<button>Inside</button>')
        self.page.evaluate('''() => {
          document.querySelector('#modal').addEventListener('keydown', e => e.preventDefault());
          escapeTab();
        }''')
        self.settle()
        expect(self.page.locator('#outside')).to_be_focused()

    def test_new_dialog_before_autofocus_is_not_overruled(self):
        self.fixture('<button>Inside</button>')
        self.page.evaluate('''() => {
          escapeTab();
          const child = document.createElement('div');
          child.role = 'dialog'; child.innerHTML = '<button>Child action</button>';
          document.body.append(child);
        }''')
        self.settle()
        expect(self.page.locator('#outside')).to_be_focused()

    def test_pointer_gesture_and_browser_shortcuts_cancel_recovery(self):
        self.fixture('<button>Inside</button>')
        self.page.evaluate('''() => {
          escapeTab();
          document.querySelector('#outside').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
        }''')
        self.settle()
        expect(self.page.locator('#outside')).to_be_focused()
        for modifier in ('ctrlKey', 'metaKey', 'altKey'):
            self.page.evaluate('key => escapeTab({[key]:true})', modifier)
            self.settle()
            expect(self.page.locator('#outside')).to_be_focused()

    def test_empty_modal_uses_the_container_without_escape(self):
        self.fixture('<fieldset disabled><input></fieldset>')
        self.page.evaluate('escapeTab()')
        self.settle()
        expect(self.page.locator('#modal')).to_be_focused()


if __name__ == '__main__':
    unittest.main(verbosity=2)
