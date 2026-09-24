"""Extends every modal regression with control, worker and busy-state coverage."""
import test_modal_controls as modal_controls
from playwright.sync_api import expect
import unittest


class ControlRefinementBrowser(modal_controls.ModalControlsBrowser):
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
