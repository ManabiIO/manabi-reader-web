"""Real DOM/Blob-frame EPUB regressions, separate from built-application acceptance."""
import base64
import io
import json
import os
from pathlib import Path
import unittest
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import zipfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as result:
        for name, content in files.items():
            result.writestr(name, content)
    return base64.b64encode(output.getvalue()).decode()


def fixture():
    return {
        'mimetype': 'application/epub+zip',
        'META-INF/container.xml': '''<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>''',
        'OPS/package.opf': '''<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB resource regression</dc:title><dc:identifier id="id">urn:uuid:fixture</dc:identifier><dc:language>ja</dc:language><dc:creator id="author">著者</dc:creator><meta refines="#author" property="file-as">ちょしゃ</meta></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav scripted" media-type="application/xhtml+xml"/><item id="css" href="css/main.css" media-type="text/css"/><item id="import" href="css/import.css" media-type="text/css"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="a"/></spine></package>''',
        'OPS/a.xhtml': '''<html xmlns="http://www.w3.org/1999/xhtml" lang="ja"><head><title>A</title><link rel="stylesheet" href="css/main.css"/></head><body><p class="same" id="note"><ruby>漢<rt>かん</rt></ruby>字𠮷</p><a href="b.xhtml#note">次へ</a><a href="#note">ここ</a>''' + '<p>日本語の長い文章を丁寧に読みます。次のページも続けて読みます。</p>' * 120 + '</body></html>',
        'OPS/b.xhtml': '''<html xmlns="http://www.w3.org/1999/xhtml"><head><title>B</title><style>.same{color:blue}</style></head><body><p class="same" id="note">別の注釈</p></body></html>''',
        'OPS/css/main.css': '@import "import.css"; body{line-height:1.9} .same{color:rgb(0,128,0)}',
        'OPS/css/import.css': '.same{font-style:italic}',
        'OPS/nav.xhtml': '''<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="a.xhtml">本文</a></li><li><a href="b.xhtml">注釈</a></li></ol></nav></body></html>'''
    }


class HarnessHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'<!doctype html><html><head><style>body{margin:0}</style></head><body></body></html>'
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class EpubBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), HarnessHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.playwright = sync_playwright().start()
        engine = os.environ.get('EPUB_BROWSER', 'chromium')
        options = {}
        if os.environ.get('EPUB_BROWSER_EXECUTABLE'):
            options['executable_path'] = os.environ['EPUB_BROWSER_EXECUTABLE']
        cls.browser = getattr(cls.playwright, engine).launch(**options)
        cls.harness = (ROOT / 'test-results/epub-harness.js').read_text()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1100, 'height': 850})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(self.origin)
        self.page.add_script_tag(content=self.harness)

    def tearDown(self):
        try:
            self.page.evaluate('window.reader?.destroy(); window.publication?.book.destroy()')
        finally:
            self.context.close()
        self.assertEqual([], self.errors)

    def import_book(self, files=None, mode='basic'):
        return self.page.evaluate('''async ({data,mode}) => {
          const bytes=Uint8Array.from(atob(data),char=>char.charCodeAt(0));
          window.bookData=await EpubTest.importEpubPublication(new File([bytes],'fixture.epub'),document,0,{mode,anchorsOnly:false});
          return {title:bookData.title,creators:bookData.creators,sections:bookData.sections,
            manifest:bookData.publicationManifest,publication:bookData.epubPublication,characters:bookData.characters};
        }''', {'data': archive(files or fixture()), 'mode': mode})

    def open_reader(self):
        self.import_book()
        result = self.page.evaluate('''async () => {
          window.publication=EpubTest.createStoredFoliateBook(bookData.elementHtml,bookData.styleSheet,bookData.publicationManifest,document,{resources:bookData.epubPublication.resources});
          const p=window.reader=document.createElement('foliate-paginator');
          p.style.cssText='width:600px;height:700px';p.setAttribute('flow','paginated');p.setAttribute('margin','16px');
          document.body.append(p);p.open(publication.book);
          p.setStyles('body{font-family:serif;font-size:18px;line-height:1.8}');
          window.loads=[];window.navErrors=[];
          p.addEventListener('load', e=>loads.push(e.detail.index));
          p.addEventListener('navigationerror',e=>navErrors.push(e.detail.message));
          return p.goTo({index:0});
        }''')
        self.assertTrue(result)
        self.page.wait_for_function('reader.getContents()[0]?.doc.fonts.status === "loaded" && reader.pages > 3')

    def test_primary_import_preserves_resources_metadata_and_spine_occurrences(self):
        data = self.import_book()
        self.assertEqual(data['creators'], [{'name': '著者', 'sortAs': 'ちょしゃ'}])
        self.assertEqual([r['href'] for r in data['manifest']['resources']], ['OPS/a.xhtml', 'OPS/b.xhtml', 'OPS/a.xhtml'])
        self.assertEqual([r['spineIndex'] for r in data['manifest']['resources']], [0, 1, 2])
        self.assertEqual([s['label'] for s in data['sections']], ['本文', '注釈', '本文'])
        self.assertEqual(data['characters'], sum(r['characters'] for r in data['publication']['resources']))

    def test_resource_links_keep_duplicate_fragments_and_the_owner_occurrence(self):
        self.import_book()
        result = self.page.evaluate('''() => bookData.epubPublication.resources.map(r=>{
          const d=new DOMParser().parseFromString(r.html,'text/html');
          return [...d.querySelectorAll('a')].map(a=>[a.dataset.manabiTargetSpineIndex,a.dataset.manabiTargetFragment]);
        })''')
        self.assertEqual(result, [[['1', 'note'], ['0', 'note']], [], [['1', 'note'], ['2', 'note']]])

    def test_per_resource_styles_and_local_imports_do_not_leak_between_chapters(self):
        self.open_reader()
        result = self.page.evaluate('''async()=>{
          const first=reader.getContents()[0].doc;
          const a=first.defaultView.getComputedStyle(first.querySelector('.same'));
          const before={color:a.color,style:a.fontStyle};
          await reader.goTo({index:1});
          const second=reader.getContents()[0].doc;
          const b=second.defaultView.getComputedStyle(second.querySelector('.same'));
          return {before,after:{color:b.color,style:b.fontStyle}};
        }''')
        self.assertEqual(result, {'before': {'color': 'rgb(0, 128, 0)', 'style': 'italic'}, 'after': {'color': 'rgb(0, 0, 255)', 'style': 'normal'}})

    def test_namespace_less_legacy_packages_still_use_the_primary_parser(self):
        files = fixture()
        files['META-INF/container.xml'] = '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>'
        files['OPS/package.opf'] = files['OPS/package.opf'].replace(' xmlns="http://www.idpf.org/2007/opf"', '')
        data = self.import_book(files)
        self.assertEqual(len(data['publication']['resources']), 3)
        self.assertEqual(data['title'], 'EPUB resource regression')

    def test_fallbacks_keep_spine_slots_and_cycles_fail_without_silently_skipping_content(self):
        files = fixture()
        files['OPS/package.opf'] = files['OPS/package.opf'].replace('<manifest>', '<manifest><item id="foreign" href="foreign.dat" media-type="application/x-test" fallback="a"/>').replace('idref="a"', 'idref="foreign"')
        self.assertEqual(len(self.import_book(files)['publication']['resources']), 3)
        files['OPS/package.opf'] = files['OPS/package.opf'].replace('fallback="a"', 'fallback="foreign"')
        with self.assertRaisesRegex(Exception, 'fallback'):
            self.import_book(files)

    def test_path_escape_and_duplicate_manifest_ids_remain_hard_failures(self):
        for replacement in ['<item id="a" href="../../escape.xhtml" media-type="application/xhtml+xml"/>', '<item id="a" href="other.xhtml" media-type="application/xhtml+xml"/>']:
            files = fixture()
            files['OPS/package.opf'] = files['OPS/package.opf'].replace('<manifest>', '<manifest>' + replacement)
            with self.assertRaises(Exception):
                self.import_book(files)
        files = fixture()
        files['OPS/package.opf'] = files['OPS/package.opf'].replace('idref="a"', 'idref="missing"')
        with self.assertRaisesRegex(Exception, 'manifest|spine|item'):
            self.import_book(files)

    def test_untrusted_content_is_sanitized_before_persistence(self):
        files = fixture()
        files['OPS/a.xhtml'] = '''<html><head><style>p{background-image:url(https://evil.invalid/probe);color:red}</style></head><body><script>window.attack=true</script><iframe src="https://evil.invalid/probe"></iframe><img src="/attack" onerror="window.attack=true"><a href="javascript:alert(1)" data-manabi-target-spine-index="1">bad</a><p>safe</p></body></html>'''
        self.import_book(files)
        result = self.page.evaluate('''()=>{
          const r=bookData.epubPublication.resources[0],d=new DOMParser().parseFromString(r.html,'text/html');
          return {scripts:d.querySelectorAll('script,iframe,[onerror],[data-manabi-target-spine-index]').length,
            image:d.querySelector('img').getAttribute('src'),css:r.styleSheet,attack:!!window.attack};
        }''')
        self.assertEqual(result['scripts'], 0)
        self.assertIsNone(result['image'])
        self.assertNotIn('evil', result['css'])
        self.assertFalse(result['attack'])

    def test_supplementary_numeric_references_and_ruby_projection_match_across_frames(self):
        files = fixture()
        files['OPS/a.xhtml'] = '<html><body><p><ruby>漢<rt>かん</rt></ruby>字&#x20000;&#131072;</p><p>次</p></body></html>'
        self.import_book(files, mode='extended')
        result = self.page.evaluate('''()=>{
          const r=bookData.epubPublication.resources[0],d=new DOMParser().parseFromString(r.html,'text/html');
          return EpubTest.projectResource(d.body.firstElementChild,r).text;
        }''')
        self.assertEqual(result, '漢字𠀀𠀀\n次')

    def test_backup_resource_slices_rebuild_identical_source_documents(self):
        self.import_book()
        result = self.page.evaluate('''()=>{
          const d=bookData,wire=EpubTest.encodeEpubPublication(d.epubPublication,d.elementHtml,d.styleSheet);
          return {decoded:EpubTest.decodeEpubPublication(JSON.parse(JSON.stringify(wire)),d.elementHtml,d.styleSheet),original:d.epubPublication};
        }''')
        self.assertEqual(result['decoded'], result['original'])

    def test_late_source_cannot_block_new_navigation_or_publish_stale_content(self):
        self.open_reader()
        result = self.page.evaluate('''async()=>{
          const s=reader.sections[1],load=s.load,unload=s.unload;
          let release,started,releases=0;
          const loading=new Promise(r=>started=r);
          s.load=async()=>{started();await new Promise(r=>release=r);return load()};
          s.unload=()=>{releases++;unload()};loads.length=0;
          const first=reader.goTo({index:1});await loading;
          const blocked=await reader.preparePageTurn(1);
          const latest=await reader.goTo({index:2});
          const beforeRelease=reader.getContents()[0].index;
          const obsolete=await first;
          release();await new Promise(r=>setTimeout(r,20));
          s.load=load;s.unload=unload;
          return{blocked:blocked===null,latest,obsolete,beforeRelease,loads:loads.slice(),releases};
        }''')
        self.assertEqual(result, {'blocked': True, 'latest': True, 'obsolete': False, 'beforeRelease': 2, 'loads': [2], 'releases': 1})

    def test_failed_document_preparation_and_locator_keep_the_current_document(self):
        self.open_reader()
        result = self.page.evaluate('''async()=>{
          const doc=reader.getContents()[0].doc;
          const s=reader.sections[1],prepare=s.prepareDocument;
          s.prepareDocument=()=>{throw new Error('preparation failed')};
          const failed=await reader.goTo({index:1});s.prepareDocument=prepare;
          const same=reader.getContents()[0].doc===doc;
          const badAnchor=await reader.goTo({index:1,anchor:()=>{throw new Error('locator failed')}});
          const stillSame=reader.getContents()[0].doc===doc;
          const recovered=await reader.goTo({index:2});
          return{failed,same,badAnchor,stillSame,recovered,errors:navErrors.slice()};
        }''')
        self.assertEqual(result, {'failed': False, 'same': True, 'badAnchor': False, 'stillSame': True, 'recovered': True, 'errors': ['preparation failed', 'locator failed']})

    def test_abort_during_iframe_preparation_does_not_reobserve_or_publish_it(self):
        self.open_reader()
        result = self.page.evaluate('''async()=>{
          const s=reader.sections[1],prepare=s.prepareDocument,c=new AbortController();
          const before=reader.getContents()[0].doc;loads.length=0;
          s.prepareDocument=()=>c.abort();
          const accepted=await reader.goTo({index:1},{signal:c.signal});
          s.prepareDocument=prepare;
          return{accepted,same:reader.getContents()[0].doc===before,loads:loads.slice()};
        }''')
        self.assertEqual(result, {'accepted': False, 'same': True, 'loads': []})

    def test_visible_range_advances_beyond_the_expanded_frame_start(self):
        self.open_reader()
        result = self.page.evaluate('''async()=>{
          const offsets=()=>{
            const d=reader.getContents()[0],root=d.doc.querySelector('.book-content');
            return EpubTest.selectedOffsets(EpubTest.projectResource(root,bookData.publicationManifest.resources[d.index]),reader.getVisibleRange());
          };
          const before=offsets();await reader.next();await reader.next();
          return{before,after:offsets(),page:reader.page};
        }''')
        self.assertGreater(result['after']['start'], result['before']['start'])
        self.assertEqual(result['page'], 3)

    def test_furigana_reveal_survives_same_resource_page_promotion(self):
        self.open_reader()
        result = self.page.evaluate('''async()=>{
          const current=reader.getContents()[0];current.doc.querySelector('ruby').classList.add('reveal-rt');
          publication.book.captureState(current.index,current.doc);
          const turn=await reader.preparePageTurn(1);turn.update(1);turn.commit();
          return reader.getContents()[0].doc.querySelector('ruby').classList.contains('reveal-rt');
        }''')
        self.assertTrue(result)

    def test_configurable_keyboard_policy_receives_original_child_document_events(self):
        self.open_reader()
        self.page.evaluate('''()=>{
          window.keyEvents=[];window.controller=new EpubTest.PageTurnController(reader,{keydown:event=>{keyEvents.push({code:event.code,trusted:event.isTrusted,child:event.target.ownerDocument!==document});event.preventDefault()}});
          reader.getContents()[0].doc.defaultView.focus();
        }''')
        self.page.keyboard.press('b')
        self.assertEqual(self.page.evaluate('keyEvents'), [{'code': 'KeyB', 'trusted': True, 'child': True}])
        self.page.evaluate('controller.destroy()')

    def test_destroy_releases_late_navigation_without_creating_a_frame(self):
        self.open_reader()
        result = self.page.evaluate('''async()=>{
          const s=reader.sections[1],load=s.load,unload=s.unload;
          let release,started,releases=0;const loading=new Promise(r=>started=r);
          s.load=async()=>{started();await new Promise(r=>release=r);return load()};
          s.unload=()=>{releases++;unload()};
          const pending=reader.goTo({index:1});await loading;reader.destroy();
          const result=await pending;release();await new Promise(r=>setTimeout(r,20));
          return{result,releases,contents:reader.getContents().length};
        }''')
        self.assertEqual(result, {'result': False, 'releases': 1, 'contents': 0})

    def test_selector_mapping_does_not_rewrite_attribute_values_or_language_arguments(self):
        result = self.page.evaluate('''()=>EpubTest.resourceSelector('html body.title, :is(body, .body), [title="body html"]:lang(body), :root > p')''')
        self.assertEqual(result, '.ttu-book-html-wrapper .ttu-book-body-wrapper.title, :is(.ttu-book-body-wrapper, .body), [title="body html"]:lang(body), .ttu-book-html-wrapper > p')


if __name__ == '__main__':
    unittest.main(verbosity=2)
