# Sparse transcription: coverage and durable recovery review

Reviewed the playback-first stack through `9cdc1510e24e54e4c5223445f6a9297471d3c156`,
retaining the concurrent early-repair, accepted-cue, and one-sided-halo safeguards.
The runtime remains `manabi-web-v7`; no C++/WASM, model weights, quantization,
source pins, or saved audio-window policy change in this follow-up.

## Reconciliation and readiness

Display, caption lead, pending repair, and final publication now derive from the
same reconciled components. A pair repair is one two-core hypothesis; its
superseded raw windows no longer decide the repair's outer boundaries. Matching
uses the actual overlapping cue extent rather than truncating it to 16 cues.
The existing conservative text/timing matcher and its workload bounds remain.

A successfully joined internal boundary exposes whole cues, including cues that
extend beyond the nominal two-second margin. An unresolved outer cue remains
whole and hidden; caption-ready time stops at its actual start (or begins after
its end), not at a nominal boundary that would play speech without its caption.
A long held leading cue also causes the missing predecessor to be prioritized.
Out-of-order window arrivals do not discard previously accepted interior cues.

The sparse PCM adapter enforces integer-sample input extents. It trims a decoder's
single extra rounding sample before inference, rejects missing samples rather
than inventing silence, and keeps ordinary inputs within 480000 samples. Duration
is captured before the worker transfers the buffer. A fractional final sample is
accepted for cue display without extending the reported lead past media duration.

## Recovery and compatibility

Seek priority is saved from the latest operation state at checkpoint time rather
than overwritten with the old stored target. Paused/failed progress consistently
uses covered seconds. A repair-only resume records the runtime actually used,
even when all ordinary windows were completed under an older compatible port.
Blocked repaired boundaries are detected before processing unrelated video, and
are not misleadingly advertised as identically resumable.

The raw saved hypotheses remain authoritative. Earlier derived cue caches are
upgraded only when every cue exactly matches a known historical projection or
unpublished assembly, including identity, text, timing, and speaker. Arbitrary
edited caches are rejected. Validation is non-mutating and the next checkpoint
persists the derived upgrade atomically. An old unpublished finalization that
incorrectly accepted a one-sided seam returns to repair with its hypotheses kept;
completed portable subtitle tracks are not rewritten. Version-1/2 window policies
are unchanged.

## Verification

- Fixture-enabled media TypeScript/Node suite: **545 passed, 0 failed, 0 skipped**.
- **12 new regression cases fail against the current pre-fix source** and pass
  with the refinement. Additional tests cover exact-cache migration, invalid
  caches, publication retries, and 40 deterministic window-arrival orders.
- Python/native-helper suite: **74 passed**. Native decoder helpers use scripted
  output, not the real model.
- Chromium production player controller: **76 passed**; workspace controller:
  **24 passed**. The workspace test now waits for actual media metadata separately
  from early subtitle parsing; those are independent asynchronous operations.
- The pinned Prettier 3.6.2 formats the changed text sources. Local TypeScript is
  5.8.3; repository CI remains responsible for its pinned full toolchain/build.

A new five-case native IndexedDB/Chromium runner is wired into the media workflow
for cache reopening, failed/committed migration transactions, actual transcript
DOM, and caption buffering. Local browser access to the localhost harness was
blocked by the environment; no local pass is claimed for that runner. Exact-head
CI results are recorded separately on the PR. Local controller tests use explicit
storage/recognition doubles, not the Svelte shell or native IndexedDB.

## Research and remaining release gates

[OpenMOSS's experimental realtime PR](https://github.com/OpenMOSS/MOSS-Transcribe-Diarize/pull/58)
uses repeated inference and stitching, not a model-native streaming guarantee.
[Whisper-Streaming](https://github.com/ufal/whisper_streaming) distinguishes agreed
and provisional output and evaluates segment-based trimming. These support the
separation of recognized audio, accepted text, and safe playback lead; neither
establishes an optimal MOSS window size or makes Whisper attention alignment
portable to this runtime.
[Emscripten's pthread documentation](https://emscripten.org/docs/porting/pthreads.html)
also distinguishes threaded builds and browser lifecycle constraints. Scripted
queue correctness is not representative device performance evidence.

Keep this PR draft. No fresh real-model quality or performance claim is made in
this follow-up. Broader natural Japanese dialogue/seam testing, physical Safari/iOS,
controlled throughput/memory measurements, suspended-tab recovery, production
serving, and live account/provider integration remain release gates. The existing
bounded policy still fails closed on unresolved overlapping/oversized repairs;
this change does not invent word timestamps or silently discard speech to finish.
