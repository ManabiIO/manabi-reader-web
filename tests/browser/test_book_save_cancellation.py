"""Native-storage save cancellation through the production handler and database."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from test_shared_safety import SharedStorageRuntime


class BookSaveCancellation(SharedStorageRuntime):
    def new_context(self):
        self.engine = os.environ.get('LIBRARY_BROWSER', 'chromium')
        profile = tempfile.TemporaryDirectory(prefix='reader-save-' + self.engine + '-')
        self.addCleanup(profile.cleanup)
        context = getattr(self.playwright, self.engine).launch_persistent_context(profile.name)
        self.assertEqual(self.engine, context.browser.browser_type.name)
        return context

    def tearDown(self):
        output = Path('test-results')
        output.mkdir(exist_ok=True)
        try:
            (output / f'{self.engine}-{self._testMethodName}.json').write_text(json.dumps({
                'engine':self.engine,'pageErrors':self.errors,
                'userAgent':self.page.evaluate('navigator.userAgent')}))
        finally:
            super().tearDown()

    def test_cancellation_during_binary_preparation_preserves_the_existing_book(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler} = await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey} = await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const {ReplicationSaveBehavior} = await import('/reader-web/src/lib/functions/replication/replication-options.ts');
          const {MergeMode} = await import('/reader-web/src/lib/data/merge-mode.ts');
          const original={title:'Prepare cancel',contentHash:'a'.repeat(64),elementHtml:'<p>Original</p>',
            styleSheet:'',blobs:{},sections:[],lastBookModified:1};
          const db=await database.db;
          const id=await db.add('data',original);
          const handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          handler.updateSettings(window,true,ReplicationSaveBehavior.Overwrite,MergeMode.MERGE,MergeMode.MERGE);
          const controller=new AbortController();
          handler.startContext({title:original.title},controller.signal);
          let release,started;
          const entered=new Promise(resolve=>started=resolve), gate=new Promise(resolve=>release=resolve);
          class HeldBlob extends Blob {
            async arrayBuffer(){ started(); await gate; return super.arrayBuffer(); }
          }
          const pending=handler.saveBook({...original,elementHtml:'<p>Must not replace original</p>',
            blobs:{image:new HeldBlob(['bytes'],{type:'image/png'})},lastBookModified:2})
            .then(id=>({id}),error=>({error:error.name}));
          await entered;controller.abort();release();
          const outcome=await pending;
          const after=await db.get('data',id);
          handler.startContext({title:original.title},new AbortController().signal);
          const retry=await handler.saveBook({...original,elementHtml:'<p>Fresh retry</p>',lastBookModified:3});
          return {outcome,after:after.elementHtml,id,retry,final:(await db.get('data',id)).elementHtml};
        }""")
        self.assertEqual({'error':'AbortError'},result['outcome'])
        self.assertEqual('<p>Original</p>',result['after'])
        self.assertEqual(result['id'],result['retry'])
        self.assertEqual('<p>Fresh retry</p>',result['final'])

    def test_cancellation_after_native_write_is_enqueued_rolls_back_and_drains_completion(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {ReplicationSaveBehavior}=await import('/reader-web/src/lib/functions/replication/replication-options.ts');
          const db=await database.db,controller=new AbortController();
          const original=IDBObjectStore.prototype.add;
          let enqueued=false,outcome;
          IDBObjectStore.prototype.add=function(...args){
            const request=original.apply(this,args);
            if(this.transaction.db.name==='books'&&this.name==='data'){
              enqueued=true;controller.abort();
            }
            return request;
          };
          const book={title:'Commit cancel',elementHtml:'<p>Read</p>',styleSheet:'',blobs:{},sections:[]};
          try { outcome=await database.upsertData(book,ReplicationSaveBehavior.Overwrite,true,true,controller.signal)
            .then(book=>({id:book.id}),error=>({error:error.name})); }
          finally{IDBObjectStore.prototype.add=original;}
          const rows=await db.getAllKeys('data');
          const retry=await database.upsertData(book,ReplicationSaveBehavior.Overwrite,true,true,new AbortController().signal);
          return {enqueued,outcome,rows,final:await db.getAllKeys('data'),retry:retry.id};
        }""")
        self.assertTrue(result['enqueued'])
        self.assertEqual({'error':'AbortError'},result['outcome'])
        self.assertEqual([],result['rows'])
        self.assertEqual([result['retry']],result['final'])


    def test_last_read_uses_current_content_and_never_lowers_a_newer_timestamp(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler}=await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey}=await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const db=await database.db;
          const original={title:'Old title',elementHtml:'<p>Old content</p>',styleSheet:'',blobs:{},
            sections:[],contentHash:'a'.repeat(64),lastBookOpen:10,lastBookModified:10};
          const id=await db.add('data',original);
          const snapshot={...original,id,lastBookOpen:150};
          const bytes={format:'reader-bytes-v1',type:'image/png',bytes:new Uint8Array([1,2,3]).buffer};
          await db.put('data',{...original,id,title:'New title',elementHtml:'<p>New content</p>',
            contentHash:'b'.repeat(64),lastBookOpen:200,lastBookModified:100,blobs:{image:bytes}});
          const handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          handler.startContext({id,title:original.title});
          await handler.updateLastRead(snapshot);
          const current=await db.get('data',id);
          snapshot.lastBookOpen=300;
          await handler.updateLastRead(snapshot);
          const after=await db.get('data',id);
          return {current:{title:current.title,html:current.elementHtml,hash:current.contentHash,
            open:current.lastBookOpen,modified:current.lastBookModified,
            bytes:current.blobs.image && Array.from(new Uint8Array(current.blobs.image.bytes))},
            after:{title:after.title,html:after.elementHtml,open:after.lastBookOpen}};
        }""")
        self.assertEqual({'title':'New title','html':'<p>New content</p>','hash':'b'*64,
                          'open':200,'modified':100,'bytes':[1,2,3]},result['current'])
        self.assertEqual({'title':'New title','html':'<p>New content</p>','open':300},result['after'])

    def test_delayed_last_read_does_not_recreate_a_deleted_book(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler}=await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey}=await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const db=await database.db,book={title:'Removed book',elementHtml:'<p>Old</p>',
            styleSheet:'',blobs:{},sections:[],lastBookOpen:1};
          const id=await db.add('data',book);
          const handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          handler.startContext({id,title:book.title});
          const removed=await database.deleteData([id],new Map([[id,book.title]]),new AbortController().signal,true);
          await handler.updateLastRead({...book,id,lastBookOpen:2});
          return {removed,ids:await db.getAllKeys('data')};
        }""")
        self.assertEqual('',result['removed']['error'])
        self.assertEqual(1,len(result['removed']['deleted']))
        self.assertEqual([],result['ids'])

    def test_native_image_read_abort_is_a_visible_failure_not_user_cancellation(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {ReplicationSaveBehavior}=await import('/reader-web/src/lib/functions/replication/replication-options.ts');
          const signal=new AbortController().signal,db=await database.db;
          const source={title:'Broken image read',elementHtml:'<p>Old</p>',styleSheet:'',blobs:{},sections:[]};
          const id=await db.add('data',source);
          class BrokenBlob extends Blob { async arrayBuffer(){throw new DOMException('Native read failed','AbortError');} }
          const outcome=await database.upsertData({...source,elementHtml:'<p>Replacement</p>',
            blobs:{image:new BrokenBlob(['bytes'],{type:'image/png'})}},
            ReplicationSaveBehavior.Overwrite,true,true,signal).then(()=>({ok:true}),error=>({
              name:error.name,message:error.message,cause:error.cause?.name}));
          const after=await db.get('data',id);
          const retry=await database.upsertData({...source,elementHtml:'<p>Retry</p>'},ReplicationSaveBehavior.Overwrite);
          return {outcome,aborted:signal.aborted,after:after.elementHtml,retry:retry.id,id,
            final:(await db.get('data',id)).elementHtml};
        }""")
        self.assertFalse(result['aborted'])
        self.assertEqual('Error',result['outcome']['name'])
        self.assertEqual('AbortError',result['outcome']['cause'])
        self.assertIn('image bytes could not be read',result['outcome']['message'])
        self.assertEqual('<p>Old</p>',result['after'])
        self.assertEqual(result['id'],result['retry'])
        self.assertEqual('<p>Retry</p>',result['final'])

    def test_summary_cursor_preserves_distinct_same_title_cards(self):
        self.open_runtime()
        result=self.page.evaluate("""async()=>{
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler}=await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey}=await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const db=await database.db,book={title:'Same title',elementHtml:'<p>Read</p>',
            styleSheet:'',blobs:{},sections:[]};
          const ids=[await db.add('data',{...book,contentHash:'a'.repeat(64)}),
            await db.add('data',{...book,contentHash:'b'.repeat(64)})];
          const handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          const original=IDBObjectStore.prototype.getAll;let usedGetAll=false,cards;
          IDBObjectStore.prototype.getAll=function(...args){
            if(this.name==='data'&&this.transaction.db.name==='books')usedGetAll=true;
            return original.apply(this,args);
          };
          try{cards=await handler.getBookList();}finally{IDBObjectStore.prototype.getAll=original;}
          return {ids,usedGetAll,cards:cards.map(({id,title,contentHash})=>({id,title,contentHash}))};
        }""")
        self.assertFalse(result['usedGetAll'])
        self.assertEqual(result['ids'],[card['id'] for card in result['cards']])
        self.assertEqual(['a'*64,'b'*64],[card['contentHash'] for card in result['cards']])
        self.assertEqual(['Same title']*2,[card['title'] for card in result['cards']])


def load_tests(_loader, _tests, _pattern):
    # The shared base also owns provider and static/offline cases. Keep those in
    # their own suites, not duplicated against this module's development server.
    return unittest.TestSuite(BookSaveCancellation(name) for name in BookSaveCancellation.__dict__
                              if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main()
