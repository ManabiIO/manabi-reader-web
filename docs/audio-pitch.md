# Optional voice pitch in the audiobook transcript

Use **Audiobook → Transcript → Voice pitch → Show** after choosing local audio
and timed subtitles. Pitch is off by default. The compact strip shows a neutral
waveform with a yellow (`#ffd83d`) acoustic contour over the most recent eight
seconds of playback. The waveform and surface use the reader's foreground,
background and border tokens in both light and dark appearances. No red target
highlighting, kana labels, recording or upload is involved.

## Loading and lifetime

The detector is a small, same-origin worker, not a downloaded machine-learning
model. The worker is constructed only after enabling pitch and is excluded from
the service worker's eager shell installation through its existing `lazyAssets`
contract. The browser's normal HTTP cache may reuse the content-hashed worker on
later enables. An uncached worker needs a connection; offline first use reports
an error with Retry instead of blocking audiobook playback.

Loading remains visible until both the worker handshake and AudioContext resume
complete. Loading, decoding/worker failures, timeouts and denied audio processing
have recoverable states. Hide remains available during loading or an error.
The enabled preference lasts for this open book session; it does not silently
opt a later book or a new browser session into audio processing.

The controller belongs to the persistent audiobook player, not the dismissible
Sheet. It reads bounded 40 ms frames from the existing local media element at
most 25 times per second, with one worker request in flight and at most 400
history points. It never reads/copies/decodes the entire audiobook. Hiding the
strip, closing the transcript or hiding the browser tab terminates analysis work.
Pausing stops sampling. Seeking, looping, changing speed, replacing audio and
reopening the strip start a new contour; stale replies cannot restore old data.

**Important Web Audio invariant:** after capture, the media source's destination
connection remains alive even while pitch is off. Disconnecting it, suspending
its context or closing the context on Sheet dismissal would mute native playback.
Only the analyser branch is removed on hide. The old source is released when the
player retires its audio element; the AudioContext closes when the player is
finally disposed. No second playback element is introduced.

## Provenance and limits

Adapted from ManabiIO/japanesevids-template `src/pitch-analysis.js`, the Black
Belt waveform/pitch implementation used with ManabiIO/japanesevids-cli. Source
blob inspected for the estimator: the `main` version on 2026-09-28; its tuning
rationale is in `PITCH-ANALYSIS-TUNING.md` (blob
`4a6a1bf3dced6aad2a87a142104868420a66735b`).

The port retains the 85–520 Hz search range, at-most-12-kHz block averaging,
mean-centred Hann frames, paired-energy normalized correlation, genuine local
peak selection, 88% candidate preference, 0.52 voicing threshold, interpolated
lag and peak/RMS waveform blend. It uses causal three-frame log-frequency
smoothing and a rolling -35 dB relative gate, rather than the offline template's
whole-clip gate, look-ahead median and greedy octave correction. The contour
breaks across unvoiced gaps. Neither implementation is Praat or dictionary
pitch-accent inference. Music, noise, creaky voices and voices outside the range
can make the trace inaccurate or absent. Synthetic tones do not validate
Japanese-speech accuracy.

This is a **live rolling visualization**, not a precomputed full-cue graph. A
paused, not-yet-played passage has no contour. Timestamp centres are based on the
media clock and playback rate, not sample-exact audio/transcript alignment.
No database schema, subtitle-delay semantics, matcher or playback API changed.

## Qualification

- `node test/pitch/run.mjs`: executes the actual TypeScript core after Node type
  stripping; no duplicate test implementation. Forty-four tests cover tones at
  six sample rates, invalid/silent input, bounded history, gaps, lazy loading,
  stale readiness/results/animation callbacks, seeks, timeouts, retries, audio
  replacement, preserved output routing, pauses and disposal.
- `node test/pitch/run.mjs --emit=test-results/pitch-modules` followed by
  `python test/pitch/browser.py test-results/pitch-modules`: native audio and
  worker harness (not the bundled Svelte app). The dedicated workflow runs it
  across Chromium, Firefox and WebKit.
- Existing application CI remains responsible for the repository-pinned
  TypeScript/Svelte check and the production static build. Before merging,
  inspect the actual app in light/dark modes and verify that its built worker
  filename matches the lazy-asset selector and is not requested by shell install.

Local evidence on the implementation pass: all 44 tests and a strict TypeScript
5.8.3 check passed. Local native browser qualification was blocked by the
container's HTTP navigation policy; it is not counted as passed. Cross-browser
workflow results and actual-app visual acceptance are separate merge gates.
