# Draft stacked work: Qwen3 word alignment for video captions

This is intentionally a **partial stacked implementation** on top of the video/MOSS work. MOSS line captions remain the playback authority and become usable immediately. Qwen alignment is optional asynchronous enrichment and must never gate playback.

## Reference implementation reviewed

JapaneseVids already uses Qwen3 forced alignment and contains two useful optimizations:

1. one warm aligner worker instead of loading the model for every line;
2. speech-island media extraction that merges nearby known speech intervals and skips long silent gaps.

Its current forced-alignment worker still calls the aligner per cue. The Reader plan below adds a stricter packed-audio mapping layer so a future browser runtime can batch/pack speech while retaining an exact map back to movie time. Do not claim this new packed-inference behavior has been qualified merely because the JapaneseVids extraction planner exists.

Relevant references:

- `ManabiIO/japanesevids-cli` PRs #34–#36
- `server/lib/alignment-speech-chunks.mjs`
- `scripts/qwen3-force-align-vtt.py`
- `ManabiIO/japanesevids-template/src/karaoke-telop-overlay.js`
- `Qwen/Qwen3-ForcedAligner-0.6B`

## Landed in this draft

- versioned local word-alignment job/result schema;
- exact transcript/media/audio/model identity fencing;
- sparse speech-island planner based on MOSS cue envelopes;
- packed-time -> media-time source mappings;
- fail-closed rejection when an aligned word crosses a synthetic splice;
- playhead-aware unfinished-batch prioritization;
- smooth within-word karaoke progress primitive;
- device-local durable checkpoint wrapper using the existing media IndexedDB `local` store;
- focused core tests.

The local store is deliberate for this handoff: the backend personal-feed schema has not yet been extended for word-alignment records, so these records must not be uploaded until a companion closed-schema change lands.

## Intended product lifecycle

1. User explicitly generates a MOSS transcript.
2. As soon as the line transcript publishes, playback and ordinary line captions are available.
3. Alignment begins independently. UI shows progress but never blocks playback.
4. Scheduler prioritizes a bounded region around the current playhead, then already-passed gaps, then distant future batches. Seeking changes pending priority only.
5. Completed alignment batches publish durably. Reload resumes unfinished batches from checkpoints.
6. When timing for a visible line arrives, the player may upgrade that line to karaoke immediately. Missing/rejected timing remains ordinary static text.
7. Karaoke uses the video media clock. Progress inside a word is visual interpolation between its measured word start/end; it is **not** character-level acoustic timing.

## Recommended stored authority

Do not mutate SRT or manufacture word timestamps inside the canonical `Cue` objects. Keep line transcript and word alignment separate:

- line track: authored/generated immutable cue text + line times;
- alignment job/result: exact `mediaKey`, `trackId`, transcript digest, audio-track identity, aligner/model revision, per-batch timing results.

This avoids making an SRT export the database and allows a newer aligner to coexist with the original line transcript. A future VTT export may include `<timestamp>` karaoke-style intra-cue timestamps, but export is derived data.

## Next Codex-worker tasks

### 1. Real browser Qwen runtime

The official aligner is ~0.6B and the published source model is large. There are third-party ONNX exports claiming Transformers.js v4 support, including q4 artifacts, but these are **not yet trusted runtime evidence**. Choose/pin an artifact only after reproducing its output against the official aligner on Japanese fixtures and recording immutable hashes/licensing.

Preferred shape:

- dedicated alignment Worker, separate from the MOSS Worker;
- one warm aligner while alignment work is active;
- model download starts only after MOSS line transcript is available and enrichment begins;
- cancellable, content-addressed OPFS model cache;
- Worker lifecycle obeys the same cross-tab memory discipline as MOSS.

### 2. Packed inference

`word-alignment.ts` currently plans and maps packed audio but does not invoke a model. The runtime must either:

- support true batched independent samples, or
- concatenate speech islands with exact sample-boundary mappings and an inference contract known not to align text across artificial cuts.

