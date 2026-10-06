/** @license BSD-3-Clause */
/** Preserve a useful, explicitly unavailable Library search for browsers with
 * JavaScript disabled. Device IndexedDB content is never embedded in the export.
 * With scripts enabled, noscript is inert and cannot duplicate hydrated controls. */
export function libraryNoScriptDocument(html) {
  const marker = '<div id="root"></div>';
  if (!html.includes(marker) || html.indexOf(marker) !== html.lastIndexOf(marker))
    throw new Error('Expo root marker is missing.');
  return html.replace(
    marker,
    `<noscript><main aria-labelledby="manabi-noscript-library-title" style="box-sizing:border-box;max-width:56rem;margin:auto;padding:24px;font-family:system-ui,sans-serif">
<h1 id="manabi-noscript-library-title">Library</h1>
<p>Enable JavaScript to open this device's Library.</p>
<label>Search library <input type="search" aria-label="Search library" placeholder="Search library" disabled /></label>
</main><style>noscript + #root { display:none; }</style></noscript>${marker}`
  );
}
