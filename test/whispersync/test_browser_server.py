"""HTTP transport tests; these do not claim to exercise browser IndexedDB."""
from contextlib import closing
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import threading
import unittest
from browser import make_handler


class BrowserServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = 'window.fixture = "私は漢字です 𠮷 か\\u3099"'.encode('utf-8')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(cls.script, cls.script))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path):
        with closing(HTTPConnection(*self.server.server_address, timeout=5)) as connection:
            connection.request('GET', path)
            response = connection.getresponse()
            return response.status, response.headers, response.read()

    def test_html_declares_utf8_before_external_scripts(self):
        status, headers, body = self.request('/')
        self.assertEqual(status, 200)
        self.assertEqual(headers.get_content_charset(), 'utf-8')
        self.assertLess(body.index(b'<meta charset="utf-8">'), body.index(b'<script'))

    def test_japanese_scripts_have_explicit_encoding_and_exact_bytes(self):
        for path in ('/bundle.js', '/tests.js'):
            with self.subTest(path=path):
                status, headers, body = self.request(path)
                self.assertEqual(status, 200)
                self.assertEqual(headers.get_content_type(), 'text/javascript')
                self.assertEqual(headers.get_content_charset(), 'utf-8')
                self.assertEqual(body, self.script)
                self.assertEqual(int(headers['Content-Length']), len(body))

    def test_unknown_routes_do_not_serve_html_as_scripts(self):
        status, _, _ = self.request('/missing.js')
        self.assertEqual(status, 404)


if __name__ == '__main__':
    unittest.main()
