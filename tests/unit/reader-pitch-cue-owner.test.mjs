/** Source-authored for the code-only reconciliation; execution is deferred. */
import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'reader-pitch-cue-owner-'));
let createAudioPanel, CueTimeline;
try {
  await build({
    stdin: {
      contents: `
        export { createAudioPanel } from './apps/web/src/reader-react/audio-panel-controller';
        export { CueTimeline } from './apps/web/src/lib/features/whispersync/subtitles';
      `,
      resolveDir: process.cwd(),
      loader: 'ts'
    },
    outfile: join(directory, 'audio.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    tsconfig: 'apps/web/tsconfig.json',
    logLevel: 'silent'
  });
  ({ createAudioPanel, CueTimeline } = createRequire(import.meta.url)(
    join(directory, 'audio.cjs')
  ));
} finally {
  rmSync(directory, { recursive: true, force: true });
}

test('React audio updates exact pitch ownership before its unchanged-cue shortcut', () => {
  const panel = createAudioPanel({
    bookId: 1,
    bookTitle: 'Cue owner',
    htmlContent: '',
    layoutKey: 0,
    onFollow() {},
    returnFocus() {}
  });
  const calls = [];
  panel.pitch = { setSpeechWindow: (bounds, owner) => calls.push({ bounds, owner }) };
  const cue = { id: 0, start: 1, end: 4, text: '声' };
  const overlapping = { id: 1, start: 2, end: 3, text: '次の声' };
  panel.cues = [cue, overlapping];
  panel.timeline = new CueTimeline(panel.cues);
  panel.snapshot = {
    file: { name: 'voice.wav', size: 10, lastModified: 0 },
    ready: true,
    paused: false,
    rate: 1,
    time: 1.5,
    duration: 10
  };
  try {
    panel.updateCurrent(false);
    assert.deepEqual(calls.at(-1), { bounds: { start: 1, end: 4 }, owner: cue });
    panel.delay = 0.25;
    panel.snapshot = { ...panel.snapshot, duration: 3.5 };
    panel.updateCurrent(false);
    assert.deepEqual(calls.at(-1), { bounds: { start: 1.25, end: 3.5 }, owner: cue });
    panel.snapshot = { ...panel.snapshot, time: 2.5 };
    panel.updateCurrent(false);
    assert.equal(calls.at(-1).owner, overlapping, 'latest-starting active cue owns overlap');
    panel.snapshot = { ...panel.snapshot, time: 3.4 };
    panel.updateCurrent(false);
    assert.equal(calls.at(-1).owner, cue, 'earlier cue regains ownership after nested cue');
    const replacement = { ...cue };
    panel.cues = [replacement];
    panel.timeline = new CueTimeline(panel.cues);
    panel.updateCurrent(false);
    assert.equal(
      calls.at(-1).owner,
      replacement,
      'identical bounds in a new transcript retire old work'
    );
    panel.snapshot = { ...panel.snapshot, time: 5 };
    panel.updateCurrent(false);
    assert.equal(calls.at(-1).bounds, undefined);
    const before = calls.length;
    panel.snapshot = { ...panel.snapshot, time: 6 };
    panel.updateCurrent(false);
    assert.equal(calls.length, before + 1, 'consecutive gap updates reach the pitch media clock');
    panel.snapshot = { ...panel.snapshot, time: 2, ready: false };
    panel.updateCurrent(false);
    assert.equal(calls.at(-1).bounds, undefined);
  } finally {
    panel.controller.destroy();
  }
});
