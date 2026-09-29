#!/usr/bin/env python3
"""Built Svelte / real IndexedDB / shared ebook display settings. No ASR or cloud claim."""
import argparse
import json
import os
import pathlib
import sys
import threading
from playwright.sync_api import sync_playwright, expect
from browser_poll import wait_for_async
ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests/browser'))
from test_static_reader import StaticHandler, ThreadingHTTPServer


PERSISTED_SELECTION = """
async expected => {
    // An early sidecar selection may still have its temporary pre-hash ID.
    // Its verified track must keep the intended label, language and exact cues.
    const primary = document.querySelector('[aria-label="Transcript track"]')?.value;
    if (!primary) return false;
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
        const record=records.find(v=>v.scope==='guest' && v.kind==='video_track' && v.id===primary);
        const track=record?.payload?.track;
        if (!track || !track.complete || track.origin!=='sidecar' ||
            track.label!==expected.label || track.language!==expected.language ||
            track.id!==primary || track.mediaKey!==record.mediaKey) return false;
        const resume=records.find(v=>v.scope==='guest' && v.kind==='video_resume' &&
            v.id===track.mediaKey && v.mediaKey===track.mediaKey);
        if (resume?.payload?.primary!==primary || !local.some(v=>v?.open===true)) return false;
        const cues=[];
        for (const [index,ref] of (record.payload.pages ?? []).entries()) {
            const page=records.find(v=>v.scope==='guest' && v.kind==='video_chunk' &&
                v.id===ref.id && v.mediaKey===track.mediaKey)?.payload;
            if (!page || page.trackId!==primary || page.index!==index || !Array.isArray(page.cues))
                return false;
            cues.push(...page.cues);
        }
        return document.querySelector('[aria-label="Transcript track"]')?.value===primary &&
            cues.length===expected.cues.length && cues.every((cue,index)=>
                cue.start===expected.cues[index].start && cue.end===expected.cues[index].end &&
                cue.text===expected.cues[index].text);
    } finally {db.close();}
}
"""

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
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM'))
        context = browser.new_context(locale='en-CA', viewport={'width':1280,'height':900})
        context.add_init_script("localStorage.setItem('manabi-reader-dictionary-setup-v1','skip')")
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_default_timeout(20000)
        page.goto(origin + '/reader-web/videos')
        expect(page.get_by_role('heading', name='Videos', exact=True)).to_be_visible()
        def upload():
            page.locator('[data-testid=media-files]').set_input_files([
                {'name':'video.mp4','mimeType':'video/mp4','buffer':(args.fixture / 'video.mp4').read_bytes()},
                {'name':'video.ja.srt','mimeType':'text/plain','buffer':'1\n00:00:00,000 --> 00:00:04,000\nこんにちは。何かお探しですか。\n\n2\n00:00:04,000 --> 00:00:08,000\n日本語の本を探しています。\n'.encode()},
                {'name':'video.en.srt','mimeType':'text/plain','buffer':b'1\n00:00:00,000 --> 00:00:04,000\nHello. Are you looking for something?\n\n2\n00:00:04,000 --> 00:00:08,000\nI am looking for a Japanese book.\n'}
            ])
        upload()
        shelf = page.get_by_label('Video library', exact=True)
        card_select = shelf.get_by_role('checkbox').first
        expect(card_select).to_be_visible()
        select_target = card_select.locator('..')
        select_box = select_target.bounding_box()
        assert select_box['width'] >= 43.5 and select_box['height'] >= 43.5, select_box
        assert card_select.evaluate("""input => {
            const label=input.closest('label');
            const r=label.getBoundingClientRect();
            const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
            return !!hit && (hit===label || label.contains(hit));
        }""")
        card_select.focus()
        expect(card_select).to_be_focused()
        page.keyboard.press('Space')
        expect(card_select).to_be_checked()
        page.keyboard.press('Space')
        expect(card_select).not_to_be_checked()
        results.append('video card selection has a native 44px keyboard and pointer target')

        existing = page.get_by_label('Choose existing subtitles', exact=True)
        expect(existing.locator('option')).to_have_count(3)
        assert page.locator('.transcript-cue').count() == 0
        options = existing.locator('option').evaluate_all('(nodes)=>nodes.map(n=>({label:n.textContent,value:n.value}))')
        chosen_label = next(o['label'] for o in options if 'video.ja.srt' in o['label'])
        # Full video verification can remap a temporary sidecar ID between
        # reading these options and the click. Select the current semantic
        # option, then capture the ID that actually became selected for the
        # native persistence/reload assertions below.
        existing.select_option(label=chosen_label)
        chosen = page.get_by_label('Transcript track', exact=True).input_value()
        assert chosen
        expect(page.locator('.transcript-cue')).to_have_count(2)
        expect(page.locator('.transcript-translation').first).to_have_text('Hello. Are you looking for something?')
        results.append('real local-file/sidecar import and explicit main selection with locale translation')
        def menu():
            page.get_by_role('button', name='Transcript options', exact=True).click()
        menu()
        page.get_by_role('button', name='Themes & Settings', exact=True).click()
        sheet = page.get_by_role('dialog', name='Themes & Settings', exact=True)
        expect(sheet).to_be_visible()
        assert sheet.get_by_role('group', name='Reading layout', exact=True).count() == 0
        before = float(sheet.get_by_role('group', name='Text size').locator('output').inner_text().split()[0])
        page.wait_for_function('''size => {
            const text=document.querySelector('.transcript-text');
            const host=text?.closest('.manabi-media')?.parentElement;
            return !!host &&
                parseFloat(getComputedStyle(host).getPropertyValue('--transcript-font-size'))===size &&
                parseFloat(getComputedStyle(text).fontSize)===size;
        }''', arg=before)
        sheet.get_by_role('button', name='Increase text size', exact=True).click()
        expect(sheet.get_by_role('group', name='Text size').locator('output')).to_have_text(f'{int(before+1)} px')
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
        wait_for_async(page, PERSISTED_SELECTION, arg={
            'label':'ja · video.ja.srt', 'language':'ja',
            'cues':[
                {'start':0,'end':4,'text':'こんにちは。何かお探しですか。'},
                {'start':4,'end':8,'text':'日本語の本を探しています。'}
            ]
        })
        persisted_primary = page.get_by_label('Transcript track', exact=True).input_value()
        (args.output/'subtitle-selection.json').write_text(json.dumps({
            'initialSelection':chosen, 'persistedSelection':persisted_primary
        },indent=2))
        results.append('close/reopen retains selected tracks and commits native storage')
        # A small file is reselected on this device; the original provider is not modified.
        page.reload()
        expect(page.get_by_role('heading',name='Videos',exact=True)).to_be_visible()
        upload()
        expect(page.locator('.transcript-cue')).to_have_count(2)
        assert not page.locator('.transcript-setup').is_visible()
        expect(page.get_by_label('Transcript track', exact=True)).to_have_value(persisted_primary)
        # Caption records and shared ebook preferences restore independently.
        # Wait for the exact rendered typography, not only for cue-row existence.
        # Keep the persistent store assertions: this cannot pass on a temporary
        # style whose saved preference was actually lost.
        page.wait_for_function("""expected => {
            const node=document.querySelector('.transcript-text');
            if (!node) return false;
            const style=getComputedStyle(node);
            return Number(localStorage.getItem('fontSize'))===expected &&
                localStorage.getItem('fontFamilyGroupOne')==='Serif' &&
                Number(localStorage.getItem('lineHeight'))===1.9 &&
                parseFloat(style.fontSize)===expected &&
                style.fontFamily.toLowerCase().startsWith('serif') &&
                Math.abs(parseFloat(style.lineHeight)/parseFloat(style.fontSize)-1.9)<.03;
        }""",arg=before+1)
        (args.output/'restored-typography.json').write_text(json.dumps(page.locator(
            '.transcript-text').first.evaluate("""node => {
                const style=getComputedStyle(node);
                return {
                    fontSize:style.fontSize,fontFamily:style.fontFamily,lineHeight:style.lineHeight,
                    savedSize:localStorage.getItem('fontSize'),
                    savedFont:localStorage.getItem('fontFamilyGroupOne'),
                    savedLineHeight:localStorage.getItem('lineHeight')
                };
            }"""),indent=2))
        results.append('real IndexedDB primary selection and shared reading settings survive reload/reselect')
        page.locator('.video-player-heading').click()
        page.screenshot(path=str(args.output/'app-desktop.png'))
        page.set_viewport_size({'width':390,'height':844})
        page.locator('.manabi-video-player').scroll_into_view_if_needed()
        page.screenshot(path=str(args.output/'app-phone.png'))

        # The real app's media chrome must participate in text scaling instead
        # of pinning its UI to absolute 16px typography. Stress the same player
        # and transcript at a genuinely narrow viewport.
        page.set_viewport_size({'width':320,'height':568})
        page.evaluate("document.documentElement.style.fontSize='200%'")
        page.locator('.manabi-video-player').scroll_into_view_if_needed()
        media = page.locator('.manabi-media')
        media_font = float(media.evaluate(
            "node => parseFloat(getComputedStyle(node).fontSize)"
        ))
        assert media_font >= 31.5, media_font
        heading_font = float(page.get_by_role(
            'heading', name='Videos', exact=True
        ).evaluate("node => parseFloat(getComputedStyle(node).fontSize)"))
        assert heading_font > media_font, (heading_font, media_font)
        track_font = float(page.get_by_label(
            'Transcript track', exact=True
        ).evaluate("node => parseFloat(getComputedStyle(node).fontSize)"))
        assert track_font >= media_font * 0.8, (track_font, media_font)
        assert page.evaluate(
            "document.documentElement.scrollWidth-innerWidth"
        ) <= 1
        assert media.evaluate("node => node.scrollWidth-node.clientWidth") <= 1

        controls = page.locator(
            '.video-study-controls button:visible, .caption-controls button:visible'
        )
        assert controls.count() >= 3
        for control in controls.all():
            box = control.bounding_box()
            assert box and box['height'] >= 43.5, box
            assert box['x'] >= -1 and box['x'] + box['width'] <= 321, box

        transcript = page.locator('.transcript-pane')
        expect(transcript).to_be_visible()
        assert transcript.evaluate("node => node.scrollWidth-node.clientWidth") <= 1
        rows = page.locator('.transcript-rows')
        assert rows.evaluate("node => node.scrollWidth-node.clientWidth") <= 1
        expect(page.locator('.transcript-cue').first).to_be_visible()

        options_button = page.get_by_role('button', name='Transcript options', exact=True)
        options_button.focus()
        options_button.press('Enter')
        options_panel = page.locator('.transcript-options')
        expect(options_panel).to_be_visible()
        options_font = float(options_panel.evaluate(
            "node => parseFloat(getComputedStyle(node).fontSize)"
        ))
        assert options_font >= media_font * 0.8, (options_font, media_font)
        panel_box = options_panel.bounding_box()
        assert panel_box['x'] >= -1 and panel_box['y'] >= -1, panel_box
        assert panel_box['x'] + panel_box['width'] <= 321, panel_box
        assert panel_box['y'] + panel_box['height'] <= 569, panel_box
        page.screenshot(path=str(args.output/'app-phone-200-percent.png'))
        page.keyboard.press('Escape')
        expect(options_panel).to_be_hidden()
        expect(options_button).to_be_focused()
        results.append('real video player and transcript chrome reflow at 320px / 200% text')

        page.evaluate("document.documentElement.style.fontSize=''")
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
