# Source read cancellation review — 2026-09-28

## Reproduced defect and repair

A controller could be cancelled while several lower-level callers still awaited
source I/O directly. A stalled local Blob read, complete content-identity
read, device-sample read or decoder range-stream pull could therefore remain
unsettled after its signal had been cancelled.

Use the existing `abortable` helper at those four await boundaries. Keep the
existing range limits, source-authority checks, short-read rejection, hash input,
progress boundaries and byte copying. Propagate the signal to sources that support
it; also detach the caller when a source does not cooperate. Late success or
failure remains observed and cannot emit progress, enqueue bytes or start another
read after cancellation.

This is cancellation of the caller's wait, not physical cancellation of disk I/O
or proof of browser memory reclamation. Blob.arrayBuffer() has no AbortSignal
parameter; the app cannot promise when an in-flight browser operation ends.
Primary references: <https://w3c.github.io/FileAPI/#dom-blob-arraybuffer> and
<https://dom.spec.whatwg.org/#abortsignal-abort-algorithms>.

## Evidence and unchanged inputs

The review used source archive artifact 10989656754 from run 36463236931. Its ZIP
SHA-256 is `3f7afd09c33e91aa3f780f45e6809cdb6b6c0b82a5802dae11179e2aa30800aa`.
Tested merge `84b6a556e4a205d5448700a34f39887d3a531674` has tree
`c8fd9615d7f1f9e33b28e262ac38ca25353423a0`, matching published `4e45a940`.
The newer queue/test changes through `eef99430` were incorporated without
replacing the prior import, source-revocation, switching or caption-handoff work.
The concurrent running-job admission guard required the reconciliation below.

`source-read-cancellation.test.mjs` executes production source functions with
explicitly held I/O promises. Its 32 cancellation cases cover four entry points,
late success/failure and exact null/0/false/AbortError reasons. All 32 fail before
the repair and pass afterward. Two controls also pass before and after: a
pre-cancelled read starts no I/O; normal local bytes, full SHA-256, sampled identity
and streamed output remain unchanged. The assertions check detachment while the
physical read is still held, not after releasing it. Node observes late rejected
promises; no unhandled failures are hidden or ignored by the test.

The combined local strict TypeScript/media run has 796 passes, zero failures or
skips with English container fixtures enabled. The Python/native-helper suite has
96 passes. The final production-controller runs also pass player79, workspace44
and transition10 using generated MP4 playback with explicit storage/decoder/model
doubles. These are not a full installed Svelte/lint/build or real-model result.
The retained toolchain is Node 22.16.0, TypeScript 5.8.3 and Prettier core 3.6.2.
The changed-file formatting check does not substitute for repository plugins/CI.
A blank line in the newer lock-cancel test is formatted without changing its
assertions. No model, runtime binary, schema, dependency or repair policy changes.

## Running request intent without duplicate admission

Concurrent `eef99430` correctly stops a deduplicated running job from receiving
another runnable admission. However, simply returning before recording a newer
Generate request caused three existing tests to fail: the two failed-pause-write
newer-intent controls and the stale switch scan superseded by Generate.

Retain the no-duplicate-admission guard. When the observed job belongs to this
queue's live, uncancelled runner and the initiating view remains current, replace
only that runner's intent token. Do not add a pending admission, kick the drain,
change durable ownership, revive a cancelled runner or claim another tab's job.
Pause writes and their failure cleanup capture and compare this token too, so an
older operation cannot cancel the refreshed request.

All three unchanged regressions pass again. Three additional tests explicitly
check one runner/one inference/no pending admission, a stale observation that
cannot refresh intent, and another queue observing the same job without acquiring
execution or switch authority. The final 796 total includes these tests and the
34 source-read cases. Historical before/after evidence is not represented as a
fresh combined differential for every earlier repair.

## Native-handle failure: narrowed, not fixed

Run 36463236931 evidence artifact 10988528136 has verified SHA-256
`c561681044ec1de7240cf4976cfd34df070a93fed799c6fca92121e529f0a0ec`.
On its recorded source, all 21 native identity/switch cases and all 18 ordinary
native import cases passed. The player79, workspace44, transition10, WebAudio8,
menu6 and transcript9 suites passed too. The earlier buffering repair therefore
now has remote evidence on that checkpoint.

The nineteenth import scenario still disconnects Chromium. Phase diagnostics
show successful OPFS creation/write/close, getFile and initial native-handle
registration, followed by `register-transient-file`; no database-close phase
appears. The available evidence narrows the crash to that reimport but does not
establish whether native handle deserialization, reserialization, application
code or the browser is responsible. A nearby public browser report is not proof
of this crash's cause.

Additional synchronous phase logging now surrounds the existing alias update:
admission, read callback, proposed write/no-op and committed completion. It adds no
await to the transaction callback and does not remove or replace actual handle
operations. The original native assertion and failure gate remain enabled. This
instrumentation and the unrelated read-cancellation repair do not clear the crash.

The selected new head still needs its full CI/native matrix and that native-handle
failure diagnosed and repaired. Natural Japanese/long-video quality, physical
Safari/iOS, representative-device resources, frozen-owner recovery and live
account/provider composition remain separate gates. No activation or merge is
included in this review.
