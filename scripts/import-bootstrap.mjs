/** @license BSD-3-Clause */
// This is an inert early file picker, not a second importer or event queue. The
// browser owns its original FileList until the real React importer claims it.
export function importBootstrapDocument(html, base) {
  if (base !== '' && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(base))
    throw new Error('Invalid import bootstrap base path.');
  const marker = '<div id="root"></div>';
  if (!html.includes(marker) || html.indexOf(marker) !== html.lastIndexOf(marker))
    throw new Error('Expo root marker is missing.');
  const bootstrap = `<section id="manabi-import-bootstrap" data-import-route="${base}/import-ttu" aria-labelledby="manabi-import-bootstrap-title">
  <h1 id="manabi-import-bootstrap-title">Import from Ttu Ebook Reader</h1>
  <p>Choose your exported ZIP files. Imports stay on this device; no sign-in or cloud access is required.</p>
  <label>Choose Ttu export ZIPs <input type="file" accept=".zip,application/zip" multiple /></label>
  <p role="status">Starting the importer. Your selected files will be inspected when it is ready.</p>
</section>
<style>
#manabi-import-bootstrap { box-sizing:border-box; width:100%; max-width:56rem; max-height:100dvh; overflow:auto; margin:auto; padding:24px; overflow-wrap:anywhere; font-family:system-ui,sans-serif; }
#manabi-import-bootstrap h1 { font-size:1.5rem; }
#manabi-import-bootstrap label { display:grid; min-width:0; gap:12px; margin-block:24px; }
#manabi-import-bootstrap input { min-width:0; width:100%; min-height:44px; font:inherit; }
#manabi-import-bootstrap ~ #root { display:none; }
</style>`;
  return html.replace(marker, bootstrap + marker);
}
