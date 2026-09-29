# Optional voice pitch in the audiobook transcript

Choose local audio and timed subtitles, then use **Audiobook → Transcript →
Voice pitch → Show**. The visualization is off by default, and enabling it lasts
only for the open book session. Audio stays on the device; no microphone,
recording, upload or second playback element is involved.

## Reading the view

The shaded waveform shows relative audio amplitude. The yellow (`#ffd83d`)
contour shows estimated acoustic pitch, with higher lines representing a higher
voice. Both the waveform and its surface follow the reader’s foreground,
background and border tokens in light and dark modes.

The graph always places the most recent audio at the right. It shows the last
eight seconds of media time, with −8 s / −4 s / Now labels and logarithmic
100 / 200 / 400 Hz guides. A point marks the latest voiced estimate. Unvoiced
frames, gaps, playback discontinuities and jumps greater than nine semitones
break the contour rather than drawing misleading connecting lines.

Pausing holds the completed trace. Seeking, looping, changing speed, choosing
another audio file, or reopening the strip starts a new trace. Resuming after
pause or buffering begins a separate contour segment. The About this view
disclosure explains these limits without occupying the main transcript view.

This is a **live rolling visualization**, not a precomputed full-cue graph.
Not-yet-played passages have no contour. The 85–520 Hz range does not cover every
voice, and music, noise or creaky speech can produce inaccurate estimates. It is
a listening aid, **not dictionary pitch-accent inference or pronunciation grading**.
Synthetic tone tests do not establish accuracy on Japanese speech.

## Loading and playback lifetime

A small, same-origin analysis worker is requested only on enable. It is not a
machine-learning model and is excluded from the service worker’s eager shell
installation through the existing `lazyAssets` contract. Normal HTTP caching
may reuse the content-hashed worker on later enables. An uncached offline first
use can fail; Retry and Hide remain available.

The loading spinner remains until both worker readiness and AudioContext resume
complete. Worker/download failures and unavailable audio output have distinct
retry messages. Loading/error/empty states reserve graph space. The disclosure
button has a 44 px minimum target, accurate expanded/control semantics and
keyboard focus styling. Reduced-motion and forced-colors modes are supported.

The controller belongs to the persistent audiobook player, not the dismissible
Sheet. It samples bounded 40 ms frames at most 25 times per second with one worker
request in flight, and keeps at most 400 history points. It never decodes or
copies the entire audiobook. Analysis stops when the strip, panel or browser tab
is hidden; pausing, ending and buffering retire both pending results and their
watchdogs. A fresh native audio window and available media data are required
before sampling resumes. Stale callbacks cannot restore retired traces.

**Web Audio routing invariant:** once the media element is captured, its direct
connection to the destination stays alive while visualization is hidden or off.
Only the analyser branch is disconnected. Closing or suspending that context on
Sheet dismissal would silence the existing player. Native Play resumes the
retained context before scheduling analysis. Audio replacement retires the old
source; final player disposal closes the context.

## Provenance

The estimator is adapted from ManabiIO/japanesevids-template
`src/pitch-analysis.js`, used by the Japanese Vids Black Belt template and
ManabiIO/japanesevids-cli. The initial port inspected main on 2026-09-28 and the
tuning rationale in `PITCH-ANALYSIS-TUNING.md` (blob
`4a6a1bf3dced6aad2a87a142104868420a66735b`).

The port retains at-most-12-kHz block averaging, mean-centred Hann frames,
paired-energy normalized correlation, genuine local peak selection, 88%
candidate preference, a 0.52 voicing threshold, interpolated lag and peak/RMS
amplitude blend. Causal three-frame log-frequency smoothing and a rolling
−35 dB relative gate replace offline look-ahead and whole-clip analysis.
Timestamp centres follow media time and playback rate; they are not
sample-exact transcript alignment. No subtitle-delay, matcher or database
schema change is required.

## Qualification

`node test/pitch/run.mjs` executes the actual TypeScript core through Node type
stripping. The 52 tests include estimator fixtures at six sample rates, bounds,
unvoiced gaps, missing/malformed replies, delayed initialization, seek/pause/end/
buffering races, timeouts, retries, replacement, native resume, preserved routing,
and the rolling graph geometry.

`node test/pitch/run.mjs --emit=test-results/pitch-modules` followed by
`python test/pitch/browser.py test-results/pitch-modules --browser chromium`
exercises actual HTML audio, Web Audio and the worker over HTTP. The dedicated
workflow runs Chromium and Firefox on Linux with an explicit audio output and
WebKit on macOS. This module harness is separate from the application UI tests.

After `BASE_PATH=/reader-web pnpm build`, run
`python tests/browser/test_voice_pitch.py`. Its two actual-app journeys use
normal EPUB/subtitle/audio import, the emitted worker and a changing-F0 audio
fixture. They check no eager worker request during offline-shell installation,
enable/disable, held paused traces, panel dismissal/reopening, seeking, mobile
keyboard interaction, theme-derived waveform colors and the yellow contour.
Screenshots and diagnostics are retained under `test-results/voice-pitch-app`.

Repository lint, application type-check and build, the native engine matrix,
and actual-app acceptance must be checked on the selected PR head. The PR
qualification ledger records observed results; an added test is not a pass.
