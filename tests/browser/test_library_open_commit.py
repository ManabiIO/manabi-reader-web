"""Book opening must commit its resume target before navigation.

Native failure injection changes only the requested transaction; normal Reader,
Library, catalog, IndexedDB and navigation code execute unchanged.
"""
import os
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch
from playwright.sync_api import expect
from test_book_save_cancellation import BookSaveCancellation
from test_books_library import LibraryBase, cross_resource_book
from test_editors_picks import EditorsPicksBrowser
from test_local_library_features import LocalFeatureBrowser


ABORT_LAST_ITEM = """() => {
  const original = IDBObjectStore.prototype.put;
  window.lastOpenWriteAborted = false;
  window.restoreLastOpenWrite = () => { IDBObjectStore.prototype.put = original; };
  IDBObjectStore.prototype.put = function(...args) {
    const request = original.apply(this, args);
    if (this.name === 'lastItem' && this.transaction.db.name === 'books') {
      window.lastOpenWriteAborted = true;
      this.transaction.abort();
    }
    return request;
  };
}"""


class LibraryOpenCommitRuntime(BookSaveCancellation):
    def test_missing_or_concurrently_deleted_book_cannot_become_last_opened(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const db = await database.db;
          const retained = await db.add('data', {title:'Retained',elementHtml:'<p>Keep</p>',blobs:{}});
          const removed = await db.add('data', {title:'Removed',elementHtml:'<p>Gone</p>',blobs:{}});
          await database.putLastItem(retained);
          let notifications = 0;
          const subscription = database.lastItemChanged$.subscribe(() => notifications++);
          const deleting = db.transaction('data', 'readwrite');
          const deletion = deleting.store.delete(removed);
          const outcome = await database.putLastItem(removed).then(() => 'saved', error => error.message);
          await deletion; await deleting.done;
          subscription.unsubscribe();
          return {outcome, notifications, retained, last:await db.get('lastItem',0),
                  exists:await db.getKey('data',removed)};
        }""")
        self.assertNotEqual('saved', result['outcome'])
        self.assertIn('removed', result['outcome'].lower())
        self.assertEqual({'dataId':result['retained']}, result['last'])
        self.assertEqual(0, result['notifications'])
        self.assertIsNone(result.get('exists'))

    def test_canceled_resume_target_never_commits_or_notifies_and_can_retry(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const db = await database.db;
          const before = await db.add('data',{title:'Before',elementHtml:'<p>Before</p>',blobs:{}});
          const after = await db.add('data',{title:'After',elementHtml:'<p>After</p>',blobs:{}});
          await database.putLastItem(before);
          let notifications = 0, enqueued = false;
          const subscription = database.lastItemChanged$.subscribe(() => notifications++);
          const early = new AbortController(); early.abort();
          const earlyOutcome = await database.putLastItem(after,early.signal).then(
            ()=>'saved',error=>error.name);
          const earlyLast = await db.get('lastItem',0);
          const late = new AbortController(), original = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function(...args) {
            const request = original.apply(this,args);
            if(this.name==='lastItem' && this.transaction.db.name==='books') {
              enqueued=true; late.abort();
            }
            return request;
          };
          let lateOutcome;
          try { lateOutcome = await database.putLastItem(after,late.signal).then(
              ()=>'saved',error=>error.name); }
          finally { IDBObjectStore.prototype.put=original; }
          const lateLast=await db.get('lastItem',0), canceledNotifications=notifications;
          await database.putLastItem(after,new AbortController().signal);
          subscription.unsubscribe();
          return {before,after,enqueued,earlyOutcome,earlyLast,lateOutcome,lateLast,
                  canceledNotifications,notifications,last:await db.get('lastItem',0)};
        }""")
        self.assertEqual('AbortError', result['earlyOutcome'])
        self.assertEqual('AbortError', result['lateOutcome'])
        self.assertTrue(result['enqueued'])
        self.assertEqual({'dataId':result['before']}, result['earlyLast'])
        self.assertEqual(result['earlyLast'], result['lateLast'])
        self.assertEqual(0, result['canceledNotifications'])
        self.assertEqual(1, result['notifications'])
        self.assertEqual({'dataId':result['after']}, result['last'])

    def test_local_preparation_detaches_only_the_exact_selected_id_without_reading_images(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler}=await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey}=await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const db=await database.db;
          const common={title:'Identical titles',contentHash:'c'.repeat(64),elementHtml:'<p>Same text</p>',
            styleSheet:'',blobs:{image:new Blob(['native image bytes'],{type:'image/png'})},sections:[]};
          const first=await db.add('data',{...common,storageSource:'source-a',lastBookOpen:10,creators:['First']});
          const second=await db.add('data',{...common,storageSource:'source-b',lastBookOpen:20,creators:['Selected']});
          const handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          handler.startContext({id:second,title:common.title});
          const original=Blob.prototype.arrayBuffer; let imageReads=0;
          Blob.prototype.arrayBuffer=function(...args){if(this.type==='image/png') imageReads++;
            return original.apply(this,args);};
          let opened;
          try { opened=await handler.prepareBookForReading(); }
          finally {Blob.prototype.arrayBuffer=original;}
          const a=await db.get('data',first),b=await db.get('data',second);
          return {opened,first,second,imageReads,rows:await db.count('data'),
            a:{source:a.storageSource,open:a.lastBookOpen,creators:a.creators,blob:a.blobs.image instanceof Blob},
            b:{source:b.storageSource??null,open:b.lastBookOpen,creators:b.creators,blob:b.blobs.image instanceof Blob}};
        }""")
        self.assertEqual(result['second'],result['opened'])
        self.assertEqual({'source':'source-a','open':10,'creators':['First'],'blob':True},result['a'])
        self.assertEqual({'source':None,'open':20,'creators':['Selected'],'blob':True},result['b'])
        self.assertEqual(0,result['imageReads'])
        self.assertEqual(2,result['rows'])

    def test_title_only_local_open_rejects_ambiguity_but_exact_ids_and_unique_titles_work(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler}=await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey}=await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const db=await database.db,handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          const one=await db.add('data',{title:'Two editions',elementHtml:'<p>One</p>',blobs:{}});
          const two=await db.add('data',{title:'Two editions',elementHtml:'<p>Two</p>',blobs:{}});
          handler.startContext({title:'Two editions'});
          const ambiguous=await handler.prepareBookForReading().then(id=>({id}),error=>({error:error.message}));
          handler.startContext({id:two,title:'An obsolete label'});
          const exact=await handler.prepareBookForReading();
          await db.delete('data',one);handler.startContext({title:'Two editions'});
          const unique=await handler.prepareBookForReading();
          handler.startContext({id:one,title:'Two editions'});
          const missing=await handler.prepareBookForReading().then(id=>({id}),error=>({error:error.message}));
          const placeholder=await db.add('data',{title:'Placeholder',storageSource:'external',blobs:{}});
          handler.startContext({id:placeholder,title:'Placeholder'});
          const empty=await handler.prepareBookForReading().then(id=>({id}),error=>({error:error.message}));
          return {ambiguous,exact,unique,missing,empty,two,rows:await db.count('data')};
        }""")
        self.assertIn('multiple',result['ambiguous'].get('error','').lower())
        self.assertEqual(result['two'],result['exact'])
        self.assertEqual(result['two'],result['unique'])
        self.assertIn('No local',result['missing'].get('error',''))
        self.assertIn('Placeholder',result['empty'].get('error',''))
        self.assertEqual(2,result['rows'])

    def test_canceled_local_preparation_preserves_source_and_retries_without_reencoding(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler}=await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey}=await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const db=await database.db,handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          const id=await db.add('data',{title:'Cancellable local copy',storageSource:'original-source',
            elementHtml:'<p>Keep source until commit</p>',blobs:{image:{format:'reader-bytes-v1',type:'image/png',
            bytes:new Uint8Array([9,8,7]).buffer}},lastBookOpen:123,lastBookModified:45});
          const early=new AbortController();early.abort();handler.startContext({id,title:'stale title'},early.signal);
          const first=await handler.prepareBookForReading().then(()=> 'opened',error=>error.name);
          const firstSource=(await db.get('data',id)).storageSource;
          const late=new AbortController();handler.startContext({id,title:'stale title'},late.signal);
          let enqueued=false;
          const original=IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put=function(...args){const request=original.apply(this,args);
            if(this.name==='data'&&this.transaction.db.name==='books'){enqueued=true;late.abort();}
            return request;};
          let second;
          try{second=await handler.prepareBookForReading().then(()=> 'opened',error=>error.name);}
          finally{IDBObjectStore.prototype.put=original;}
          const after=await db.get('data',id);
          handler.startContext({id,title:'stale title'},new AbortController().signal);
          const retry=await handler.prepareBookForReading(),current=await db.get('data',id);
          return {id,first,firstSource,second,enqueued,retry,afterSource:after.storageSource,
            finalSource:current.storageSource??null,open:current.lastBookOpen,modified:current.lastBookModified,
            bytes:Array.from(new Uint8Array(current.blobs.image.bytes)),rows:await db.count('data')};
        }""")
        self.assertEqual('AbortError',result['first'])
        self.assertEqual('original-source',result['firstSource'])
        self.assertEqual('AbortError',result['second'])
        self.assertTrue(result['enqueued'])
        self.assertEqual('original-source',result['afterSource'])
        self.assertEqual(result['id'],result['retry'])
        self.assertIsNone(result['finalSource'])
        self.assertEqual([9,8,7],result['bytes'])
        self.assertEqual(123,result['open'])
        self.assertEqual(45,result['modified'])
        self.assertEqual(1,result['rows'])


class LibraryOpenCommitStatic(LibraryBase):
    def setUp(self):
        self.phase = 'setup'
        self.diagnostics = []
        super().setUp()
        self.page.on('pageerror', lambda error: self.diagnostics.append({
            'kind':'pageerror', 'phase':self.phase, 'url':self.page.url,
            'name':error.name, 'message':error.message, 'stack':error.stack}))
        self.page.on('requestfailed', lambda request: self.diagnostics.append({
            'kind':'requestfailed', 'phase':self.phase, 'url':request.url,
            'resourceType':request.resource_type, 'failure':request.failure}))
        self.page.on('framenavigated', lambda frame: self.diagnostics.append({
            'kind':'navigation', 'phase':self.phase, 'url':frame.url}))

    def tearDown(self):
        self.phase = 'teardown'
        try:
            super().tearDown()
        finally:
            output = Path('test-results')
            output.mkdir(exist_ok=True)
            (output / f'{self.engine}-{self._testMethodName}-lifecycle.json').write_text(
                json.dumps({'events':self.diagnostics, 'pageErrors':self.errors}, indent=2))

    def test_failed_resume_commit_stays_in_library_and_retry_opens_the_selected_book(self):
        self.import_book('Retained resume')
        self.import_book('Selected book')
        ids = {row['title']:row['id'] for row in self.stores('books',['data'])['data']}
        self.page.evaluate("""id => new Promise((resolve,reject) => {
          const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{const db=open.result,tx=db.transaction('lastItem','readwrite');
            tx.objectStore('lastItem').put({dataId:id},0);
            tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
        })""", ids['Retained resume'])
        self.page.evaluate(ABORT_LAST_ITEM)
        self.page.get_by_role('button',name='Read Selected book',exact=True).click()
        expect(self.page.get_by_text('Error opening book:',exact=False)).to_be_visible(timeout=5000)
        self.assertTrue(self.page.evaluate('window.lastOpenWriteAborted'))
        self.assertIn('/manage',self.page.url)
        self.assertEqual([{'dataId':ids['Retained resume']}],self.stores('books',['lastItem'])['lastItem'])
        self.page.evaluate('window.restoreLastOpenWrite()')
        self.page.get_by_role('button',name='Close',exact=True).filter(has_text='Close').click()
        self.page.get_by_role('button',name='Read Selected book',exact=True).click()
        expect(self.page).to_have_url(re.compile(r'/reader-web/b\?id=' + str(ids['Selected book']) + r'$'))
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy','false')
        self.assertEqual([{'dataId':ids['Selected book']}],self.stores('books',['lastItem'])['lastItem'])
        self.assertEqual(2,len(self.stores('books',['data'])['data']))

    def test_queued_open_cannot_change_resume_or_navigate_after_back(self):
        self.phase = 'import'
        self.import_book('Queued book')
        self.import_book('Retained book')
        ids={row['title']:row['id'] for row in self.stores('books',['data'])['data']}
        self.phase = 'establish Back destination'
        # Establish the Back destination through completed app navigation. Do
        # not tear down a just-created document while its entry imports load.
        self.page.get_by_role('button',name='Library actions',exact=True).click()
        self.page.get_by_role('menuitem',name='Settings',exact=True).click()
        expect(self.page.get_by_role('heading',name='Appearance',exact=True)).to_be_visible()
        self.go_library()
        holder=self.context.new_page()
        try:
            # A same-origin image document has IndexedDB but no application
            # module graph to interrupt when this storage-only actor closes.
            holder.goto(self.origin+'/reader-web/favicon.png')
            holder.evaluate("""id=>new Promise((resolve,reject)=>{
              const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
              open.onsuccess=()=>{const db=open.result,tx=db.transaction('lastItem','readwrite');
                tx.objectStore('lastItem').put({dataId:id},0);
                tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
            })""",ids['Retained book'])
            holder.evaluate("""()=>new Promise((resolve,reject)=>{
              const open=indexedDB.open('books');open.onerror=()=>reject(open.error);
              open.onsuccess=()=>{const db=open.result,tx=db.transaction('lastItem','readwrite');
                let held=true;window.releaseResumeBlocker=()=>{held=false;};
                window.resumeBlockerDone=new Promise((done,fail)=>{
                  tx.oncomplete=()=>{db.close();done();};tx.onabort=()=>{db.close();fail(tx.error);};});
                const keep=()=>{if(!held)return;const read=tx.objectStore('lastItem').get(0);
                  read.onsuccess=keep;};keep();resolve();};
            })""")
            self.page.evaluate("""()=>{
              const original=IDBDatabase.prototype.transaction;
              delete document.documentElement.dataset.resumeTargetTransactionStarted;
              IDBDatabase.prototype.transaction=function(names,mode,...args){
                const tx=original.call(this,names,mode,...args);
                if(this.name==='books'&&mode==='readwrite'&&Array.from(tx.objectStoreNames).includes('lastItem'))
                  document.documentElement.dataset.resumeTargetTransactionStarted='true';
                return tx;
              };
            }""")
            self.page.get_by_role('button',name='Read Queued book',exact=True).click()
            # Locator assertions do not compile a predicate in the page's CSP realm.
            expect(self.page.locator('html')).to_have_attribute('data-resume-target-transaction-started','true')
            self.phase = 'cancel queued resume via Back'
            self.page.go_back()
            expect(self.page).to_have_url(re.compile('/reader-web/settings$'))
            # A history URL and SSR heading do not certify SvelteKit startup.
            expect(self.page.locator('#svelte-announcer')).to_be_attached()
            holder.evaluate('async()=>{window.releaseResumeBlocker();await window.resumeBlockerDone;}')
            self.assertEqual([{'dataId':ids['Retained book']}],self.stores('books',['lastItem'])['lastItem'])
            self.assertTrue(self.page.url.endswith('/settings'))
            self.phase = 'fresh explicit retry'
            self.go_library()
            self.page.get_by_role('button',name='Read Queued book',exact=True).click()
            expect(self.page).to_have_url(re.compile(r'/reader-web/b\?id='+str(ids['Queued book'])+r'$'))
            self.assertEqual([{'dataId':ids['Queued book']}],self.stores('books',['lastItem'])['lastItem'])
            # Navigation commits the URL before the Reader's lazy modules and
            # publication finish loading. A successful retry must render the
            # reader, not close its document during those pending imports.
            self.phase = 'wait for actual reader retry'
            expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy','false')
            self.phase = 'reader retry ready'
        finally:
            if not holder.is_closed():
                holder.evaluate('window.releaseResumeBlocker?.()')
                holder.close()


class CatalogOpenCommitStatic(EditorsPicksBrowser):
    def setUp(self):
        with patch.dict(os.environ, {'PICKS_BROWSER':os.environ.get('LIBRARY_BROWSER','chromium')}):
            super().setUp()
        self.assertEqual(self.engine,self.context.browser.browser_type.name)
        self.context.add_init_script("localStorage.setItem('manabi-reader-dictionary-setup-v1','skip')")

    def test_failed_catalog_resume_commit_keeps_import_and_allows_explicit_retry(self):
        self.library()
        self.page.evaluate(ABORT_LAST_ITEM)
        self.page.get_by_role('region',name="Editor's Picks books").get_by_role('button',name='Open').first.click()
        expect(self.page.get_by_text('Could not open book',exact=True)).to_be_visible(timeout=5000)
        self.assertTrue(self.page.evaluate('window.lastOpenWriteAborted'))
        self.assertIn('/manage',self.page.url)
        saved=self.book_rows()
        self.assertEqual(1,len(saved['books']))
        self.assertEqual([],saved['last'])
        self.assertEqual([],saved['bookmarks'])
        self.page.evaluate('window.restoreLastOpenWrite()')
        self.page.get_by_role('button',name='Close',exact=True).filter(has_text='Close').click()
        self.page.get_by_role('button',name='Read A Pick from Manabi',exact=True).click()
        expect(self.page).to_have_url(re.compile(r'/reader-web/b\?id='))
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy','false')
        self.assertEqual(saved['books'],self.book_rows()['books'])
        self.assertEqual([{'dataId':saved['books'][0]['id']}],self.book_rows()['last'])


class ContentOpenCommitStatic(LocalFeatureBrowser):
    def test_passage_retry_preserves_resume_and_issues_only_a_successful_preview(self):
        self.page.locator('input[type=file][accept*=".epub"]').first.set_input_files(
            {'name':'cross.epub','mimeType':'application/epub+zip','buffer':cross_resource_book()})
        expect(self.page.get_by_role('button',name='Read Cross Resource Return',exact=True)).to_be_visible()
        # Establish ordinary first-read history through the actual Reader, not
        # a fabricated absence of its intentional start-date record.
        self.page.get_by_role('button',name='Read Cross Resource Return',exact=True).click()
        expect(self.page.locator('.book-content').first).to_have_attribute('aria-busy','false')
        self.assertEqual(1,len(self.stores('books',['readerStatistic'])['readerStatistic']))
        self.go_library()
        self.seed_resume(100)
        before=self.stores('books',['bookmark','readerStatistic'])
        self.search('DESTINATION_UNIQUE')
        self.page.evaluate(ABORT_LAST_ITEM)
        self.page.get_by_role('button',name='Open passage in Cross Resource Return: DESTINATION_UNIQUE',exact=True).click()
        expect(self.page.get_by_text('Error opening book:',exact=False)).to_be_visible(timeout=5000)
        self.assertIn('/manage',self.page.url)
        self.assertEqual(before,self.stores('books',['bookmark','readerStatistic']))
        self.page.evaluate('window.restoreLastOpenWrite()')
        self.page.get_by_role('button',name='Close',exact=True).filter(has_text='Close').click()
        self.search('DESTINATION_UNIQUE')
        self.page.get_by_role('button',name='Open passage in Cross Resource Return: DESTINATION_UNIQUE',exact=True).click()
        expect(self.page.get_by_role('button',name='Return to where I was',exact=True)).to_be_visible(timeout=20000)
        self.assertEqual(before,self.stores('books',['bookmark','readerStatistic']))
        self.assertNotIn('DESTINATION_UNIQUE',self.page.url)
        self.page.get_by_role('button',name='Return to where I was',exact=True).click()
        expect(self.page.get_by_role('button',name='Return to where I was',exact=True)).to_have_count(0)


def load_tests(_loader, _tests, _pattern):
    return unittest.TestSuite(cls(name) for cls in [LibraryOpenCommitRuntime,LibraryOpenCommitStatic,CatalogOpenCommitStatic,ContentOpenCommitStatic]
                              for name in cls.__dict__ if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main()
