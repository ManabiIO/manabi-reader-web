# Snippet reading ownership and local cleanup recovery

Follow-up to merged Snippets #73 and backend #87, reviewed against frontend
`f50d53c797fb65e981c830f6a895609734eabc3e`. This is independent of the UI/accessibility
refinement in #93. No document schema, dependency, provider API, collection contract,
default destination, deployment or native-app synchronization changes.

## Reading replies must still own their storage location

Account guards alone cannot protect a snippet that moves between sources within
one account. `refreshSnippet` can overlap a transfer. The old `syncReading` could
read the departing source, then fetch a newer local record, upload that record's
position to the old source, and clear the pending position for the new source.
A write admitted before the move could also acknowledge after it, overwriting the
new source's progress token/checkpoint. Remote-position adoption had the same
transaction-time ownership gap.

Capture the primary location and transfer identity before source I/O. Recheck them
before deciding what to upload and inside each local acknowledgement/adoption
transaction. A missing primary also revokes ordinary synchronization. Normal
refresh defers entirely while a transfer owns the snippet; only the transfer's
explicit destination may synchronize then. A stale reply cannot clear pending
progress or publish an old location's token. The next sync targets the current home.

Do not invalidate synchronization merely for a document edit or provider body-token
rotation at the same location. A newer reading intent remains dirty when an older
position is acknowledged. Transfer-target synchronization still works for the
owning move. This does not make a remote write and local transaction atomic.

## Resume cleanup after the local original is already absent

The browser File System Access API reports absence with `DOMException` named
`NotFoundError`, while the cloud adapters use `code: not_found`. After the original
was removed but before local completion committed, resuming previously stayed
stuck in the copied phase.

Recognize the native absence error only for ownerless local-folder sources and only
inside source cleanup, after destination verification and reading-state transfer.
Recheck source write capability before completing, exactly as for cloud absence.
Permission failures, disconnected folders, changed originals, and missing or
changed destinations remain failures with the journal and snapshots retained. A
resume does not upload another copy. Cross-provider moves remain recoverable, not
atomic, and local filesystems cannot exclude external writers atomically.

## Reproduction and evidence

Run from the repository root with its pinned Node/dependencies:

```sh
node --test tests/unit/snippet-reading-ownership.test.mjs tests/unit/snippet-transfer-recovery.test.mjs
```

Nineteen new cases execute the complete production modules, with controlled async
provider and database boundaries (not a native IndexedDB/browser integration test).
The same final cases against the exact unchanged production preimages give **10
passes and 9 failures**. The repaired modules give **19 passes, zero failures,
skips or cancellations**. Focused ESLint and Prettier checks pass. Both production
preimage Git blob hashes were matched to the reviewed main commit.

The existing Portable snippets workflow includes `tests/unit/*.test.mjs` and retains
its actual-app Chromium/WebKit, frozen-lock install, Svelte check and production
build. Those full integration gates must be checked on the follow-up PR; local
component results are not substituted for them. Live OAuth/provider composition,
physical Safari/Japanese IME and external-writer rehearsals retain their existing
release-qualification boundaries.
