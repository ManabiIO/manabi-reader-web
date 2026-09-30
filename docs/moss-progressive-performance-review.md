# Progressive transcription overhead review

Base: `11f1978cf25681d82fde7aff3452f257ac3f4bac` (tree
`489f8f1d822de565b1c661bc228985938519de2d`). The model, its digest, v7 native
ABI, packaged WASM and all saved window/repair policies are unchanged.

## Profile and scope

The first local profile found repeated whole-caption reconciliation and hashing
inside playback buffering updates. Separately, synchronous SHA-256 of the largest
bounded decoded input took about 41 ms in this Node environment. These are main
thread/application costs, not measurements of MOSS's tensor computations.

The upstream port describes autoregressive decoding as memory-bandwidth-sensitive;
Emscripten also warns that native SIMD and Wasm SIMD do not have identical costs.
This review therefore does not assert that more threads, shorter model inputs or
another compiler are automatic wins. Those need controlled real-model A/B tests.

## Changes

- A player-owned `sparsePlaybackSnapshot` computes the visible-caption digest,
  numeric readiness/predecessor ranges and timing totals once per progress
  notification. Playback ticks no longer reconcile and hash the transcript.
- Snapshot lifetimes follow explicit notifications, NOT object identity: notifying
  a mutated Job again recomputes the snapshot. Draft-page digests refresh on
  `setDrafts`; missing/stale pages still cannot release a caption wait. Compact
  completion and disposal release the snapshot. No global cache is introduced.
- Shared missing-window query logic and the existing projection preserve old
  semantics, including first-component precedence for conflicting overlaps.
  Snapshot data is UI-only and is never used as authority for persisted acceptance.
- Generation and recovered audio-proof verification use bounded native SHA-256
  when Web Crypto is available. The input is limited to 60 seconds / 3,840,000
  bytes; this is not whole-video or whole-model materialization. Proof bytes and
  digest serialization remain identical. Nonfinite/shared/detached inputs fail.
- The digest completes before PCM is transferred to MOSS. Cancellation fences a
  late result; native failures propagate rather than becoming missing evidence or
  an unexpected synchronous retry. Environments without Web Crypto retain the
  synchronous compatible fallback. No new native crypto cancellation API is claimed.

## Local benchmark

`tools/media/benchmark-progressive.mjs` compares the separately compiled base and
current code, interleaving 15 timed rounds after warmup and checking outputs. The
caption workload includes one notification/snapshot plus 20 subsequent playback
queries, with a visible draft. Setup and draft-digest costs are included.

| Synthetic workload | Base median | Optimized median |
| --- | ---: | ---: |
| 30-minute timeline, 598 visible cues | 134.79 ms | 5.27 ms |
| Two-hour timeline, 2,392 visible cues | 583.96 ms | 19.48 ms |
| 30-second decoded-input proof | 19.53 ms | 3.15 ms |
| 60-second decoded-input proof | 40.43 ms | 5.76 ms |

The native proof call's synchronous entry cost was about 1.26 / 2.10 ms for
30 / 60 seconds, respectively; total time includes waiting for the digest.
These Node 22.16.0 CPU microbenchmarks are not MOSS inference speedups, device-wide
latency measurements or peak-memory measurements. They do not establish realtime
transcription. Raw rounds and machine identity are retained in the review bundle.
The native Chromium runner independently measures current snapshots versus the
retained uncached reference queries and synchronous proof implementation, without
using timing thresholds to decide correctness.

## Correctness evidence

Local fixture-enabled strict media suite: 677 passed, zero failures/skips. Python
and native-helper tooling: 80 passed. Existing actual Chromium player controller:
79 cases passed. Three new player snapshot scenarios passed in the in-memory
controller harness. New unit cases cover both saved sparse policies, 40 deterministic
arrival patterns per policy, long boundary cues, overlapping repair conflicts,
fractional final samples, notification mutation, offset byte views and proof bounds.
Three shared queue/store cases exercise native proof success, failure and Cancel,
including database reopen and proof-before-PCM-transfer ordering.

Local native-origin navigation was administrator-blocked; the new native browser
runner must pass in CI before native IndexedDB results are claimed. It also records
browser benchmark samples. Scripted ASR remains separate from actual model evidence.
The existing real-v7 qualification still applies only to its exact recorded inputs
and artifacts; this review does not rerun or broaden natural-Japanese qualification.

## Unchanged release boundary

No lock stealing, frozen-tab takeover, model change or relaxed seam acceptance is
introduced. Resource-safe frozen-owner recovery, genuine speech disagreement and
exhausted repair budgets, continuous Japanese/long-video quality, controlled physical
device throughput/memory, Safari/iOS and production/provider qualification remain
separate gates. Keep the progressive rollout draft pending those gates.

## Primary research

- https://www.w3.org/TR/webcrypto/#SubtleCrypto-method-digest
- https://web.dev/articles/long-tasks-devtools
- https://web.dev/articles/off-main-thread
- https://emscripten.org/docs/optimizing/Optimizing-Code.html
- https://emscripten.org/docs/porting/simd.html
- https://github.com/localai-org/moss-transcribe.cpp
