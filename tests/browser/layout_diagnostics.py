"""Failure-only geometry for generated browser fixtures; does not change assertions."""
import json


def report_layout_failure(case):
    result = getattr(getattr(case, '_outcome', None), 'result', None)
    if result is None or not any(
        test.id().startswith(case.id())
        for test, _ in [*result.failures, *result.errors]
    ):
        return
    try:
        state = case.page.evaluate('''() => {
          const describe = element => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            return {
              tag: element.tagName, id: element.id, class: String(element.className).slice(0, 180),
              role: element.getAttribute('role'), hidden: element.getAttribute('aria-hidden'),
              display: style.display, position: style.position, visibility: style.visibility,
              overflowX: style.overflowX, overflowY: style.overflowY,
              top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
              clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
              scrollTop: element.scrollTop
            };
          };
          const ancestors = selector => [...document.querySelectorAll(selector)].slice(0, 3).map(node => {
            const chain = [];
            for (let element = node; element && chain.length < 12; element = element.parentElement)
              chain.push(describe(element));
            return chain;
          });
          return {
            url: location.href, viewport: [innerWidth, innerHeight], scroll: [scrollX, scrollY],
            document: describe(document.documentElement),
            selection: ancestors('[aria-label="Book selection"]'),
            reader: ancestors('.book-content'),
            controls: ancestors('[data-reader-controls]'),
            gallery: ancestors('.gallery-viewer'),
            galleryState: [...document.querySelectorAll('.gallery-layout')].slice(0, 3).map(panel => ({
              class: panel.className,
              thumbnails: [...panel.querySelectorAll('[data-image-index]')].map(button => ({
                index: button.dataset.imageIndex, label: button.getAttribute('aria-label'),
                pressed: button.getAttribute('aria-pressed')
              })),
              image: [...panel.querySelectorAll('.gallery-viewer img')].map(image => ({
                alt: image.alt, complete: image.complete,
                naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight
              })),
              buttons: [...panel.querySelectorAll('.gallery-viewer button')].map(button => ({
                text: button.textContent, disabled: button.disabled, ...describe(button)
              }))
            }))
          };
        }''')
        print('BROWSER LAYOUT FAILURE:', json.dumps(state, ensure_ascii=False))
    except Exception as error:
        print('Browser layout diagnostic unavailable:', type(error).__name__, str(error))
