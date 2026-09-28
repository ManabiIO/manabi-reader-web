"""Native renderer regressions for caret geometry and delayed navigation work."""
import io
import unittest
import zipfile
from playwright.sync_api import expect
from test_foliate_slide import FoliateSlide, P

PROBE_BODY = (
    '<span id="navigation-boundary">AB</span>'
    '<h1 id="navigation-start" tabindex="0">Navigation lifetime</h1>'
    '<p id="navigation-caret">ABCD</p><p id="navigation-unicode">A😀</p>'
    + ''.join(f'<p>{i}. 日本語の本を読みます。次のページも丁寧に読みます。</p>'
              for i in range(80))
)


class NavigationChecks:
    def test_final_character_caret_uses_its_own_page(self):
        self.open_navigation_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          const doc = p.getContents()[0].doc;
          const height = doc.documentElement.clientHeight;
          p.setStyles(`body{margin:0;writing-mode:horizontal-tb}
            #navigation-boundary{font-size:400px;line-height:${height}px;word-break:break-all}`);
          p.render();
          const node = doc.getElementById('navigation-boundary').firstChild;
          const range = doc.createRange();
          range.setStart(node,0);range.setEnd(node,1);
          await p.scrollToAnchor(range);const first = p.page;
          range.setStart(node,1);range.setEnd(node,2);
          await p.scrollToAnchor(range);const expected = p.page;
          const caret = doc.createRange();caret.setStart(node,1);caret.collapse(true);
          await p.scrollToAnchor(caret);
          return {first,expected,actual:p.page,offsets:[caret.startOffset,caret.endOffset]};
        }""")
        self.assertGreater(result['expected'], result['first'])
        self.assertEqual(result['actual'], result['expected'])
        self.assertEqual(result['offsets'], [1, 1])

    def test_geometry_does_not_mutate_the_callers_caret(self):
        self.open_navigation_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          const doc = p.getContents()[0].doc;
          const node = doc.getElementById('navigation-caret').firstChild;
          const results = [];
          for (const offset of [0,1,2,3,4]) {
            const range = doc.createRange();range.setStart(node,offset);range.collapse(true);
            await p.scrollToAnchor(range);
            results.push([range.startOffset,range.endOffset,range.collapsed]);
          }
          return results;
        }""")
        self.assertEqual(result, [[i, i, True] for i in range(5)])

    def test_geometry_measures_whole_supplementary_characters(self):
        self.open_navigation_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          const doc = p.getContents()[0].doc;
          const node = doc.getElementById('navigation-unicode').firstChild;
          const prototype = doc.defaultView.Range.prototype;
          const original = prototype.getClientRects;
          const measured = [];
          // Observe bounds but delegate every geometry read to the browser.
          prototype.getClientRects = function() {
            if (this.startContainer === node && this.endContainer === node)
              measured.push([this.startOffset,this.endOffset]);
            return original.call(this);
          };
          try {
            const results = [];
            for (const offset of [1,3]) {
              measured.length = 0;
              const range = doc.createRange();range.setStart(node,offset);range.collapse(true);
              await p.scrollToAnchor(range);
              results.push(measured[0] ?? null);
            }
            return results;
          } finally { prototype.getClientRects = original; }
        }""")
        self.assertEqual(result, [[1, 3], [1, 3]])

    def test_noncollapsed_selection_keeps_its_bounds(self):
        self.open_navigation_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          const doc = p.getContents()[0].doc;
          const node = doc.getElementById('navigation-caret').firstChild;
          const range = doc.createRange();range.setStart(node,1);range.setEnd(node,3);
          await p.scrollToAnchor(range,true);
          return {offsets:[range.startOffset,range.endOffset],text:range.toString()};
        }""")
        self.assertEqual(result, {'offsets': [1, 3], 'text': 'BC'})

    def check_failed_turn_retry(self, direction, failure_phase):
        self.open_navigation_book()
        result = self.page.evaluate("""async ({direction,failurePhase}) => {
          const p = document.querySelector('foliate-paginator');
          await p.goTo({index:direction > 0 ? 0 : 1,anchor:direction > 0 ? 1 : 0});
          const section = p.sections[direction > 0 ? 1 : 0];
          const load = section.load, styles = p.setStyles;
          const failure = new Error('Controlled stylesheet application failure');
          let rejected = false;
          if (failurePhase === 'view') section.load = async () => 17;
          else p.setStyles = () => { throw failure; };
          try {
            try { await (direction > 0 ? p.next() : p.prev()); }
            catch (error) {
              rejected = failurePhase === 'view' ? error.message === '17 is not string' : error === failure;
            }
          } finally { section.load = load;p.setStyles = styles; }
          const accepted = await p.goTo({index:2});
          return {rejected,accepted,index:p.getContents()[0].index};
        }""", {'direction': direction, 'failurePhase': failure_phase})
        self.assertEqual(result, {'rejected': True, 'accepted': True, 'index': 2})

    def test_next_recovers_after_view_load_rejection(self):
        self.check_failed_turn_retry(1, 'view')

    def test_previous_recovers_after_stylesheet_application_rejection(self):
        self.check_failed_turn_retry(-1, 'styles')

    def test_section_load_failure_remains_reported_and_retryable(self):
        self.open_navigation_book()
        result = self.page.evaluate("""async () => {
          const p = document.querySelector('foliate-paginator');
          await p.goTo({index:0,anchor:1});
          const section = p.sections[1],load = section.load;
          const failure = new Error('Controlled section read failure');
          let reported = false;
          const onError = event => { reported ||= event.detail === failure; };
          p.addEventListener('navigationerror',onError);
          section.load = async () => { throw failure; };
          try { await p.next(); }
          finally { section.load = load;p.removeEventListener('navigationerror',onError); }
          const accepted = await p.goTo({index:1});
          return {reported,accepted,index:p.getContents()[0].index};
        }""")
        self.assertEqual(result, {'reported': True, 'accepted': True, 'index': 1})

    def check_focus_lifetime(self, mode):
        self.open_navigation_book()
        result = self.page.evaluate("""async mode => {
          const p = document.querySelector('foliate-paginator');
          const doc = p.getContents()[0].doc;
          const target = doc.getElementById('navigation-start');
          // Hold only the frame requested synchronously by this focus event.
          // All other frames, geometry and navigation use the real renderer.
          const held = [], raf = window.requestAnimationFrame;
          if (mode === 'removed' || mode === 'active') await p.goTo({index:0,anchor:1});
          window.requestAnimationFrame = callback => { held.push(callback);return 0; };
          try { target.dispatchEvent(new FocusEvent('focusin',{bubbles:true})); }
          finally { window.requestAnimationFrame = raf; }
          if (mode === 'removed') target.remove();
          else if (mode === 'destroyed') p.destroy();
          else if (mode !== 'active') await p.goTo({index:mode === 'cross' ? 1 : 0,anchor:1});
          for (const callback of held) callback(performance.now());
          if (mode === 'destroyed') return {held:held.length,contents:p.getContents().length};
          if (mode === 'active') return {held:held.length,page:p.page};
          // An obsolete detached anchor otherwise leaves the resized renderer
          // on its blank trailing sentinel instead of the final text page.
          if (mode !== 'same') { p.style.height = '1000px';p.render(); }
          return {held:held.length,index:p.getContents()[0].index,page:p.page,last:p.pages-2};
        }""", mode)
        self.assertEqual(result['held'], 1)
        if mode == 'destroyed':
            self.assertEqual(result['contents'], 0)
        elif mode == 'active':
            self.assertEqual(result['page'], 1)
        else:
            self.assertEqual(result['index'], 1 if mode == 'cross' else 0)
            self.assertEqual(result['page'], result['last'])

    def test_old_focus_cannot_override_new_same_chapter_navigation(self):
        self.check_focus_lifetime('same')

    def test_departed_chapter_focus_cannot_corrupt_reflow_anchor(self):
        self.check_focus_lifetime('cross')

    def test_removed_focus_target_cannot_corrupt_reflow_anchor(self):
        self.check_focus_lifetime('removed')

    def test_current_document_focus_still_reveals_its_target(self):
        self.check_focus_lifetime('active')

    def test_destroyed_reader_ignores_queued_focus(self):
        self.check_focus_lifetime('destroyed')


class FoliateNavigation(NavigationChecks, FoliateSlide):
    def open_navigation_book(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        output = io.BytesIO()
        title = 'Navigation lifetime acceptance'
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('mimetype', 'application/epub+zip')
            archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
            manifest = ''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(3))
            spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(3))
            archive.writestr('content.opf', f'<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">{title}</dc:title></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>')
            for i in range(3):
                archive.writestr(f'c{i}.xhtml', '<html><body>' + PROBE_BODY + '</body></html>')
        self.context.add_init_script("localStorage.setItem('manabi-dev-foliate-epub','true');localStorage.setItem('viewMode','paginated');localStorage.setItem('writingMode','horizontal-tb')")
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'navigation.epub', 'mimeType': 'application/epub+zip', 'buffer': output.getvalue()})
        self.page.get_by_role('button', name='Read ' + title, exact=True).click()
        self.page.wait_for_function(f"() => {P}?.pageCounts.length === 3 && {P}.pageCounts.every(Number.isFinite)")


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(FoliateNavigation(name) for name in sorted(NavigationChecks.__dict__)
                              if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
