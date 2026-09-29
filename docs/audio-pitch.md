# Optional voice pitch in the audiobook transcript

Choose local audio and timed subtitles, then use **Audiobook → Transcript →
Voice pitch → Show**. The visualization is off by default and remains enabled
only for the open book session. Audio stays on the device; no microphone,
recording, upload, second playback element, or server analysis is involved.

## Reading the view

The shaded waveform shows relative audio amplitude. The yellow (`#ffd83d`)
contour shows estimated acoustic pitch, with higher lines representing a higher
fundamental frequency. The waveform and surface use the reader's foreground,
background and border tokens in light and dark appearances.

The graph always places the most recent audio at the right. It shows the last
eight seconds of media time, with −8 s / −4 s / Now labels and logarithmic
100 / 200 / 400 Hz guides. A point marks the latest voiced estimate. Unvoiced
frames, low-confidence frames, playback discontinuities and implausibly large
display jumps break the contour rather than joining unrelated estimates.

Pausing holds the completed trace. Seeking, looping, changing speed, choosing
another audio file, or reopening the strip starts a new trace. Resuming after
pause or buffering begins a separate contour segment.

This is a **live rolling visualization**, not a precomputed full-cue graph and
not dictionary pitch-accent inference or pronunciation grading.

## SwiftF0 detector

Pitch is estimated by **SwiftF0 0.3.0**, using the upstream MIT-licensed ONNX
model from `lars76/swift-f0`. The exact vendored model is recorded in
`SWIFTF0-NOTICE.txt`.

The detector runs at its native 16 kHz sample rate. Reader resamples only the
bounded analysis window; audible playback and transcription continue to use the
original media stream. SwiftF0 emits estimates every 16 ms and needs temporal
context around an estimate. Reader samples a ~683 ms Web Audio history window
(at the requested 48 kHz analysis context) every 80 ms and publishes only model
frames with SwiftF0's required future context. Overlapping windows are
deduplicated by media timestamp.

SwiftF0 confidence below 0.5 is treated as unvoiced. Digitally silent frames are
also suppressed. A rolling speech-oriented level gate suppresses candidate pitch
more than 20 dB below the recent voiced level, following SwiftF0's guidance for
speech applications.

**Important limitation:** SwiftF0 detects pitched sound, not speaker identity.
Music, another speaker, or other tonal background audio can still be reported as
pitch, particularly when the intended speaker pauses. The confidence and level
gates reduce misleading traces but do not perform source separation. When the
detector is uncertain Reader prefers a gap over inventing a contour.

## Loading and resource isolation

SwiftF0 is loaded only after the user presses **Show**. The lazy graph consists
of the pitch worker, the pinned SwiftF0 model and ONNX Runtime Web's WASM
backend. Those emitted assets are excluded from the service worker's eager
offline-shell installation. Normal browser caching may reuse them after first
use; an uncached first use therefore needs a network connection.

ONNX Runtime is configured for the **WASM CPU backend with one inference
thread**. Voice pitch does not request WebGPU. This is deliberate so the
optional visualization does not compete for the GPU execution path used by
other local ML features. The worker is terminated when pitch is hidden, the
sheet is dismissed or the page is hidden.

The loading spinner remains until both the SwiftF0 inference session and the
Web Audio context are ready. A cold runtime/model load gets a 30-second bounded
startup window. Retry and Hide remain available on failure.

## Playback lifetime

The controller belongs to the persistent audiobook player, not the dismissible
Sheet. Once Web Audio captures the media element, its direct
media-source → destination connection stays alive while pitch is hidden or off.
Only the optional analyser branch is disconnected. Closing or suspending that
context on Sheet dismissal would silence the existing player, so final context
shutdown happens only when the player is disposed.

Analysis uses one worker request in flight. Pausing, ending, buffering, seeking,
rate changes and audio replacement retire pending replies and their watchdogs.
An epoch plus monotonically increasing media timestamps prevents an old worker
result from restoring a retired contour. The graph keeps at most 560 points,
which bounds the dense 16 ms SwiftF0 output over the eight-second display.

## Provenance and licensing

SwiftF0 upstream: `https://github.com/lars76/swift-f0`.

The vendored model is SwiftF0 0.3.0, upstream Git blob
`3619f9ab7ad7c852b995550c74d971be236225d7`, licensed MIT. ONNX Runtime Web
1.29.0 is also MIT licensed and is pinned by the web package manifest.

The previous JapaneseVids-derived normalized-autocorrelation estimator is no
longer used by Reader's Voice pitch feature.

## Qualification

The dependency-free core suite exercises resampling, graph bounds and the
controller's worker/audio lifecycle. Its native module harness intentionally
uses a deterministic detector stub so it can isolate Web Audio routing,
capture reuse, cancellation, seek/pause/buffering races and disposal without
pretending to qualify the neural model.

**Actual SwiftF0 qualification belongs to the production-app browser test.**
After `BASE_PATH=/reader-web pnpm build`, run
`python tests/browser/test_voice_pitch.py --browser <engine>`. It imports a
normal EPUB, subtitles and changing-F0 local WAV through the built application,
verifies that the worker/model/WASM are not requested by offline-shell
installation, enables pitch, observes real SwiftF0 results, exercises playback
lifetime and captures light/dark appearance.

The dedicated workflow runs that built-app journey in Chromium, Firefox and
WebKit. Repository lint, Svelte/TypeScript checking, production build and all
three real SwiftF0 browser jobs must pass on the selected head before the PR's
qualification ledger can call the detector switch complete.
