# Connected-media cancellation review

Base: `588f586a811badb3ae615038c5229e24e3fa2557`.

The source-lifetime guards on the prior head correctly rejected cached media after
revocation, but two operations could still stay attached indefinitely when their
underlying provider ignored cancellation: a cloud reconnect/info request and video
sync's feed/mutation request. In addition, changing the authenticated connection
did not actively pause an already running bulk (version-2) transcription or evict
its cached cloud source.

This follow-up makes cancellation ownership explicit without changing model,
window, repair or publication policy:

- `cloudRequest` and both network awaits in `syncMedia` use the existing
  `abortable` boundary. An AbortSignal detaches the caller promptly while late
  resolution/rejection remains observed and cannot advance storage.
- Cloud alias reconnection and full byte verification run inside the current
  connection's `cloudAbort` scope. Replacing/signing out the connection aborts a
  stalled request even though `SyncTransport.request` has no signal parameter.
- A connection change evicts cached cloud sources, disposes the active cloud
  player, and pauses all jobs locally admitted for those sources. The new generic
  queue pause path includes bulk progressive jobs; the existing video-switch API
  remains sparse-only. Other tabs' ownership is untouched.
- Local-file playback and jobs are not revoked by an account connection change.

Focused regressions cover stalled cloud info, stalled sync feed and mutation,
late transport completion after abort, active version-2 inference on connection
revocation, cloud-source eviction, and a pending reconnect that never cooperates
with cancellation. The pre-existing source-lifetime, queue ownership and account
scope checks remain authoritative.

This does not implement frozen-page model takeover, live provider authentication,
or physical Safari/iOS qualification.


## Successor-owner fence

A delayed media revocation previously scanned durable jobs after an asynchronous
storage read and then consulted the queue's *current* admission/active owner. A
new Resume using the same durable job ID could therefore be mistaken for the
owner captured by the old source lifetime.

Pause now snapshots both the admission-token object and active-owner object
before storage yields. It deletes/aborts only if those exact authorities are
still current. Two regressions hold the source-revocation scan while replacing a
queued admission or replacing a failed active owner; releasing the stale scan
must not remove or abort either successor.
