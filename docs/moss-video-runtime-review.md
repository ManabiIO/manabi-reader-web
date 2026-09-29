# MOSS/video lifecycle review — 2026-09-26, refinement 2

## Source and scope

This cumulative 21-file delta (seven files refined or added in this round) is based on Reader video PR #46 at
`9b15254df41943d9cfb497afb47f4b2293739959` (full Git tree
`eb6c570b7e90439ce18154445bafb7f389b9a164`). It does not merge the
cancelled Qwen branches or replace the newer transcript-first player with an
older cumulative media bundle. No backend, production activation, model
revision, C++ input, or dependency is changed.

The input was the later 19-file local bundle, whose `changes.patch` SHA-256 is
`2666747fd403035e3dc706abd6d5f7e95609628509b053fe5cd48b931fcdeef5`.
These remain local source changes, not pushed to GitHub. Use the cumulative
patch on the documented PR base, or the incremental patch on that exact prior
bundle's output. Those are alternative application routes, never sequential
patches to apply together. Neither route is a Qwen or old cumulative-video merge.

The selected model remains Mudler `moss-transcribe-q5_0.gguf`, 648174592 bytes,
Hub commit `54e4bbd17da3f84adf1c1bcf7791b9b9266f741e`, SHA-256
`7e9ce1de5648ed49fc5c4f5e003d61a7421a63c14074f7275dc8a8cc664ff865`.
The runtime identity remains `manabi-web-v3`. Opening a video or selecting
existing captions does not request transcription/model installation.

## New findings fixed in refinement 2

### Close could incorrectly report successful shutdown

The background queue task caught and reported errors, converting its owned
promise into a successful result before Close could inspect it. In addition,
an aborted batch/job suppressed every error, including a different failure from
saving the paused checkpoint or retiring the runtime.

The queue now keeps the original task promise and observes it separately.
Only the exact cancellation reason is suppressed; an independent checkpoint or
retirement failure reaches the Close aggregate after the remaining drains settle.
A settled, already-reported task is cleared so it cannot poison a later unrelated
Close. The regression tests exercise a failed pause transaction and a failure in
the batch's final disposal even when the first immediate disposal call succeeds.

### Outstanding renewal and recovery operations escaped the queue drain

Stopping the heartbeat timer did not wait for a lease-renewal write already
started by its callback. Queue Close also did not own the initial recovery scan.
The queue now tracks the actual renewal promise, checks cancellation inside its
atomic update, and waits for the renewal before releasing the batch lock. It
coalesces and drains recovery. A delayed recovery read cannot start updates after
Close. The held-operation tests verify these orderings with explicit transaction,
timer and engine doubles. This is not a reproduced native-IDB data-loss claim;
the underlying MediaStore already drains admitted writes on its own close.

### A fast failed or paused job could strand the Generate button

A terminal queue notification could arrive before Generate returned the job ID.
The player ignored it because the pending ID was not assigned yet; after the ID
arrived, the button stayed disabled as “Generating transcript…”. This ordering is
possible when audio preflight fails quickly while the workspace refreshes jobs.

The player now retains terminal outcomes only during that explicit admission,
then reconciles the returned ID. Outcomes for unrelated jobs do not cancel it,
and a later running/decoding notification supersedes an earlier pause. Existing
manual transcript-selection authority is unchanged. Four Chromium regressions
cover those orders; the failure and pause cases reproduce on the prior bundle.

### Exact abort reasons include explicit null

The shared abort helper now preserves `signal.reason` exactly. Null is a valid
explicit reason, not evidence that the caller omitted a reason. Regressions cover
null, zero, false and a string through both the direct and joined-signal helpers.

## Retained repairs from the 19-file bundle

### Inference serialization did not own resident model lifetime

The previous queue released its origin-wide inference lock after a job while
leaving that workspace's warm model alive. Multiple idle tabs could each retain
weights. A lock now covers a draining batch and the asynchronous shutdown that
follows. Successive admitted files share the warm runtime; an idle workspace
releases it. Work admitted during retirement starts a fresh batch.

The worker frees its model and stops the pthread pool before acknowledging a
matching disposal request. The client waits for that acknowledgement before
replacement, with a one-second termination-request fallback for an unresponsive
worker. Repeated Close calls wait for the same drain. Freeing failure still
attempts pool shutdown; it does not send a successful cleanup acknowledgement.
This is tested protocol ordering, not a measurement of physical memory release.
Without Web Locks the cleanup is per workspace, not an origin-wide guarantee;
old-version tabs also cannot be retroactively made to obey this policy.

### Shared jobs were confused with locally available files

