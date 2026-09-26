"""Built-app EPUB compatibility: first-paint CSS, repeated resources and controls.

The Foliate migration's new imports must remain readable with its activation gate
unset. No DOM implementation, storage write or production renderer is substituted.
"""
import io
import json
import re
import unittest
import zipfile
from playwright.sync_api import expect
from test_epub_publication import EpubPublicationBrowser, resource_epub, TITLE
from test_static_reader import StaticHandler


def identical_spine_epub():
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(resource_epub())) as source, zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            data = source.read(item)
            if item.filename == 'EPUB/book.opf':
                data = data.replace(b'<itemref idref="two"/>', b'<itemref idref="one"/>')
            elif item.filename == 'EPUB/one.xhtml':
                # Generated chapter-link metadata would make the innerHTML differ.
                # This fixture tests truly identical consecutive chapter bodies.
                data = re.sub(rb'<a\b[^>]*>.*?</a>', b'', data)
            target.writestr(item, data)
    return output.getvalue()


class ResourceCompatibilityBrowser(EpubPublicationBrowser):
    def open_legacy_book(self, identical=False):
        settings = {'manabi-dev-foliate-epub':'false', 'viewMode':'paginated',
                    'writingMode':'horizontal-tb', 'hideFurigana':'false', 'hideSpoilerImage':'false'}
        self.context.add_init_script('if (location.origin === ' + json.dumps(self.origin) + ') {'
            'for (const [key,value] of Object.entries(' + json.dumps(settings) + ')) localStorage.setItem(key,value);}')
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name':'resources.epub', 'mimeType':'application/epub+zip',
            'buffer':identical_spine_epub() if identical else resource_epub()
        })
        self.page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
        expect(self.page.locator('.book-content-container .text')).to_be_visible(timeout=30000)
        expect(self.page.locator('foliate-paginator')).to_have_count(0)

    def test_legacy_paginator_mounts_resource_identity_before_first_measurement(self):
        self.context.add_init_script("""(() => {
          window.firstLegacyResource = null;
          const observer = new MutationObserver(() => {
            const content = document.querySelector('.book-content-container');
            const text = content?.querySelector('.text');
            if (!text) return;
            window.firstLegacyResource = {id: content.id,
              index: content.dataset.manabiSpineIndex, color: getComputedStyle(text).color};
            observer.disconnect();
          });
          observer.observe(document, {childList:true,subtree:true});
        })()""")
        self.open_legacy_book()
        self.assertEqual({'id':'ttu-epub-0','index':'0','color':'rgb(180, 0, 0)'},
                         self.page.evaluate('window.firstLegacyResource'))
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        self.assertEqual([], StaticHandler.probes)

    def test_legacy_paginator_distinguishes_consecutive_identical_spine_occurrences(self):
        self.open_legacy_book(identical=True)
        content = self.page.locator('.book-content')
        expect(content).to_have_attribute('aria-busy', 'false')
        for key, index in [('ArrowRight',1),('ArrowRight',2),('ArrowLeft',1),('ArrowLeft',0)]:
            self.page.keyboard.press(key)
            chapter = self.page.locator('.book-content-container')
            expect(chapter).to_have_attribute('data-manabi-spine-index', str(index))
            expect(chapter).to_have_attribute('id', 'ttu-epub-' + str(index))
            expect(content).to_have_attribute('aria-busy', 'false')
            self.assertEqual('rgb(180, 0, 0)', chapter.locator('.text').evaluate('e=>getComputedStyle(e).color'))
            self.assertEqual('かん', chapter.locator('rt').text_content())
        self.assertEqual([], StaticHandler.probes)

    def test_superseded_chapter_turn_back_to_current_body_becomes_ready(self):
        self.open_legacy_book(identical=True)
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        # Deliver both normal reader key handlers before the two-frame mount.
        # Returning to unchanged visible HTML still needs a fresh layout owner.
        self.page.evaluate("""() => {
          for (const key of ['ArrowRight','ArrowLeft'])
            window.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,bubbles:true}));
        }""")
        expect(self.page.locator('.book-content-container')).to_have_attribute('data-manabi-spine-index','0')
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy','false')
        # The reader remains usable after the cancelled replacement.
        self.page.keyboard.press('ArrowRight')
        expect(self.page.locator('.book-content-container')).to_have_attribute('data-manabi-spine-index','1')
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy','false')

    def test_enlarged_reader_toolbar_keeps_all_actions_in_view_and_hit_testable(self):
        self.open_legacy_book()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy', 'false')
        for size in ('100%', '125%', '200%'):
            with self.subTest(font_size=size):
                self.page.set_viewport_size({'width':320,'height':568})
                self.page.evaluate('size=>document.documentElement.style.fontSize=size', size)
                controls = self.page.get_by_role('button', name='Show reading controls', exact=True)
                if controls.is_visible():
                    controls.click()
                toolbar = self.page.get_by_role('banner', name='Reader toolbar')
                expect(toolbar).to_be_visible()
                toolbar.get_by_role('button',name='Reading tools',exact=True).click(trial=True)
                for name in ('Library','Contents','Bookmarks and Notes','Themes & Settings','Reading tools'):
                    button = toolbar.get_by_role('button', name=name, exact=True)
                    bounds = button.evaluate("""e=>{
                      const r=e.getBoundingClientRect(), hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                      return {left:r.left,right:r.right,width:r.width,height:r.height,
                        available:hit===e||e.contains(hit),viewport:innerWidth};
                    }""")
                    self.assertGreaterEqual(bounds['left'],0,bounds)
                    self.assertLessEqual(bounds['right'],bounds['viewport'],bounds)
                    self.assertGreaterEqual(bounds['width'],44,bounds)
                    self.assertGreaterEqual(bounds['height'],44,bounds)
                    self.assertTrue(bounds['available'],bounds)
                toolbar.get_by_role('button',name='Reading tools',exact=True).click()
                expect(self.page.get_by_role('menuitem',name='Dictionary Setup',exact=True)).to_be_visible()
                self.page.keyboard.press('Escape')
        self.page.evaluate('document.documentElement.style.fontSize=""')


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(ResourceCompatibilityBrowser(name) for name in ResourceCompatibilityBrowser.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
