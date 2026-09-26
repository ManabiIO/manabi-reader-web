"""Metadata-only last-read writes through the actual handler/native IndexedDB."""
import unittest
from test_library_deletion import LibraryDeletionRuntime


class BookLastRead(LibraryDeletionRuntime):
    def test_last_read_preserves_newer_content_without_reading_image_blobs(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database} = await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler} = await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey} = await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const db = await database.db;
          const bytes = {format:'reader-bytes-v1',type:'image/png',bytes:new Uint8Array([1,2,3]).buffer};
          const id = await db.add('data', {title:'Current title',elementHtml:'<p>New content</p>',
            styleSheet:'',blobs:{image:bytes},coverImage:bytes,sections:[],lastBookOpen:100,
            contentHash:'b'.repeat(64),storageSource:'Retain source',manabiTtuImport:{version:2}});
          const before = await db.get('data',id);
          const handler = new BrowserStorageHandler(window,StorageKey.BROWSER);
          handler.startContext({id,title:'Stale title'});
          const read = Blob.prototype.arrayBuffer;
          let reads=0,error;
          Blob.prototype.arrayBuffer = function(){ reads++; throw new Error('Unexpected image read'); };
          try {
            await handler.updateLastRead({id,title:'Stale title',elementHtml:'<p>Stale</p>',
              styleSheet:'',blobs:{image:new Blob(['stale'])},sections:[],lastBookOpen:200});
          } catch(e) { error=String(e); }
          finally { Blob.prototype.arrayBuffer=read; }
          const after=await db.get('data',id);
          const project = book => ({...book,blobs:{image:[...new Uint8Array(book.blobs.image.bytes)]},
            coverImage:[...new Uint8Array(book.coverImage.bytes)]});
          return {reads,error,before:project(before),after:project(after)};
        }""")
        self.assertEqual(0, result['reads'])
        self.assertIsNone(result.get('error'))
        self.assertEqual({**result['before'], 'lastBookOpen': 200}, result['after'])

    def test_stale_updates_do_not_recreate_deleted_books_or_lower_newer_timestamps(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {BrowserStorageHandler}=await import('/reader-web/src/lib/data/storage/handler/browser-handler.ts');
          const {StorageKey}=await import('/reader-web/src/lib/data/storage/storage-types.ts');
          const db=await database.db;
          const book={title:'Timestamp',elementHtml:'<p>Read</p>',styleSheet:'',blobs:{},sections:[],lastBookOpen:500};
          const id=await db.add('data',book),handler=new BrowserStorageHandler(window,StorageKey.BROWSER);
          handler.startContext({id,title:book.title});
          await Promise.all([handler.updateLastRead({...book,id,lastBookOpen:300}),
            handler.updateLastRead({...book,id,lastBookOpen:200})]);
          const kept=await db.get('data',id);
          await db.delete('data',id);
          await handler.updateLastRead({...book,id,lastBookOpen:600});
          return {time:kept.lastBookOpen,keys:await db.getAllKeys('data')};
        }""")
        self.assertEqual(500, result['time'])
        self.assertEqual([], result['keys'])

    def test_native_abort_rolls_back_is_observed_and_allows_retry(self):
        self.open_runtime()
        result = self.page.evaluate("""async () => {
          const {database}=await import('/reader-web/src/lib/data/store.ts');
          const {updateBookLastRead}=await import('/reader-web/src/lib/data/database/books-db/book-records.ts');
          const db=await database.db;
          const id=await db.add('data',{title:'Abort',elementHtml:'<p>Read</p>',styleSheet:'',blobs:{},sections:[],lastBookOpen:100});
          const original=IDBObjectStore.prototype.put;let error,enqueued=false;
          IDBObjectStore.prototype.put=function(...args){
            const request=original.apply(this,args);
            if(this.transaction.db.name==='books'&&this.name==='data'){
              enqueued=true;this.transaction.abort();
            }
            return request;
          };
          try { await updateBookLastRead(db,id,200); }
          catch(e){error=e.name;}
          finally{IDBObjectStore.prototype.put=original;}
          const before=await db.get('data',id);
          await updateBookLastRead(db,id,300);
          return {enqueued,error,before:before.lastBookOpen,after:(await db.get('data',id)).lastBookOpen};
        }""")
        self.assertTrue(result['enqueued'])
        self.assertEqual('AbortError', result['error'])
        self.assertEqual(100, result['before'])
        self.assertEqual(300, result['after'])


def load_tests(_loader, _tests, _pattern):
    return unittest.TestSuite(BookLastRead(name) for name in BookLastRead.__dict__
                              if name.startswith('test_'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