Jobs are account-shared but an ordinary selected File can exist only in one tab.
A draining queue now executes only jobs explicitly admitted there by Generate
or Resume. It cannot discover another tab's queued File job and fail it using
the wrong source resolver. Atomic job admission and durable owner checks remain.

Startup recovery no longer treats queued work as abandoned. It pauses eligible
running jobs only. Queued work without a local admission has an explicit **Run
here** action. Opening/reloading the workspace does not start those jobs.

### Audio failures could cause unnecessary model installation

Model preparation previously preceded source lookup and decoding. The first
valid nonzero PCM window now triggers preparation. A missing source, malformed
PCM, or an exactly all-zero first window does not start a model download.
All-zero is a literal digital-silence check, not a new speech detector or quiet
speech threshold. Publication-only retries need neither decoding nor inference.

The job and workspace cancellation signals now cover source lookup, full content
verification, lazy decoder import, and decoder lifetime together. A late result
from an abandoned operation cannot start a new decoder or model request.

### Model-cache cancellation could wait forever on storage

Cache opening, quota checks, cached-file reading/hashing, streamed reads/writes,
and final close now allow a cancelled caller to stop waiting for a dependency
that does not cooperate. Late failures remain observed. A writer acquired after
cancellation is explicitly aborted instead of leaking its staging stream.
Free-space guidance now derives from the pinned byte size plus the existing
32 MiB reserve (682 MB), instead of asking for too little space.
Cleanup failure cannot replace the original error; progress cannot update after
a cancelled write. Falsy abort reasons, including zero, remain failures rather
than being mistaken for a successful Worker response.

Cancellation is not rollback. Only verified bytes reach close; if Cancel races
an already completing close, a valid cache can remain, but the cancelled call
cannot proceed into inference. Cancellation does not forcibly interrupt a
third-party promise, provider request, browser filesystem operation, or garbage
collection. Aborting the owning stream is still requested where supported.

### Playback writes and Close were not bounded/coordinated

Both portable playback and device-only checkpoint writers retain one active
write and at most one latest pending snapshot, rather than one promise/write
for every intermediate position. Tests stall the first write and submit 2,000
updates; the actual first and final values are the only writes. Failure stops
subsequent saves so a competing stored edit is not blindly overwritten.

Workspace disposal removes the outgoing account's UI and pauses sound immediately.
Player-save and model/job drains begin independently. A failed drain cannot skip
the other drain or owned-store cleanup; errors are reported afterward. Slow
storage can still delay completion: this is not a bounded storage-shutdown claim.
The model lock is held through normal runtime retirement, not through an assumed
synchronous effect of Worker.terminate().

Caption text and each translation declare independent automatic direction in
addition to their language. The existing line-led interface, Reader typography,
track choices, line following/replay, and downloadable subtitles are retained.

## Verification executed on the refined source

Local tools are Node 22.16.0, TypeScript 5.8.3, Python 3.11 and system Chromium
149. This is not the repository's installed Node 24 / TypeScript 6 / pnpm toolchain.

| Local check | Result | Boundary |
| --- | --- | --- |
| Strict media TypeScript and core tests | 406 passed; no failures or skips | Includes eight new closeout/abort tests; explicit store/model/timer doubles where documented |
| Python tooling/cache/runtime-publication | 65 passed | Includes nine compiled, sanitizer-instrumented C++ model-transfer helper cases |
| Chromium production player controller | 51 passed | Four new early-generation-outcome cases; generated MP4; selected boundaries doubled |
| Chromium production workspace controller | 21 passed | Model, provider and persistence boundaries explicitly doubled |
| Actual Chromium Web Audio | 8 passed | Real native resampling/downmix/rendering |
| Existing menu checks | 6 passed | Keyboard/pinch viewport inputs simulated |
| Existing transcript interactions | 9 passed | Real DOM and generated media |
| Patch application and safety | 15 passed | Both routes produce identical outputs; bad preimages, tampering, staged edits and symlinks rejected |
| Actual prebuilt single-threaded MOSS WASM | 6 passed | Exported ABI/identity, heap allocation/access, cancellation-word bookkeeping, invalid tiny MEMFS model; no weights |

The focused before/after evidence contains 12 new cases: eight core and four
player-controller cases. Seven failed on the exact previous bundle (five core,
two browser); all 12 pass after repair. Do not add these to the suite totals a
second time. The earlier bundle's 29-case/19-failure reproduction is historical
and is retained separately, not presented as freshly executed in this round.

Desktop and phone player screenshots were inspected. They retain the current
line-led transcript interface. These are controller-harness screenshots, not a
fresh full-Svelte build. The local fixture is generated English speech; Japanese
and Arabic UI strings are authored text, not local Japanese ASR evidence.

