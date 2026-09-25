# Video library and CPU MOSS implementation

This work adds a local-first video workspace and a CPU-only transcription engine
adapter. It is not yet release-qualified. See the handoff report for exact executed
checks; a successful helper test is not proof of real-model inference or deployment.

## Boundaries

- `/videos` is linked from Books. Opening a file never downloads a model or starts
  transcription. Generate (or an explicit bulk action) does both as needed.
- Video uses the browser media element; Mediabunny supplies bounded audio decode
  through `manabi/media-runtime.ts`. This is not a VLC-compatible codec layer.
- Local files, directory handles and authenticated cloud ranges share ByteSource.
  Cloud adapters recheck selected-root admission and file revision. Provider tokens
  and capability URLs remain on the backend.
- Embedded MP4/MOV `tx3g`/`wvtt` and Matroska UTF-8/ASS/SSA/text-WebVTT captions
  have bounded text demuxers. Unsupported, encrypted, laced, bitmap, fragmented or
  unresolvable inputs are not silently classified as subtitle-free. ASS text is
  extracted without promising full original typography/drawing semantics.
- Caption-page/manifest changes invalidate the active player across store notifications,
  while playback-only checkpoints do not reread the subtitle archive. Manifest and
  referenced page reads share one transaction; unrelated video/account pages are not
  loaded. Incomplete tracks remain unavailable until their verified pages arrive.
  Forced/full and authored/generated tracks are never merged merely because text matches.
- Audio-window cancellation releases callers waiting on metadata or stalled packet
  callbacks, observes late failures and stops scheduled audio sources. Web Audio
  retains packet timestamps and gaps while resampling/downmixing to 16 kHz mono.
  Windows have both a byte budget and a packet/node budget.
- SRT/WebVTT imports and generated alternatives are canonical structured tracks,
  including language, source, model/engine provenance and independent cue times.
  No user file or existing subtitle is overwritten. Export is explicit; this does
  not write sidecars to cloud folders or remux video containers.
- Primary and secondary tracks are paired by time, not cue index. Theater overlays
  stack them. The transcript moves beside/below the video based on available area.
  Caption size, white/yellow text, background and edge settings are restrained.
- Local IndexedDB replicas are account-partitioned; account sync is opt-in. Models,
  source locators/handles, local jobs and sampled identities are never synced.
  Portable media keys are SHA-256 of all original bytes. A separate device-only
  sampled key saves position while full identification is still running. The
  sampled identity is a convenience, not proof that two files are identical.
- Cloud locators are saved only locally; reopening obtains a fresh authenticated
  metadata/range source and verifies content before attaching portable state.
  Full hashing still reads every byte; large cloud videos incur material traffic.
- A serial queue uses 60-second cores with two-second overlaps and completed-window
  checkpoints. Speaker labels are window-local; boundary deduplication is heuristic.
  Each job has a compare-and-update owner token and expiring lease. A stale worker
  cannot commit checkpoints or publish after another worker claims the job. Cancellation
  is durable, not an older full-record replacement. Subtitle pages, manifest and the
  completed job state publish in one records/local transaction. A publication-only
  retry does not rerun inference. Browser suspension is not guaranteed background processing.
- The video shelf has All, Continue watching, Finished and Not watched filters.
  Filters clear hidden selections; saved-progress refreshes preserve open menus/focus.
  Automatic audio selection requires a unique decodable match to the requested language
  (or one untagged stream). Ambiguous dubs/commentary are never selected arbitrarily.
- Late acknowledgements cannot erase a newer conflict or local edit. Sync reports
  pending edits honestly, advances only through delivered feed sequences and retains
  pending mutations after errors without a tight one-second network retry loop.

## Runtime build and policy

With an activated Emscripten SDK:

```
python tools/media/build-moss.py
```

