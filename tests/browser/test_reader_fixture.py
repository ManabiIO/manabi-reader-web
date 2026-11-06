"""Fixture identity helpers retain real storage operands and safety fault targets."""
import json
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from reader_fixture import reader_fixture, reader_fixture_path, reader_product


class ReaderFixtureIdentity(unittest.TestCase):
    def test_metadata_selects_the_actual_output_and_rejects_invalid_identity(self):
        with TemporaryDirectory(prefix='reader-fixture-identity-') as temporary:
            root = Path(temporary).resolve()
            marker = root / 'reader-product.json'
            product = {'schema': 1, 'edition': 'manabi', 'storageNamespace': 'private-fixture-v1',
                       'basePath': '/private-reader', 'name': 'Private Reader fixture'}
            marker.write_text(json.dumps(product))
            with patch.dict(os.environ, READER_EDITION_TEST_OUTPUT=str(root)):
                reader_product.cache_clear()
                self.assertEqual(product, reader_product())
                product['storageNamespace'] = '../wrong'
                marker.write_text(json.dumps(product))
                reader_product.cache_clear()
                with self.assertRaisesRegex(ValueError, 'valid Reader product'):
                    reader_product()
            reader_product.cache_clear()

    def test_explicit_fixture_scripts_keep_native_apis_and_target_only_owned_names(self):
        product = {'storageNamespace': 'fixture-v1', 'basePath': '/manabitan-reader'}
        script = """() => {
          localStorage.setItem('fontSize', '24');
          const key = 'writingMode'; localStorage.removeItem(key);
          indexedDB.open('books', 16);
          indexedDB.open('foreign-database');
          const name = 'manabi-reader-integrations'; indexedDB.open(name);
          caches.open('ttu-userfonts');
          const db = {name:'fixture-v1:books'};
          if (db.name === 'books') localStorage.getItem('fontSize');
          return '/api/reader-web/session/';
        }"""
        converted = reader_fixture(script, product)
        # Execute only authored identity statements. No application/storage
        # substitutes or browser profile are used for product qualification.
        harness = """const calls=[];
          const localStorage = Object.fromEntries(['setItem','getItem','removeItem'].map(name=>[name,(...args)=>calls.push([name,...args])]));
          const indexedDB={open:(...args)=>calls.push(['database',...args])};
          const caches={open:(...args)=>calls.push(['cache',...args])};
          const value=eval('('+process.argv[1]+')')();
          console.log(JSON.stringify({calls,value}));"""
        result = subprocess.run(['node', '-e', harness, converted], capture_output=True, text=True, check=True)
        self.assertEqual({'calls': [
            ['setItem', 'fixture-v1:fontSize', '24'], ['removeItem', 'fixture-v1:writingMode'],
            ['database', 'fixture-v1:books', 16], ['database', 'foreign-database'],
            ['database', 'fixture-v1:manabi-reader-integrations'], ['cache', 'fixture-v1:ttu-userfonts'],
            ['getItem', 'fixture-v1:fontSize']], 'value': '/api/reader-web/session/'}, json.loads(result.stdout))
        self.assertNotIn('prototype =', converted)

    def test_fault_injection_still_targets_database_and_storage_keys(self):
        product = {'storageNamespace': 'fixture-v1', 'basePath': '/open-reader'}
        source = """Storage.prototype.setItem = function(key,value) {
          if (key === 'writingMode') throw Error('quota');
        }; if (this.transaction.db.name === 'books' && this.name === 'data') tx.abort();
        if (this.transaction.db.name === 'manabi-reader-integrations' && this.name === 'books') tx.abort();
        IDBDatabase.prototype.transaction = function() { const database = this; if(database.name==='books') throw Error('abort'); };"""
        converted = reader_fixture(source, product)
        self.assertIn('key === "fixture-v1:writingMode"', converted)
        self.assertIn('this.transaction.db.name === "fixture-v1:books"', converted)
        self.assertIn('this.transaction.db.name === "fixture-v1:manabi-reader-integrations"', converted)
        # The books object store in the integrations DB is a logical wire name.
        self.assertIn("this.name === 'books'", converted)
        self.assertIn('if(database.name==="fixture-v1:books")', converted)

    def test_upstream_context_and_api_paths_keep_their_own_identities(self):
        product = {'storageNamespace': 'fixture-v1', 'basePath': '/open-reader'}
        source = "indexedDB.open('books'); localStorage.getItem('fontSize'); location.href='/reader-web/manage'; fetch('/api/reader-web/session/');"
        result = reader_fixture_path(source, product)
        self.assertIn("indexedDB.open('books')", result)
        self.assertIn("localStorage.getItem('fontSize')", result)
        self.assertIn("location.href='/open-reader/manage'", result)
        self.assertIn("fetch('/api/reader-web/session/')", result)
        sentinels = (Path(__file__).with_name('test_reader_editions.py')).read_text()
        self.assertIn("localStorage.setItem('manabi-flashcards:sentinel', 'keep')", sentinels)
        self.assertIn("localStorage.setItem('manabi-reader-v1:sentinel', 'keep')", sentinels)
        self.assertIn("indexedDB.open('books', 1)", sentinels)
        self.assertNotIn('reader_fixture(', sentinels)


if __name__ == '__main__':
    unittest.main(verbosity=2)
