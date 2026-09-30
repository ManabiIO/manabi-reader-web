"""Reader Contents and confirmation refinements in the compiled application.

Mixed into the existing Connect suite so all prior cases and page-error/CSP
checks remain. Only the delayed-event case holds the renderer event boundary.
"""
from playwright.sync_api import expect
from test_rhea_ui import chaptered_epub
from test_static_reader import TITLE


class ReaderNavigationPanels:
    def assert_box_in_viewport(self, target):
        self.assertTrue(target.evaluate('''e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth &&
            r.top >= 0 && r.bottom <= innerHeight && getComputedStyle(e).visibility === 'visible';
        }'''))

    def assert_hit_target_in_viewport(self, target):
        self.assertTrue(target.evaluate('''e => {
          const r = e.getBoundingClientRect();
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight &&
            e.contains(document.elementFromPoint(x, y));
        }'''))

    def open_chaptered_reader(self):
        self.page.evaluate('''() => {
          localStorage.setItem('fontFamilyGroupOne', 'Klee One');
          localStorage.setItem('viewMode', 'paginated');
        }''')
        self.go_library()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'Contents refinement.epub', 'mimeType': 'application/epub+zip',
            'buffer': chaptered_epub()
        })
        self.page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')

    def open_contents_panel(self):
        reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if reveal.is_visible():
            reveal.click()
        self.page.get_by_role('button', name='Contents', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Table of contents', exact=True)
        expect(panel).to_be_visible()
        return panel

    def test_contents_keep_one_scroll_owner_with_enlarged_text_in_short_viewports(self):
        self.open_chaptered_reader()
        for width, height, scale in ((1440, 900, '100%'), (320, 360, '200%')):
            panel = self.open_contents_panel()
            self.page.set_viewport_size({'width': width, 'height': height})
            self.page.evaluate('v => document.documentElement.style.fontSize = v', scale)
            chapter_list = panel.get_by_role('navigation', name='Chapters', exact=True)
            self.assertEqual('visible', chapter_list.evaluate('e => getComputedStyle(e).overflowY'))
            self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
            for name in ('The journey begins', 'A new morning'):
                row = chapter_list.get_by_role('button', name=name, exact=True)
                row.scroll_into_view_if_needed()
                expect(row).to_be_in_viewport()
                bounds = row.bounding_box()
                self.assertGreaterEqual(bounds['height'], 44)
                self.assertTrue(row.evaluate('''e => {
                  const r=e.getBoundingClientRect();
                  return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
                }'''))
            footer = panel.get_by_role('button', name='Next Chapter', exact=True)
            panel.evaluate('e => e.scrollTop = e.scrollHeight')
            self.assert_box_in_viewport(footer)
            close = panel.get_by_role('button', name='Close Table of Contents', exact=True)
            panel.evaluate('e => e.scrollTop = 0')
            self.assert_hit_target_in_viewport(close)
            expect(close).to_have_attribute('data-shape', 'circle')
            self.capture(f'contents-refined-{width}-{height}')
            close.click()
            expect(panel).to_have_count(0)
            self.page.evaluate('document.documentElement.style.fontSize = "100%"')
            self.page.set_viewport_size({'width': 1440, 'height': 900})

    def test_jump_rejects_blank_fractional_and_out_of_range_values_without_closing(self):
        self.open_reader()
        panel = self.open_tool('Jump to Position')
        field = panel.get_by_role('spinbutton', name='Jump to Position', exact=True)
        confirm = panel.get_by_role('button', name='Confirm', exact=True)
        expect(field).to_have_attribute('step', '1')
        for value in ('', '1.5', '0'):
            field.fill(value)
            confirm.click()
            expect(panel).to_be_visible()
            expect(field).to_have_attribute('aria-invalid', 'true')
            expect(panel.get_by_role('alert')).to_contain_text('Enter a whole number')
        field.fill('1')
        field.press('Enter')
        expect(panel).to_have_count(0)
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')

    def test_reader_dialog_actions_and_errors_reflow_in_both_appearances(self):
        self.open_reader()
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            self.page.reload()
            expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
            panel = self.open_tool('Jump to Position')
            self.page.set_viewport_size({'width': 320, 'height': 568})
            self.page.evaluate('document.documentElement.style.fontSize = "200%"')
            field = panel.get_by_role('spinbutton', name='Jump to Position', exact=True)
            field.fill('1.5')
            panel.get_by_role('button', name='Confirm', exact=True).click()
            expect(panel.get_by_role('alert')).to_be_visible()
            self.assertLessEqual(panel.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
            self.assertGreaterEqual(field.bounding_box()['height'], 44)
            panel.locator('[data-dialog-scroll]').evaluate('e => e.scrollTop = e.scrollHeight')
            for name, variant in (('Cancel', 'secondary'), ('Confirm', 'default')):
                control = panel.get_by_role('button', name=name, exact=True)
                expect(control).to_have_attribute('data-variant', variant)
                self.assert_hit_target_in_viewport(control)
                self.assertGreaterEqual(control.bounding_box()['height'], 44)
            self.capture('reader-position-dialog-' + mode)
            panel.get_by_role('button', name='Cancel', exact=True).click()
            expect(panel).to_have_count(0)
            self.page.evaluate('document.documentElement.style.fontSize = "100%"')
            self.page.set_viewport_size({'width': 1200, 'height': 900})
            panel = self.open_tool('Complete Book')
            expect(panel.get_by_role('button', name='Cancel', exact=True)).to_have_attribute('data-variant', 'secondary')
            expect(panel.get_by_role('button', name='Confirm', exact=True)).to_have_attribute('data-variant', 'default')
            panel.get_by_role('button', name='Cancel', exact=True).click()
            expect(panel).to_have_count(0)

    def test_tracker_can_open_for_plain_text_without_a_chapter_catalog(self):
        self.page.evaluate('''() => {
          localStorage.setItem('statisticsEnabled', '1');
          localStorage.setItem('fontFamilyGroupOne', 'Klee One');
        }''')
        self.go_library()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'Plain notes.txt', 'mimeType': 'text/plain',
            'buffer': ('日本語の文章を読みます。\n' * 100).encode('utf-8')
        })
        self.page.get_by_role('button', name='Read Plain notes', exact=True).click(timeout=30000)
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        self.page.get_by_role('button', name='Open reading tracker', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Reading tracker', exact=True)
        expect(panel).to_be_visible()
        chapter_eta = panel.get_by_role(
            'button',
            name='Time to Finish Chapter: N/A. Activate to hide.',
            exact=True,
        )
        expect(chapter_eta).to_be_visible()
        expect(chapter_eta).to_have_attribute('aria-pressed', 'false')
        panel.get_by_role('button', name='Close reading tracker', exact=True).click()
        expect(panel).to_have_count(0)

    def test_dismissed_contents_cannot_close_a_reopened_panel_after_delayed_page_events(self):
        self.page.evaluate('''() => {
          localStorage.setItem('statisticsEnabled', '1');
          localStorage.setItem('trackerAutostartTime', '0');
        }''')
        self.open_chaptered_reader()
        self.page.get_by_role('button', name='Open reading tracker', exact=True).click()
        tracker = self.page.get_by_role('dialog', name='Reading tracker', exact=True)
        tracker.get_by_role(
            'button', name='Resume tracking after closing', exact=True
        ).click()
        tracker.get_by_role('button', name='Close reading tracker', exact=True).click()
        expect(tracker).to_have_count(0)
        panel = self.open_contents_panel()
        self.page.evaluate('''() => {
          const dispatch = document.dispatchEvent.bind(document);
          const held = [];
          document.dispatchEvent = event => {
            if (event.type === 'ttsu:page.change') { held.push(event); return true; }
            return dispatch(event);
          };
          window.releaseContentsPageEvents = () => {
            document.dispatchEvent = dispatch;
            for (const event of held) dispatch(event);
            return held.length;
          };
          window.contentsPageEvents = held;
        }''')
        panel.get_by_role('navigation', name='Chapters').get_by_role(
            'button', name='A new morning', exact=True).click()
        self.page.wait_for_function('() => window.contentsPageEvents.length > 0')
        expect(panel).to_be_visible()
        panel.get_by_role('button', name='Close Table of Contents', exact=True).click()
        expect(panel).to_have_count(0)
        reopened = self.open_contents_panel()
        self.assertGreater(self.page.evaluate('window.releaseContentsPageEvents()'), 0)
        # Observe for longer than the production 200ms debounce. This is a
        # bounded negative assertion, not a delay used to make a click succeed.
        self.page.evaluate('''() => new Promise(resolve => setTimeout(resolve, 350))''')
        expect(reopened).to_be_visible()
        self.capture('contents-reopened-after-delayed-navigation')
        self.page.keyboard.press('Escape')
        expect(reopened).to_have_count(0)