Both single-thread and pthread SIMD variants are built from fixed MOSS/ggml commits.
The builder uses separate work directories, verifies both variants before touching
installed outputs, stages copies on the destination filesystem, and serializes the
local replacement. A caught installation error restores the previous pair. If
recovery itself fails, the error names a retained `.moss-runtime-*` backup directory.
Inspect it before retrying; do not delete it automatically. A process kill can also
leave recovery files. Two renames are not an atomic live-deployment mechanism; use
the normal deployment's immutable build/release switch rather than building into
a live-served directory. Generated runtime/recovery directories are ignored by Git.
The original source tree is never patched in place when `--source` is supplied;
its pinned commit is cloned into an isolated build directory.
The q5_0 GGUF is fetched only after an explicit generation request; its immutable
revision, byte length, magic and SHA-256 are checked. Download progress is visible
and cancellable, and a verified model is cached in OPFS. No hosted inference API
or Hugging Face account/token is required. This uses streaming fetch, not a generic
SDK, because only one public pinned artifact is needed.

The build disables Emscripten dynamic JavaScript execution. Reader's script-src
permits `wasm-unsafe-eval`, not JavaScript `unsafe-eval`. Worker responses served by
an additional CSP must permit WASM too. Deploy `.wasm` as `application/wasm`; ship
both runtime directories and their verbatim upstream notices/build manifests.
The Worker also checks the compiled ABI, engine and ggml revisions and actual
shared-memory mode before downloading weights. It additionally checks the actual
JavaScript/C exports, WORKERFS integration, typed heap views, cancellation address,
and pthread teardown binding before the large download. Early HTTP/stream failures
abort the destination without losing their original error to cleanup failures.
Both CPU artifacts must match the
app's port revision (`manabi-web-v3`). When changing the C++ port, bump the revision
in the build recipe and model manifest together. Completed older transcripts remain
valid; interrupted old-port jobs must be regenerated rather than mixing engines.
This compatibility check is not a signature or sandbox for untrusted JavaScript.
The runtime recipe records source/compiler/output hashes but is not itself evidence
that these binaries compile or perform acceptably.

Model loading now reuses at most 4 MiB of tensor-transfer scratch storage rather
than staging each entire tensor. Packed tensor bytes and destination offsets are
unchanged. Checked signed file extents, exact byte counts, and RAII file ownership
reject overflow/truncation and release the file on exceptions or cancellation.
This does not reduce the resident weight buffers or establish a total memory bound.
The native helper is compiled and executed under AddressSanitizer/UBSan by
`tests/media/test_model_reader.py`; that is not a ggml/MOSS/Emscripten build.

The Worker exposes its shared cancellation word as soon as the runtime passes
validation, before fetching/loading the model. This handshake does not mark the
model ready. A pthread preparation can observe cancellation during the bounded
transfer loop even while the Worker cannot service message events. A fully loaded
runtime refreshes its heap view in the separate ready message. Single-thread
cancellation and non-cooperating operations retain the worker-termination fallback;
actual WASM cancellation latency still requires measurement.

Threading is selected only in an already cross-origin-isolated context. This work
does not impose COOP/COEP on existing authentication/provider flows. Qualify those
headers with OAuth redirects, worker assets, model CDN fetches and cloud playback
before choosing threaded mode as the default. The single-thread worker remains the
fallback. The current 2 GiB WASM limit and real memory footprint need measurement.

## Checks

Use the repository's Node/pnpm versions in a full checkout. Resolve the real lockfile
with the package manager; this bundle does not invent dependency integrity entries.

```
pnpm install --lockfile-only
pnpm install
pnpm --dir apps/web check
pnpm --dir apps/web build
node tools/media/test.mjs
FIXTURE="$(python tools/media/generate-fixtures.py --language en)"
MEDIA_FIXTURE="$FIXTURE" node tools/media/test.mjs
python -m unittest discover -s tests/media -p 'test_*.py' -v
python tests/media/dom-browser.py --fixture "$FIXTURE" --output .cache/media-dom-evidence
python tests/media/workspace-dom.py --fixture "$FIXTURE" --output .cache/media-workspace-dom-evidence
python tests/media/audio-browser.py --output .cache/media-audio-evidence
node tools/media/benchmark-hash.mjs
python tests/media/browser.py --fixture "$FIXTURE" --output .cache/media-browser-evidence
```

