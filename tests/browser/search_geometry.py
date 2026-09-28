"""Rendered-text visibility assertions independent of IntersectionObserver.

WebKit's inline-mark observer reported ratio zero for a visibly painted match
in run 36469636779. Require every text fragment to fit inside the real scroller
and viewport, with an unobstructed hit target. Retain observer values separately.
This helper never scrolls, changes styles, or weakens failed geometry into a pass.
"""
import json

from playwright.sync_api import expect


MARK_GEOMETRY = r"""element => {
  const range = document.createRange();
  range.selectNodeContents(element);
  const fragments = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
  const viewport = window.visualViewport;
  const clip = {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth),
    bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight)
  };
  let rendered = element.isConnected && fragments.length > 0;
  const clips = [];
  for (let node = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
      rendered = false;
    if (node !== element) {
      const rect = node.getBoundingClientRect();
      const xClipped = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
      const yClipped = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
      if (xClipped) {
        clip.left = Math.max(clip.left, rect.left + node.clientLeft);
        clip.right = Math.min(clip.right, rect.left + node.clientLeft + node.clientWidth);
      }
      if (yClipped) {
        clip.top = Math.max(clip.top, rect.top + node.clientTop);
        clip.bottom = Math.min(clip.bottom, rect.top + node.clientTop + node.clientHeight);
      }
      if (xClipped || yClipped) clips.push({tag: node.tagName, class: node.className, rect: rect.toJSON()});
    }
  }
  const rects = fragments.map(rect => {
    const fits = rect.left >= clip.left - 0.5 && rect.right <= clip.right + 0.5 &&
      rect.top >= clip.top - 0.5 && rect.bottom <= clip.bottom + 0.5;
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const hit = !!target && (target === element || element.contains(target));
    return {...rect.toJSON(), fits, hit, target: target?.outerHTML.slice(0, 180)};
  });
  return {visible: rendered && rects.every(r => r.fits && r.hit), clip, rects, clips};
}"""


def assert_mark_visible(case, mark):
    """Wait for the painted fragments without performing test-side scrolling."""
    expect(mark).to_have_count(1)
    expect(mark).to_be_visible()
    handle = mark.element_handle()
    try:
        try:
            case.page.wait_for_function(
                '(element) => (' + MARK_GEOMETRY + ')(element).visible', arg=handle, timeout=5000)
        finally:
            # Preserve geometry even when the predicate fails. An independent
            # observer disagreement is diagnostic, never a success shortcut.
            geometry = mark.evaluate(MARK_GEOMETRY)
            observer = mark.evaluate('''element => new Promise(resolve => {
              const timer = setTimeout(() => { observer.disconnect(); resolve({pending:true}); }, 1500);
              const observer = new IntersectionObserver(entries => {
                clearTimeout(timer);
                const entry = entries[0]; observer.disconnect();
                resolve({ratio: entry.intersectionRatio, intersecting: entry.isIntersecting,
                  bounds: entry.boundingClientRect.toJSON(), intersection: entry.intersectionRect.toJSON()});
              });
              observer.observe(element);
            })''')
            path = case.output / (case._testMethodName + '-mark-geometry.jsonl')
            with path.open('a') as stream:
                stream.write(json.dumps({'geometry': geometry, 'observer': observer}) + '\n')
            case.assertTrue(geometry['visible'], json.dumps(geometry))
    finally:
        if handle:
            handle.dispose()


def assert_control_reachable(case, control):
    """Require a full-size, unobstructed pointer target in the visual viewport."""
    expect(control).to_be_visible()
    handle = control.element_handle()
    try:
        case.page.wait_for_function('''element => {
          const r = element.getBoundingClientRect();
          const v = window.visualViewport;
          const left = v?.offsetLeft ?? 0, top = v?.offsetTop ?? 0;
          const right = left + (v?.width ?? innerWidth);
          const bottom = top + (v?.height ?? innerHeight);
          const center = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.width >= 44 && r.height >= 44 &&
            r.left >= left && r.right <= right && r.top >= top && r.bottom <= bottom &&
            !!center && element.contains(center);
        }''', arg=handle, timeout=5000)
    finally:
        if handle:
            handle.dispose()
