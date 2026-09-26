"""Real-browser worker contract tests using the committed worker, not mocked Cache APIs.

This small shell fixture is not a full Reader application build. The separate
compiled-app acceptance test covers EPUB import and offline reopening.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from pathlib import Path
import threading
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SCOPE = '/Reader-Web/'
OPTIONS = None


class FixtureServer(ThreadingHTTPServer):
    request_queue_size = 128


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        server = self.server
        path = urlsplit(self.path).path
        server.requests.append(path)
        version = server.version
        headers = {}
        mime = 'text/javascript'
        status = 200
        if path == SCOPE + 'service-worker.js':
            status_source = (ROOT / 'apps/web/src/lib/service-worker/offline-status.mjs').read_text()
            worker_source = (ROOT / 'apps/web/src/lib/service-worker/reader-service-worker.mjs').read_text()
            worker_source, imports = re.subn(
                r"import\s*\{[^}]+\}\s*from './offline-status.mjs';", '', worker_source)
            assert imports == 1, 'The fixture must inline the real worker dependency exactly once'
            config = {
                'build': [SCOPE + 'app-' + version + '.js', SCOPE + 'offline-status.mjs'],
                'files': [SCOPE + 'appearance-init.js', SCOPE + 'app.css', SCOPE + 'font.woff2'],
                'prerendered': [SCOPE, SCOPE + 'manage', SCOPE + 'b'],
                'version': version, 'userFontsCacheName': 'fixture-user-fonts'
            }
            # Concatenate the exact dependency/worker modules into a classic
            # worker so Firefox does not require module-service-worker support.
            body = (status_source + '\n' + worker_source).replace('export ', '')
            body += '\nregisterReaderServiceWorker(self, ' + json.dumps(config) + ');'
            headers['Cache-Control'] = 'no-store'
        elif path == SCOPE + 'offline-status.mjs':
            body = (ROOT / 'apps/web/src/lib/service-worker/offline-status.mjs').read_text()
        elif path == SCOPE + 'appearance-init.js':
            body = 'window.appearanceVersion = ' + json.dumps(version)
            headers['Cache-Control'] = 'public, max-age=3600'
        elif path == SCOPE + 'app.css':
            mime, body = 'text/css', 'body { font-size: 16px; }'
            if version == 'bad-css':
                mime, body = 'text/html', '<html>Wrong CSS response</html>'
            headers['Cache-Control'] = 'public, max-age=3600'
        elif path == SCOPE + 'font.woff2':
            # Byte-cache contract only; the app acceptance checks real rendering.
            mime, body = 'font/woff2', 'font:' + version
            headers['Cache-Control'] = 'public, max-age=3600'
        elif path.startswith(SCOPE + 'app-') and path.endswith('.js'):
            served = path.rsplit('app-', 1)[1][:-3]
            body = 'document.body.dataset.boot = ' + json.dumps(served)
            if served == 'bad':
                status, body = 503, 'deliberately missing required asset'
            if served == 'empty':
                status, body = 204, ''
            if served == 'bad-js':
                mime, body = 'text/html', '<html>Not a JavaScript module</html>'
            if served == 'redirect':
                status, body = 302, ''
                headers['Location'] = SCOPE + 'login'
        elif path in [SCOPE, SCOPE + 'manage', SCOPE + 'b']:
            mime = 'text/html'
            body = (f'<!doctype html><html><head><title>Worker contract</title>'
                    f'<script src="{SCOPE}appearance-init.js"></script></head>'
                    f'<body data-document="{version}"><h1>Offline shell fixture</h1>'
                    f'<script src="{SCOPE}app-{version}.js"></script>'
                    f'<script>window.registrationAttempt = navigator.serviceWorker.register("{SCOPE}service-worker.js")'
                    '.catch(() => {});</script></body></html>')
            headers['Cache-Control'] = 'public, max-age=3600'
            if version == 'bad-page' and path == SCOPE + 'b':
                mime, body = 'text/plain', 'Not an HTML document'
        elif path == '/observer':
            mime, body = 'text/html', '<!doctype html><title>Outside worker scope</title>'
        else:
            mime, status, body = 'text/plain', 404, 'not found'
        encoded = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(encoded)))
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *args):
        pass


class OfflineWorker(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        kwargs = {'executable_path': OPTIONS.executable} if OPTIONS.executable else {}
        cls.browser = getattr(cls.playwright, OPTIONS.browser).launch(**kwargs)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.server = FixtureServer(('127.0.0.1', 0), FixtureHandler)
        self.server.version = 'v1'
        self.server.requests = []
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = 'http://127.0.0.1:' + str(self.server.server_port)
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def stop_origin(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join()
            self.server = None

    def tearDown(self):
        self.context.close()
        self.stop_origin()
        self.assertEqual(self.errors, [])

    def install(self):
        self.page.goto(self.origin + SCOPE + 'manage')
        # Await real registration/activation with a bounded polling deadline,
        # independently of animation frames or document rendering.
        self.page.evaluate('''async scope => {
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const r = await navigator.serviceWorker.getRegistration(scope);
            if (r?.active?.state === 'activated') return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Automatic worker activation timed out');
        }''', SCOPE)
        self.assertEqual(self.status()['state'], 'ready')

    def status(self):
        return self.page.evaluate('''async (scope) => {
          const { getOfflineStatus } = await import(scope + 'offline-status.mjs');
          return getOfflineStatus(navigator.serviceWorker, location.origin + scope);
        }''', SCOPE)

    def update(self, version, terminal):
        # A reload's automatic register() must finish before changing what its
        # worker URL serves. Otherwise that job can race the deliberate update,
        # reject one candidate and create another cache during the assertion.
        self.page.evaluate('async () => { await window.registrationAttempt; }')
        self.server.version = version
        result = self.page.evaluate('''async ({scope, terminal}) => {
          const r = await navigator.serviceWorker.getRegistration(scope);
          const state = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Update lifecycle timed out')), 10000);
            r.addEventListener('updatefound', () => {
              const w = r.installing;
              const changed = () => {
                if (w.state === terminal) { clearTimeout(timer); resolve(w.state); }
              };
              w.addEventListener('statechange', changed);
              changed();
            }, {once: true});
          });
          await r.update();
          return state;
        }''', {'scope': SCOPE, 'terminal': terminal})
        self.assertEqual(result, terminal)

    def test_first_visit_then_fresh_navigation_with_stopped_origin(self):
        self.install()
        # Readiness of an active registration does not require force-claiming
        # this first document, installing a PWA, or granting storage persistence.
        self.assertFalse(self.page.evaluate('!!navigator.serviceWorker.controller'))
        self.stop_origin()
        next_page = self.context.new_page()
        response = next_page.goto(self.origin + SCOPE + 'b?id=42')
        self.assertTrue(response.from_service_worker)
        self.assertEqual(next_page.locator('body').get_attribute('data-boot'), 'v1')
        self.assertEqual(next_page.locator('body').get_attribute('data-document'), 'v1')
        next_page.close()

    def test_update_refreshes_mutable_http_cache_and_keeps_live_tab_pinned(self):
        self.install()
        self.page.reload()
        self.assertTrue(self.page.evaluate('!!navigator.serviceWorker.controller'))
        observer = self.context.new_page()
        observer.goto(self.origin + '/observer')
        observer.evaluate('''async scope => {
          window.oldActive = (await navigator.serviceWorker.getRegistration(scope)).active;
        }''', SCOPE)
        self.update('v2', 'installed')
        self.assertEqual(self.status(), {'state': 'ready', 'updateWaiting': True})
        # The waiting shell must have fresh mutable bytes, not v1's HTTP cache.
        cached = self.page.evaluate('''async scope => {
          const name = `manabi-reader:${encodeURIComponent(location.origin + scope)}:shell:v2`;
          const c = await caches.open(name);
          return [(await c.match(location.origin + scope + 'manage')).text(),
                  (await c.match(location.origin + scope + 'appearance-init.js')).text()]
            .reduce(async (a, p) => [...await a, await p], Promise.resolve([]));
        }''', SCOPE)
        self.assertIn('data-document="v2"', cached[0])
        self.assertIn('"v2"', cached[1])
        self.stop_origin()
        # Opening another document while v1 still has clients must use v1.
        second = self.context.new_page()
        response = second.goto(self.origin + SCOPE + 'b?id=43')
        self.assertTrue(response.from_service_worker)
        self.assertEqual(second.locator('body').get_attribute('data-boot'), 'v1')
        second.close()
        self.page.close()
        observer.evaluate('''async scope => {
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const r = await navigator.serviceWorker.getRegistration(scope);
            if (r?.active !== window.oldActive && r?.active?.state === 'activated') return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Waiting worker did not activate after old clients closed');
        }''', SCOPE)
        third = self.context.new_page()
        response = third.goto(self.origin + SCOPE + 'b?id=44')
        self.assertTrue(response.from_service_worker)
        self.assertEqual(third.locator('body').get_attribute('data-boot'), 'v2')
        self.assertEqual(third.locator('body').get_attribute('data-document'), 'v2')
        self.assertEqual(third.evaluate('window.appearanceVersion'), 'v2')
        third.close()
        observer.close()

    def test_partial_cache_clear_is_detected_without_repair_or_unrelated_deletion(self):
        self.install()
        self.page.evaluate('''async scope => {
          const sentinel = await caches.open('fixture-user-fonts');
          await sentinel.put('/userfonts/keep', new Response('keep-local-data'));
          const name = `manabi-reader:${encodeURIComponent(location.origin + scope)}:shell:v1`;
          await (await caches.open(name)).delete(location.origin + scope + 'b');
        }''', SCOPE)
        requests = len(self.server.requests)
        self.assertEqual(self.status()['state'], 'incomplete')
        self.assertEqual(len(self.server.requests), requests, 'Status must not fetch repairs')
        self.assertEqual(self.page.evaluate('''async scope => {
          const name = `manabi-reader:${encodeURIComponent(location.origin + scope)}:shell:v1`;
          return !!await (await caches.open(name)).match(location.origin + scope + 'b');
        }''', SCOPE), False)
        self.assertEqual(self.page.evaluate('''async () =>
          (await (await caches.open('fixture-user-fonts')).match('/userfonts/keep')).text()
        '''), 'keep-local-data')

    def test_failed_required_asset_preserves_old_shell(self):
        self.install()
        self.page.reload()
        self.update('bad', 'redundant')
        # A failed addAll batch must not leave a partially usable candidate.
        self.assertEqual(self.page.evaluate('''async scope => {
          const name = `manabi-reader:${encodeURIComponent(location.origin + scope)}:shell:bad`;
          return (await (await caches.open(name)).keys()).length;
        }''', SCOPE), 0)
        self.assertEqual(self.status()['state'], 'ready')
        self.stop_origin()
        response = self.page.reload()
        self.assertTrue(response.from_service_worker)
        self.assertEqual(self.page.locator('body').get_attribute('data-boot'), 'v1')

    def assert_bad_candidate_keeps_old_app(self, version):
        self.install()
        self.page.reload()
        self.update(version, 'redundant')
        self.assertEqual(self.page.evaluate('''async ({scope, version}) => {
          const name = `manabi-reader:${encodeURIComponent(location.origin + scope)}:shell:${version}`;
          return (await caches.keys()).includes(name);
        }''', {'scope': SCOPE, 'version': version}), False)
        self.assertEqual(self.status()['state'], 'ready')
        self.stop_origin()
        response = self.page.reload()
        self.assertTrue(response.from_service_worker)
        self.assertEqual(self.page.locator('body').get_attribute('data-boot'), 'v1')

    def test_empty_successful_response_cannot_replace_the_working_shell(self):
        self.assert_bad_candidate_keeps_old_app('empty')

    def test_html_instead_of_javascript_cannot_replace_the_working_shell(self):
        self.assert_bad_candidate_keeps_old_app('bad-js')

    def test_html_instead_of_css_cannot_replace_the_working_shell(self):
        self.assert_bad_candidate_keeps_old_app('bad-css')

    def test_non_html_page_cannot_replace_the_working_shell(self):
        self.assert_bad_candidate_keeps_old_app('bad-page')

    def test_mutable_font_refreshes_http_cache_then_survives_offline(self):
        self.install()
        self.page.reload()
        read_font = 'async scope => (await fetch(scope + "font.woff2")).text()'
        self.assertEqual(self.page.evaluate(read_font, SCOPE), 'font:v1')
        self.assertEqual(self.server.requests.count(SCOPE + 'font.woff2'), 1)
        observer = self.context.new_page()
        observer.goto(self.origin + '/observer')
        observer.evaluate('''async scope => {
          window.oldActive = (await navigator.serviceWorker.getRegistration(scope)).active;
        }''', SCOPE)
        self.update('v2', 'installed')
        self.page.close()
        observer.evaluate('''async scope => {
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const r = await navigator.serviceWorker.getRegistration(scope);
            if (r?.active !== window.oldActive && r?.active?.state === 'activated') return;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('New worker did not activate');
        }''', SCOPE)
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(self.origin + SCOPE + 'manage')
        self.assertEqual(self.page.evaluate(read_font, SCOPE), 'font:v2')
        self.assertEqual(self.server.requests.count(SCOPE + 'font.woff2'), 2)
        self.stop_origin()
        self.assertEqual(self.page.evaluate(read_font, SCOPE), 'font:v2')
        observer.close()

    def test_redirect_is_not_an_accepted_shell_asset(self):
        self.install()
        self.page.reload()
        self.update('redirect', 'redundant')
        self.assertEqual(self.status()['state'], 'ready')
        self.assertNotIn(SCOPE + 'login', self.server.requests)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', choices=['chromium', 'webkit', 'firefox'], default='chromium')
    parser.add_argument('--executable')
    OPTIONS, args = parser.parse_known_args()
    unittest.main(argv=[__file__, *args])
