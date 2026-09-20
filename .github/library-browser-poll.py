from pathlib import Path
import re
p = Path('tests/browser/test_books_library.py')
s = p.read_text()
assert s.count('import threading\n') == 1
s = s.replace('import threading\n', 'import threading\nimport time\n')
marker = '    def add_collection(self, title, name):\n'
assert s.count(marker) == 1
s = s.replace(marker, '''    def wait_bookmark(self, data_id, predicate):
        # Playwright 1.63 wait_for_function treats a predicate Promise as truthy
        # before its eventual boolean result. Read committed rows and poll the
        # actual value with a bounded deadline, never a fixed settling sleep.
        deadline = time.monotonic() + 20
        while True:
            rows = self.stores('books', ['bookmark'])['bookmark']
            row = next((value for value in rows if value['dataId'] == data_id), None)
            if row is not None and predicate(row):
                return row
            self.assertLess(time.monotonic(), deadline, 'Bookmark condition not met: ' + repr(row))
            self.page.wait_for_timeout(25)

''' + marker)
pattern = r"        reader\.keyboard\.press\('PageDown'\)\n        reader\.keyboard\.press\('KeyB'\)\n        reader\.wait_for_function\([\s\S]*?arg=before, timeout=20000\)\n        after = self\.stores\('books', \['bookmark'\]\)\['bookmark'\]\[0\]"
s, count = re.subn(pattern, '''        reader.bring_to_front()
        reader.keyboard.press('PageDown')
        # Let the existing three-second reader autosave actually persist. Do not
        # replace it with a direct database write or merely check unchanged data.
        after = self.wait_bookmark(before['dataId'],
            lambda row: row.get('lastBookmarkModified', 0) > before['lastBookmarkModified'])
        self.assertGreater(after['lastBookmarkModified'], before['lastBookmarkModified'])
        self.page.bring_to_front()''', s)
assert count == 1, count
pattern = r'        self\.page\.wait_for_function\("""async id => \{[\s\S]*?arg=before\[\x27dataId\x27\], timeout=20000\)'
s, count = re.subn(pattern, '''        self.wait_bookmark(before['dataId'],
            lambda row: row.get('completion', {}).get('state') == 'finished')''', s)
assert count == 1, count
assert 'wait_for_function(' not in s
p.write_text(s)
