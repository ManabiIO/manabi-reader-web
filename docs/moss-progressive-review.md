# Progressive MOSS: adversarial review and refinement

Reviewed against the unpublished 37-file progressive bundle rebased onto Reader #46
at `698a764e1d283f49ada88dac722b76fe2f5a1fd9`. That parent carries the v5 Wasm
SIMD/partial-encoder/thread-tuning performance port. Mudler Q5_0, model SHA-256 and
pinned C++/ggml source are unchanged. The progressive callback is therefore v6: it
retains all v5 performance behavior and adds callback/progressive semantics; v5 and
v6 are intentionally distinct runtime identities. No replacement model, forced
aligner, microphone capture, global speaker identification, merge, or deployment.

## Reproduced defects and repairs

### 1. Seam matching erased meaningful distinctions

The previous comparison deleted every space, comma and period. It could equate
`1.5` with `15`, `1,5` with `15`, and `a part` with `apart`, then consume a right-hand
hypothesis or repair anchor as though it were confirmed repeated context.

Matching now preserves numeric punctuation and Latin/numeric word boundaries.
NFC normalization is confined to the comparison representation; original text and
timestamps remain verbatim. Japanese cue boundaries can still match without spaces.
An ordinary English one-to-many cue split has positive regression coverage too.

### 2. Close-in-time repetitions were mistaken for overlap

Endpoint tolerances alone allowed separate short occurrences of `そうですね。` to
collapse. Agreement now also requires positive acoustic-time overlap of at least
half the shorter interval, and endpoint tolerance is bounded by that interval.
The same rule protects repair anchors. Timestamp jitter is still tolerated for
longer overlapping utterances. This is evidence-sensitive matching, not a guarantee
that generated timestamps or the selected recognition are correct.

### 3. One-to-many matching could erase a speaker turn

A single cue could match two cues assigned to different speakers in the neighboring
window, replacing their turn structure with the single cue. Matching groups must
now be internally single-speaker and sequential. Window-local speaker labels are
not compared as global identities. Ambiguity goes to the existing bounded repair
path rather than being declared an agreement.

The stricter policy may increase repair frequency. That tradeoff requires natural
Japanese/mixed-speaker measurement; the synthetic tests do not establish a net
quality improvement or real-time performance.

### 4. Preview callbacks could outlive an inference

A custom engine that retained its callback could publish an old window's preview
after success, or throw an abort exception out of band after cancellation. Each
recognition now closes its callback lifetime in `finally`; late callbacks are inert.
The final result still follows the normal parser and atomic checkpoint path.

### 5. The final worker result could contradict its preview

The previous protocol checked consecutive previews but not the final handoff.
Both the compiled worker handler and client now reject a final result that rewrites
an emitted prefix. Native ASCII edge stripping is allowed only at actual string
edges; it cannot erase a word boundary inside an extended transcript. Repeated
identical client snapshots no longer generate duplicate preview notifications.
The worker callback is removed on every completion/failure path.

### 6. Delayed draft restoration could override Generate

Generate now establishes a new selection intent before awaiting admission. An older
saved-draft read cannot choose its track after that explicit new action. A real
Chromium controller test reproduces the original race and checks the repaired path.

### 7. Terminal jobs could retain or revive provisional text

The player retires previews on paused, failed and complete status, without depending
on a later workspace refresh. Late previews for those jobs are ignored. A resumed
operation can display previews again; status/clear messages for another job cannot
clear the selected job's preview. Inference-level callback fencing remains the
primary defense against an old operation during a later resume.

### 8. The ASR gate demanded an impossible single-cue preview

A closing timestamp remains ambiguous during preview until a following cue opening
or final completion. A valid single-cue result can therefore produce real token
callbacks without any complete preview cue. The gate now accepts an explicit null
`firstPreviewCueSeconds` for one parsed final cue, while still requiring real
callbacks, a valid first-output latency and nonempty recognition. Missing fields,
empty recognition, invalid timing and missing multi-cue preview evidence fail.
The fixture's editorial line count is no longer imposed on the recognizer. Strict
parsing and the character-error gate remain. This does not fabricate a zero latency.

### 9. Missing speaker tags unnecessarily discarded valid MOSS text

OpenMOSS issue #40 documents timestamped transcription where the model omits every
`[Sxx]` tag. Our strict parser previously failed the whole window despite preserving
valid text/timestamps being possible. It now chooses one grammar from the first
opening token: ordinary tagged output remains strict, while a consistently untagged
window is retained with speaker unknown. Tagged/untagged mixing still fails closed,
and regression cases preserve bracketed numeric text and preview withholding.

A separate rebase review also fixed policy provenance: a saved `pause-overlap-v1`
job resumed under v5 now publishes its actual durable policy instead of being labeled
with the current `pause-overlap-v2` default. v3/v4/v5 runtime history is likewise kept
separate from the progressive v6 runtime identity.

