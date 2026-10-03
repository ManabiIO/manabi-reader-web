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
  assert.equal(evidence.nativeFontManager, 'settings-typography-font-cache-read-and-close');
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
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  if (process.argv[2] === '--pair') {
    const first = readEvidence(await fs.readFile(process.argv[3], 'utf8'));
    const second = readEvidence(await fs.readFile(process.argv[4], 'utf8'));
    verifyEvidence(first, 'seed', first.id);
    verifyEvidence(second, 'verify', first.id);
    assert.equal(first.entry, second.entry, 'Entry changed unexpectedly between process launches');
    assert.notEqual(first.processId, second.processId, 'Both phases used the same process');
    console.log(
      'Packaged Android host smoke passed, including synthetic storage after process restart.'
    );
  } else {
    const [, , filename, phase, id] = process.argv;
    verifyEvidence(readEvidence(await fs.readFile(filename, 'utf8')), phase, id);
  }
}
