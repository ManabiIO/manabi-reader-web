/* SPDX-License-Identifier: BSD-3-Clause */
/* global caches, document, localStorage */
// Instrumentation-only inspection. Imports, selection and removal must use the
// actual native controls. Only a random test sentinel and exact cleanup write here.
// The platform harness wraps and evaluates this expression from its test APK.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (config) => {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  assert(/^[a-f0-9]{32}$/.test(config.id), 'Invalid font qualification identity');
  const name = `Qualification font ${config.id}`;
  const fileName = `manabi-font-${config.id}.woff2`;
  const path = `/userfonts/${fileName}`;
  const key = `manabi-font-qualification-${config.id}`;
  const keys = ['userfonts', 'fontFamilyGroupOne', 'fontFamilyGroupTwo'];
  const catalog = () => JSON.parse(localStorage.getItem('userfonts') || '[]');
  const digest = async (bytes) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
  const wait = async (read, label) => {
    const deadline = Date.now() + 10000;
    do {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(label);
  };
  if (config.operation === 'prepare') {
    assert(!localStorage.getItem(key), 'Font fixture already exists');
    assert(catalog().length === 0, 'Fresh emulator must have an empty custom-font catalog');
    const cache = await caches.open('ttu-userfonts');
    assert(
      (await cache.keys()).length === 0,
      'Fresh emulator must have an empty custom-font cache'
    );
    const css = document.getElementById('manabi-packaged-fonts')?.textContent || '';
    const source = /url\(["']?([^"')]+)["']?\)/.exec(css)?.[1];
    assert(source, 'Missing packaged font fixture');
    const url = new URL(source, location.href);
    assert(
      url.origin === location.origin &&
        /^\/www\.bundle\/[A-Za-z0-9_./-]+\.woff2$/.test(url.pathname) &&
        !url.pathname.includes('/../') &&
        !url.search &&
        !url.hash,
      'Font source must be a packaged WOFF2 asset'
    );
    const response = await fetch(url);
    assert(response.status === 200, 'Packaged source font did not load');
    const bytes = await response.arrayBuffer();
    assert(bytes.byteLength > 0, 'Packaged font fixture is empty');
    const original = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
    const fixture = {
      name,
      fileName,
      path,
      original,
      bytes: bytes.byteLength,
      sha256: await digest(bytes),
      assetPath: url.pathname.slice(1)
    };
    localStorage.setItem(key, JSON.stringify(fixture));
    return fixture;
  }
  const fixture = JSON.parse(localStorage.getItem(key) || 'null');
  assert(
    fixture?.name === name && fixture.fileName === fileName && fixture.path === path,
    'Font qualification metadata did not survive'
  );
  const cache = await caches.open('ttu-userfonts');
  if (config.operation === 'cancelled') {
    assert(
      keys.every((key) => localStorage.getItem(key) === fixture.original[key]),
      'Cancelling the picker changed a font preference'
    );
    assert((await cache.keys()).length === 0, 'Cancelling the picker stored a file');
    return { cancelled: true };
  }
  if (config.operation === 'cleanup') {
    assert(catalog().length === 0, 'Native removal did not remove the catalog entry');
    assert((await cache.keys()).length === 0, 'Native removal did not remove cached bytes');
    assert(
      localStorage.getItem('fontFamilyGroupOne') === '',
      'Removing selected primary must reset that family'
    );
    assert(
      localStorage.getItem('fontFamilyGroupTwo') === fixture.original.fontFamilyGroupTwo,
      'Removing primary changed the other family'
    );
    await wait(
      () => !(document.getElementById('ttu-userfonts')?.textContent || '').includes(name),
      'Removed font remains in the production stylesheet'
    );
    for (const key of keys) {
      if (fixture.original[key] === null) localStorage.removeItem(key);
      else localStorage.setItem(key, fixture.original[key]);
    }
    assert(
      keys.every((key) => localStorage.getItem(key) === fixture.original[key]),
      'Exact original font preferences not restored'
    );
    localStorage.removeItem(key);
    return { removed: true, restored: true };
  }
  assert(
    config.operation === 'imported' || config.operation === 'selected',
    'Unknown font probe operation'
  );
  const fonts = catalog();
  assert(
    fonts.length === 1 &&
      fonts[0].name === name &&
      fonts[0].fileName === fileName &&
      fonts[0].path === path,
    'Native import did not retain the exact font identity'
  );
  const stored = await cache.match(path);
  assert(
    stored && stored.headers.get('content-type') === 'font/woff2',
    'Native font file is not available'
  );
  const bytes = await stored.arrayBuffer(),
    sha256 = await digest(bytes);
  assert(
    bytes.byteLength === fixture.bytes && sha256 === fixture.sha256,
    'Native font bytes differ from selected file'
  );
  assert(
    localStorage.getItem('fontFamilyGroupTwo') === fixture.original.fontFamilyGroupTwo,
    'Other font family changed'
  );
  assert(
    localStorage.getItem('fontFamilyGroupOne') ===
      (config.operation === 'selected' ? name : fixture.original.fontFamilyGroupOne),
    'Import must not select a font; Use must select the exact name'
  );
  await wait(() => {
    const css = document.getElementById('ttu-userfonts')?.textContent || '';
    return css.includes(name) && css.includes('blob:');
  }, 'Production embedded font stylesheet did not load the cached face');
  // Exercise the production stylesheet. No test FontFace or CSS is installed.
  const faces = await document.fonts.load(`16px "${name}"`, 'Reader 日本語');
  assert(
    faces.length > 0 &&
      faces.every(
        (face) => face.status === 'loaded' && face.family.replace(/^["']|["']$/g, '') === name
      ),
    'Production custom face failed to decode'
  );
  return {
    name,
    fileName,
    path,
    bytes: bytes.byteLength,
    sha256,
    selected: config.operation === 'selected',
    productionCss: 'cached-blob-face-loaded'
  };
};
