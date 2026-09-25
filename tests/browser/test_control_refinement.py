"""Extends every modal regression with control, worker and busy-state coverage."""
import test_modal_controls as modal_controls
from playwright.sync_api import expect
import unittest


class ControlRefinementBrowser(modal_controls.ModalControlsBrowser):
    def test_long_search_in_enlarged_landscape_keeps_dismissal_and_results_reachable(self):
        title = ('A long descriptive book title ' * 16).strip()
        self.import_book(title)
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        saved = self.stores('books', ['bookmark'])
        self.page.set_viewport_size({'width': 568, 'height': 320})
        self.page.evaluate('document.documentElement.style.fontSize = "125%"')
        panel = self.open_tool('Search Book')
        self.check_modal(panel)
        self.assertLessEqual(panel.evaluate('p => p.scrollTop'), 1)
        self.capture('long-search-opening-landscape')
        panel.get_by_role('searchbox').fill('日')
        expect(panel.get_by_text('180 results', exact=True)).to_be_visible()
        first = panel.get_by_role('button').filter(has_text='Section 1').first
        first.scroll_into_view_if_needed()
        self.frames()
        self.assertGreater(first.evaluate('e => e.parentElement.clientHeight'), 0)
        bounds, row = panel.bounding_box(), first.bounding_box()
        self.assertGreaterEqual(row['y'], bounds['y'] - 1)
        self.assertLessEqual(row['y'] + row['height'], bounds['y'] + bounds['height'] + 1)
        self.capture('long-search-results-landscape')
        # A normal click must work. Visibility alone misses a zero-height parent.
        first.click()
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_be_visible()
        self.assertEqual(saved, self.stores('books', ['bookmark']))

    def test_navigation_uses_shared_close_without_overlapping_enlarged_headers(self):
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.goto(self.origin + '/Reader-Web/settings')
        self.page.evaluate('document.documentElement.style.fontSize = "125%"')
        trigger = self.page.get_by_role('button', name='Navigate', exact=True)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Manabi Reader', exact=True)
        close = self.check_modal(panel)
        # A plain w-* loses to the sheet's data-side width; the intended
        # one-rem gutter must not silently become a cramped 75%-width panel.
        width = panel.evaluate('e => ({actual:e.getBoundingClientRect().width, expected:innerWidth-parseFloat(getComputedStyle(document.documentElement).fontSize)})')
        self.assertAlmostEqual(width['actual'], width['expected'], delta=1)
        self.capture('navigation-shared-close-enlarged-phone')
        close.click()
        expect(panel).to_have_count(0)
        expect(trigger).to_be_focused()

    def test_changing_query_fences_a_pending_result_selection(self):
        self.open_reader()
        panel = self.search()
        self.hold_digest()
        panel.get_by_role('button').filter(has_text='Section 1').first.click()
        self.page.wait_for_function('typeof window.__releasePanelDigest === "function"')
        panel.get_by_role('searchbox').fill('文章')
        expect(panel.get_by_text('180 results', exact=True)).to_be_visible()
        self.release_digest()
        expect(panel).to_be_visible()
        expect(self.page.get_by_role('button', name='Return to where I was', exact=True)).to_have_count(0)
        panel.get_by_role('button').filter(has_text='Section 1').first.click()
        expect(panel).to_have_count(0)

    def test_forced_colors_preserves_the_dismiss_control_outline(self):
        self.open_reader()
        self.page.emulate_media(forced_colors='active')
        if not self.page.evaluate('matchMedia("(forced-colors: active)").matches'):
            self.skipTest('This engine does not emulate forced colors')
        panel = self.open_tool('Dictionary Setup')
        close = self.check_modal(panel)
        style = close.evaluate("e => { const s=getComputedStyle(e); return {width:s.borderTopWidth, style:s.borderTopStyle, color:s.color, background:s.backgroundColor}; }")
        self.assertEqual('1px', style['width'])
        self.assertEqual('solid', style['style'])
        self.assertNotEqual(style['color'], style['background'])
        self.capture('forced-colors-dismissal')
        close.click()
        expect(panel).to_have_count(0)

    def test_search_constructor_failure_has_a_working_retry(self):
        self.open_reader()
        self.page.evaluate('''() => {
          const NativeWorker = window.Worker;
          window.Worker = new Proxy(NativeWorker, {
            construct(target, args) {
              if (String(args[0]).includes('reader-search-worker')) {
                window.Worker = NativeWorker;
                throw new DOMException('Test worker unavailable', 'SecurityError');
              }
              return Reflect.construct(target, args);
            }
          });
        }''')
        panel = self.open_tool('Search Book')
        panel.get_by_role('searchbox').fill('日')
        expect(panel.get_by_role('alert')).to_have_text('Search could not finish. Please try again.')
        panel.get_by_role('button', name='Retry Search', exact=True).click()
        expect(panel.get_by_text('180 results', exact=True)).to_be_visible()
        expect(panel.get_by_role('alert')).to_have_count(0)
        panel.get_by_role('button').filter(has_text='Section 1').first.click()
        expect(panel).to_have_count(0)

    def test_async_worker_failure_is_reported_and_retry_uses_a_fresh_worker(self):
        self.open_reader()
        # Send one malformed query into the real worker to exercise its async
        # rejection path, rather than fabricating an error reply in the host.
        self.page.evaluate('''() => {
          const NativeWorker = window.Worker;
          window.Worker = new Proxy(NativeWorker, {
            construct(target, args) {
              const worker = Reflect.construct(target, args);
              if (String(args[0]).includes('reader-search-worker')) {
                window.Worker = NativeWorker;
                const send = worker.postMessage.bind(worker);
                worker.postMessage = message => {
                  if (message.type === 'search') {
                    worker.postMessage = send;
                    return send({...message, query:null});
                  }
                  return send(message);
                };
              }
              return worker;
            }
          });
        }''')
        panel = self.open_tool('Search Book')
        panel.get_by_role('searchbox').fill('日')
        expect(panel.get_by_role('alert')).to_have_text('Search could not finish. Please try again.')
        panel.get_by_role('button', name='Retry Search', exact=True).click()
        expect(panel.get_by_text('180 results', exact=True)).to_be_visible()
        expect(panel.get_by_role('alert')).to_have_count(0)
        panel.get_by_role('button').filter(has_text='Section 1').first.click()
        expect(panel).to_have_count(0)

    def test_closing_during_ime_composition_does_not_disable_the_next_search(self):
        self.open_reader()
        panel = self.search()
        panel.get_by_role('searchbox').evaluate('''e => {
          e.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
          e.value = '文章';
          e.dispatchEvent(new InputEvent('input', {bubbles:true, isComposing:true}));
        }''')
        expect(panel.get_by_role('button').filter(has_text='Section 1')).to_have_count(0)
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        panel = self.open_tool('Search Book')
        expect(panel.get_by_role('searchbox')).to_have_value('文章')
        expect(panel.get_by_text('180 results', exact=True)).to_be_visible()

    def test_notes_actions_have_distinct_shapes_and_remain_reachable_in_landscape(self):
        self.open_reader()
        self.page.set_viewport_size({'width': 568, 'height': 320})
        controls = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if controls.is_visible():
            controls.click()
        self.page.get_by_role('button', name='Bookmarks and Notes', exact=True).click()
        panel = self.page.get_by_role('dialog').last
        add = panel.get_by_role('button', name='Add Bookmark', exact=True)
        export = panel.get_by_role('button', name='Export Notes', exact=True)
        def shape(button):
            return button.evaluate('e => ({h:e.getBoundingClientRect().height,r:parseFloat(getComputedStyle(e).borderTopLeftRadius)})')
        self.assertGreaterEqual(shape(add)['r'], shape(add)['h'] / 2)
        self.assertLess(shape(export)['r'], shape(export)['h'] / 2)
        add.click()
        saved = panel.get_by_role('button').filter(has_text='Go to saved passage')
        expect(saved).to_have_count(1)
        saved.scroll_into_view_if_needed()
        bounds, row = panel.bounding_box(), saved.bounding_box()
        self.assertGreaterEqual(row['y'], bounds['y'])
        self.assertLessEqual(row['y'] + row['height'], bounds['y'] + bounds['height'])
        self.capture('notes-landscape-controls')
        saved.click()
        expect(panel).to_have_count(0)

    def test_enlarged_onboarding_keeps_a_readable_title_and_full_width_description(self):
        self.open_reader()
        self.page.set_viewport_size({'width': 320, 'height': 480})
        self.page.evaluate('document.documentElement.style.fontSize = "125%"')
        panel = self.open_tool('Dictionary Setup')
        close = self.check_modal(panel)
        title = panel.locator('[data-slot="dialog-title"]').bounding_box()
        description = panel.locator('[data-slot="dialog-description"]').bounding_box()
        self.assertGreaterEqual(title['width'], 150)
        self.assertGreaterEqual(description['width'] - title['width'], close.bounding_box()['width'])
        self.assertEqual(description['x'], title['x'])
        self.capture('onboarding-readable-enlarged-phone')
        panel.get_by_role('button', name='Not now', exact=True).click()
        expect(panel).to_have_count(0)

    def test_reduced_motion_does_not_translate_pressed_buttons(self):
        self.open_reader()
        self.page.emulate_media(reduced_motion='reduce')
        panel = self.open_tool('Dictionary Setup')
        button = panel.get_by_role('button', name='Not now', exact=True)
        button.hover()
        self.page.mouse.down()
        self.assertEqual('none', button.evaluate('e => getComputedStyle(e).translate'))
        self.page.mouse.up()
        expect(panel).to_have_count(0)

    def test_collection_save_cannot_be_dismissed_while_its_transaction_is_pending(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.get_by_role('button', name='Collections', exact=True).click()
        self.page.get_by_role('button', name='New Collection…', exact=True).click()
        panel = self.dialog()
        panel.get_by_label('Name', exact=True).fill('Durable collection')
        # A real readwrite transaction queues the application's write behind
        # it. No database method, response, or production UI is replaced.
        self.page.evaluate('''async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('manabi-reader-integrations');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const tx = db.transaction('metadata', 'readwrite');
          let hold = true;
          window.__releaseCollectionTransaction = () => { hold = false; };
          tx.oncomplete = tx.onabort = () => db.close();
          const pump = () => {
            if (hold) tx.objectStore('metadata').get('books-organization-v1').onsuccess = pump;
          };
          pump();
        }''')
        try:
            panel.get_by_role('button', name='Save', exact=True).click()
            expect(panel.locator('form')).to_have_attribute('aria-busy', 'true')
            expect(panel.get_by_role('button', name='Close', exact=True)).to_be_disabled()
            expect(panel.get_by_label('Name', exact=True)).to_be_disabled()
            self.page.keyboard.press('Escape')
            expect(panel).to_be_visible()
            self.page.mouse.click(2, 2)
            expect(panel).to_be_visible()
        finally:
            self.page.evaluate('window.__releaseCollectionTransaction()')
        expect(panel).to_have_count(0)
        expect(self.page.get_by_role('button', name='Durable collection 0', exact=True)).to_be_visible()


if __name__ == '__main__':
    unittest.main()
