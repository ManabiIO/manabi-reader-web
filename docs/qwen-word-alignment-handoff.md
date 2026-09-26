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