## Research used in the review

- Machacek, Dabre and Bojar, _Turning Whisper into Real-Time Transcription System_:
  https://arxiv.org/html/2307.14743v2
  LocalAgreement compares successive hypotheses; its confirmed-output handling
  combines text with timestamps and explicitly acknowledges timestamp changes.
  Its word-timestamp assumptions and GPU measurements are not MOSS/WASM guarantees.
  This reinforced the joint-evidence seam review and distinct first-output,
  complete-preview and final-completion timing measurements.
- OpenMOSS issue #40, missing `[Sxx]` tags on otherwise timestamped output:
  https://github.com/OpenMOSS/MOSS-Transcribe-Diarize/issues/40
  This supports treating speaker identity as optional when the whole model response
  consistently omits it; it does not justify inventing a speaker or weakening mixed
  output validation.
- WHATWG Encoding Standard, TextDecoder decode/stream behavior:
  https://encoding.spec.whatwg.org/#dom-textdecoder-decode
  Streaming decode can defer a split trailing UTF-8 sequence. The existing fresh
  decoder per full-prefix snapshot remains correct for the callback's snapshot
  protocol; one persistent decoder fed those same full snapshots would duplicate
  bytes. This review adds final-prefix consistency without switching protocols.
- Emscripten, Interacting with code:
  https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html
  Reviewed the C++/JavaScript boundary and copied heap bytes against its documented
  interoperation model. Scripted native/worker tests are not a replacement for a
  rebuilt v5 WASM runtime in both threading modes.
- Silero VAD maintained implementation:
  https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/utils_vad.py
  Speech thresholds, minimum silence duration and padding are explicit policy
  choices. Our energy valleys remain boundary candidates only, not proof that
  quiet speech is absent. No new VAD dependency or audio deletion was introduced.

## Executed evidence

All counts below are newly executed on the refined source unless marked before.

| Scope                                                                     | Result                          |
| ------------------------------------------------------------------------- | ------------------------------- |
| Strict media TypeScript compilation and Node tests, fixture cases enabled | 495 passed; zero failures/skips |
| Python tooling and native helper/patch tests                              | 74 passed                       |
| Chromium production player controller                                     | 73 passed                       |
| Chromium production workspace/controller                                  | 22 passed                       |
| Real Chromium Web Audio resampling/window tests                           | 8 passed                        |
| Menu/viewport controller cases                                            | 6 passed                        |
| Transcript interactions with generated MP4                                | 9 passed                        |

The focused 25-case seam/client set ran against the exact preceding compiled
bundle: 12 passed and 13 failed. The same set passes after repair. This includes
existing controls; it is not 25 new tests and is not added twice to suite totals.
Three new player cases failed on the preceding player and pass after repair; a
fourth new case protects resumed/other-job behavior. The single-cue metric case
failed before the gate repair. The new native-final mismatch case is one of six
scripted compiled-worker scenarios, counted within one Node test, not six more ASR
tests.

The C++ output patch still runs against a scripted decoder. Native model-reader
checks use address/undefined-behavior sanitizers. Browser controller runs inject
storage, recognition and provider boundaries as documented by their harnesses;
they are not a full Svelte build, native IndexedDB/multitab test or real recognition.
The generated media uses installed English eSpeak. Authored Japanese captions are
not Japanese ASR evidence. Phone/desktop progressive screenshots were inspected.

A separate synthetic maximum-boundary timing check used 128 cues per side and
128 characters per cue. Three runs took approximately 136–154 ms on this host.
This bounds neither device latency nor typical seam cost, and is not an ASR
throughput benchmark. Dense boundary matching and repair rate remain profiling
items for representative inputs.

## Remaining qualification

Both v5 WASM variants must be built and run with the unchanged real model. The
repository-pinned formatter/ESLint/Svelte/build and exact-head CI must run on the
published composition. Local formatting used the available official Prettier
3.10-dev distribution without the repository's Svelte/Tailwind plugins; it is not
an installed-repository formatting qualification.

Natural Japanese, repetitions, numbers, quiet/music-backed speech, speaker overlaps,
long held utterances, timestamp error and seam repair rate remain unqualified.
Unresolved or over-budget repairs preserve the accepted prefix and hypotheses, but
resuming is not guaranteed to resolve a fundamentally ambiguous boundary. No
character/word timestamps are invented to conceal that uncertainty.

The exact base-v4 CPU smoke result improved to about 3.14x realtime threaded and
5.7x single-threaded on its small CI fixture. Those results motivate a short first
window but are not v5 or representative-device qualification. Production WASM packaging
warning still applies.
This review does not claim faster-than-real-time inference, fix the deployment
pipeline, establish physical Safari/iOS behavior, or qualify live cloud/account
composition. Keep the progressive PR draft until the relevant gates are satisfied.