If the chosen model/runtime cannot guarantee safe multi-cue packed inference, keep the media-extraction/warm-model optimization and call alignment per cue. Correctness beats an unproven batch speedup.

### 3. Player integration

When a line has complete authoritative word timings:

- render each word/span separately;
- retain the existing transcript-first layout and shared Reader typography;
- use a restrained active fill derived from the existing text color (Apple Music/Spotify-like), not the heavier Blackbelt metallic/red/yellow styling;
- moving-video overlay can use a brighter fill plus existing outline/background for contrast;
- do not animate untranslated secondary text unless it has its own authoritative alignment.

The Blackbelt renderer is a timing/geometry reference, especially its media-clock-driven wipe. Do not port its heavy Three.js visual stack into Reader.

### 4. Durable sync

Add closed backend kinds for alignment manifest/pages, with strict size/count/source/model fences. Then add them to the existing local-first account sync. A changed transcript digest or audio-track identity must invalidate reuse without deleting the old immutable result.

### 5. Qualification

Before calling this complete:

- compare browser aligner output with official Qwen on reviewed Japanese audio;
- test speech-island packing on repeated phrases and cut boundaries;
- measure model download, startup, steady-state memory and RTF;
- verify MOSS transcript remains usable while alignment is slow/failing;
- reload midway through alignment and resume without redoing committed batches;
- seek far ahead and verify scheduler priority changes without discarding prior work;
- physical Safari/iOS memory and background/suspension behavior;
- full app build and native IndexedDB/cross-tab tests.

## Durable checkpoint review (2026-09-26)

The job validator now requires completed batch IDs to match the durable result
IDs exactly, so a checkpoint cannot declare work complete without saved timing.
Updates cannot change the job ID under an existing storage key. Checkpoints reject
paused/failed jobs, and a completed job accepts only identical existing output;
a late new or conflicting result cannot be silently acknowledged. Completion also
rejects duplicate expected batch IDs. The added transaction-double regression
checks these admission rules; it does not qualify cross-tab worker ownership.

The browser runtime remains an actual dependency, not a missing UI toggle.
The inspected community export
`valoomba/Qwen3-ForcedAligner-0.6B-ONNX` at
`261c9ed100c1b18a4a1fbc488e05625dc9a4ae5c` publishes FP32 synthetic-logit
comparison metadata and q4 smoke comparisons on English strings. Its q4 maximum
absolute logit difference is 7.7992; this number is not a word-timing error metric
or proof of a defective model. No reviewed Japanese audio/timestamp comparison
is supplied by that metadata. It is therefore a candidate for qualification,
not an accepted artifact for automatically downloading and timing user videos.

## Post-Codex review: frozen inputs and revision-checked checkpoints

