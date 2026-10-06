"""Extends every modal regression with control, worker and busy-state coverage."""
from reader_controls import reveal_reader_controls
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
        # This pushed screen now uses contextual overflow, not a global navigation sheet.
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.goto(self.origin + '/reader-web/settings')
        self.page.evaluate('document.documentElement.style.fontSize = "125%"')
        trigger = self.page.get_by_role('button', name='Settings actions', exact=True)
        trigger.click()
        panel = self.page.get_by_role('menu', name='Page actions', exact=True)
        expect(panel.get_by_role('menuitem', name='Accounts and libraries', exact=True)).to_be_visible()
        expect(panel.get_by_role('menuitem', name='Settings', exact=True)).to_have_count(0)
        bounds = panel.bounding_box()
        self.assertGreaterEqual(bounds['x'], 7)
        self.assertLessEqual(bounds['x'] + bounds['width'], 313)
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
        self.capture('navigation-context-enlarged-phone')
        self.page.keyboard.press('Escape')
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
        # Escape belongs to the active input method; explicit dismissal still
        # ends composition and must not disable the next real search.
        expect(panel).to_be_visible()
        expect(panel.get_by_role('searchbox')).to_be_focused()
        panel.get_by_role('button', name='Close search', exact=True).click()
        expect(panel).to_have_count(0)
        panel = self.open_tool('Search Book')
        expect(panel.get_by_role('searchbox')).to_have_value('文章')
        expect(panel.get_by_text('180 results', exact=True)).to_be_visible()


    def test_reader_tool_round_trips_never_leave_focus_in_a_closed_surface(self):
        self.open_reader()
        controls = self.page.locator('button[data-reader-controls]')

        panel = self.open_tool('Search Book')
        search = panel.get_by_role('searchbox', name='Search within book', exact=True)
        search.focus()
        expect(search).to_be_focused()
        search.press('Escape')
        expect(panel).to_have_count(0)
        expect(controls).to_be_focused()
        expect(self.page.get_by_role('menu')).to_have_count(0)

        panel = self.open_tool('Browse Book')
        slider = panel.get_by_role('slider', name='Book position', exact=True)
        slider.focus()
        expect(slider).to_be_focused()
        slider.press('Escape')
        expect(panel).to_have_count(0)
        expect(controls).to_be_focused()
        expect(self.page.get_by_role('menu')).to_have_count(0)

        panel = self.open_tool('Jump to Position')
        field = panel.get_by_role('spinbutton', name='Jump to Position', exact=True)
        field.focus()
        expect(field).to_be_focused()
        field.press('Escape')
        expect(panel).to_have_count(0)
        expect(controls).to_be_focused()
        expect(self.page.get_by_role('menu')).to_have_count(0)

        panel = self.open_tool('Dictionary Setup')
        not_now = panel.get_by_role('button', name='Not now', exact=True)
        not_now.focus()
        expect(not_now).to_be_focused()
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        expect(controls).to_be_focused()
        expect(self.page.get_by_role('menu')).to_have_count(0)

        # Re-enter the first tool after four portal lifecycles. A stale focus
        # scope or hidden menu must not prevent a fresh keyboard interaction.
        panel = self.open_tool('Search Book')
        search = panel.get_by_role('searchbox', name='Search within book', exact=True)
        search.fill('文章')
        expect(panel.get_by_text('180 results', exact=True)).to_be_visible(timeout=15000)
        expect(search).to_be_focused()
        self.capture('reader-tool-round-trip-focus')
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        expect(controls).to_be_focused()


    def test_notes_panel_keeps_sticky_dismissal_reachable_at_200_percent_text(self):
        self.open_reader()
        self.page.set_viewport_size({'width': 320, 'height': 320})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        reveal_reader_controls(self.page)
        trigger = self.page.get_by_role('button', name='Bookmarks and Notes', exact=True)
        trigger.focus()
        trigger.press('Enter')
        panel = self.page.get_by_role('dialog').last
        heading = panel.get_by_role('heading', name='Bookmarks & Notes', exact=True)
        expect(heading).to_be_visible()
        heading_box = heading.bounding_box()
        self.assertGreaterEqual(heading_box['width'], 240)
        self.assertEqual('normal', heading.evaluate('e => getComputedStyle(e).overflowWrap'))
        self.assertEqual('normal', heading.evaluate('e => getComputedStyle(e).wordBreak'))
        words = heading.locator('[data-annotations-title-word]')
        expect(words).to_have_count(2)
        for word in words.all():
            box = word.bounding_box()
            line_height = word.evaluate('e => parseFloat(getComputedStyle(e).lineHeight)')
            self.assertLessEqual(box['width'], heading_box['width'] + 1)
            self.assertLessEqual(box['height'], line_height * 1.15)
        add = panel.get_by_role('button', name='Add Bookmark', exact=True)
        self.assertGreaterEqual(add.bounding_box()['height'], 43.99)
        add.click()

        saved = panel.get_by_role('button').filter(has_text='Go to saved passage')
        expect(saved).to_have_count(1)
        scroll = panel.locator('[data-annotations-scroll]')
        self.page.wait_for_function('e => e.scrollHeight > e.clientHeight', arg=scroll.element_handle())
        scroll.evaluate('e => { e.scrollTop = e.scrollHeight; }')
        self.page.wait_for_function('e => e.scrollTop > 0', arg=scroll.element_handle())
        saved = panel.get_by_role('button').filter(has_text='Go to saved passage')
        expect(saved).to_be_visible()

        close = panel.get_by_role('button', name='Close bookmarks and notes', exact=True)
        box = close.bounding_box()
        viewport = self.page.evaluate('''() => {
          const v=visualViewport;
          return {
            left:v?.offsetLeft ?? 0, top:v?.offsetTop ?? 0,
            right:(v?.offsetLeft ?? 0)+(v?.width ?? innerWidth),
            bottom:(v?.offsetTop ?? 0)+(v?.height ?? innerHeight)
          };
        }''')
        self.assertGreaterEqual(box['width'], 43.99)
        self.assertGreaterEqual(box['height'], 43.99)
        self.assertGreaterEqual(box['x'], viewport['left'] - 1)
        self.assertGreaterEqual(box['y'], viewport['top'] - 1)
        self.assertLessEqual(box['x'] + box['width'], viewport['right'] + 1)
        self.assertLessEqual(box['y'] + box['height'], viewport['bottom'] + 1)
        self.assertTrue(close.evaluate('''e => {
          const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return !!hit && (hit===e || e.contains(hit));
        }'''))
        self.assertLessEqual(panel.evaluate('e => e.scrollWidth-e.clientWidth'), 1)

        remove = panel.get_by_role('button', name='Remove bookmark', exact=True)
        expect(remove).to_be_visible()
        self.assertGreaterEqual(remove.bounding_box()['height'], 43.99)
        self.assertTrue(remove.evaluate('''e => {
          const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return !!hit && (hit===e || e.contains(hit));
        }'''))
        # The sticky header must still own dismissal after the annotation action
        # at the opposite end of the scroller is reached.
        self.assertTrue(close.evaluate('''e => {
          const r=e.getBoundingClientRect();
          const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
          return !!hit && (hit===e || e.contains(hit));
        }'''))
        self.capture('notes-short-enlarged-sticky-dismissal')

        close.focus()
        close.press('Enter')
        expect(panel).to_have_count(0)
        expect(self.page.locator('button[data-reader-controls]')).to_be_focused()
        self.page.evaluate('document.documentElement.style.fontSize = ""')

    def test_notes_actions_have_distinct_shapes_and_remain_reachable_in_landscape(self):
        self.open_reader()
        self.page.set_viewport_size({'width': 568, 'height': 320})
        reveal_reader_controls(self.page)
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
