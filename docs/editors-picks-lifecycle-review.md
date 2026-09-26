# Editor’s Picks lifecycle and ownership review

Continuation of PR #57 from `3f5a9568d6cf71de9c98b784cb3c1daa59ec64a9`,
retaining the #55 integration at `92a53bfe9452ea0a3ad81824934113b369d82651`.
The first diagnostic-only commit is `345c798919d25d310a34571d54fc69d582cde257`.
No renderer enablement, database schema, dependency or backend changes.

## Reproduced defects

Five new built-app cases fail on the starting source: a guest can open another
account’s cached copy through a catalog hash match; switching accounts away and
back leaves a held download alive; duplicate feed IDs crash the keyed list;
a 206 response containing an otherwise valid EPUB is accepted as a complete
file; and malformed UTF-8 is silently replaced rather than rejected. Those cases
now pass with recoverable errors, preserved stored books/bookmarks/last-opened
state, explicit retry and a fresh successful account-transition operation.

A sixth case reproduces an unnecessary catalog request while returning to a
populated Library. Unknown ownership temporarily produces an empty card list,
which mounted Editor’s Picks just before the owned cards arrived and destroyed
it. The embedded personal-Library catalog now waits for resolved account/link
state and an actually empty list. It remains available for a truly empty Library
and through the explicit menu; legacy external-source empty states are retained.

## Implementation boundaries

Catalog reuse checks the existing stored ownership links independently of the UI,
refuses foreign-account and source-bound matches, and rejects multiple eligible
copies instead of selecting the first. A narrow BrowserStorageHandler subclass
reuses the existing importer and records its actual saved ID. A fresh copy arriving
during parsing is reused rather than replacing its progress. The actual ID is
validated again before opening. Lookup uses a cursor instead of retaining all
book image payloads in an array; this is not a constant-memory or benchmark claim.

Account transitions, page departure and destruction abort the current catalog
operation. Its cancellation reaches the existing import context, asynchronous
binary preparation and the uncommitted native book transaction. Request and
transaction-completion failures are drained through commitTransaction; the abort
listener is removed on settlement. An already committed write cannot be undone.
The books and integration databases are not one atomic snapshot; this is not a
new cross-tab ownership transaction or a redesign of account/profile policy.

Feed/file admission requires HTTP 200, retains byte limits, cancels rejected
bodies, decodes the known UTF-8 feed strictly, and validates IDs before rendering.
It retains existing allowed-path, redirect and credential restrictions. No
original EPUB file is modified and no server proxy is introduced.

## Evidence and remaining interpretation

The permanent built-app Editor’s Picks suite has eleven cases, including twelve
consecutive immediate reader departures. All original functional assertions and
no-page-errors assertions remain. Diagnostics retain error name/message/stack,
failed requests, native error/rejection events and blob URL creation/revocation
metadata, without storing blob contents or suppressing application errors.

Two native-storage module tests exercise the actual BrowserStorageHandler and
DatabaseService through Vite: cancellation during a held Blob read preserves the
old book, and cancellation immediately after a native add request is enqueued
rolls back the transaction. Both then retry successfully. They explicitly select
the requested browser engine and run alongside the existing local-library suite;
they are not described as production-bundle tests.

Local Chromium passes the eleven catalog cases and two cancellation cases. The
static build, 281 default units, repository ESLint and component lint pass;
Svelte has zero errors and one inherited unused Foliate export warning. Final
source/tree identities and new-head CI outcomes belong in the PR. Local WebKit
requires ICU 74 unavailable in this Debian container, so Ubuntu CI must qualify
WebKit; desktop engines do not certify physical Safari or live providers.

The old Books Library report truncated an access-control error ending in a UUID.
The diagnostic-only source subsequently passed Books Library without a production
fix. That is not a diagnosis of the earlier failure. The independently reproduced
transient OPDS request is repaired, but the earlier UUID error must not be equated
to that request without full evidence. New-head failure diagnostics and the rapid
navigation regression remain authoritative; no retry-until-green policy is used.

Primary contracts: the Fetch and Encoding standards for completed response and
fatal UTF-8 decoding, DOM AbortSignal, and IndexedDB transaction completion.
- https://fetch.spec.whatwg.org/
- https://encoding.spec.whatwg.org/
- https://dom.spec.whatwg.org/#aborting-ongoing-activities
- https://www.w3.org/TR/IndexedDB/
