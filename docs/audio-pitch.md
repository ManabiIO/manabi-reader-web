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
Not-yet-played passages have no contour. The 85–520 Hz speech range does not cover
every voice. SwiftF0 is robust to many degraded-audio conditions but detects
pitched sound rather than speaker identity, so music or another simultaneous
speaker can still produce an estimate. It is a listening aid, **not dictionary
pitch-accent inference or pronunciation grading**. Synthetic tone tests do not
establish accuracy on Japanese speech.

## Loading and playback lifetime

A same-origin analysis worker, the 135 KB SwiftF0 0.3.0 model, and ONNX Runtime
Web's WASM CPU runtime are requested only on first enable. All three are excluded
from the service worker’s eager shell installation through the existing
`lazyAssets` contract. Normal HTTP caching may reuse the content-hashed assets
later. An uncached offline first use can fail; Retry and Hide remain available.
The runtime is fixed to one WASM thread and does not request WebGPU, limiting
contention with transcription.

The loading spinner remains until both worker readiness and AudioContext resume
complete. Worker/download failures and unavailable audio output have distinct
retry messages. Loading/error/empty states reserve graph space. The disclosure
button has a 44 px minimum target, accurate expanded/control semantics and
keyboard focus styling. Reduced-motion and forced-colors modes are supported.

The controller belongs to the persistent audiobook player, not the dismissible
Sheet. It samples a bounded rolling ~0.64 s Web Audio window about every 256 ms,
with one worker request in flight. Each model run emits the newly stable
32 ms-spaced contour frames that have both SwiftF0's required past and future
context instead of discarding all but one. The 256 ms cadence cuts repeated
overlapping model work by more than half while keeping the displayed trace
dense. The history remains bounded to 400 points. SwiftF0
resamples only that window to 16 kHz and selects the newest estimate with its
documented future context; it never decodes or copies the entire audiobook. Analysis stops when the strip, panel or browser tab
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

F0 estimation uses **SwiftF0 0.3.0** by Lars Nieradzik (MIT), with the exact
vendored upstream model identified in `pitch/SWIFTF0-NOTICE.txt`. The model
runs locally through ONNX Runtime Web's WASM backend. Reader constrains the
search to 85–520 Hz, uses SwiftF0's confidence with a 0.52 voiced threshold,
retains a rolling −35 dB relative level gate, and maps the model's fixed 16 ms
frames back to media time. The previous custom autocorrelation estimator has
been removed rather than retained as a silent fallback.

SwiftF0 requires about 176 ms of future context for a final streaming frame.
Reader therefore analyzes a short rolling window, discards the eleven
left-edge frames that lack normal streaming history, and displays only estimates
with the required past/future context. Timestamp mapping follows media time and playback
rate; it is not sample-exact transcript alignment. No subtitle-delay, matcher
or database schema change is required.

## Qualification

`node test/pitch/run.mjs` executes the actual TypeScript core through Node type
stripping. The deterministic tests cover SwiftF0 resampling/selection contracts, bounds,
silence and malformed output, plus missing/malformed replies, delayed
initialization, seek/pause/end/buffering races, timeouts, retries, replacement,
native resume, preserved routing, and rolling graph geometry. Native browser
qualification exercises the real vendored model and WASM runtime.

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
