"""Real-browser worker contract tests using the committed worker, not mocked Cache APIs.

This small shell fixture is not a full Reader application build. The separate
compiled-app acceptance test covers EPUB import and offline reopening.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SCOPE = '/Reader-Web/'
OPTIONS = None


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
            worker_source = worker_source.replace(
                "import { inspectOfflineShell, OFFLINE_STATUS_REQUEST } from './offline-status.mjs';", '')
            config = {
                'build': [SCOPE + 'app-' + version + '.js', SCOPE + 'offline-status.mjs'],
                'files': [SCOPE + 'appearance-init.js'],
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
        elif path.startswith(SCOPE + 'app-') and path.endswith('.js'):
            served = path.rsplit('app-', 1)[1][:-3]
            body = 'document.body.dataset.boot = ' + json.dumps(served)
            if served == 'bad':
                status, body = 503, 'deliberately missing required asset'
            if served == 'redirect':
                status, body = 302, ''
                headers['Location'] = SCOPE + 'login'
        elif path in [SCOPE, SCOPE + 'manage', SCOPE + 'b']:
            mime = 'text/html'
            body = (f'<!doctype html><html><head><title>Worker contract</title>'
                    f'<script src="{SCOPE}appearance-init.js"></script></head>'
                    f'<body data-document="{version}"><h1>Offline shell fixture</h1>'
                    f'<script src="{SCOPE}app-{version}.js"></script>'
                    f'<script>navigator.serviceWorker.register("{SCOPE}service-worker.js")'
                    '.catch(() => {});</script></body></html>')
            headers['Cache-Control'] = 'public, max-age=3600'
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
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
        self.server.request_queue_size = 128
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
        # wait_for_function treats a Promise as truthy before its resolved
        # boolean is known. Await real registration/activation, with a deadline.
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

    def test_failed_required_asset_preserves_old_shell(self):
        self.install()
        self.page.reload()
        self.update('bad', 'redundant')
        self.assertEqual(self.status()['state'], 'ready')
        self.stop_origin()
        response = self.page.reload()
        self.assertTrue(response.from_service_worker)
        self.assertEqual(self.page.locator('body').get_attribute('data-boot'), 'v1')

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
