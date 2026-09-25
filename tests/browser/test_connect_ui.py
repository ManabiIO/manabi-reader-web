"""App Store Connect-inspired workspace refinement against the real static app."""
import unittest
from playwright.sync_api import expect
import test_apple_controls as previous

# Retain the existing catalog and continuation suites exactly once.
CatalogLifetimeBrowser = previous.CatalogLifetimeBrowser


class ConnectControlsBrowser(previous.AppleControlsBrowser):
    def assert_no_horizontal_overflow(self, root):
        # On Linux a classic vertical scrollbar reduces html.clientWidth by
        # about 13px even when the page has no horizontal overflow. The root
        # scroll width should be compared with the viewport's full width.
        self.assertLessEqual(root.evaluate('''e => e.scrollWidth -
            (e === document.documentElement ? window.innerWidth : e.clientWidth)'''), 1)

    def test_settings_navigation_and_fields_distinguish_selection_from_actions(self):
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            for width, scale in ((1440, '100%'), (390, '100%'), (320, '200%')):
                self.page.set_viewport_size({'width': width, 'height': 844})
                self.page.goto(self.origin + '/Reader-Web/settings')
                self.page.evaluate('v => document.documentElement.style.fontSize = v', scale)
                search = self.page.get_by_role('searchbox', name='Search settings', exact=True)
                expect(search).to_be_visible()
                self.assertGreaterEqual(search.bounding_box()['height'], 43.99)
                header = self.page.locator('header').first.bounding_box()
                self.assertGreaterEqual(self.page.locator('[data-settings-content]').bounding_box()['y'], header['y'] + header['height'] - 1)
                self.assertAlmostEqual(search.evaluate('e => parseFloat(getComputedStyle(e).borderTopLeftRadius)'), 10, delta=0.1)
                nav = self.page.get_by_role('navigation', name='Settings categories')
                typography = nav.get_by_role('button', name='Fonts & text', exact=True)
                typography.click()
                expect(typography).to_have_attribute('aria-pressed', 'true')
                expect(self.page.locator('#settings-content').get_by_role('heading', name='Fonts & text', exact=True)).to_be_visible()
                self.assert_no_horizontal_overflow(self.page.locator('html'))
                # Activate with the keyboard before checking its focus ring.
                # Do not assume Safari is configured to Tab through buttons.
                typography.press('Enter')
                expect(typography).to_be_focused()
                self.assertNotEqual('none', typography.evaluate('e => getComputedStyle(e).outlineStyle'))
                self.capture(f'connect-settings-{mode}-{width}')
                search.fill('NoSuchSettingForThisRegression')
                expect(self.page.locator('#settings-content [role="status"]')).to_contain_text('No matching settings')
                search.fill('')
                expect(self.page.locator('#settings-content').get_by_role('heading', name='Fonts & text', exact=True)).to_be_visible()

    def test_statistics_toolbar_and_options_reflow_and_keep_unique_form_labels(self):
        self.page.goto(self.origin + '/Reader-Web/statistics')
        for width, scale in ((1200, '100%'), (390, '100%'), (320, '200%')):
            self.page.set_viewport_size({'width': width, 'height': 844})
            self.page.evaluate('v => { document.documentElement.style.fontSize = v; scrollTo(0,0); }', scale)
            toolbar = self.page.get_by_role('banner', name='Statistics toolbar')
            self.assert_no_horizontal_overflow(self.page.locator('html'))
            bounds = toolbar.bounding_box()
            self.assertGreaterEqual(self.page.locator('[data-statistics-content]').bounding_box()['y'], bounds['y'] + bounds['height'] - 1)
            heatmap = toolbar.get_by_role('button', name='Heatmap', exact=True)
            heatmap.click()
            expect(heatmap).to_have_attribute('aria-pressed', 'true')
            self.assertEqual('2px', heatmap.evaluate('e => getComputedStyle(e).borderBottomWidth'))
            trigger = toolbar.get_by_role('button', name='Statistics options', exact=True)
            trigger.click()
            self.page.get_by_role('menuitem', name='Statistics Settings', exact=True).click()
            panel = self.page.get_by_role('dialog', name='Statistics options', exact=True)
            expect(panel).to_be_visible()
            self.assert_no_horizontal_overflow(panel)
            self.assertAlmostEqual(panel.bounding_box()['width'], width if width < 640 else min(width, 576), delta=1)
            expect(panel.get_by_label('Start of Week', exact=True)).to_have_count(1)
            ids = panel.locator('[id]').evaluate_all('nodes => nodes.map(n => n.id)')
            self.assertEqual(len(ids), len(set(ids)), 'Every field and accessible title must have a unique ID')
            panel.get_by_label('Template', exact=True).select_option('Custom')
            panel.get_by_label('From', exact=True).fill('2026-04-09')
            panel.get_by_label('To', exact=True).fill('2026-04-12')
            expect(panel.get_by_label('From', exact=True)).to_have_value('2026-04-09')
            expect(panel.get_by_label('To', exact=True)).to_have_value('2026-04-12')
            panel.get_by_label('Start of Week', exact=True).select_option('2')
            self.assertEqual('2', self.page.evaluate('localStorage.getItem("lastStartDayOfWeek")'))
            self.capture(f'connect-statistics-options-{width}')
            for action in ('Download raw history (JSON)', 'Export Selection', 'Export All', 'Delete Selection', 'Delete All'):
                control = panel.get_by_role('button', name=action, exact=True)
                control.scroll_into_view_if_needed()
                expect(control).to_be_in_viewport()
                self.assertLessEqual(control.bounding_box()['x'] + control.bounding_box()['width'], width + 1)
            panel.get_by_role('button', name='Close statistics options', exact=True).click()
            expect(panel).to_have_count(0)
            expect(trigger).to_be_focused()

    def seed_statistics(self):
        self.page.evaluate('''async () => {
          const db = await new Promise((resolve, reject) => {
            const r = indexedDB.open('books');
            r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
          });
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction('statistic', 'readwrite');
              for (let i = 0; i < 61; i++) tx.objectStore('statistic').put({
                title: 'Filter title ' + String(i).padStart(3, '0') + (i === 60 ? ' Café 日本語' : ''),
                dateKey:'2026-09-25', readingTime:60, charactersRead:25,
                minReadingSpeed:1500, altMinReadingSpeed:1500, lastReadingSpeed:1500,
                maxReadingSpeed:1500, lastStatisticModified:100
              });
              tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
            });
          } finally { db.close(); }
        }''')

    def test_title_filter_pages_survive_empty_queries_resize_and_private_drafts(self):
        self.seed_statistics()
        history = self.stores('books', ['statistic'])
        self.page.goto(self.origin + '/Reader-Web/statistics')
        trigger = self.page.get_by_role('button', name='Filter books', exact=True)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Filter books', exact=True)
        expect(panel.get_by_role('checkbox')).to_have_count(25)
        panel.get_by_role('button', name='Next', exact=True).click()
        expect(panel.get_by_text('Page 2 / 3', exact=True)).to_be_visible()
        expect(panel.get_by_role('checkbox').first).to_be_focused()
        expect(panel.get_by_role('checkbox').first).to_be_in_viewport()
        panel.get_by_role('button', name='Next', exact=True).click()
        expect(panel.get_by_role('checkbox')).to_have_count(11)
        expect(panel.get_by_role('checkbox').first).to_be_focused()
        expect(panel.get_by_role('checkbox').first).to_be_in_viewport()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        search = panel.get_by_role('searchbox', name='Filter book titles', exact=True)
        search.fill('no matching title')
        expect(panel.get_by_text('No Titles to filter', exact=True)).to_be_visible()
        expect(panel.get_by_role('checkbox')).to_have_count(0)
        search.fill('CAFÉ')
        expect(panel.get_by_role('checkbox')).to_have_count(1)
        row = panel.get_by_role('checkbox', name='Filter title 060 Café 日本語', exact=True)
        row.uncheck()
        self.capture('connect-title-filter-enlarged')
        self.assert_no_horizontal_overflow(panel)
        panel.get_by_role('button', name='Cancel', exact=True).click()
        expect(panel).to_have_count(0)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Filter books', exact=True)
        panel.get_by_role('searchbox').fill('CAFÉ')
        expect(panel.get_by_role('checkbox')).to_be_checked()
        panel.get_by_role('checkbox').uncheck()
        panel.get_by_role('button', name='Apply Filter', exact=True).click()
        expect(panel).to_have_count(0)
        trigger.click()
        panel = self.page.get_by_role('dialog', name='Filter books', exact=True)
        panel.get_by_role('searchbox').fill('CAFÉ')
        expect(panel.get_by_role('checkbox')).not_to_be_checked()
        panel.get_by_role('button', name='Selected titles only', exact=True).click()
        expect(panel.get_by_role('checkbox')).to_have_count(0)
        panel.get_by_role('button', name='Selected titles only', exact=True).click()
        expect(panel.get_by_role('checkbox')).to_have_count(1)
        self.assertEqual(history, self.stores('books', ['statistic']))
        self.page.keyboard.press('Escape')
        expect(panel).to_have_count(0)
        expect(trigger).to_be_focused()

    def settle_reader_appearance(self, panel):
        # Capture the resulting palette, not the light/dark transition halfway
        # through. Keep real animations enabled and await their actual completion.
        panel.evaluate('''async panel => {
          await new Promise(resolve => requestAnimationFrame(resolve));
          await Promise.all(panel.getAnimations({subtree:true})
            .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {})));
          panel.scrollTop = 0;
        }''')
        self.frames()

    def test_reader_appearance_state_controls_and_themes_remain_reachable_when_enlarged(self):
        self.open_reader()
        reveal = self.page.get_by_role('button', name='Show reading controls', exact=True)
        if reveal.is_visible():
            reveal.click()
        self.page.get_by_role('button', name='Themes & Settings', exact=True).click()
        panel = self.page.get_by_role('dialog', name='Themes & Settings', exact=True)
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        self.settle_reader_appearance(panel)
        self.assert_no_horizontal_overflow(panel)
        for label in ('system', 'light', 'dark'):
            control = panel.get_by_role('button', name=label, exact=True)
            expect(control).to_have_attribute('data-shape', 'rounded')
        panel.get_by_role('button', name='Ecru theme', exact=True).click()
        panel.get_by_role('button', name='dark', exact=True).click()
        expect(self.page.locator('html')).to_have_attribute('data-appearance', 'dark')
        expect(self.page.locator('html')).to_have_attribute('data-theme', 'ecru-theme')
        panel.get_by_label('Reading line spacing', exact=True).select_option('1.9')
        self.settle_reader_appearance(panel)
        self.assert_no_horizontal_overflow(panel)
        bounds = panel.bounding_box()
        self.assertGreaterEqual(bounds['x'], -1)
        self.assertLessEqual(bounds['x'] + bounds['width'], 321)
        self.assertGreaterEqual(bounds['y'], -1)
        self.assertLessEqual(bounds['y'] + bounds['height'], 569)
        title = panel.locator('[data-slot=sheet-title]')
        line_height = title.evaluate('e => parseFloat(getComputedStyle(e).lineHeight)')
        self.assertLessEqual(title.bounding_box()['height'], line_height * 2 + 1)
        self.capture('connect-reader-appearance-enlarged')
        panel.get_by_role('button', name='Close reading appearance', exact=True).click()
        expect(panel).to_have_count(0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
