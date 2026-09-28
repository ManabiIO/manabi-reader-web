"""First-visible-node bookmarks through the real paginated app and IndexedDB."""
import io
import zipfile
import unittest
from urllib.parse import parse_qs, urlsplit
from playwright.sync_api import expect
from test_foliate_slide import FoliateSlide, P

TITLE = 'Visible reading count acceptance'
TEXT = '日本語読書学習中'


def progress_epub():
    output = io.BytesIO()
    body = ''.join(f'<p><span id="run-{index}">{TEXT}</span></p>' for index in range(120))
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
        archive.writestr('content.opf', f'''<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>{TITLE}</dc:title><dc:language>ja</dc:language></metadata><manifest>
<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="chapter"/></spine></package>''')
        archive.writestr('chapter.xhtml', f'<html><body>{body}</body></html>')
    return output.getvalue()


class FoliateProgressBoundary(FoliateSlide):
    def open_progress_book(self, vertical):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.context.add_init_script("""(() => {
          localStorage.setItem('manabi-dev-foliate-epub','true');
          localStorage.setItem('viewMode','paginated');
          localStorage.setItem('autoBookmark','false');
        })()""")
        self.context.add_init_script("localStorage.setItem('writingMode','" + ('vertical-rl' if vertical else 'horizontal-tb') + "')")
        self.page.goto(self.origin + '/reader-web/manage')
        expect(self.page.locator('input[type=file][webkitdirectory]')).to_be_attached()
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files({
            'name': 'progress.epub', 'mimeType': 'application/epub+zip', 'buffer': progress_epub()
        })
        self.page.get_by_role('button', name='Read ' + TITLE, exact=True).click(timeout=30000)
        self.page.wait_for_function(f"() => {P}?.page === 1 && {P}?.pages > 4")
        # Observe the actual renderer range. Fixed-length authored nodes give an
        # independent count oracle, without importing the production calculator.
        self.page.evaluate(f"""async () => {{
          const p={P};
          p.addEventListener('relocate', event => {{
            const range=event.detail.range, doc=p.getContents()[0].doc;
            if(!range) return;
            const nodes=[...doc.querySelectorAll('[id^="run-"]')];
            const first=nodes.find(el => {{
              const text=el.firstChild;
              return range.intersectsNode(text) &&
                !(range.startContainer===text && range.startOffset===text.length) &&
                !(range.endContainer===text && range.endOffset===0);
            }});
            window.expectedReadingCount=first ? Number(first.id.slice(4))*{len(TEXT)} : null;
          }});
          await p.goTo({{index:0,anchor:0}});
        }}""")
        self.page.wait_for_function('window.expectedReadingCount === 0')
        return int(parse_qs(urlsplit(self.page.url).query)['id'][0])

    def bookmark(self, book_id):
        self.page.evaluate(f'{P}.getContents()[0].doc.defaultView.focus()')
        self.assertTrue(self.page.evaluate(f'{P}.getContents()[0].doc.hasFocus()'))
        self.page.keyboard.press('b')
        self.page.wait_for_function("""id => new Promise((resolve,reject) => {
          const open=indexedDB.open('books'); open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result;
            const request=db.transaction('bookmark').objectStore('bookmark').get(id);
            request.onerror=()=>{db.close();reject(request.error);};
            request.onsuccess=()=>{db.close();resolve(request.result?.exploredCharCount===window.expectedReadingCount);};};
        })""", arg=book_id)

    def check_first_and_later(self, vertical):
        book_id = self.open_progress_book(vertical)
        self.bookmark(book_id)
        self.assertEqual(0, self.page.evaluate('window.expectedReadingCount'))
        self.page.evaluate(f"""async () => {{
          const p={P};
          for(let i=0;i<3;i++) {{const turn=await p.preparePageTurn(1);if(!turn)throw Error('Missing page');turn.commit();}}
        }}""")
        page = self.pose()['page']
        expected = self.page.evaluate('window.expectedReadingCount')
        self.assertGreater(expected, 0)
        self.bookmark(book_id)
        self.page.reload()
        self.page.wait_for_function(f"() => {P}?.page === {page}")
        self.assertEqual([], self.errors)

    def test_horizontal_bookmarks_start_at_first_visible_node(self):
        self.check_first_and_later(False)

    def test_vertical_bookmarks_start_at_first_visible_node(self):
        self.check_first_and_later(True)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(FoliateProgressBoundary(name) for name in FoliateProgressBoundary.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