`dom-browser.py` runs production DOM controllers plus a generated MP4 in Chromium,
with explicit persistence/provider transport doubles. It also tests minimal WASM
under restrictive CSP without permitting JavaScript eval. It does not compile the
Svelte route, run real IndexedDB or perform speech recognition. `workspace-dom.py`
adds actual workspace DOM tests with explicit transaction, audio-metadata and ASR
stand-ins. Neither in-memory test document is treated as a secure origin. The hash
benchmark is Node incremental SHA-256, not browser or speech-recognition performance.
`browser.py` is the
separate secure-context/IndexedDB harness; it must run where local serving is allowed.

`audio-browser.py` executes the production pipeline with real Chromium
`OfflineAudioContext`/`AudioBuffer`: downmix, 44.1/48 kHz resampling, nonzero packet
offsets, pre-roll, silent gaps and window boundaries. Only the decoded-packet supply
is injected. It does not test Mediabunny/WebCodecs file decoding or speech recognition.
The Python runtime-publication tests use explicitly controlled placeholder files,
not compiled MOSS outputs. Their checksums/header checks do not validate inference.

Japanese fixtures use whichever supported Japanese voice is actually installed.
The default preference is Kyoko on macOS; on Linux the resolver tries Open JTalk,
then an already provisioned pyopenjtalk package, then eSpeak NG/eSpeak only when
its installed voice table explicitly contains Japanese. An unavailable preferred
name never changes the requested language.

A typical Debian development setup is:

```sh
sudo apt-get update
sudo apt-get install ffmpeg open-jtalk open-jtalk-mecab-naist-jdic hts-voice-nitech-jp-atr503-m001
```

The voice package may require enabling the distribution's non-free/multiverse
component. The generator itself does not change package repositories, install
system packages, call a hosted synthesis service or download pyopenjtalk dictionaries.
Install the engine/dictionary/voice once on the development runner. The official
Open JTalk project and Debian package pages document the required assets:
https://open-jtalk.sourceforge.net/ and https://packages.debian.org/bookworm/open-jtalk.
Voice assets have their own licenses; they are not bundled in this repository.

Use automatic selection, or provide an explicit Open JTalk dictionary/voice:

```
JA_FIXTURE="$(python tools/media/generate-fixtures.py --language ja)"
# --voice Kyoko remains a preference and may select a different installed Japanese voice.
# OPEN_JTALK_DICT_DIR=/path/to/dictionary OPEN_JTALK_VOICE=/path/to/voice.htsvoice \
#   python tools/media/generate-fixtures.py --language ja --engine open-jtalk
python tests/media/asr.py --fixture "$FIXTURE" --language en --output .cache/asr-en.json
python tests/media/asr.py --fixture "$FIXTURE" --language en --threaded --output .cache/asr-en-threaded.json
python tests/media/asr.py --fixture "$JA_FIXTURE" --language ja --output .cache/asr-ja.json
```

The Web Speech API does not expose the PCM required by a deterministic recorder;
fixture generation therefore uses local synthesis plus ffmpeg. The selected actual
voice and language are printed to stderr and stored in the fixture manifest; stdout
remains just the cache path. When no supported Japanese synthesizer is installed,
the command fails rather than manufacturing Japanese-labelled English or silence.
The cache includes executable, voice and dictionary hashes where accessible, tool
versions, fixture definition and both generator modules. It verifies all output
hashes and cue intervals, serializes concurrent generation/repair per key, and
regenerates broken entries. Two-sentence fixtures work as well as longer fixtures.

