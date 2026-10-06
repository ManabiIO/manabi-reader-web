"""Bounded, observation-only evidence for synthetic browser acceptance fixtures.

No response interception, error filtering, preventDefault, or promise handlers.
Retain both Playwright errors and native DOM errors: WebKit console messages can
be surfaced as pageerror even when they are not uncaught application exceptions.
"""
from collections import deque
import json
from pathlib import Path
import time


def case_failed(case):
    """Include body/subtest failures already recorded before tearDown starts."""
    result = getattr(getattr(case, '_outcome', None), 'result', None)
    return result is not None and any(
        test.id().startswith(case.id())
        for test, _ in [*result.failures, *result.errors]
    )


def close_context_with_evidence(context, evidence=None):
    """Observe disposal without changing its exceptions or page-error listeners."""
    if evidence is None:
        context.close()
        return
    evidence.record('context-close-start', documents=[page.url for page in context.pages])
    completed = False
    try:
        context.close()
        completed = True
    finally:
        evidence.record('context-close-end', completed=completed)


class LifecycleEvidence:
    def __init__(self, context, page, engine):
        self.events = deque(maxlen=512)
        # Retain raw error identity even if a busy page rolls it out of the
        # network-event window. This is evidence only, never an error allowlist.
        self.page_errors = deque(maxlen=32)
        self.page_errors_seen = 0
        self.pages = {}
        self.total = 0
        self.engine = engine
        self.started = time.monotonic()
        self.record('start', url=page.url)
        self.watch_page(page)
        context.on('page', self.watch_page)
        # Observers do not consume errors. Existing no-page-error assertions
        # remain authoritative; these events only help identify their origin.
        context.add_init_script('''(() => {
          const report = (event, error) => console.debug('READER_LIFECYCLE ' + JSON.stringify({
            event, url: location.href, name: error?.name,
            message: error?.message ?? String(error ?? ''), stack: error?.stack
          }));
          addEventListener('error', event => report('error', event.error ?? event.message));
          addEventListener('unhandledrejection', event => report('unhandledrejection', event.reason));
          addEventListener('pagehide', () => report('pagehide'));
          addEventListener('pageshow', () => report('pageshow'));
        })()''')

    def watch_page(self, page):
        if page in self.pages:
            return
        page_id = len(self.pages) + 1
        self.pages[page] = page_id
        self.record('page-attached', page=page_id, document=page.url)
        page.on('pageerror', lambda error: self.record(
            'pageerror', name=error.name, message=error.message, stack=error.stack,
            document=page.url, page=page_id))
        page.on('console', lambda message: self.record(
            'console', level=message.type, text=message.text, location=message.location,
            document=page.url, page=page_id)
            if message.type in ('error', 'warning') or message.text.startswith('READER_LIFECYCLE ')
            else None)
        page.on('request', lambda request: self.record(
            'request', url=request.url, kind=request.resource_type, page=page_id))
        page.on('requestfailed', lambda request: self.record(
            'requestfailed', url=request.url, kind=request.resource_type,
            failure=request.failure, page=page_id))
        page.on('response', lambda response: self.record(
            'response', url=response.url, status=response.status, page=page_id))
        page.on('framenavigated', lambda frame: self.record(
            'navigation', url=frame.url, main=frame == page.main_frame, page=page_id))
        page.on('close', lambda: self.record('close', document=page.url, page=page_id))

    def record(self, event, **fields):
        self.total += 1
        entry = {'sequence': self.total, 'seconds': time.monotonic() - self.started,
                 'event': event, **fields}
        self.events.append(entry)
        if event == 'pageerror':
            self.page_errors_seen += 1
            self.page_errors.append(entry)

    def write(self, name, *, failed=False):
        payload = {'test': name, 'engine': self.engine, 'events_seen': self.total,
                   'events_omitted': self.total - len(self.events),
                   'page_errors_seen': self.page_errors_seen,
                   'page_errors_omitted': self.page_errors_seen - len(self.page_errors),
                   'page_errors': list(self.page_errors), 'events': list(self.events)}
        # The Expo qualification intentionally does not upload artifacts. Print
        # failure evidence before disk I/O so that its job log remains useful.
        if failed:
            print('BROWSER LIFECYCLE FAILURE:', json.dumps(payload), flush=True)
        output = Path('test-results') / (self.engine + '-' + name + '-lifecycle.json')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2))
