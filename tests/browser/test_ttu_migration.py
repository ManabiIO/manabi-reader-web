"""One-time migration through the built app, real exports, IndexedDB and Chromium.

The source ZIP is made by the retained Ttu export UI/serializer. Derived batches
are real ZIP files; deliberate damaged files and external snapshots are test
inputs, not intercepted HTTP, mocked storage, or a replacement importer.
"""
import io
import json
import os
from pathlib import Path
import re
import threading
import unittest
import zipfile
from playwright.sync_api import sync_playwright, expect
from test_static_reader import StaticHandler, ThreadingHTTPServer, epub, TITLE

OTHER = 'Other book'
STAMP = 1789837322544


def zip_bytes(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, value in files.items():
            archive.writestr(name, value if isinstance(value, (str, bytes)) else json.dumps(value, ensure_ascii=False))
    return out.getvalue()


def entries(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        return {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}


def fixture_epub(title):
    files = entries(epub())
    files['content.opf'] = files['content.opf'].replace(TITLE.encode(), title.encode())
    return zip_bytes(files)


def statistics(title, day='2026-09-19', seconds=300, modified=STAMP):
    return dict(title=title, dateKey=day, charactersRead=60, readingTime=seconds,
                minReadingSpeed=720, altMinReadingSpeed=720, lastReadingSpeed=720,
                maxReadingSpeed=720, lastStatisticModified=modified)


def goal(start='2026-09-01', end='2026-09-15'):
    return dict(timeGoal=600, characterGoal=500, goalFrequency='daily', goalStartDate=start,
                goalEndDate=end, goalOriginalEndDate=end, lastGoalModified=STAMP)


class MigrationBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        launch = {}
        if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'):
            launch['executable_path'] = os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
        cls.browser = cls.playwright.chromium.launch(**launch)
        try:
            cls.source = cls.export_fixture()
            cls.source_entries = entries(cls.source)
        except BaseException:
            cls.browser.close()
            cls.playwright.stop()
            cls.server.shutdown()
            cls.server.server_close()
            cls.thread.join()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    @classmethod
    def export_fixture(cls):
        context = cls.browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.set_default_timeout(30000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            page.goto(cls.origin + '/Reader-Web/manage')
            for title in (TITLE, OTHER):
                page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
                    {'name': title+'.epub', 'mimeType': 'application/epub+zip', 'buffer': fixture_epub(title)})
                expect(page.get_by_role('button', name='Read ' + title, exact=True)).to_be_visible()
            # Source history deliberately initialized at the persistence boundary.
            # Export remains the actual user-facing exporter with real serializers.
            page.evaluate('''stamp => new Promise((resolve,reject) => {
              const open=indexedDB.open('books'); open.onerror=()=>reject(open.error);
              open.onsuccess=()=>{ const db=open.result,tx=db.transaction(['data','bookmark','statistic','audioBook','subtitle','lastModified'],'readwrite');
                const all=tx.objectStore('data').getAll();all.onsuccess=()=>{
                  for(const book of all.result){
                    tx.objectStore('bookmark').put({dataId:book.id,exploredCharCount:30,progress:30/book.characters,lastBookmarkModified:stamp});
                    tx.objectStore('statistic').put({title:book.title,dateKey:'2026-09-19',charactersRead:60,readingTime:300,
                      minReadingSpeed:720,altMinReadingSpeed:720,lastReadingSpeed:720,maxReadingSpeed:720,lastStatisticModified:stamp});
                    tx.objectStore('lastModified').put({title:book.title,dataType:'statistic',lastModifiedValue:stamp});
                    tx.objectStore('audioBook').put({title:book.title,playbackPosition:12.5,lastAudioBookModified:stamp});
                    tx.objectStore('subtitle').put({title:book.title,lastSubtitleDataModified:stamp,
                      subtitleData:{name:'book.srt',subtitles:[{id:'line-1',originalStartSeconds:0,startSeconds:0,startTime:'00:00:00',
                        originalEndSeconds:2,endSeconds:2,endTime:'00:00:02',originalText:'本',text:'本',subIndex:0}]}});
                  }
                };tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
              };
            })''', STAMP)
            page.get_by_role('button', name='Library actions', exact=True).click()
            page.get_by_role('menuitem', name='Select Books', exact=True).click()
            page.get_by_role('button', name='Select all', exact=True).click()
            expect(page.get_by_text('2 selected', exact=True)).to_be_visible()
            page.get_by_role('button', name='Export', exact=True).click()
            page.get_by_role('button', name='Zip File', exact=True).click()
            for label in ('Book Data', 'Bookmark', 'Statistics', 'Audiobook', 'Subtitles'):
                page.get_by_label(label, exact=True).check()
            with page.expect_download(timeout=60000) as pending:
                page.get_by_role('button', name='Start', exact=True).click()
            download = pending.value
            raw = Path(download.path()).read_bytes()
            assert not errors, errors
            files = entries(raw)
            assert len([name for name in files if '/bookdata_' in name]) == 2, list(files)
            assert len([name for name in files if '/statistics_' in name]) == 2, list(files)
            assert any('/audioBook_' in name for name in files)
            assert any('/subtitles_' in name for name in files)
            return raw
        finally:
            output=Path('test-results'); output.mkdir(exist_ok=True)
            page.screenshot(path=str(output/'migration-export-source.png'),full_page=True)
            (output/'migration-export-source.html').write_text(page.content())
            context.close()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.page.set_default_timeout(20000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        StaticHandler.probes.clear()
        self.page.goto(self.origin + '/Reader-Web/import-ttu')
        expect(self.page.get_by_role('heading', name='Import from Ttu Ebook Reader', exact=True)).to_be_visible()
        expect(self.page.get_by_label('Choose Ttu export ZIPs', exact=True)).to_be_enabled()

    def tearDown(self):
        output=Path('test-results'); output.mkdir(exist_ok=True)
        self.page.screenshot(path=str(output/(self._testMethodName+'.png')), full_page=True)
        (output/(self._testMethodName+'.html')).write_text(self.page.content())
        self.context.close()
        self.assertEqual([],self.errors)

    def load(self, raw=None, name='Ttu backup.zip'):
        self.page.get_by_label('Choose Ttu export ZIPs', exact=True).set_input_files(
            {'name':name,'mimeType':'application/zip','buffer':self.source if raw is None else raw})
        expect(self.page.get_by_label('Choose Ttu export ZIPs', exact=True)).to_be_enabled()

    def row(self, title=TITLE):
        return self.page.get_by_role('article', name='Import '+title, exact=True)

    def run_import(self):
        self.page.get_by_role('button',name=re.compile(r'^Import selected \(')).click()
        expect(self.page.get_by_label('Choose Ttu export ZIPs', exact=True)).to_be_enabled(timeout=60000)

    def clear(self):
        self.page.get_by_role('button', name='Clear list', exact=True).click()

    def snapshot(self):
        return self.page.evaluate('''() => new Promise((resolve,reject)=>{
          const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result,names=['data','bookmark','statistic','readerStatistic','audioBook','subtitle','readingGoal','storageSource'];
            const tx=db.transaction(names),out={};for(const name of names){const request=tx.objectStore(name).getAll();
              request.onsuccess=()=>out[name]=name==='data'?request.result.map(({blobs,coverImage,...book})=>({...book,media:Object.keys(blobs)})):request.result;}
            tx.oncomplete=()=>{db.close();out.statistic=[...out.statistic,...out.readerStatistic];resolve(out);};tx.onerror=()=>reject(tx.error);};
        })''')

    def subset(self, *parts, title=None):
        return zip_bytes({name:body for name,body in self.source_entries.items()
                          if (title is None or name.startswith(title+'/')) and name.rsplit('/',1)[-1].split('_')[0] in parts})

    def test_bulk_real_export_reads_ruby_images_and_preserves_all_parts(self):
        self.load()
        expect(self.page.get_by_role('article')).to_have_count(2)
        self.run_import()
        expect(self.row().get_by_role('status')).to_have_text('Imported '+TITLE+'.')
        data=self.snapshot()
        self.assertEqual(2,len(data['data']))
        self.assertEqual(2,len(data['bookmark']))
        self.assertEqual(2,len(data['statistic']))
        self.assertEqual(2,len(data['audioBook']))
        self.assertEqual(2,len(data['subtitle']))
        self.assertEqual([],data['storageSource'])
        for row in data['statistic']:
            self.assertEqual(300,row['readingTime'])
            self.assertEqual(60,row['charactersRead'])
        self.assertEqual(12.5,data['audioBook'][0]['playbackPosition'])
        self.assertEqual('本',data['subtitle'][0]['subtitleData']['subtitles'][0]['text'])
        self.row().get_by_role('link',name='Read '+TITLE,exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy','false',timeout=45000)
        expect(self.page.locator('.book-content ruby rt').first).to_have_text('ほん')
        self.page.wait_for_function('() => document.querySelector("#safe-image")?.naturalWidth > 0')
        self.assertEqual([],StaticHandler.probes)

    def test_multiple_zips_selection_and_same_backup_cannot_undo_newer_local_reading(self):
        files=[]
        for title in (TITLE,OTHER):
            raw=zip_bytes({n:b for n,b in self.source_entries.items() if n.startswith(title+'/')})
            files.append({'name':title+'.zip','mimeType':'application/zip','buffer':raw})
        self.page.get_by_label('Choose Ttu export ZIPs',exact=True).set_input_files(files)
        expect(self.page.get_by_label('Choose Ttu export ZIPs',exact=True)).to_be_enabled()
        self.page.get_by_role('button',name='Select none',exact=True).click()
        self.row().get_by_role('checkbox').check()
        self.run_import()
        self.assertEqual(1,len(self.snapshot()['data']))
        self.page.get_by_role('button',name='Select all',exact=True).click()
        self.run_import()
        data=self.snapshot()
        self.assertEqual(2,len(data['data']))
        self.assertEqual(2,len(data['statistic']))
        self.page.evaluate('''() => new Promise((resolve,reject)=>{const open=indexedDB.open('books');open.onsuccess=()=>{
          const db=open.result,tx=db.transaction(['bookmark','readerStatistic'],'readwrite');
          tx.objectStore('bookmark').clear();const all=tx.objectStore('readerStatistic').getAll();all.onsuccess=()=>{
            for(const row of all.result)tx.objectStore('readerStatistic').put({...row,readingTime:999,lastStatisticModified:row.lastStatisticModified+100});};
          tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};})''')
        before=self.snapshot()
        self.page.reload()
        # ZIP compression, entry ordering and container timestamp do not determine identity.
        self.load(zip_bytes(dict(reversed(list(self.source_entries.items())))), 'repacked.zip')
        self.run_import()
        self.assertEqual(before,self.snapshot())
        expect(self.row().get_by_role('status')).to_contain_text('Already imported')

    def test_piecemeal_data_only_requires_explicit_previously_migrated_destination(self):
        self.load(self.subset('progress','statistics'))
        self.run_import()
        self.assertEqual([],self.snapshot()['data'])
        expect(self.row().get_by_role('status')).to_contain_text('previously imported book')
        self.clear()
        self.load(self.subset('bookdata'))
        self.run_import()
        data=self.snapshot()
        self.assertEqual([],data['bookmark'])
        self.assertEqual([],data['statistic'])
        self.clear()
        self.load(self.subset('progress','statistics','audioBook','subtitles'))
        for book in data['data']:
            self.row(book['title']).get_by_label('Destination for '+book['title'],exact=True).select_option(str(book['id']))
        self.run_import()
        result=self.snapshot()
        self.assertEqual(2,len(result['data']))
        self.assertEqual(2,len(result['bookmark']))
        self.assertEqual(2,len(result['statistic']))
        for book in result['data']:
            mark=next(v for v in result['bookmark'] if v['dataId']==book['id'])
            self.assertEqual(30,mark['exploredCharCount'])

    def test_changed_source_conflicts_atomically_then_explicit_replace_and_older_retry(self):
        self.load()
        self.run_import()
        self.page.evaluate('''() => new Promise(resolve=>{const open=indexedDB.open('books');open.onsuccess=()=>{
          const db=open.result,tx=db.transaction('readerStatistic','readwrite'),store=tx.objectStore('readerStatistic'),all=store.getAll();
          all.onsuccess=()=>{for(const row of all.result)store.put({...row,readingTime:800,lastStatisticModified:row.lastStatisticModified+10});};
          tx.oncomplete=()=>{db.close();resolve();};};})''')
        before=self.snapshot()
        files={}
        for name,body in self.source_entries.items():
            if name.startswith(OTHER+'/'):continue
            if '/progress_' in name:
                value=json.loads(body);value.update(exploredCharCount=40,lastBookmarkModified=STAMP+20)
                files[name.replace(str(STAMP),str(STAMP+20))]=value
            elif '/statistics_' in name:
                value=json.loads(body);value[0].update(readingTime=400,lastStatisticModified=STAMP+20)
                files[name.replace(str(STAMP),str(STAMP+20))]=value
            else:files[name]=body
        self.clear();self.load(zip_bytes(files),'changed.zip');self.run_import()
        expect(self.row().get_by_role('status')).to_contain_text('differs')
        self.assertEqual(before,self.snapshot(), 'Conflict must roll back the earlier bookmark write and receipt too')
        self.row().get_by_role('button',name='Use imported data for '+TITLE,exact=True).click()
        expect(self.page.get_by_label('Choose Ttu export ZIPs',exact=True)).to_be_enabled()
        after=self.snapshot()
        mark=next(x for x in after['bookmark'] if x['dataId']==next(b['id'] for b in after['data'] if b['title']==TITLE))
        self.assertEqual(40,mark['exploredCharCount'])
        self.assertEqual(400,next(s['readingTime'] for s in after['statistic'] if s['title']==TITLE))
        self.clear();self.load();self.run_import()
        self.assertEqual(after,self.snapshot(),'Old batches cannot roll back source or newer local history')

    def test_duplicate_titles_different_content_remain_separate_and_do_not_bind_cloud_sources(self):
        self.load();self.run_import()
        files=dict(self.source_entries)
        book_name=next(n for n in files if n.startswith(TITLE+'/bookdata_'))
        package=entries(files[book_name]);book=json.loads(package['staticdata.json'])
        book['elementHtml']+='<p>Different edition.</p>'
        book['storageSource']='secret cloud source';book['refreshToken']='must-not-import'
        package['staticdata.json']=json.dumps(book);files[book_name]=zip_bytes(package)
        self.clear();self.load(zip_bytes(files),'different-edition.zip');self.run_import()
        data=self.snapshot()
        self.assertEqual(3,len(data['data']))
        separate=next(b for b in data['data'] if b['title'].startswith(TITLE+' [Ttu import'))
        self.assertNotIn('storageSource',separate)
        self.assertNotIn('refreshToken',separate)
        self.assertEqual([],data['storageSource'])
        self.assertEqual(3,len(data['statistic']))

    def test_separate_reading_goals_import_and_duplicate_are_idempotent(self):
        raw=zip_bytes({f'ttu-user-goals_1_6_{STAMP}.json':[goal()]})
        self.load(raw,'goals.zip');self.run_import()
        result=self.snapshot();self.assertEqual(1,len(result['readingGoal']))
        self.assertEqual(600,result['readingGoal'][0]['timeGoal'])
        self.clear();self.load(raw,'same-goals.zip');self.run_import();self.assertEqual(result,self.snapshot())
        self.clear();self.load(zip_bytes({f'ttu-user-goals_1_6_{STAMP}.json':[goal('2026-09-10','2026-09-20')]}),'overlap.zip');self.run_import()
        expect(self.row('Reading Goals').get_by_role('status')).to_contain_text('overlap')
        self.assertEqual(result,self.snapshot())

    def test_unsafe_archive_and_invalid_item_leave_originals_and_other_books_intact(self):
        unsafe=zip_bytes({'../bookdata_1_6_1_1_0.zip':b'not-zip'})
        self.load(unsafe,'unsafe.zip')
        expect(self.page.get_by_role('status')).to_contain_text('Unsafe archive path')
        self.assertEqual([],self.snapshot()['data'])
        files=dict(self.source_entries)
        for name in list(files):
            if name.startswith(TITLE+'/statistics_'):
                files[name]=[statistics(TITLE,day='2026-02-30')]
        self.load(zip_bytes(files),'invalid-day.zip');self.run_import()
        data=self.snapshot();self.assertEqual([OTHER],[b['title'] for b in data['data']])
        expect(self.row().get_by_role('status')).to_contain_text('date')
        self.assertEqual([OTHER],[s['title'] for s in data['statistic']])

    def test_hostile_restored_html_and_css_never_execute_or_fetch(self):
        files={n:b for n,b in self.source_entries.items() if n.startswith(TITLE+'/')}
        name=next(n for n in files if '/bookdata_' in n);package=entries(files[name]);book=json.loads(package['staticdata.json'])
        book['elementHtml']+='<script>window.migrationAttack=true</script><img src="/attack-probe" onerror="window.migrationAttack=true"><iframe src="/attack-probe"></iframe>'
        book['styleSheet']='p {background-image:url(/attack-probe);color:red}'
        book['htmlBackup']='<script>window.migrationAttack=true</script><p>safe</p>'
        package['staticdata.json']=json.dumps(book);files[name]=zip_bytes(package)
        self.load(zip_bytes(files),'hostile.zip');self.run_import()
        data=self.snapshot()['data'][0]
        self.assertNotIn('<script',data['elementHtml']);self.assertNotIn('onerror',data['elementHtml'])
        self.assertNotIn('url(',data['styleSheet']);self.assertNotIn('<script',data['htmlBackup'])
        self.row().get_by_role('link',name='Read '+TITLE,exact=True).click()
        expect(self.page.locator('.book-content')).to_have_attribute('aria-busy','false',timeout=45000)
        self.assertFalse(self.page.evaluate('Boolean(window.migrationAttack)'))
        self.assertEqual([],StaticHandler.probes)

    def test_cancellation_preserves_completed_book_and_retry_is_safe(self):
        self.load()
        # Observe actual rendered completion, then invoke the real Stop button.
        # No parser, transaction, clock, or storage implementation is replaced.
        self.page.evaluate('''() => {const observer=new MutationObserver(()=>{
          if([...document.querySelectorAll('article [role=status]')].some(e=>e.textContent.startsWith('Imported '))){
            const stop=[...document.querySelectorAll('button')].find(e=>e.textContent==='Stop importing');
            if(stop){observer.disconnect();stop.click();}
          }
        });observer.observe(document.querySelector('.import-list'),{subtree:true,childList:true,characterData:true});}''')
        self.run_import()
        data=self.snapshot()
        self.assertGreaterEqual(len(data['data']),1)
        self.assertLessEqual(len(data['data']),2)
        expect(self.page.get_by_role('status').first).to_contain_text('Stopped')
        self.page.get_by_role('button',name='Select all',exact=True).click();self.run_import()
        final=self.snapshot();self.assertEqual(2,len(final['data']));self.assertEqual(2,len(final['statistic']))

    def test_many_day_rows_exceed_cloud_state_cap_but_migrate_locally_without_truncation(self):
        import datetime
        files={n:b for n,b in self.source_entries.items() if n.startswith(TITLE+'/')}
        key=next(n for n in files if '/statistics_' in n)
        start=datetime.date(2020,1,1)
        rows=[statistics(TITLE,day=(start+datetime.timedelta(days=i)).isoformat()) for i in range(500)]
        self.assertGreater(len(json.dumps(rows)),65536)
        files[key]=rows
        self.load(zip_bytes(files),'long-history.zip');self.run_import()
        data=self.snapshot();self.assertEqual(500,len(data['statistic']));self.assertEqual(150000,sum(r['readingTime'] for r in data['statistic']))
        self.clear();self.load(zip_bytes(files),'repeat-long-history.zip');self.run_import();self.assertEqual(data,self.snapshot())

    def test_migration_entrypoint_and_google_drive_labels_use_official_names(self):
        self.page.goto(self.origin+'/Reader-Web/manage')
        self.page.get_by_role('button',name='Library actions',exact=True).click()
        self.page.get_by_role('menuitem',name='Add Books',exact=True).click()
        self.page.get_by_role('menuitem',name='Import from Ttu Ebook Reader',exact=True).click()
        expect(self.page.get_by_role('heading',name='Import from Ttu Ebook Reader',exact=True)).to_be_visible()
        self.assertNotRegex(self.page.locator('body').inner_text(),r'\b(?:TTU|GDrive)\b')
        self.page.goto(self.origin+'/Reader-Web/settings')
        self.assertNotRegex(self.page.locator('body').inner_text(),r'\b(?:TTU|GDrive)\b')


if __name__=='__main__':
    unittest.main(verbosity=2)
