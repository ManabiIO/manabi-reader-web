/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
export function readEvidence(text) {
  const marker = 'MANABI_ANDROID_QUALIFICATION=';
  const lines = text.split(/\r?\n/).filter((line) => line.includes(marker));
  assert.equal(lines.length, 1, 'Expected one complete instrumentation evidence record');
  return JSON.parse(lines[0].slice(lines[0].indexOf(marker) + marker.length));
}
export function verifyEvidence(evidence, phase, id) {
  assert.equal(evidence.schema, 1);
  assert.equal(evidence.passed, true, evidence.error || 'Instrumentation failed');
  assert.equal(evidence.phase, phase);
  assert.equal(evidence.id, id);
  assert.equal(evidence.target, 'io.manabi.reader');
  assert.equal(evidence.targetDebuggable, false);
  assert.equal(evidence.nativeRoundTrip, 'snapshot-route-and-library-state-reply');
  assert.equal(evidence.nativeFontManager, 'shared-font-list-add-back-and-close-without-save');
  assert.equal(
    evidence.nativeFontPicker?.picker,
    phase === 'seed' ? 'system-picker-cancel-import-and-select' : 'retained-from-previous-process'
  );
  assert.equal(evidence.nativeFontPicker.removed, phase === 'verify');
  const font = evidence.nativeFontPicker.font;
  assert.equal(font.name, `Qualification font ${id}`);
  assert.equal(font.fileName, `manabi-font-${id}.woff2`);
  assert.equal(font.path, `/userfonts/${font.fileName}`);
  assert.ok(Number.isSafeInteger(font.bytes) && font.bytes > 0);
  assert.match(font.sha256, /^[a-f0-9]{64}$/);
  assert.equal(font.selected, true);
  assert.equal(font.productionCss, 'cached-blob-face-loaded');
  if (phase === 'seed') {
    assert.deepEqual(evidence.nativeFontImported, { ...font, selected: false });
    assert.deepEqual(evidence.nativeFontAfterReload, font);
  } else assert.deepEqual(evidence.nativeFontCleanup, { removed: true, restored: true });
  assert.equal(
    evidence.nativeFontPreferences,
    'explicit-font-draft-cancel-apply-and-exact-restore'
  );
  assert.equal(evidence.nativeChoices, 'color-mode-selection-local-save-and-restore');
  assert.equal(evidence.nativeThemeChooser, 'add-dialog-back-and-close-without-save');
  assert.equal(
    evidence.nativeDimensions,
    'slider-completion-and-automatic-local-save-with-exact-restore'
  );
  assert.equal(evidence.nativeBackgrounds?.rendered, 'native-light-and-dark-decoded-pixels');
  assert.equal(evidence.nativeBackgrounds.removed, phase === 'verify');
  assert.equal(
    evidence.nativeBackgrounds.picker,
    phase === 'seed' ? 'system-picker-cancel-and-three-imports' : 'retained-from-previous-process'
  );
  assert.deepEqual(Object.keys(evidence.nativeBackgrounds.records).sort(), [
    'library-dark',
    'library-light',
    'reader-light'
  ]);
  for (const [slot, image] of Object.entries(evidence.nativeBackgrounds.records)) {
    assert.equal(image.name, `manabi-background-${id}-${slot}.png`);
    assert.ok(Number.isSafeInteger(image.bytes) && image.bytes > 0);
    assert.match(image.sha256, /^[a-f0-9]{64}$/);
  }
  const archive = evidence.nativeBookExport;
  assert.equal(
    archive?.journey,
    phase === 'seed'
      ? 'system-picker-cancel-import-export-and-remove'
      : 'retained-after-process-restart'
  );
  assert.equal(archive.removed, phase === 'verify');
  assert.equal(archive.libraryCopyRemoved, true);
  assert.equal(archive.zip, 'independent-nested-zip-and-stored-html-verification');
  assert.equal(archive.title, `manabi-export-${id}`);
  assert.match(archive.filename, /^ttu-reader-export-[0-9-]+-[A-Za-z0-9_-]+\.zip$/);
  assert.ok(Number.isSafeInteger(archive.bytes) && archive.bytes > 256 * 1024);
  assert.ok(Number.isSafeInteger(archive.htmlBytes) && archive.htmlBytes > 256 * 1024);
  for (const key of ['sha256', 'contentHash', 'htmlSha256'])
    assert.match(archive[key], /^[a-f0-9]{64}$/);
  assert.match(
    evidence.entry,
    /^https:\/\/appassets\.androidplatform\.net\/www\.bundle\/[a-f0-9]{32}\.html$/
  );
  assert.equal(typeof evidence.nativeSettings?.webViewVersion, 'string');
  assert.equal(evidence.nativeSettings.fileOriginBypass, false);
  if (phase === 'seed') {
    assert.equal(evidence.initial?.secureContext, true);
    assert.equal(evidence.initial?.cachedFont, 'cached-packaged-face-loaded-via-blob');
    assert.equal(evidence.afterReload?.cachedFont, 'cached-packaged-face-loaded-via-blob');
    assert.equal(
      evidence.initial?.moduleWorker,
      'real-packaged-worker-replied-not_open-without-storage-open'
    );
    assert.equal(evidence.initial?.wasm, 'real-packaged-sqlite-streaming-compile-only');
    assert.equal(evidence.initial?.webLocks, 'exclusive-contention-and-reacquisition');
    assert.equal(evidence.afterReload?.indexedDB, 'read-committed-sentinel');
    assert.equal(evidence.afterReload?.opfs, 'read-committed-sentinel');
    assert.equal(evidence.navigation?.length, 9);
    assert.ok(evidence.navigation.every((item) => item.rootRetained === true));
  } else {
    assert.equal(phase, 'verify');
    assert.equal(evidence.afterProcessRestart?.cachedFont, 'cached-packaged-face-loaded-via-blob');
    assert.equal(evidence.afterProcessRestart?.indexedDB, 'read-committed-sentinel');
    assert.equal(evidence.afterProcessRestart?.opfs, 'read-committed-sentinel');
    assert.equal(evidence.cleanup?.cleaned, `manabi-android-qualification-${id}`);
  }
  return evidence;
}
export function verifyEvidencePair(first, second) {
  verifyEvidence(first, 'seed', first.id);
  verifyEvidence(second, 'verify', first.id);
  assert.equal(first.entry, second.entry, 'Entry changed unexpectedly between process launches');
  assert.notEqual(first.processId, second.processId, 'Both phases used the same process');
  assert.deepEqual(
    first.nativeFontPicker.font,
    second.nativeFontPicker.font,
    'Selected font identity, cached bytes and production loading must survive a real process restart'
  );
  assert.deepEqual(
    first.nativeBackgrounds.records,
    second.nativeBackgrounds.records,
    'Exact persisted background bytes must survive a real process restart'
  );
  const firstArchive = { ...first.nativeBookExport };
  const secondArchive = { ...second.nativeBookExport };
  for (const archive of [firstArchive, secondArchive]) {
    delete archive.journey;
    delete archive.removed;
  }
  assert.deepEqual(
    firstArchive,
    secondArchive,
    'The same complete ZIP must survive process restart'
  );
  return { first, second };
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  if (process.argv[2] === '--pair') {
    const first = readEvidence(await fs.readFile(process.argv[3], 'utf8'));
    const second = readEvidence(await fs.readFile(process.argv[4], 'utf8'));
    verifyEvidencePair(first, second);
    console.log(
      'Packaged Android host smoke passed, including synthetic storage after process restart.'
    );
  } else {
    const [, , filename, phase, id] = process.argv;
    verifyEvidence(readEvidence(await fs.readFile(filename, 'utf8')), phase, id);
  }
}
