"""Bounded, observation-only evidence for synthetic browser acceptance fixtures.

No response interception, error filtering, preventDefault, or promise handlers.
Retain both Playwright errors and native DOM errors: WebKit console messages can
be surfaced as pageerror even when they are not uncaught application exceptions.
"""
from collections import deque
import json
from pathlib import Path
import time


class LifecycleEvidence:
    def __init__(self, context, page, engine):
        self.events = deque(maxlen=512)
        self.total = 0
        self.engine = engine
        self.started = time.monotonic()
        self.record('start', url=page.url)
        page.on('pageerror', lambda error: self.record(
            'pageerror', name=error.name, message=error.message, stack=error.stack,
            document=page.url))
        page.on('console', lambda message: self.record(
            'console', level=message.type, text=message.text, location=message.location)
            if message.type in ('error', 'warning') or message.text.startswith('READER_LIFECYCLE ')
            else None)
        page.on('request', lambda request: self.record(
            'request', url=request.url, kind=request.resource_type))
        page.on('requestfailed', lambda request: self.record(
            'requestfailed', url=request.url, kind=request.resource_type,
            failure=request.failure))
        page.on('response', lambda response: self.record(
            'response', url=response.url, status=response.status))
        page.on('framenavigated', lambda frame: self.record(
            'navigation', url=frame.url, main=frame == page.main_frame))
        page.on('close', lambda: self.record('close'))
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

    def record(self, event, **fields):
        self.total += 1
        self.events.append({'sequence': self.total, 'seconds': time.monotonic() - self.started,
                            'event': event, **fields})

    def write(self, name):
        output = Path('test-results') / (self.engine + '-' + name + '-lifecycle.json')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({'engine': self.engine, 'events_seen': self.total,
                                     'events_omitted': self.total - len(self.events),
                                     'events': list(self.events)}, indent=2))