Reviewed parent: `ce7e19a1aebfee1674931a9e9e322204cefb9922` (PR #52).
The existing packed-duration correction, build integration, and complete-result
checks are retained. The unpublished local alignment contract is now version 2
and the planner revision is `qwen3-packed-v2`. No production caller currently
imports these modules. This is not a migration of shipped captions or MOSS jobs;
old experimental version-1 alignment records are rejected, not silently upgraded
or erased. Experimental callers must explicitly regenerate a version-2 plan.

### Corrected planning boundaries

- Validate original cue IDs/text/times before padding. Padding cannot make a
  reversed or negative interval valid. Bound count and cumulative UTF-8 payload.
- Accumulate padded contexts using integer 16 kHz sample offsets and clip to
  `mediaDuration` when supplied. The future decoder must supply its actual
  canonical PCM duration and honor these exact floor/ceil sample boundaries.
- Use content-derived batch IDs, including all cue identities, text, speaker,
  ranges and planning settings. First/last delimiter strings were ambiguous and
  survived text edits. Preserve input order for tied cue times.
- Keep the existing conservative 180-second / 512-cue hard bounds, including
  duplicated overlapping padded context. The previous configurable 600-second
  ceiling exceeded the official model's documented five-minute input limit.
- Validate the entire packed map before mapping words: contiguous positive
  sample-aligned packed intervals, equal source/packed lengths, unique cue IDs,
  bounded ranges and no synthetic-splice crossing, even by a sub-microsecond.

The official model card is https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B.
A maximum is not a tested browser-performance guarantee. Public seconds represent
sample-grid endpoints; returned model word times are not rounded into fabricated
sample-level acoustic precision.

### Version-2 store API

New jobs must be queued, revision zero, empty, and include the nonempty ordered
`plannedBatchIds` generated for their immutable transcript/model inputs.
`modelRevision` must be an immutable lowercase 40-character Hub commit, not main.
`put(job)` is create-only; an equivalent normalized existing snapshot is a no-op,
but it cannot reset history or rebind the transcript/audio/model/plan.

```ts
let current = await store.get(id);
if (!current) throw new Error('Missing alignment job');
current = await store.update(id, current.revision, (job) => ({
  ...job,
  status: 'running'
}));
const approval = current.revision;
// The future runtime uses the exact immutable plan represented by current.
const result = await alignOnePlannedBatch(current);
current = await store.checkpoint(id, result, approval);
// Completion checks the durable plan; callers cannot supply a convenient subset.
current = await store.complete(id, current.revision);
```

Capture the approval **before** decoding/inference. Never reread a newer revision
solely to approve old output. A competing edit, pause/resume, or checkpoint revokes
that approval in the same writable transaction. Process checkpoint writes
serially. If a response is uncertain, inspect the durable result and compare it;
an identical result with current approval is a no-op. A conflicting result cannot
replace prior output, and completed jobs are immutable.

`update` is state-only: source identity, plan, results and revision cannot be
rewritten through it. `checkpoint` snapshots input before waiting for storage and
requires a planned batch. `complete` requires every stored planned ID and refuses
paused/failed/queued jobs. Bounds cover batch count, word count and JSON size;
empty word output cannot certify a batch. Unalignable speech needs a future
explicit rejected-result representation, not manufactured or empty successful
word timing.

The store uses the existing production MediaStore read/write transaction. See
https://www.w3.org/TR/IndexedDB/#transaction-scheduling for overlapping-write
serialization. This is a local compare-and-write contract, not worker leasing,
network cancellation, filesystem durability, or native multi-tab qualification.

### Important remaining implementation boundaries

This planner still packs separate padded per-cue contexts and splits distant
islands into separate plans. It does not yet create PCM, merge overlapping
context, submit a true batched inference request, or implement adaptive
throughput-based buffering. The static playhead priority is unchanged.

Results still need authoritative cue/token/character-span binding, exact text
coverage, packed-versus-unpacked Japanese accuracy tests, and real model identity
verification before renderer use. JSON field validation and immutable inputs are
not proof that a model produced correct timings. The required pipeline remains:
publish usable MOSS lines first, enrich asynchronously, publish completed aligned
regions independently, and retain static lines for unavailable/rejected timing.
No new MOSS/player/background-service behavior is enabled by this review.

### Review evidence

The current local media run compiles the TypeScript and passes **399/399** tests,
including **39** alignment cases (30 new and nine retained/adapted), with generated
English container fixtures enabled and no skips. Six unchanged-API planner/map
regressions fail against the exact parent module and pass after repair. Store
cases execute the production MediaStore callbacks through the existing explicit
transaction double, including separate connections, competing writes, pause /
restart, rollback and input snapshots. They are not native IndexedDB or ASR tests.

The parent CI reports successful normal CI, static build, video, Books, recovery
and portability workflows. Its Appearance run `36213008055` failed in WebKit's
`test_collection_management_reflows_at_double_text_size`: heading height 128 px
versus allowed 65 px. That inherited collection-layout failure is outside these
alignment files and is not declared flaky or fixed here. The new source still
requires the normal installed-toolchain lint, Svelte, build and CI gates; local
core compilation is not a substitute for those checks.
