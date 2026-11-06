# Optional voice pitch in the audiobook transcript

Choose local audio and timed subtitles, then use **Audiobook → Transcript →
Voice pitch → Show**. The visualization is off by default, and enabling it lasts
only for the open book session. Audio stays on the device; no microphone,
recording, upload or second playback element is involved.

## Reading the view

The shaded waveform shows relative mixed-audio amplitude inside the active
subtitle. The yellow (`#ffd83d`)
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

Between timed subtitles, the strip shows **Waiting for dialogue** and sends no
model requests. Existing points scroll out with the media clock. Each cue owns
its exact delayed, duration-clamped half-open interval; samples outside it are
zeroed before inference and projected frames outside it are discarded. A new
cue starts a separate segment. Overlapping music or speakers inside the active
cue can still influence the monophonic estimate.

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
Sheet. It samples a bounded rolling ~0.55 s Web Audio window about every 96 ms,
with one worker request in flight, and keeps at most 400 history points. SwiftF0
resamples only that window to 16 kHz and selects the newest estimate with its
documented future context; it never decodes or copies the entire audiobook. Analysis stops when the strip, panel or browser tab
is hidden; pausing, ending and buffering retire both pending results and their
watchdogs. A fresh native audio window and available media data are required
before sampling resumes. Stale callbacks cannot restore retired traces.

Inference is serialized even when a newer playback epoch retires an unfinished
request. Explicit retirement also drops queued work during gaps. Input and all
returned output tensors are disposed after success or failure, including
partial input allocation and malformed outputs; published arrays are copied
before release. Quiet non-silent input receives model-only gain, while amplitude
and current-hop silence gating use the original resampled samples.

The controller prefers a 48 kHz context. If the native fallback cannot fit
11 past + 1 current + 10 future model frames inside the 32,768-sample analyser,
it fails before worker download or media capture and closes the unused context.
Retry can create a new context after the output rate changes. A cue transition
waits for future context without shortening a full post-seek or post-pause
fresh-audio wait.

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

The vendored graph is Git blob `3619f9ab7ad7c852b995550c74d971be236225d7`
(135,090 bytes). It accepts float32 `audio` shaped `[1, samples]` and scalar
float32 `fmin`/`fmax`; outputs are float64 `pitch` and float32 `confidence`, each
`[1, frames]`. ONNX Runtime Web remains pinned to 1.29.0, using WASM CPU.
The [v0.3.0 reference source](https://github.com/lars76/swift-f0/blob/v0.3.0/swift_f0/core.py)
defines 16,000 Hz / 256 samples = **16 ms** per model frame. The centered 32 ms
window measures display level; it is not the model hop. Frame selection needs
11 preceding and 10 subsequent frames. The minimum complete window is 352 ms.

SwiftF0 requires about 176 ms of future context for a final streaming frame.
Reader therefore analyzes a short rolling window and displays a slightly
delayed acoustic estimate. Timestamp mapping follows media time and playback
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

## October 13 source reconciliation (unqualified)

This composition starts from Expo main `a1101b66db4c194140aeb4a8d6edcdfc86b4c770`.
The model, runtime version, document-base worker initialization, asset URL
resolution and lazy loading remain in their current Expo form. No persistent
user data or backup format changes.

| Historical donor | Semantic disposition |
| --- | --- |
| #252 `2b8af420bea544ece819300bdb20b6a56513df12` | Carry tensor ownership, current-hop silence, full context, high-rate filtering/capture bounds, serialization and stale-reply protection. Fix its adapter's missing ownership of rejected/unexpected output tensors. Extend retirement to gaps with no replacement analysis. |
| #227 `456e8712507c72c09c44bbe355cb01d637ab1fc6` | Carry exact cue masks, gap clock and cue state into the live React adapter. Preserve main's 0.55 s / 96 ms single-frame cadence. Its 0.64 s / 256 ms batching and alternate context-rate fallback are not adopted; qualify them separately if desired. Do not transplant its malformed literal `\n` in `analysis.ts`. |
| #193 `5b54d32682e4cce1d9f14769717fa8d0c09d721b` | Carry cue entry/exit ownership and broken contours through the composition above. Retained Svelte changes remain historical evidence; the dirty shared Svelte source is not edited. |

All three donor PRs remain open; ancestry alone is not a semantic disposition.
Regression sources cover resource lifetime, worker retirement, cue identity,
timestamp projection, gap admission and React cue ownership. **No tests,
type checks, lint, builds, installs, benchmarks, model execution, playback,
browser verification or CI dispatch were performed for this composition.**
The later authorized batch must run core and React/Expo regressions, qualify the
real model in Chromium/Firefox/WebKit, and verify lazy assets in the actual Expo
web export and packaged Android DOM host. Synthetic assertions do not qualify
Japanese speech or mixed dialogue/music accuracy. This upstream media work is
outside native v3-hotfix release blockers.
