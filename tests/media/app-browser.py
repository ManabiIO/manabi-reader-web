#!/usr/bin/env python3
"""Built Svelte / real IndexedDB / shared ebook display settings. No ASR or cloud claim."""
import argparse
import json
import pathlib
import sys
import threading
from playwright.sync_api import sync_playwright, expect
ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/browser'))
from test_static_reader import StaticHandler, ThreadingHTTPServer


APPEARANCE_AUDIT = """
async (sheet) => {
    // Let Svelte commit this frame, but do not wait out or cancel color transitions.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', {willReadFrequently:true});
    const rgba = css => {
        context.clearRect(0,0,1,1);
        context.fillStyle = css;
        context.fillRect(0,0,1,1);
        const [r,g,b,a] = context.getImageData(0,0,1,1).data;
        return [r,g,b,a/255];
    };
    const over = (foreground, background) => foreground.slice(0,3).map(
        (v,i) => v*foreground[3] + background[i]*(1-foreground[3])
    ).concat(1);
    const background = node => {
        const ancestors=[];
        for(let n=node;n;n=n.parentElement) ancestors.push(n);
        return ancestors.reverse().reduce(
            (value,n) => over(rgba(getComputedStyle(n).backgroundColor),value),
            [255,255,255,1]
        );
    };
    const luminance = color => color.slice(0,3).map(v=>{
        const c=v/255;
        return c<=.04045 ? c/12.92 : ((c+.055)/1.055)**2.4;
    }).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const nodes=sheet.querySelectorAll(
        '[data-slot="sheet-title"], output, .setting-row > span, p:not(.sr-only), select, button'
    );
    const measurements = Array.from(nodes).filter(node =>
        !node.disabled && node.getBoundingClientRect().height>0 &&
        (node.textContent.trim() || node.tagName==='SELECT')
    ).map(node=>{
        const style=getComputedStyle(node);
        const surface=background(node);
        const ink=over(rgba(style.color),surface);
        const a=luminance(ink), b=luminance(surface);
        return {
            label:node.getAttribute('aria-label') || node.textContent.trim().slice(0,80),
            ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),
            color:style.color, background:surface,
            transition:style.transitionProperty
        };
    });
    const colorTransitions=Array.from(sheet.querySelectorAll('button')).concat(sheet).filter(node=>
        getComputedStyle(node).transitionProperty.split(',').some(
            value=>['all','color','background-color','border-color'].includes(value.trim())
        )
    ).map(node=>node.getAttribute('aria-label') || node.getAttribute('data-slot'));
    return {measurements,colorTransitions};
}
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), StaticHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    results = []
    errors = []
    p = sync_playwright().start()
    try:
        browser = p.chromium.launch()
        context = browser.new_context(locale='en-CA', viewport={'width':1280,'height':900})
        context.add_init_script("localStorage.setItem('manabi-reader-dictionary-setup-v1','skip')")
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(20000)
        page.goto(origin + '/Reader-Web/videos')
        expect(page.get_by_role('heading', name='Videos', exact=True)).to_be_visible()
        def upload():
            page.locator('[data-testid=media-files]').set_input_files([
                {'name':'video.mp4','mimeType':'video/mp4','buffer':(args.fixture / 'video.mp4').read_bytes()},
                {'name':'video.ja.srt','mimeType':'text/plain','buffer':'1\n00:00:00,000 --> 00:00:04,000\nこんにちは。何かお探しですか。\n\n2\n00:00:04,000 --> 00:00:08,000\n日本語の本を探しています。\n'.encode()},
                {'name':'video.en.srt','mimeType':'text/plain','buffer':b'1\n00:00:00,000 --> 00:00:04,000\nHello. Are you looking for something?\n\n2\n00:00:04,000 --> 00:00:08,000\nI am looking for a Japanese book.\n'}
            ])
        upload()
        existing = page.get_by_label('Choose existing subtitles', exact=True)
        expect(existing.locator('option')).to_have_count(3)
        assert page.locator('.transcript-cue').count() == 0
        options = existing.locator('option').evaluate_all('(nodes)=>nodes.map(n=>({label:n.textContent,value:n.value}))')
        chosen = next(o['value'] for o in options if 'video.ja.srt' in o['label'])
        existing.select_option(chosen)
        expect(page.locator('.transcript-cue')).to_have_count(2)
        expect(page.locator('.transcript-translation').first).to_have_text('Hello. Are you looking for something?')
        results.append('real local-file/sidecar import and explicit main selection with locale translation')
        def menu():
            page.get_by_role('button', name='Transcript options', exact=True).click()
        before = float(page.locator('.transcript-text').first.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'))
        menu()
        page.get_by_role('button', name='Themes & Settings', exact=True).click()
        sheet = page.get_by_role('dialog', name='Themes & Settings', exact=True)
        expect(sheet).to_be_visible()
        assert sheet.get_by_role('group', name='Reading layout', exact=True).count() == 0
        sheet.get_by_role('button', name='Increase text size', exact=True).click()
        page.wait_for_function('(size)=>parseFloat(getComputedStyle(document.querySelector(".transcript-text")).fontSize)===size',arg=before+1)
        assert float(page.evaluate('localStorage.getItem("fontSize")')) == before+1
        sheet.get_by_label('Reading font', exact=True).select_option('Serif')
        sheet.get_by_label('Reading line spacing', exact=True).select_option('1.9')
        page.wait_for_function('getComputedStyle(document.querySelector(".transcript-text")).fontFamily.toLowerCase().startsWith("serif")')
        assert page.evaluate('localStorage.getItem("fontFamilyGroupOne")') == 'Serif'
        assert float(page.evaluate('localStorage.getItem("lineHeight")')) == 1.9
        page.wait_for_function('() => { const s=getComputedStyle(document.querySelector(".transcript-text")); return Math.abs(parseFloat(s.lineHeight)/parseFloat(s.fontSize)-1.9)<.03; }')
        # Finish the opening animation only. Theme switches are then audited on
        # their first rendered frames; independent foreground/background fades
        # must not temporarily erase headings or controls.
        sheet.evaluate("""async sheet => {
            await Promise.all(sheet.getAnimations({subtree:true}).filter(
                animation=>animation.effect.getComputedTiming().iterations!==Infinity
            ).map(animation=>animation.finished.catch(()=>{})));
        }""")
        contrast = {}
        for mode in ('light', 'dark'):
            sheet.get_by_role('group', name='Reading appearance mode').get_by_role('button',name=mode,exact=True).click()
            expect(page.locator('html')).to_have_attribute('data-appearance',mode)
            audit = sheet.evaluate(APPEARANCE_AUDIT)
            contrast[mode] = audit
            (args.output/'shared-reading-contrast.json').write_text(json.dumps(contrast,indent=2))
            assert not audit['colorTransitions'], audit
            assert len(audit['measurements']) >= 12, audit
            failures = [item for item in audit['measurements'] if item['ratio'] < 4.5]
            assert not failures, (mode,failures)
        results.append('shared appearance has readable light/dark controls without mismatched color fades')
        page.screenshot(path=str(args.output/'shared-reading-settings.png'))
        sheet.get_by_role('button', name='Close reading appearance',exact=True).click()
        expect(sheet).to_have_count(0)
        expect(page.get_by_role('button',name='Transcript options',exact=True)).to_be_focused()
        results.append('actual shared ebook font, size, spacing, theme stores and focus return')
        menu()
        with page.expect_download() as download:
            page.get_by_role('button',name='Download subtitles',exact=True).click()
        assert download.value.suggested_filename=='video.ja.srt'
        assert 'こんにちは。' in pathlib.Path(download.value.path()).read_text()
        results.append('actual application SRT download')
        menu();page.get_by_role('button',name='Close transcript',exact=True).click()
        expect(page.locator('.transcript-pane')).to_be_hidden()
        page.get_by_role('button',name='Show transcript',exact=True).click()
        expect(page.locator('.transcript-cue')).to_have_count(2)
        expect(page.locator('.transcript-pane')).to_be_visible()
        # A rendered row is not a durable write acknowledgement. Establish the
        # actual committed IDB state before testing reload, without sleep timers.
        page.wait_for_function("""async (primary) => {
            const db = await new Promise((yes,no) => {
                const r=indexedDB.open('manabi-media-v1');
                r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);
            });
            try {
                const tx=db.transaction(['local','records'],'readonly');
                const read=name=>new Promise((yes,no)=>{
          const r=tx.objectStore(name).getAll();
          r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);
                });
                const [local,records]=await Promise.all([read('local'),read('records')]);
                return local.some(v=>v?.open===true) && records.some(v=>v?.payload?.primary===primary);
            } finally {db.close();}
        }""",arg=chosen)
        results.append('close/reopen retains selected tracks and commits native storage')
        # A small file is reselected on this device; the original provider is not modified.
        page.reload()
        expect(page.get_by_role('heading',name='Videos',exact=True)).to_be_visible()
        upload()
        expect(page.locator('.transcript-cue')).to_have_count(2)
        assert not page.locator('.transcript-setup').is_visible()
        assert float(page.locator('.transcript-text').first.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'))==before+1
        results.append('real IndexedDB primary selection and shared reading settings survive reload/reselect')
        page.locator('.video-player-heading').click()
        page.screenshot(path=str(args.output/'app-desktop.png'))
        page.set_viewport_size({'width':390,'height':844})
        page.locator('.manabi-video-player').scroll_into_view_if_needed()
        page.screenshot(path=str(args.output/'app-phone.png'))
        assert not errors, errors
        browser.close()
    except Exception:
        try:
            page.screenshot(path=str(args.output/"failure.png"))
            state=page.evaluate("""async()=>{
                const r=indexedDB.open('manabi-media-v1');
                const db=await new Promise((yes,no)=>{r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error)});
                const tx=db.transaction(['local','records'],'readonly');
                const read=n=>new Promise(yes=>{const q=tx.objectStore(n).getAll();q.onsuccess=()=>yes(q.result)});
                const data=await Promise.all([read('local'),read('records')]);db.close();
                return {data,primary:document.querySelector('[aria-label="Transcript track"]')?.value,secondary:document.querySelector('[aria-label="Translation track"]')?.value};
            }""")
            (args.output/'storage-diagnostics.json').write_text(json.dumps(state,ensure_ascii=False))
            (args.output/"failure.html").write_text(page.content())
        except Exception:
            pass
        raise
    finally:
        p.stop()
        server.shutdown();server.server_close();thread.join()
        (args.output/'results.json').write_text(json.dumps({'passed':len(results),'checks':results,'page_errors':errors,'boundary':'real Svelte app, local File and IndexedDB; no account/provider/ASR'},indent=2))
    print(json.dumps(results))

if __name__=='__main__':
    main()
