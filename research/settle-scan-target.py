from pathlib import Path
p=Path('test/reader/e2e/run.mjs');s=p.read_text()
old="    await page.waitForFunction(() => document.fonts.status === 'loaded');"
new="""    await expect(content).not.toHaveText('');
    await content.evaluate(async (el) => {
        // The conditional Reader renders its first section asynchronously. A
        // FontFaceSet can be 'loaded' before that section first requests its
        // Japanese face. Measure the real text, not only the fixed container.
        const deadline = performance.now() + 5000;
        let previous = '', stable = 0;
        while (performance.now() < deadline) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
            if (!node || document.fonts.status !== 'loaded') { stable = 0; continue; }
            const range = document.createRange(); range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            const state = [el.innerHTML.length, el.scrollLeft, el.scrollTop, el.scrollWidth, el.scrollHeight,
                rect.x, rect.y, rect.width, rect.height].join(',');
            stable = state === previous ? stable + 1 : 0;
            previous = state;
            if (stable >= 12) return;
        }
        throw new Error('Reader text geometry did not settle before the scan gesture');
    });"""
assert s.count(old)==1;s=s.replace(old,new);p.write_text(s)
