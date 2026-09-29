# MOSS preview lifetime review

Reviewed the progressive stack at `75c6a4ec3c7c81cf2b98846f989ebe0eb69c8d35`,
then reapplied the fixes to `e5d5355f39b87ae6bb9193790d979d2feb66b18f`
and preserved the subsequent packaged-runtime parent
`fa97ee1839c763569ae61a2d4c849648797c2baf`. The callback runtime remains
`manabi-web-v7`. Mudler Q5_0 weights, model digest, window policies and native
runtime code are unchanged by this follow-up.

## Reproduced and fixed

1. A synchronous client preview observer exception retired a healthy worker and
   rejected valid recognition. Protocol validation is now separate from optional
   rendering. A failed observer is disabled for that inference, while every later
   worker prefix and the final result are still checked.
2. The progressive orchestrator relied on the concrete client to contain preview
   parser/renderer exceptions. Custom engines could let those exceptions abort
   recognition. A shared per-inference wrapper now contains this optional work
   and closes its callback on success, failure or cancellation.
3. Legacy version-1 window callbacks outlived their inference. A retained callback
   could inject stale progress into the next window or throw after cancellation.
   The legacy queue now uses the same wrapper without changing its saved window
   interpretation, ownership cuts or provenance.

Cancellation and authoritative inference/final-parse errors still fail normally.
The wrapper does not export provisional text, advance checkpoints, swallow storage
errors or treat a missing final result as success. It preserves undefined callbacks
for repair inference, where preview is intentionally disabled.

## Verification

- 10 regression failures reproduced on the corresponding pre-fix sources:
  7 client/progressive cases and 3 actual legacy queue/store cases.
- Strict TypeScript 5.8.3 compilation of the changed modules and their media
  dependency closure passed locally.
- 141 targeted Node tests passed, with no failures or skips, on the refreshed v7
  composition. This includes progressive seams/checkpoints, client protocol,
  legacy preview lifetimes, recovery admission, preparation cancellation, runtime
  ownership and model cleanup.

The local checkout is a hash-verified source subset, not a full repository build.
The repository-pinned toolchain, Svelte build and browser workflows must still
validate the published head. Scripted recognition and transaction doubles are not
real-MOSS, native IndexedDB or representative-device performance evidence.

## Unchanged release gates

The progressive stack now contains packaged v7 single/threaded runtimes. Keep the PR draft
until their exact-head real-model/application qualification, natural Japanese seam
evaluation, device time-to-first-caption and throughput/memory measurements,
physical Safari/iOS and multi-tab lifecycle tests, and production serving checks
are verified. Oversized retained seam repairs remain an
explicit non-retryable policy limitation, not a silently invented transcript.
