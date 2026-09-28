# Exact repair timing and shared-custody review

Base: `989de698e350081b5f75ab65784389660b3f96ce`. The diagnostic-only
`4ec3db9183c04c54e862e2c4a16bec942253d224` is retained as the parent of the
production repair follow-up. Mudler Q5_0, model digests, manabi-web-v7,
packaged WASM, native ABI and saved audio-window policies are unchanged.

## Reproduced defects

The exact-text repair path previously used only a fixed 0.35-second endpoint
allowance. It could therefore treat a short accepted reply at 2.00-2.20 seconds
and a separate same-text reply at 2.21-2.41 seconds as the same utterance. The
existing grouped fallback already required substantial temporal overlap; exact
text bypassed that safeguard.

`sameCueTiming` now shares the existing overlap/displacement rule between the
exact repair path and grouped matching. The exact path still caps displacement
at 0.35 seconds; short speech additionally scales that cap to half its duration.
Same-text output at a disjoint interval is not evidence for the accepted anchor.
A genuine overlapping anchor plus a separate repeated reply retains both cues.
This is conservative reconciliation, not a new word-alignment or accuracy claim.

Restoring accepted timestamps can also change a cue's chronological order
relative to unmatched repair speech. Exact restoration now sorts the resulting
array by start and end, as the grouped path already did. Accepted cue objects
and input hypotheses remain unchanged.

## Saved-state scope

No migration or validation relaxation is included. An initially suspected old
cache format could not be substantiated: the initial progressive implementation
`62ab6d23650784838c14cb1d5520571b3a55595c` already required half-duration overlap,
and the inspected later source snapshots retained that rule. The speculative
compatibility code and tests were discarded. Existing persisted projections,
cache validation and completed tracks are not rewritten by this follow-up.

## Verification before publication

- Fixture-enabled strict media TypeScript/Node suite: 644 passed, no failures or skips.
- Python/native-helper suite: 80 passed.
- Seven new unit cases and four additional shared queue/store cases. Seven of
  these eleven cases fail against the unmodified base; all pass after the fix.
- The existing native repair runner now contains 15 scenarios. It uses the same
  cases as Node, with actual Chromium IndexedDB and Web Locks in CI.
- Prettier 3.6.2 and diff whitespace checks passed for the changed TS/MJS sources.

The local checkout is a CI-derived source subset, not the whole application.
Local native-origin navigation was administrator-blocked; browser/application
acceptance must come from the published head's CI evidence. Recognition is
scripted. Do not infer real-model quality, throughput, peak memory or physical
device support from these tests. The PR review records the resulting CI evidence.

## Shared-custody experiment: a startup failure, not a takeover result

The earlier experiment timed out before its first acquisition. Diagnostic commit
`4ec3db91` now exposes the actual worker capabilities and startup exception. In
Chromium 153.0.8010.12 the tested SharedWorker reports `Worker: undefined` and
`navigator.locks.request: function`; constructing the nested model worker throws
`ReferenceError: Worker is not defined`. Workflow `36380195396` retains the
negative result and both peers' event traces. No model was acquired, so no freeze
or takeover success can be inferred from this probe.

The HTML standard exposes Worker in SharedWorker, but the tested implementation
cannot be assumed to implement that surface. Replacing the module with a
SharedWorker broker is therefore not a drop-in production solution. A direct
single-thread runtime or another ownership design would need separate real-runtime
qualification, including cancellation, responsiveness, browser support and any
loss of threaded performance. No such runtime change is included here.

## Release boundary

Keep PR #67 draft. The ordinary application continues to use its existing origin
lock and durable owner checks; it does not steal a lock and allocate a second
model while a frozen owner retains resources. Resource-safe frozen-tab takeover,
genuine accepted-prefix disagreement, safe input/alignment limits, broader natural
Japanese dialogue, representative-device performance/memory, physical Safari/iOS,
production serving and live-provider composition remain separate qualification
items. No merge or deployment is performed by this follow-up.

Primary references:

- https://html.spec.whatwg.org/multipage/workers.html#the-worker-interface
- https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- https://github.com/ManabiIO/manabi-reader-web/blob/62ab6d23650784838c14cb1d5520571b3a55595c/apps/web/src/lib/media/moss-progressive.ts
