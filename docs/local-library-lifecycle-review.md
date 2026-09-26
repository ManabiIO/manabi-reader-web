# Local-library connection and notebook lifecycle review

Starting PR #43 source: `769c19167f833abf33a87fbc0ab668d117765d52`.
The local review workspace uses its captured test-merge composition
`a73b95a608f4e71f9fe4aaace3c24ef162f3f5c4`. Parent-only UI changes are
left untouched. Final publication and CI identities are recorded in the PR.

## Review scope

Re-read the WebDAV transport, source configuration/import, consent and sync,
reader leases, notebook validation/edit/restore, Yatsu migration/receipts,
persistence helpers, Library worker/projection/search navigation, and their
callers and existing tests. This pass concentrates on interactions between
otherwise successful operations, not another check for unfinished comments.
It is not an exhaustive review of every provider, format or device.

## Reproduced connection defects

A successful read-only WebDAV test was followed by an uncancelable settings save.
Holding the real per-source Web Lock, clicking Save, then clicking Cancel or
navigating back to Books reproduced a late persisted configuration after the
editor had gone away. Cancellation is now carried through the lock request and
into the actual IndexedDB transaction. A request canceled before the callback
starts does not run. After lock acquisition, a live configuration transaction
explicitly listens for cancellation and aborts. Credentials and source lifetimes
are published only after the configuration transaction has committed.

Cancellation cannot undo an already committed transaction. Nor does passing an
AbortSignal to Web Locks stop work after a lock has been granted. The code handles
these as different boundaries rather than assuming cancellation is universal.
The new native-transaction regression clicks the actual Cancel button immediately
after the metadata write is enqueued and requires the prior configuration and
remembered password to remain unchanged.

A second pair of reproductions used two ordinary app tabs. A stale editor could
recreate a connection disconnected in the other tab, including its remembered
password. It could also restore source write permission revoked in the other
tab while the stale user only edited the source name. Serializing writes did not
prevent either stale decision. The editor now supplies its original configuration
snapshot, and the save compares it with the stored configuration inside the same
readwrite transaction as the configuration and consent changes. A mismatch
requires reload rather than retrying stale permission changes. The explicit
Reload WebDAV connections action refreshes the list and exits the stale editor;
the regression also makes a successful fresh edit without restoring revoked
permission. New connections
require the record to be absent; the existing immutable folder/username rule
remains enforced.

Disconnect had a separate transaction failure path. Aborting its actual
IndexedDB link deletion preserved the database transaction but produced an
unhandled transaction-completion rejection. Disconnect now aborts and drains the
transaction before propagating the original failure. The regression requires
unchanged configuration/link stores, no unhandled page error, and a successful
retry that still leaves the locally imported book intact. Current-tab memory
credentials are cleared again under the source lock after successful disconnect,
so earlier queued work cannot republish them before disconnect returns.

## Notebook repair at the WebDAV application boundary

The previous missing-annotation recovery covered notebook restore, but WebDAV
could still import a record labeled anchored whose annotation was absent. That
record was excluded from the unlocated-notes interface and was effectively hidden.
A real HTTP fixture reproduced the behavior using a schema-valid remote document.

Notebook restore and WebDAV now share the same unlocated-record conversion.
WebDAV checks linkage after all merged records have been applied, within the same
transaction. Valid annotations may appear later in JSON key order and retain
their links. Missing or incorrectly scoped references become visible, editable
unlocated notes, retaining original evidence without guessing a location. Existing
annotation tombstones are not resurrected. Previously received orphan evidence
is checked during subsequent sync as well.

The regression synchronizes the orphan, verifies its retained original source,
checks convergence without continuing PUT/revision churn, and edits the recovered
note through the real reader UI. A positive counterpart sends the import record
before its valid annotation and verifies that the link is preserved and a repeat
sync remains a no-op.

## Regression coverage and verification

`test_local_library_lifecycle.py` adds eight browser cases to the existing three
local-library modules, in both Chromium and WebKit in the permanent workflow.
These cover queued Cancel, canceled navigation, Cancel during a native transaction,
failed disconnect/retry, stale disconnect/revocation editors, orphan-note repair,
and valid reversed-order annotation delivery. Before the fix, the queued Cancel,
navigation Cancel, failed disconnect, stale disconnect/revocation editors and
orphan-note cases all failed. Reversed-order valid linkage already passed and
remains a preservation test. Another case checks cancellation inside the acquired
lock's write transaction.

`local-library-lifecycle.test.mjs` tests pre-aborted requests, canceled fallback
queue entries with subsequent recovery, and propagation of the exact signal and
return value through the native-lock adapter. Browser tests, not that adapter
mock, establish actual Web Locks and IndexedDB behavior.

The browser harness uses actual persistent browser profiles, a separate HTTP
WebDAV server, browser-enforced CORS, and real app controls. Fault orchestration
is explicit: a held native Web Lock, an actual transaction aborted through its
request wrapper, Cancel triggered at a metadata write, and a crafted remote
notebook document. No page errors are suppressed. Exact test totals, final
source/merge identities, and browser limitations belong in the PR evidence.

## Primary references and remaining boundaries

- [Web Locks API](https://www.w3.org/TR/web-locks/): the signal cancels a queued
  request; once granted it is ignored, and the callback promise determines lock
  lifetime. Hence cancellation is also enforced at the transaction boundary.
- [Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/): readwrite
  transaction isolation and all-or-nothing commit/abort underpin the snapshot
  comparison and permission updates.
- [idb transaction completion](https://github.com/jakearchibald/idb#txdone): request
  promises and the transaction's completion promise must both be handled.

No new backend, runtime dependency, database version or original-ebook mutation
is introduced. Cross-device HTTP preconditions remain necessary; origin-local
Web Locks do not coordinate different devices. Existing conservative import,
missing-remote and source-permission rules remain in place. Physical iPhone
Safari and live WebDAV-provider certification remain separate release checks;
desktop Chromium/WebKit fixtures do not establish those results.
