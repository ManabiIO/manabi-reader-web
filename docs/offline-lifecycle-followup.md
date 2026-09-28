# Offline recovery and preference lifetimes

Review date: 2026-09-28. Base: `b9cd878743486ff27e007e9064dae3c57f563bcd`
(main, after merged #48, #68, #69 and #70). Base tree:
`0ebe30e3e89465fc226727a0d42fc1b8427280b4`.

This combines the previously prepared, unpublished lifecycle patch with a
further review of preference startup and connection recovery. Four production
modules change: account client, integration persistence, preference runtime and
organization storage. No schema/version, dependency, service-worker cache policy,
book representation, archive format, source identity or consent-default change.
The separate schema-lineage work in #71 is not duplicated here.

## Account refresh: exact request ownership

The former forced-refresh callback recursively called `refreshAccount(true)`.
An earlier completion listener could start successor B before queued callback Q
ran. The generation-wide queue lookup then returned Q itself, forming an
indirect promise-adoption cycle: both HTTP requests could finish while Q never
settled. A second reconnect during B could also be absorbed by Q instead of
scheduling a follow-up after that event.

Queues now belong to an exact active-probe object. A queued callback directly
joins an already-started successor, or calls a private request-start function.
It does not recursively enter forced queue admission. Repeated force calls
on one probe share one successor; a new force on the successor can queue its
own follow-up. Exact-promise cleanup cannot remove a newer queue. Existing
principal validation, generation revocation, timeout, keepalive and recent-result
cache behavior are retained.

## Integration database: failed handles are not permanent

A failed `openDB` promise previously remained cached for the lifetime of the
module. An abnormal connection termination likewise left later callers using
a dead handle. Cache invalidation now follows the exact opening promise on
failure, `terminated`, and `blocking` (version-change/delete) events. Blocking
also closes only that old connection. Late callbacks cannot close or evict a
replacement. A later access can reopen; the failure still reaches its caller.
There is no autonomous retry or replay of an old write.

## Preference startup: recovery without stale authority

The initial organization read is a prerequisite to capturing account settings.
Failure must not become an empty library to upload. Bootstrap now observes
rejection, reports unavailable status, and supports a bounded, single-flight
retry through online/visibility events and a 30-second poll with five-second
failure backoff. All bootstrap listeners retire on success or cleanup.

Profile reads retain an exact activation, not just a user ID. A delayed first A
read cannot apply after A→B→A has created a newer activation. Duplicate same-ID
notifications share the current load. Failed reads remain retriable even offline;
sync is not enabled unless the saved consent actually loads. Cleanup prevents
late profile application and watcher installation.

Asynchronous local preference saves and background lock/recovery failures are
observed. Failure status is published only for the still-current activation,
state, and (for local save failures) latest queued write. The user's in-memory
edit and existing consent are not erased. Explicit callers still receive their
operation's failure; reporting is not a success substitute.

## Revocation reaches pending organization transactions

Dropping a late result alone does not stop a write that already began. An
activation-scoped AbortSignal now travels from preference application to the
organization transaction. Profile changes, sync toggles and runtime cleanup
revoke it. Before storage opens and before mutation the signal is checked;
while a transaction is pending its abort listener requests rollback.

The existing `commitTransaction` helper observes completion before the first
organization read, covering read, receipt lookup, mutation and both writes.
Migration receipt fields are captured before suspension. Receipts remain atomic
with membership and no-op/idempotent outcomes still await commit. An empty native
AbortError receives an actionable save message with its cause retained; explicit
scope cancellation retains its own reason. Publication follows successful commit
and is suppressed if its initiating scope has since ended. Abort listeners are
removed after settlement.

An already committed transaction cannot be rolled back. This is not an atomic
transaction spanning scalar preferences, IndexedDB, and HTTP; dispatched remote
writes cannot be recalled. It does not redesign organization identity, portable
membership merging or every asynchronous operation in the app.

## Optional notifications stay optional

A denied organization BroadcastChannel constructor no longer prevents local
Library setup. Normal supported delivery retains the existing `changed` protocol;
no self-broadcast filter is added. Without messaging, automatic cross-tab
notification is not promised. This is separate from the previously repaired
collection-dialog focus bug, not a reinterpretation of it as data corruption.

## Regression evidence

Four new component suites run complete production modules through explicitly
controlled storage, network, timer and Svelte-store boundaries. Native Promise
scheduling and the production transaction helper execute. These are not native
IndexedDB or assembled Svelte application tests.

| Suite | Cases |
| --- | ---: |
| Account refresh lifetime | 9 |
| Organization transaction lifetime | 14 |
| Integration connection lifetime | 4 |
| Preference startup lifetime | 10 |
| Total | 37 |

The final same 37 tests against unmodified production modules at the base yield
15 passes, 17 failures and 5 cancellations (pending promises from missing
revocation). The repaired source passes all 37, zero skips/cancellations.
The first smaller startup/connection negative control reproduced seven failures;
its failures included genuine unhandled asynchronous rejections in the old code.

The organization component fixture separately observes its deliberate completion
rejection so it can test failed baseline paths without orphaning test-owned
promises. Its assertions establish completion enrollment, rollback, publication
and commit, not a claim of native unhandled-rejection measurement.

The existing scheduled `test_collection_commit.py` gains two actual-app cases:
initial organization-read abort with retained membership/error/explicit retry and
reload; and denied organization messaging with local creation/filtering still
working. Existing pointer/keyboard creation stress tests remain intact.

Local Node 22.16.0 / TypeScript 5.8.3 execution uses a Git-blob-verified text-only
snapshot, not the full pinned application toolchain. Python syntax and whitespace
checks pass. The new browser cases are not locally executed. Full lint, Svelte
checking, production build and Chromium/WebKit application qualification must
come from the new PR's exact-head CI; prior green commits are not substitutes.
No physical Safari or storage-eviction certification is claimed.

```sh
node --experimental-strip-types --test \
  tests/unit/account-refresh-lifetime.test.mjs \
  tests/unit/library-organization-lifetime.test.mjs \
  tests/unit/integration-connection-lifetime.test.mjs \
  tests/unit/preference-startup-lifetime.test.mjs
```

After building the real `/reader-web` application:

```sh
LIBRARY_BROWSER=chromium python tests/browser/test_collection_commit.py
LIBRARY_BROWSER=webkit python tests/browser/test_collection_commit.py
```

## Primary references

- [ECMAScript promise resolution](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise-resolve-functions)
- [IndexedDB transaction lifecycle](https://www.w3.org/TR/IndexedDB/#transaction-lifecycle)
- [idb connection and completion callbacks](https://github.com/jakearchibald/idb)
- [Svelte lifecycle and cleanup](https://svelte.dev/docs/svelte/lifecycle-hooks)

These establish platform semantics. The specific failures are demonstrated by
the regression cases, not inferred solely from the references.