The real-ASR gate validates the fixture language, engine attribution and every
cached file checksum before inference. It records the actual fixture/voice identity
and rejects invalid CER thresholds and wrong isolation modes. This remains a
runtime-only recognition check using generated PCM, not a full media-decoder test.
No audio/video, installed voice assets or fonts should be committed.

## Remaining acceptance work

Real MOSS compile/inference, Japanese accuracy, overlap seams, long-file memory/RTF,
real IndexedDB/cross-tab recovery, composed Django/account/provider tests, full app
lint/typecheck/build, and Safari/iOS/native fullscreen remain mandatory. Existing
book collections/series and polished thumbnails are not fully generalized. Generated
translation and upgrade-comparison UI are not part of this implementation. Imported
translations and multiple generated source tracks are supported.

For the companion backend helper/real-validator-body regressions:

```
python -m unittest discover -s tests/reader_web -p 'test_media*.py' -v
```

These helpers deliberately do not emulate Django/PostgreSQL authentication or live
provider services. Run the existing composed backend suite after integrating both
patches; helper-only success is not an admission to production.

## Explicit networked-runner qualification

`.github/workflows/media-qualification.yml` is **manual (`workflow_dispatch`) only**.
It does not run merely because these local files exist, and it is not a release,
merge, deployment, or model-publication workflow. Dispatch the intended branch
only after reviewing its code.

The application job uses the repository's pinned Node/pnpm and requires a frozen,
package-manager-generated lockfile; it will not silently manufacture the missing
Mediabunny lock entry. It typechecks the actual adapter/Svelte application and builds
at `/Reader-Web`.

The independent CPU job checks out emsdk 4.0.23 at commit
`c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56`, builds both single-thread and pthread
runtimes, installs Open JTalk with the actual Japanese dictionary/voice, generates
English and Japanese fixtures, runs the core tests with real generated containers,
and runs the native IndexedDB/browser harness. It then runs real MOSS on the
verified PCM from both languages with both runtime variants. Failed speech setup,
missing runtimes, recognition failures and missing native storage support are
failures, not successful skips. It uses only read permissions, no repository
secrets, and never publishes a release. Evidence uploads include logs, source and
runtime identity metadata, and browser screenshots—not media binaries, model
weights, installed voice assets, fonts or browser profiles.

The Ubuntu voice package is in multiverse; the workflow expects the runner's
normal package sources to provide it. It does not change sources to bypass a
restricted runner. Official package/source references:
- https://packages.ubuntu.com/noble/hts-voice-nitech-jp-atr503-m001
- https://packages.ubuntu.com/noble/open-jtalk-mecab-naist-jdic
- https://github.com/emscripten-core/emsdk/tree/c0bb220cb6e6f4e0fabb6f6db9efd53390ef5e56

This workflow is prepared but has not been executed by the local continuation.
Its PCM recognition gate does **not** exercise the browser's real video decoder
feeding MOSS. That end-to-end path, long-window seams/performance, Django/account
composition, live cloud providers and physical Safari/iOS still need qualification.
Each ASR process currently uses a fresh browser profile; budgeting a workflow run
should allow up to four model downloads (approximately 2.6 GB total), not assume
OPFS persists between independent test processes.

## Storage and queue refinements

Generate admission is one IndexedDB read/write transaction across the scope's jobs,
so simultaneous tabs reuse a pending job for the same media/audio/language/engine.
Changed engines and deliberate alternatives to finished or paused jobs remain
separate. New job identities cannot overwrite saved jobs. Successful publication
checks the final track against the durable checkpoint, commits transcript pages and
completion atomically, then retains a compact completed-job summary. Failed/paused
jobs keep their complete window checkpoints; completed transcript text lives in its
canonical caption pages rather than being duplicated indefinitely in queue rows.

A caption refresh reads only track manifests plus the requested video's referenced
pages in one read-only transaction. It never loads unrelated caption bodies. A
missing/deleted page keeps the incomplete track unpublished until all its verified
pages are available. The Node transaction-boundary tests use an explicit double;
the native browser suite contains separate cross-connection admission checks.
