"""App Store Connect-inspired workspace refinement against the real static app."""
from reader_controls import reveal_reader_controls
import unittest
from playwright.sync_api import expect
import test_apple_controls as previous
from test_reader_navigation_panels import ReaderNavigationPanels

# Retain the existing catalog and continuation suites exactly once.
CatalogLifetimeBrowser = previous.CatalogLifetimeBrowser


class ConnectControlsBrowser(ReaderNavigationPanels, previous.AppleControlsBrowser):
    def assert_no_horizontal_overflow(self, root):
        # The root's clientWidth excludes a native vertical scrollbar. Compare
        # it with the full viewport, but keep real horizontal overflow visible.
        result = root.evaluate('''e => {
          const rootPage = e === document.documentElement;
          const delta = e.scrollWidth - (rootPage ? window.innerWidth : e.clientWidth);
          if (delta <= 1 || !rootPage) return {delta};
          const clippedByAncestor = node => {
            for (let parent = node.parentElement; parent && parent !== e; parent = parent.parentElement)
              if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowX)) return true;
            return false;
          };
          const offenders = [...document.querySelectorAll('*')]
            .filter(node => node.getBoundingClientRect().right > window.innerWidth + 1 && !clippedByAncestor(node))
            .slice(0, 12)
            .map(node => ({tag: node.tagName, className: typeof node.className === 'string' ? node.className.slice(0, 90) : '', text: node.textContent?.trim().slice(0, 35), right: Math.round(node.getBoundingClientRect().right)}));
          return {delta, viewport: window.innerWidth, client: e.clientWidth, scroll: e.scrollWidth, offenders};
        }''')
        self.assertLessEqual(result['delta'], 1, result)

    def test_primary_workspaces_remain_operable_in_short_enlarged_viewport(self):
        self.page.set_viewport_size({'width': 320, 'height': 320})
        cases = (
            (
                '/reader-web/manage',
                lambda: self.page.get_by_role('banner', name='Library toolbar', exact=True),
                lambda: self.page.get_by_role('button', name='Collections', exact=True),
                'library'
            ),
            (
                '/reader-web/snippets',
                lambda: self.page.get_by_role('heading', name='Snippets', exact=True),
                lambda: self.page.get_by_role('button', name='New snippet', exact=True),
                'snippets'
            ),
            (
                '/reader-web/statistics',
                lambda: self.page.get_by_role('banner', name='Statistics toolbar', exact=True),
                lambda: self.page.get_by_role('button', name='Statistics options', exact=True),
                'statistics'
            ),
            (
                '/reader-web/settings',
                lambda: self.page.get_by_role('heading', name='Settings', exact=True),
                lambda: self.page.get_by_role('searchbox', name='Search settings', exact=True),
                'settings'
            ),
            (
                '/reader-web/connections',
                lambda: self.page.get_by_role('heading', name='Accounts and libraries', exact=True),
                lambda: self.page.get_by_role('link', name='Sign in to Manabi', exact=True),
                'connections'
            ),
        )

        for route, ready, action, label in cases:
            with self.subTest(route=route):
                self.page.goto(self.origin + route)
                self.page.evaluate('''() => {
                  document.documentElement.style.fontSize = "200%";
                  scrollTo(0, 0);
                }''')
                expect(ready()).to_be_visible()
                self.assert_no_horizontal_overflow(self.page.locator('html'))

                control = action()
                expect(control).to_be_attached()
                control.scroll_into_view_if_needed()
                expect(control).to_be_visible()
                box = control.bounding_box()
                self.assertGreaterEqual(box['height'], 43.99, (route, box))
                self.assertGreaterEqual(box['x'], -1, (route, box))
                self.assertGreaterEqual(box['y'], -1, (route, box))
                self.assertLessEqual(box['x'] + box['width'], 321, (route, box))
                self.assertLessEqual(box['y'] + box['height'], 321, (route, box))
                self.assertTrue(control.evaluate('''e => {
                  const r=e.getBoundingClientRect();
                  const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
                  return !!hit && (hit===e || e.contains(hit));
                }'''), route)

                control.focus()
                expect(control).to_be_focused()
                self.assertNotEqual(
                    'none',
                    control.evaluate('e => getComputedStyle(e).outlineStyle'),
                    route
                )
                self.assert_no_horizontal_overflow(self.page.locator('html'))
                self.capture(f'connect-short-enlarged-{label}')

        self.page.evaluate('document.documentElement.style.fontSize = ""')

    def test_settings_navigation_and_fields_distinguish_selection_from_actions(self):
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            for width, scale in ((1440, '100%'), (390, '100%'), (320, '200%')):
                self.page.set_viewport_size({'width': width, 'height': 844})
                self.page.goto(self.origin + '/reader-web/settings')
                self.page.evaluate('v => document.documentElement.style.fontSize = v', scale)
                search = self.page.get_by_role('searchbox', name='Search settings', exact=True)
                expect(search).to_be_visible()
                self.assertGreaterEqual(search.bounding_box()['height'], 43.99)
                header = self.page.locator('header').first.bounding_box()
                self.assertGreaterEqual(self.page.locator('[data-settings-content]').bounding_box()['y'], header['y'] + header['height'] - 1)
                self.assertAlmostEqual(search.evaluate('e => parseFloat(getComputedStyle(e).borderTopLeftRadius)'), 10, delta=0.1)
                if width >= 1280:
                    primary = self.page.get_by_role('navigation', name='Primary navigation')
                    for destination in ('Library', 'Statistics', 'Settings'):
                        expect(primary.get_by_role('link', name=destination, exact=True)).to_be_visible()
                    expect(primary.get_by_role('link', name='Settings', exact=True)).to_have_attribute(
                        'aria-current', 'page'
                    )
                nav = self.page.get_by_role('navigation', name='Settings categories')
                typography = nav.get_by_role('link', name='Fonts & text', exact=True)
                typography.click()
                expect(typography).to_have_attribute('aria-current', 'page')
                expect(self.page.locator('#settings-content').get_by_role('heading', name='Fonts & text', exact=True)).to_be_visible()
                self.assert_no_horizontal_overflow(self.page.locator('html'))
                # Activate with the keyboard before checking its focus ring.
                # Do not assume Safari is configured to Tab through links.
                typography.press('Enter')
                expect(typography).to_be_focused()
                self.assertNotEqual('none', typography.evaluate('e => getComputedStyle(e).outlineStyle'))
                self.capture(f'connect-settings-{mode}-{width}')
                search.fill('NoSuchSettingForThisRegression')
                expect(self.page.get_by_role('status', name='Settings search results', exact=True)).to_contain_text('No matching settings')
                search.fill('')
                expect(self.page.locator('#settings-content').get_by_role('heading', name='Fonts & text', exact=True)).to_be_visible()

    def test_primary_workspace_navigation_appears_at_standard_desktop_width(self):
        self.page.set_viewport_size({'width': 1024, 'height': 768})
        self.page.goto(self.origin + '/reader-web/settings')
        primary = self.page.get_by_role('navigation', name='Primary navigation')
        for destination in ('Library', 'Snippets', 'Statistics', 'Settings'):
            expect(primary.get_by_role('link', name=destination, exact=True)).to_be_visible()
        expect(primary.get_by_role('link', name='Settings', exact=True)).to_have_attribute(
            'aria-current', 'page'
        )
        self.assert_no_horizontal_overflow(self.page.locator('html'))

    def test_settings_section_links_follow_url_history_without_scrolling(self):
        self.page.set_viewport_size({'width': 1200, 'height': 844})
        self.page.goto(self.origin + '/reader-web/settings')
        nav = self.page.get_by_role('navigation', name='Settings categories')
        typography = nav.get_by_role('link', name='Fonts & text', exact=True)
        layout = nav.get_by_role('link', name='Page layout', exact=True)

        start_scroll = self.page.evaluate('scrollY')
        typography.click()
        expect(self.page).to_have_url(self.origin + '/reader-web/settings#typography')
        expect(typography).to_have_attribute('aria-current', 'page')
        expect(
            self.page.locator('#settings-content').get_by_role(
                'heading', name='Fonts & text', exact=True
            )
        ).to_be_visible()
        self.assertEqual(start_scroll, self.page.evaluate('scrollY'))

        layout.click()
        expect(self.page).to_have_url(self.origin + '/reader-web/settings#layout')
        expect(layout).to_have_attribute('aria-current', 'page')
        expect(
            self.page.locator('#settings-content').get_by_role(
                'heading', name='Page layout', exact=True
            )
        ).to_be_visible()

        self.page.go_back()
        expect(self.page).to_have_url(self.origin + '/reader-web/settings#typography')
        expect(typography).to_have_attribute('aria-current', 'page')
        expect(
            self.page.locator('#settings-content').get_by_role(
                'heading', name='Fonts & text', exact=True
            )
        ).to_be_visible()

        self.page.go_back()
        expect(self.page).to_have_url(self.origin + '/reader-web/settings')
        appearance = nav.get_by_role('link', name='Appearance', exact=True)
        expect(appearance).to_have_attribute('aria-current', 'page')
        expect(
            self.page.locator('#settings-content').get_by_role(
                'heading', name='Appearance', exact=True
            )
        ).to_be_visible()

    def test_connections_workspace_uses_shared_action_hierarchy(self):
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            for width, scale in ((390, '100%'), (320, '200%')):
                self.page.set_viewport_size({'width': width, 'height': 844})
                self.page.goto(self.origin + '/reader-web/connections')
                self.page.evaluate('v => document.documentElement.style.fontSize = v', scale)
                heading = self.page.get_by_role('heading', name='Accounts and libraries', exact=True)
                expect(heading).to_be_visible()
                context = self.page.get_by_role('navigation', name='Context navigation')
                expect(context.get_by_role('link', name='Back to Library', exact=True)).to_be_visible()
                expect(context.get_by_role('link')).to_have_count(1)
                sign_in = self.page.get_by_role('link', name='Sign in to Manabi', exact=True)
                create = self.page.get_by_role('link', name='Create a Manabi account', exact=True)
                expect(sign_in).to_have_attribute('data-variant', 'default')
                expect(sign_in).to_have_attribute('data-size', 'lg')
                expect(create).to_have_attribute('data-variant', 'outline')
                expect(self.page.get_by_role('button', name='Refresh connections', exact=True)).to_have_attribute(
                    'data-variant', 'ghost'
                )
                self.assert_no_horizontal_overflow(self.page.locator('html'))
                if scale == '200%':
                    self.assertEqual(
                        [1, 1],
                        heading.evaluate('''e => {
                          const node = e.firstChild;
                          const value = node.textContent;
                          return ['Accounts', 'libraries'].map(word => {
                            const start = value.indexOf(word);
                            const range = document.createRange();
                            range.setStart(node, start);
                            range.setEnd(node, start + word.length);
                            return range.getClientRects().length;
                          });
                        }''')
                    )
                first_section = self.page.locator('.connections-page > section').first
                self.assertAlmostEqual(
                    first_section.evaluate('e => parseFloat(getComputedStyle(e).borderTopLeftRadius)'),
                    16,
                    delta=0.1
                )
                self.capture(f'connect-connections-{mode}-{width}')

    def test_shared_library_workspace_reflows_like_other_management_pages(self):
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            self.page.set_viewport_size({'width': 320, 'height': 844})
            self.page.goto(self.origin + '/reader-web/shared-library')
            self.page.evaluate('document.documentElement.style.fontSize = "200%"')
            heading = self.page.get_by_role(
                'heading', name='Shared Ttu Ebook Reader libraries', exact=True
            )
            expect(heading).to_be_visible()
            context = self.page.get_by_role('navigation', name='Context navigation')
            expect(
                context.get_by_role('link', name='Back to Accounts and libraries', exact=True)
            ).to_be_visible()
            expect(context.get_by_role('link')).to_have_count(1)
            self.assert_no_horizontal_overflow(self.page.locator('html'))
            self.assertEqual(
                [1, 1, 1],
                heading.evaluate('''e => {
                  const node = e.firstChild;
                  const value = node.textContent;
                  return ['Shared', 'Ebook', 'libraries'].map(word => {
                    const start = value.indexOf(word);
                    const range = document.createRange();
                    range.setStart(node, start);
                    range.setEnd(node, start + word.length);
                    return range.getClientRects().length;
                  });
                }''')
            )
            first_section = self.page.locator('main > section').first
            self.assertAlmostEqual(
                first_section.evaluate('e => parseFloat(getComputedStyle(e).borderTopLeftRadius)'),
                16,
                delta=0.1
            )
            add = self.page.get_by_role('button', name='Add existing shared folder', exact=True)
            if add.count():
                expect(add).to_have_attribute('data-variant', 'default')
                expect(
                    self.page.get_by_role(
                        'button', name='Create shared library in a folder', exact=True
                    )
                ).to_have_attribute('data-variant', 'outline')
            self.capture(f'connect-shared-library-{mode}-320')

    def test_import_workspace_uses_management_hierarchy_at_enlarged_text(self):
        for mode in ('light', 'dark'):
            self.page.evaluate('v => localStorage.setItem("appearance", v)', mode)
            self.page.set_viewport_size({'width': 320, 'height': 844})
            self.page.goto(self.origin + '/reader-web/import-ttu')
            self.page.evaluate('document.documentElement.style.fontSize = "200%"')

            heading = self.page.get_by_role(
                'heading', name='Import from Ttu Ebook Reader', exact=True
            )
            expect(heading).to_be_visible()
            context = self.page.get_by_role('navigation', name='Context navigation')
            expect(context.get_by_role('link', name='Back to Library', exact=True)).to_be_visible()
            expect(context.get_by_role('link')).to_have_count(1)
            file_input = self.page.get_by_label('Choose Ttu export ZIPs', exact=True)
            expect(file_input).to_be_visible()
            self.assertGreaterEqual(file_input.bounding_box()['height'], 43.99)
            self.assert_no_horizontal_overflow(self.page.locator('html'))
            self.assertEqual(
                [1, 1, 1],
                heading.evaluate('''e => {
                  const node = e.firstChild;
                  const value = node.textContent;
                  return ['Import', 'Ebook', 'Reader'].map(word => {
                    const start = value.indexOf(word);
                    const range = document.createRange();
                    range.setStart(node, start);
                    range.setEnd(node, start + word.length);
                    return range.getClientRects().length;
                  });
                }''')
            )
            instructions = self.page.locator('.migration-page > section').first
            self.assertAlmostEqual(
                instructions.evaluate('e => parseFloat(getComputedStyle(e).borderTopLeftRadius)'),
                16,
                delta=0.1
            )
            self.capture(f'connect-import-ttu-{mode}-320')

    def test_reading_goals_use_labeled_fields_and_native_sync_controls(self):
        self.page.set_viewport_size({'width': 320, 'height': 844})
        self.page.goto(self.origin + '/reader-web/settings#tracking')
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')

        statistics = self.page.get_by_role('switch', name='Enable Statistics', exact=True)
        if not statistics.is_checked():
            statistics.check()

        goals = self.page.locator('[data-setting="reading-goals"]')
        expect(goals).to_be_visible()
        expect(goals.get_by_role('heading', name='Reading goals', exact=True)).to_have_count(1)
        self.assert_no_horizontal_overflow(self.page.locator('html'))

        sync = goals.get_by_role('button', name='Sync', exact=True)
        edit = goals.get_by_role('button', name='Edit', exact=True)
        reset = goals.get_by_role('button', name='Reset', exact=True)
        expect(sync).to_have_attribute('data-variant', 'outline')
        expect(edit).to_have_attribute('data-variant', 'secondary')
        expect(reset).to_have_attribute('data-variant', 'destructive')
        expect(reset).to_be_disabled()

        fields = (
            ('Time goal (minutes)', 'spinbutton'),
            ('Character goal', 'spinbutton'),
            ('Frequency', 'combobox'),
            ('Start date', None)
        )
        for label, role in fields:
            field = goals.get_by_label(label, exact=True)
            expect(field).to_be_visible()
            self.assertGreaterEqual(field.bounding_box()['height'], 43.99)
            expect(field).to_be_disabled()

        edit.click()
        for label, _ in fields:
            expect(goals.get_by_label(label, exact=True)).to_be_enabled()
        expect(goals.get_by_role('button', name='Save', exact=True)).to_have_attribute(
            'data-variant', 'default'
        )
        cancel = goals.get_by_role('button', name='Cancel', exact=True)
        expect(cancel).to_have_attribute('data-variant', 'ghost')
        cancel.click()

        sync.click()
        dialog = self.page.locator('[data-slot="dialog-content"]')
        expect(dialog).to_be_visible()
        title = dialog.get_by_text('Sync Reading Goals', exact=True)
        expect(title).to_be_visible()
        title_box = title.bounding_box()
        panel_box = dialog.locator('section.ui-panel').bounding_box()
        self.assertGreaterEqual(title_box['width'], panel_box['width'] * 0.7)
        source = dialog.get_by_label('Source', exact=True)
        target = dialog.get_by_label('Target', exact=True)
        self.assertGreaterEqual(source.bounding_box()['height'], 43.99)
        self.assertGreaterEqual(target.bounding_box()['height'], 43.99)
        swap = dialog.get_by_role('button', name='Swap sync source and target', exact=True)
        self.assertEqual('BUTTON', swap.evaluate('e => e.tagName'))
        expect(swap).to_be_disabled()
        expect(dialog.get_by_role('button', name='Cancel', exact=True)).to_have_attribute(
            'data-variant', 'ghost'
        )
        expect(dialog.get_by_role('button', name='Confirm', exact=True)).to_have_attribute(
            'data-variant', 'default'
        )
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        expect(dialog).to_have_count(0)

    def test_advanced_storage_editor_labels_the_correct_controls(self):
        self.page.set_viewport_size({'width': 320, 'height': 844})
        self.page.goto(self.origin + '/reader-web/settings#library')
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')

        storage = self.page.locator('[data-setting="storage-sources"]')
        expect(storage).to_be_visible()
        expect(storage.get_by_role('heading', name='Storage sources', exact=True)).to_have_count(1)
        add = storage.get_by_role('button', name='Add source', exact=True)
        expect(add).to_have_attribute('data-variant', 'outline')
        expect(add).to_be_enabled(timeout=15000)
        add.click()

        dialog = self.page.locator('[data-slot="dialog-content"]')
        expect(dialog).to_be_visible()
        name = dialog.get_by_label('Name', exact=True)
        sync_target = dialog.get_by_label('Is Sync Target', exact=True)
        source_default = dialog.get_by_label('Is Source Default', exact=True)
        source_type = dialog.get_by_label('Storage type', exact=True)
        client_id = dialog.get_by_label('Client ID', exact=True)
        client_secret = dialog.get_by_label('Client Secret', exact=True)
        password = dialog.get_by_label('Password', exact=True)
        confirm = dialog.get_by_label('Confirm Password', exact=True)

        for field in (name, source_type, client_id, client_secret, password, confirm):
            expect(field).to_be_visible()
            self.assertGreaterEqual(field.bounding_box()['height'], 43.99)

        expect(sync_target).not_to_be_checked()
        expect(source_default).not_to_be_checked()
        source_default.check()
        expect(source_default).to_be_checked()
        expect(sync_target).not_to_be_checked()
        sync_target.check()
        expect(sync_target).to_be_checked()
        expect(source_default).to_be_checked()

        expect(dialog.get_by_role('button', name='Cancel', exact=True)).to_have_attribute(
            'data-variant', 'ghost'
        )
        expect(dialog.get_by_role('button', name='Save', exact=True)).to_have_attribute(
            'data-variant', 'default'
        )
        self.assertLessEqual(dialog.evaluate('e => e.scrollWidth - e.clientWidth'), 1)
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        expect(dialog).to_have_count(0)

    def test_statistics_toolbar_and_options_reflow_and_keep_unique_form_labels(self):
        self.page.goto(self.origin + '/reader-web/statistics')
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
            filter_books = toolbar.get_by_role('button', name='Filter books', exact=True)
            expect(filter_books).to_have_attribute('data-variant', 'secondary')
            trigger = toolbar.get_by_role('button', name='Statistics options', exact=True)
            expect(trigger).to_have_attribute('data-variant', 'secondary')
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

    def test_heatmap_days_are_real_keyboard_actions(self):
        self.seed_statistics()
        self.page.goto(self.origin + '/reader-web/statistics')
        self.page.get_by_role('button', name='Heatmap', exact=True).click()
        day = self.page.locator('[data-date="2026-09-25"]')
        self.assertEqual('BUTTON', day.evaluate('e => e.tagName'))
        expect(day).to_have_attribute('aria-disabled', 'false')
        # The calendar is one Tab stop; directly focusing a day makes it the
        # retained roving stop, regardless of the machine's current date.
        day.focus()
        expect(day).to_have_attribute('tabindex', '0')
        expect(self.page.locator('.heatmap-calendar button[tabindex="0"]')).to_have_count(1)
        day.press('Enter')
        close = self.page.get_by_role('button', name='Close heatmap details', exact=True)
        expect(close).to_be_visible()
        close.click()
        day.focus()
        day.press(' ')
        expect(self.page.get_by_role('button', name='Close heatmap details', exact=True)).to_be_visible()

    def test_title_filter_pages_survive_empty_queries_resize_and_private_drafts(self):
        self.seed_statistics()
        history = self.stores('books', ['statistic'])
        self.page.goto(self.origin + '/reader-web/statistics')
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
        expect(panel.get_by_role('button', name='Close title filter', exact=True)).to_be_in_viewport()
        expect(panel.get_by_role('button', name='Apply Filter', exact=True)).to_be_in_viewport()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.page.evaluate('document.documentElement.style.fontSize = "200%"')
        search = panel.get_by_role('searchbox', name='Filter book titles', exact=True)
        search.fill('no matching title')
        expect(panel.get_by_text('No Titles to filter', exact=True)).to_be_visible()
        expect(panel.get_by_role('checkbox')).to_have_count(0)
        search.fill('CAFÉ')
        expect(panel.get_by_role('checkbox')).to_have_count(1)
        row = panel.get_by_role('checkbox', name='Filter title 060 Café 日本語', exact=True)
        panel.get_by_role('button', name='Remove matching', exact=True).click()
        expect(row).not_to_be_checked()
        expect(panel.get_by_role('status')).to_contain_text('60 selected')
        search.fill('')
        expect(panel.get_by_role('checkbox', name='Filter title 000', exact=True)).to_be_checked()
        search.fill('CAFÉ')
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
        reveal_reader_controls(self.page)
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