The new optional `tests/media/runtime-browser.py` loads verified prebuilt single
CPU WASM in an in-memory Chromium page. It validates the complete artifact files
and all six port-input hashes, then calls the production runtime-contract checks
and real exported functions. It is not a Worker, WORKERFS, pthread-pool, URL/CSP,
recognition, peak-model-memory or real-model cancellation test. The separate
existing worker-disposal gate still uses a runtime/host/download double.

## Recovered upstream qualification: real MOSS recognition exists

The prior handoff's local-inference limitation was correct, but it omitted an
existing successful remote run for the exact PR base. No new remote job was
started for this review. The recovered run is **Media CPU qualification
36212615470**, completed 2026-09-26, at
`9b15254df41943d9cfb497afb47f4b2293739959`:

https://github.com/ManabiIO/manabi-reader-web/actions/runs/36212615470

The job builds both CPU runtimes, runs real generated English and Japanese
speech through MOSS, and records these results:

| Language | CPU variant | Audio seconds | Inference seconds | Real-time factor | Preparation seconds | Normalized character error |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| English | Single | 10.76375 | 421.08 | 39.12 | 19.39 | 0% |
| English | Threaded | 10.76375 | 216.86 | 20.15 | 19.15 | 0% |
| Japanese | Single | 11.105 | 420.37 | 37.85 | 19.34 | 2.56% |
| Japanese | Threaded | 11.105 | 216.83 | 19.53 | 22.63 | 2.56% |

**The performance result is a concern, not a production-readiness pass.** On
that CI host the model took about 3.6 minutes threaded or seven minutes single
for roughly 11 seconds of audio, plus preparation. A passing recognition smoke
test is not evidence of usable interactive or long-video throughput. These
numbers are observations from that host, not an extrapolated phone benchmark.

The Japanese character difference is the fixture's `歩いて行きます` versus
recognized `歩いていきます`. This small synthetic-voice sample does not establish
natural-speech quality, multi-speaker diarization, timestamp accuracy or
cross-window seam quality. No such claim is made.

That same base run also has successful dependency-installed application
checks/build and 14 native-browser/IndexedDB cases, including stale-save
compare-and-swap and account partitions. These results qualify the **upstream
base**, not either unpushed local delta, and are not new multi-tab lifecycle
qualification. Remote job/runtime evidence is kept in its own bundle directory.

Artifact provenance (downloaded ZIP bytes matched the reported SHA-256):

- Runtime artifact 10896901625, `moss-cpu-runtime-review`:
  `c0bb2a078cede2f3e5f2283a57f4a82d5e876b6666d1538c86cff0713ba9bc64`.
- Evidence artifact 10896522789, `media-real-cpu-evidence`:
  `4d8e5e2bcba74e086db82bdb1f822f516e3f7511812355787dd5831d21232c47`.

The recovered runtime's six C++/build/helper inputs match the unchanged reviewed
source. Reusing these compiled bytes made the six local ABI checks possible;
it does not make the new queue/player lifecycle code real-model tested.

## Outstanding qualification and source limitations

A local native browser/IndexedDB run was attempted but stopped at navigation with
`ERR_BLOCKED_BY_ADMINISTRATOR`. No cases in that run executed. Native origin-wide
Web Locks/multi-tab/suspension remain unqualified here. Physical Safari/iOS and
paired Django/account/cloud composition were not exercised.

There was no local model-weight download, local real recognition, fresh runtime
build, expensive CI dispatch, push or deployment. The compiler entry point
`emcmake` remains unavailable locally; prebuilt runtime assets are now available
for the limited ABI checks above. Full dependency-installed formatter/lint,
Svelte/Mediabunny checks/build and CI must run on the resulting delta. No local
recognition accuracy, model-memory, physical reclamation or real-model
cancellation-latency result is claimed.

The checkout is a content-verified partial source reconstruction with synthetic
Git ancestry, not an authenticated full clone. The source capture came from
upstream appearance artifact 10874465644; only captured files matching the
recorded PR-base Git blob identities were admitted. Missing relevant inputs were
restored only from matching blobs, and each old-delta output was hash-checked.
Unrelated CI-merge differences were excluded. The bundle records the expected
full parent tree and exact before/after identities for all changed paths. Neither
synthetic local commit is substituted for the real upstream commit.

## Primary references

- AbortController's exact abort reason:
  https://dom.spec.whatwg.org/#dom-abortcontroller-abort
- Web Locks callback lifetime and release:
  https://www.w3.org/TR/web-locks/
- Emscripten pthreads and browser isolation:
  https://emscripten.org/docs/porting/pthreads.html
- Browser writable file staging/close semantics:
  https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable

The lifecycle tests, rather than assumptions about immediate browser resource
reclamation, define the ordering guarantees described above.
