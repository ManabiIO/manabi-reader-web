#!/usr/bin/env python3
"""Real Chromium menu layout/focus; keyboard and pinch bounds are explicit simulated
VisualViewport inputs. This does not qualify a physical iOS keyboard or IME.
"""
import argparse
import base64
import functools
import json
import os
import pathlib
import re
import traceback

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / '.cache/menu-evidence')
    parser.add_argument('--chromium', default=os.environ.get('CHROMIUM', '/usr/bin/chromium'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    build = ROOT / '.cache/media-test-build'

    @functools.cache
    def module(name):
        source = (build / name).read_text()
        source = re.sub(
            r"""(['"])(\./[^'"\n]+\.js)\1""",
            lambda match: match[1] + module(match[2][2:]) + match[1],
            source,
        )
        return 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()

    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=args.chromium, headless=True, args=['--no-sandbox']
        )

        def make(simulated=False, fallback=False):
            page = browser.new_page(viewport={'width': 390, 'height': 844})
            page.set_content(
                '<!doctype html><meta charset="utf-8"><style>'
                + (build / 'media.css').read_text()
                + '</style><main class="manabi-media" id="host"></main>'
            )
            page.evaluate(
                """async ({url,simulated,fallback}) => {
                    if(simulated) {
                        window.testViewport=Object.assign(new EventTarget(),{
                            offsetLeft:0,offsetTop:0,width:390,height:844
                        });
                        Object.defineProperty(window,'visualViewport',{
                            configurable:true,value:testViewport
                        });
                    }
                    if(fallback) {
                        Object.defineProperty(window,'visualViewport',{value:undefined});
                        Object.defineProperty(HTMLElement.prototype,'showPopover',{
                            configurable:true,value:undefined
                        });
                    }
                    const {TranscriptMenu,button,element}=await import(url);
                    window.menu=new TranscriptMenu();
                    menu.trigger.style.cssText='position:fixed;right:24px;top:50px';
                    for(let i=0;i<8;i++)menu.panel.append(button('Option '+i,()=>{}));
                    const label=element('label','Subtitle offset');
                    window.field=element('input');field.type='number';field.value='0';
                    label.append(field);menu.panel.append(label);
                    host.append(menu.trigger,menu.panel);
                }""",
                {'url': module('player-controls.js'), 'simulated': simulated, 'fallback': fallback},
            )
            return page

        def bounded(page, left, top, width, height):
            rect = page.locator('.transcript-options').bounding_box()
            assert rect is not None
            assert rect['x'] >= left - .01, rect
            assert rect['y'] >= top - .01, rect
            assert rect['x'] + rect['width'] <= left + width + .01, rect
            assert rect['y'] + rect['height'] <= top + height + .01, rect

        def case(name, fn):
            try:
                fn()
                results.append({'name': name, 'passed': True})
                print('PASS', name, flush=True)
            except Exception:
                results.append({'name': name, 'passed': False, 'error': traceback.format_exc()})
                print('FAIL', name, traceback.format_exc(), flush=True)

        def ordinary_resize():
            page = make()
            page.get_by_role('button', name='Transcript options', exact=True).click()
            bounded(page, 0, 0, 390, 844)
            page.set_viewport_size({'width': 320, 'height': 568})
            page.wait_for_timeout(60)
            bounded(page, 0, 0, 320, 568)
            page.keyboard.press('Escape')
            assert page.get_by_role('button', name='Transcript options', exact=True).evaluate(
                'node=>node===document.activeElement'
            )
            assert page.locator('.transcript-options').is_hidden()
            page.close()

        case('native popover stays bounded across actual viewport resize and restores focus', ordinary_resize)

        def keyboard():
            page = make(simulated=True)
            page.get_by_role('button', name='Transcript options', exact=True).click()
            page.locator('input').fill('1.25')
            page.evaluate("""Object.assign(testViewport,{offsetTop:80,height:250});
                testViewport.dispatchEvent(new Event('resize'))""")
            page.wait_for_timeout(60)
            bounded(page, 0, 80, 390, 250)
            assert page.evaluate('document.activeElement===field && field.value==="1.25"')
            assert page.evaluate('window.scrollY') == 0
            box = page.locator('input').bounding_box()
            assert box['y'] >= 80 and box['y'] + box['height'] <= 330, box
            page.screenshot(path=str(args.output / 'menu-keyboard-bounds.png'))
            page.evaluate('menu.panel.scrollTop=0')
            page.wait_for_timeout(60)
            assert page.evaluate('menu.panel.scrollTop') == 0
            page.close()

        case('simulated keyboard keeps the timing input visible without scrolling the page or trapping menu scroll', keyboard)

        def pinch():
            page = make(simulated=True)
            page.get_by_role('button', name='Transcript options', exact=True).click()
            page.evaluate("""Object.assign(testViewport,{
                offsetLeft:90,offsetTop:100,width:195,height:422});
                testViewport.dispatchEvent(new Event('scroll'))""")
            page.wait_for_timeout(60)
            bounded(page, 90, 100, 195, 422)
            page.close()

        case('simulated pinch-pan uses visible viewport offsets instead of layout edges', pinch)

        def tiny_height():
            page = make(simulated=True)
            page.get_by_role('button', name='Transcript options', exact=True).click()
            page.evaluate("""Object.assign(testViewport,{offsetTop:120,height:94});
                testViewport.dispatchEvent(new Event('resize'))""")
            page.wait_for_timeout(60)
            bounded(page, 0, 120, 390, 94)
            assert page.evaluate('menu.panel.scrollHeight>menu.panel.clientHeight')
            page.close()

        case('a very short visible viewport scrolls instead of forcing a 120px overflowing panel', tiny_height)

        def disposal():
            page = make(simulated=True)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.get_by_role('button', name='Transcript options', exact=True).click()
            page.evaluate("""menu.dispose();testViewport.height=220;
                testViewport.dispatchEvent(new Event('resize'));menu.trigger.click()""")
            page.wait_for_timeout(30)
            assert not errors, errors
            assert page.locator('.transcript-options').count() == 0
            assert page.evaluate('menu.trigger.getAttribute("aria-expanded")') == 'false'
            page.close()

        case('disposed controls ignore a late trigger and viewport event', disposal)

        def fallback():
            page = make(fallback=True)
            page.get_by_role('button', name='Transcript options', exact=True).click()
            bounded(page, 0, 0, 390, 844)
            page.keyboard.press('Escape')
            assert page.locator('.transcript-options').is_hidden()
            assert page.evaluate('document.activeElement===menu.trigger')
            page.close()

        case('no-popover and no-VisualViewport fallback retains sizing, Escape and focus', fallback)
        browser.close()

    report = {
        'environment': 'Chromium; actual production menu DOM and focus',
        'simulated': 'keyboard/pinch VisualViewport inputs; no physical-device claim',
        'tests': results,
        'passed': sum(case['passed'] for case in results),
        'failed': sum(not case['passed'] for case in results),
    }
    (args.output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    if report['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
