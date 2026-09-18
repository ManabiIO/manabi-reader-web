from pathlib import Path
p=Path('apps/web/src/lib/components/book-reader/book-reader-paginated/book-reader-paginated.svelte');s=p.read_text()
s=s.replace("  let currentSectionId = '';", "  let currentSectionId = '';\n\n  let disposed = false;\n  let renderGeneration = 0;")
s=s.replace('    stopFontLayout?.();\n    document.removeEventListener', '    disposed = true;\n    renderGeneration += 1;\n    stopFontLayout?.();\n    sectionReady$.complete();\n    sectionRenderComplete$.complete();\n    document.removeEventListener',1)
s=s.replace("  currentSection$.pipe(takeUntil(destroy$)).subscribe((html) => {\n    const nestAnimationFrame", "  currentSection$.pipe(takeUntil(destroy$)).subscribe((html) => {\n    const generation = ++renderGeneration;\n    const nestAnimationFrame")
s=s.replace('      if (count === 0) {\n        fn();', '      if (disposed || generation !== renderGeneration) return;\n      if (count === 0) {\n        fn();',1)
s=s.replace('''  function onContentDisplayChange(_calculator: SectionCharacterStatsCalculator) {
    _calculator.updateParagraphPos();''','''  function onContentDisplayChange(_calculator: SectionCharacterStatsCalculator) {
    if (disposed || _calculator !== calculator) return;
    // Initialize the section at the boundary that consumes its geometry. Image
    // readiness can precede the font callback during Svelte component updates.
    _calculator.updateCurrentSection(sectionIndex$.getValue());
    _calculator.updateParagraphPos();''')
old='''      scrollWhenReady = false;
      bookmarkData.then((data) => {
        if (!data || !bookmarkManager) return;
        exploredCharCount = data.exploredCharCount || 0;
        bookmarkManager.scrollToBookmark(data);
      });'''
new='''      const generation = renderGeneration;
      bookmarkData.then((data) => {
        if (disposed || generation !== renderGeneration || _calculator !== calculator) return;
        if (!data) { scrollWhenReady = false; return; }
        // Use this component's actual owner, not the asynchronously propagated
        // parent binding. Keep restoration pending until its geometry is valid.
        if (!concreteBookmarkManager) return;
        if (concreteBookmarkManager.scrollToBookmark(data)) {
          scrollWhenReady = false;
          exploredCharCount = data.exploredCharCount || 0;
        }
      });'''
assert old in s;s=s.replace(old,new);p.write_text(s)
p=Path('apps/web/src/lib/components/book-reader/book-reader-paginated/bookmark-manager-paginated.ts');s=p.read_text()
s=s.replace('    if (!charCount) return;', '    if (!charCount) return true;',1)
s=s.replace('      this.pageManager.scrollTo(scrollPos, false);', '      if (scrollPos < 0) return false;\n      this.pageManager.scrollTo(scrollPos, false);')
s=s.replace('      this.setIntendedCharCount(charCount);','      this.setIntendedCharCount(charCount);\n      return true;',1)
s=s.replace('      scroll(this.calculator);\n      return;', '      return scroll(this.calculator);')
s=s.replace('    this.sectionIndex$.next(index);\n  }', '    this.sectionIndex$.next(index);\n    return true;\n  }',1)
p.write_text(s)
p=Path('test/reader/e2e/run.mjs');s=p.read_text()
old='''    try { await page.mouse.move(point.x, point.y, {steps: 12}); }
    finally { await page.keyboard.up('Shift'); }
    await expect.poll(async () => (await visiblePopupFrames()).length, {timeout: 20000}).toBe(1);
    const [popup] = await visiblePopupFrames();
    await expect(popup.locator('body')).toContainText(installedTitle, {timeout: 20000});
    await expect(popup.locator('.headword-term').first()).toContainText(word === '食べました' ? '食べる' : word);
    return popup;'''
new='''    try {
        // A hover must keep its modifier down until the result is visible. A
        // synthetic multi-step sweep may open an intervening popup over target.
        await page.mouse.move(point.x, point.y);
        await expect.poll(async () => (await visiblePopupFrames()).length, {timeout: 20000}).toBe(1);
        const [popup] = await visiblePopupFrames();
        await expect(popup.locator('body')).toContainText(installedTitle, {timeout: 20000});
        await expect(popup.locator('.headword-term').first()).toContainText(word === '食べました' ? '食べる' : word);
        return popup;
    } finally { await page.keyboard.up('Shift'); }'''
assert old in s;s=s.replace(old,new);p.write_text(s)
