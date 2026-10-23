# Reader integration reassessment

## Current scope: continuous Google Drive compatibility

Decision updated 2026-10-22. The user's request for continuous ッツ (Ttsu) and
ideally Yatsu synchronization supersedes the earlier one-time-migration-only
scope. Google Drive is the first and only transport in this phase. Web is active;
Android is paused, Windows is deferred, and Apple clients are separate products.
Import/export stays available and independent of connection setup.

The working branch includes an executable reconciliation contract, bounded
state-file decoder, read-only Google Drive preview and an explicit local receive
flow, **not a released continuous-sync service**. The preview uses the existing
same-origin connection. Selecting and comparing a local book remains read-only;
a matching result does not save a link or apply reading data. A separate review
and save action applies supported incoming reading values with a durable recovery
journal. Verified pairs can now be remembered and reopened for a fresh manual
check. There is no automatic scheduler or outgoing Drive writer.
Existing TTU-shaped Drive handlers and shared-folder auto import/export are not
evidence that the proposed safety requirements are already implemented.

### Public Hoshi reference, without implementation source

Reviewed only Hoshi's [user guide][hoshi-guide], its linked screenshots and
[privacy policy][hoshi-privacy]. No Hoshi implementation, diffs, repository clone,
or decompiled app was consulted.

The guide puts separate platform OAuth clients in one user-created Google Cloud
project, using `drive.file`. Its screenshots expose connection status, automatic
sync, direction, statistics and audiobook options. It describes periodic sync and
lifecycle triggers, plus manual per-book sync. This establishes a user workflow;
it does not establish atomic writes, conflict recovery or lossless statistics
merging. The same-project requirement is the important compatibility finding.

### Drive access and sign-in

Prefer the existing same-origin backend's authorization-code flow, encrypted
server-side refresh-token storage, one-use state and account checks. Disconnect
behavior needs the shared-project changes described below. Do not copy credentials
from another reader or include client secrets in frontend configuration. Google's
OAuth "offline access" permits refreshing
credentials while the user is absent; cloud transfers still require a network.

A Manabi OAuth client does not automatically see another app's `drive.file`
library, even for the same Google account. Google's [scope documentation][scopes]
describes app-created or explicitly authorized files. Test Google Picker access
to actual independently created books, existing child files, and newly created
children; selecting a folder must not be treated as recursive authorization.
Manabi's existing [appDataFolder][appdata] storage is private to its app and cannot
serve as the interchange directory.

The existing backend connection currently requests `drive.readonly` plus
`drive.appdata`, not `drive.file`. It can discover and read existing ordinary Drive
libraries under broader read consent; its writes are confined to app-private
reading state. This does not qualify TTU/Yatsu write-back. The backend is
default-off and its restricted-scope verification remains a release gate. A
narrow compatibility connection must have an explicit purpose and scope model,
rather than silently inheriting that connection's permissions.

There are two access paths to qualify before selecting a default:

- A Manabi-managed connection with explicit file authorization, if it can support
  the necessary continuing access to the selected library.
- An advanced, user-owned shared Google Cloud project, with a separately
  configured Manabi backend client in that project. Hoshi's documented setup is a
  reference for this path. This needs an explicit credential-management design;
  it is not a hidden fallback to browser-stored client secrets.

If narrow authorization cannot cover existing and future files, show that precise
limitation. Do not silently request full-Drive scopes, label inaccessible files
as deleted, or create a second empty library under the same title. Broader scopes
and Google verification would require a separate product/security decision.
[Yatsu's built-in connection][yatsu-drive] uses a separate default library; its
custom TTU-compatible connection is the interoperability candidate. A shared
project also couples revocation: Google's [OAuth documentation][oauth] states
that revocation invalidates issued tokens for every client in that project.
Keep disconnecting Manabi (stop local jobs and forget its server-held credentials)
separate from revoking the project's Google authorization. A revocation action
must explain its effect on the other readers before it is chosen. An observed
Yatsu v11 backup does not qualify its current cloud writer.

The existing backend's disconnect route deletes the connection and queues token
revocation. It cannot be reused unchanged for a shared-project connection. The
preview reuses only the current managed connection. No backend credentials or
scopes changed; shared-project OAuth remains unimplemented.

### Connection and reading experience

Connect Google Drive, preview an explicitly chosen root, identify supported books,
and let the reader select which books and data to link. Show existing local and
remote progress before resolving first-connection differences. No implicit upload
of the entire local library and no second live database used while reading.

Save locally first. Schedule bounded, coalesced sync after committed changes,
when the app regains focus/connectivity, periodically while active, and when
leaving a book. Persist pending intent before an exit-triggered network attempt;
page dismissal is not a reliable opportunity to finish an upload. Reading must
open from local data without waiting for Drive. Offer an available incoming
position without jumping an active reader unexpectedly. A web tab cannot promise
continuous execution after it closes. A later server worker could process only
intent already delivered to it.

Use the existing inline connection detail control, with per-connection last
verified sync and pending changes in Accounts and libraries. Distinguish
"Saved on this device", "Waiting for connection", "Syncing", "Reconnect Google
Drive" and "Review changes". Online does not mean synced. Keep routine updates
quiet; do not introduce repeated toasts or alarming offline banners.

### Identity, format and reconciliation contract

Keep Drive transport separate from versioned TTU/Yatsu adapters. Bind every book
to account, connection generation, selected root ID and stable provider file IDs,
plus the existing fingerprint of decoded book content and media. Neither titles,
ZIP bytes, timestamps nor browser-local IDs prove book identity. Refuse ambiguous
duplicate files and unknown format versions. Use bounded decoding and existing
content sanitization. Preserve unknown fields and additive sidecars without
rewriting them; reject outgoing serialization if lossless preservation cannot be
proved. Original book packages are immutable during routine progress sync.

The initial normalized projection covers resume position and complete daily
statistics rows. Notes, highlights, audiovisual progress and settings need their
own demonstrated mappings before continuous writes; import/export support alone
is insufficient. Do not claim whole-app parity.

`planReaderBridge()` compares current local/remote semantic digests against a
previously agreed baseline:

- Equal values can be acknowledged against the observed revisions. Planning is
  not itself a durable acknowledgement.
- A change on only one side can transfer; resume positions may move backwards.
- Distinct daily rows can transfer independently. Two edits to the same day's
  cumulative total require review. Never add totals or choose their maximum.
- Initial differences and concurrent edits pause the whole book. Keep both
  recoverable values. An accepted decision creates a new guarded operation.
- Missing files or rows are not deletion instructions. Preserve local data and
  the last agreed baseline; never propagate deletion automatically.
- Receive-only keeps unsent local changes pending. Baselines must remain agreed,
  rather than recording divergent values as though synchronized.
- Account changes, reconnect generations, changed content, unstable reads and
  unknown write outcomes pause application and outbound work.

A transport must download a stable set of related files and revalidate the full
observation. One Drive revision is not an atomic revision across several files.
Use a paginated [Drive changes feed][changes] for discovery, with durable tokens,
bounded retries and a full rediscovery when a token expires. A feed or push
notification is a hint to inspect the selected files, not a trusted data payload.

`projectReaderBridgeFiles()` now reads bounded, version-matched progress and
statistics files into that contract. It compares normalized values without local
row IDs, export timestamps, property order or completion transport versions.
It retains the exact original JSON separately. Yatsu section/layout context and
dictionary counts also participate in semantic comparison: identical scroll
coordinates in different sections must not be acknowledged as the same position.
The eventual local adapter must map every field or pause; retained wire context
does not prove a portable local position. The originals are recovery evidence,
not permission to rewrite Yatsu files. Unknown fields, conflicting
files, filename/position disagreement and mismatched character counts fail before
any projection is returned. Legacy pixel coordinates remain meaningful until a
proven portable location replaces them. The decoder freezes its result and
supports cancellation; no partial result is acknowledged.

The checked-in public Yatsu v11 backup exercises the decoder and reconciliation
planner together. TTU fixtures cover the common supported shape.

`previewDriveReaderBridge()` now downloads a bounded observation through dedicated
backend snapshot/file routes. The backend requires a selected Google library root
and direct child book directory, checks two full listings, fences downloads by
file versions/checksums and rechecks connection generation after provider I/O.
Unknown sidecars participate in the observation but are not rewritten or
downloaded. The frontend verifies the decoded package title/content identity,
projects supported state and rechecks the full observation before showing it.
The normal `CloudLibrary.read()` EPUB/TXT/HTMLZ filter remains unchanged.

In Accounts and libraries, browsing a supported Google book directory offers an
inline preview of its saved position and reading days. It explicitly says that
automatic sync is not connected. Navigation, account changes and canceled work
must not publish an older preview. This gives the snapshot adapter a production
caller without representing a read as permission to sync.

`identifyReaderBook()` is shared with one-time import and retains the exact prior
receipt hash format. It hashes decoded content/media, ignores local IDs and
claimed content hashes, captures inputs before asynchronous work and supports
cancellation. The public Yatsu package and existing built-app migration/reimport
journeys exercise that shared path. No database or backup format changed.

The local comparison uses the same HTML/CSS/EPUB cleanup as one-time import.
It hashes actual stored text and media, checks character counts and publication
layout, and permits local renames without trusting titles or import receipts.
The raw package fingerprint and existing import receipt format are unchanged.
Only a genuine in-memory preview from the current account/session can enter this
flow. Local choices use compact index keys and filter account ownership; the
selected book is checked again before reading content. Hashing happens outside
IndexedDB, followed by a transaction that rechecks the complete stored book,
ownership and bookmark, comparing ArrayBuffer bytes rather than object keys.
Legacy native Blob or string-cover records pause comparison without rewriting
them. No statistics migration, journal entry, last-read update or baseline is
created, so there is no new persisted state or backup-format change.

The comparison is wired into the Connections preview with explicit selection,
an inline result and no toast. Eight local-content cases run in both native
Chromium and WebKit alongside schema/recovery coverage. They cover same-size
binary changes, second-connection edits, account/cancellation boundaries,
duplicate titles, renames and packed EPUB resource maps. The composed production
web export also exercises actual Yatsu ZIP import, idempotent reimport, explicit
selection/comparison, unsupported-mapping rejection and stale-remote refresh on
desktop and phone widths. Those steps preserve local reading data and make no
Drive writes. They do not qualify continuous synchronization or Yatsu locator
application.

### Explicit local receive checkpoint (2026-10-23)

After a genuine content match, review compares saved position and daily totals.
Initial or concurrent differences require an explicit choice to use Drive's
values. Totals replace rather than add, local-only days remain, and missing rows
are never deletion instructions. Unsupported Yatsu locator/dictionary fields,
ambiguous legacy statistics and pending personal sync work pause application.

Receive rechecks the full remote observation, persists intent, then rechecks book
bytes, ownership and reading state in the same transaction that applies changes
and records acceptance. It uses the existing reader-lifetime Web Lock so an open
reader prevents application. Accepted baselines contain only agreed values;
superseded decisions retain recovery evidence. A retry returns an existing
receipt rather than replaying over later local reading. Receive evidence was
introduced in books schema version 14; saved connections below extend it to 15.

The receive path now binds comparisons to their original account, rechecks aggregate
statistics timestamps and keeps completion/history clocks monotonic within decoder
limits. Recovery records are checked again inside the acceptance transaction.
Restored completed decisions remain inactive without blocking new review; restored
unfinished or uncertain work still requires resolution. The interface cancels stale
reviews and downloads, preserves truthful failure wording, and presents comparison
and recovery controls inline at phone and desktop widths.

The initial receive checkpoint passed 79 bridge/interface unit cases, 58 native IndexedDB
cases in each of Chromium and WebKit, typecheck, focused lint and a fresh Expo web
export. Its complete frontend unit suite passed all 1,854 cases. The composed
PostgreSQL suite now exercises positive TTU receive as well as unsupported Yatsu
mapping in both browsers: actual import, a separate reader tab blocking receive,
explicit replacement, retained prior values, recovery download/inert restore,
repeat restore, post-restore review and old-archive reimport preserving received
values. Desktop and 390px screenshots were inspected. Chromium recovery runs in
offline mode; WebKit blocks all HTTP requests instead because Playwright's
synthetic offline mode rejects even plain local File reads. Neither recovery
operation needs network access.

A delayed genuine session response reproduced a cold-import account race after
navigation. Explicit import now resolves the initial unknown profile before
admission, then retains the normal account/cancellation fences. Settled offline
and anonymous imports stay local. This does not add a database or backup format.

Continuous sync still requires scheduling,
compatibility OAuth, richer Yatsu mappings and a qualified outgoing serializer.
The provider tests use real HTTP against a stateful vendor-wire fixture and
PostgreSQL. They do not establish real Google consent, Drive listing consistency
or live cross-app write safety. Rechecking observed versions is not an atomic
multi-file transaction. This remains a development checkpoint.

### Saved verified connections (2026-10-23)

After a genuine local content match, an explicit “Remember this reader connection”
action saves the verified pair. This does not receive reading values or enable
automatic sync. The additive books schema v15 store binds the account, local
UUID, actual content fingerprint, provider connection/generation, selected root,
book directory, package and state-file IDs. Saving rechecks the full remote
observation and current local bytes/ownership before assigning identity and
persisting the pair in one transaction. Concurrent, stale and cancelled saves
cannot replace a different pairing. Titles and browser-local numeric IDs alone
are never identity evidence.

“Saved reader connections” reopens the pair after navigation, verifies the saved
revision and identities, downloads a new stable observation, and compares the
actual stored content again. Reading sidecars may advance on the same file IDs;
replaced files, changed generation/content and unsupported mappings require new
review. Forgetting the connection requires its current account/revision and
preserves reading data, Google access and recovery evidence. These controls use
quiet inline messages and support local listing/removal offline.

Recovery v3 adds bounded connection descriptors. V1 and v2 remain readable.
Restore is atomic and idempotent across journal evidence and connection hints;
hints remain inactive and never select a local book or reconnect Google Drive.
The ordinary book ZIP format is unchanged, so keep the recovery JSON alongside
book backups. Native Chromium and WebKit exercise v14 upgrades, tab races,
cancellation, identity reuse, source replacement, malformed recovery and removal.
The expanded frontend suite passes all 1,902 cases. There are 66 passing native
IndexedDB cases per browser, and 28 saved-pair
service cases exercise the production preview/content-comparison path. The full
app passes both composed journeys in Chromium and WebKit, including remembering
a pair, rechecking it after navigation, recovery v3 round-trip, inactive hints and
forgetting connections. Screenshots were inspected at desktop, 390px and 320px.
Narrow layouts contain both the comparison table and account preference selector.

### Writes, failures and recovery

`reader-bridge-journal.ts` retains prepared intent, conflicts, original state
files, baseline digests and uncertain attempt identities in the books database.
Storage version 14 adds `readerBridgeJournal` without rewriting existing book
records. Journaling in the separate integration database would not allow local
application and acknowledgement to share one transaction, so it is deliberately
excluded from that path.

Preparing an operation re-decodes its exact original files and checks their
semantic digests. It captures inputs before asynchronous work. One IDB transaction
serializes competing tabs and rechecks account scope before commit. Random CAS
revisions reject stale transitions. The upload-attempt marker commits uncertainty
before transmission; reopening the app or retrying a lost preparation response
cannot turn it back into a fresh upload. Unsent drafts can be explicitly abandoned
without discarding their evidence; uncertain and restored records cannot. Capacity
limits stop new work without evicting older recovery records.

The local receive adapter now verifies current local book state and applies
supported incoming values together with acceptance. The journal does not execute
network transfers or resolve uncertain outgoing outcomes. Its write-capability
argument must come from a qualified live adapter; no backup can supply it. Native
Chromium and WebKit cases exercise database reopening, competing connections,
account/cancellation rollback and inert recovery imports.

Before the first outbound write, durably record the base revisions, intended
semantic values, original remote bytes and operation identity. A local journal
must survive reload, offline interruption and tab races. Coordinate our own tabs
and devices, but never assume an advisory lease is honored by other readers.

Qualification must demonstrate conditional replacement on the **exact Drive
upload endpoint**, recovery-copy retention, readback verification, interrupted
upload handling and retry behavior. A version number or read-then-write check
alone is not compare-and-swap. The planner's `conditional-recoverable` capability
is an adapter qualification requirement, not a feature supplied by that string.
If atomic replacement cannot be demonstrated, keep automatic outgoing work paused
and provide an explicitly reviewed recovery/import/export path.

On an uncertain result, inspect the remote operation outcome before retrying. Do
not acknowledge a newer local edit as uploaded merely because an older upload
succeeded. Apply local data and acknowledge only the accepted projection in one
transaction, rechecking local revision and connection generation. Multi-file
writes need journaled stages and partial-completion recovery; Drive does not
provide a transaction over the reader's whole book directory.

The reviewed [TTU Drive handler][ttu-drive] can replace files without a shared
conflict protocol. Even if our own operation is conditional, another reader may
later overwrite it. Preserve recoverable history and surface detected divergence;
do not promise that all participating apps provide conflict-safe synchronization.

### Backup and restore

The read-only preview still changes no persisted user state. Explicit receive
persists local reading changes and their recovery evidence. The journal provides
a versioned, bounded recovery JSON format through `exportReaderBridgeRecovery()`
and `restoreReaderBridgeRecovery()`. It retains exact state-file originals, pending
intent, observed identities, baseline digests and the original phase/attempt even
after recovery import. Export revalidates evidence and excludes live writer
capability, access/refresh tokens, client secrets and grants. Unknown fields and
invalid projections reject the whole import before any record is written.

Recovery imports are same-account, atomic and idempotent. They are stored as
inert `restored` records alongside existing work, never over it. They do not
select a local book, activate a connection, acknowledge a baseline or replay an
upload. Fresh connection/content verification and explicit recovery are required.
Connections now includes offline-capable recovery download/restore controls and
an action to set aside unsent decisions while retaining evidence. New exports
use version 3, including connection descriptors and acceptance; versions 1 and 2 remain readable. Restored
acceptance stays inactive and never replays local changes. The positive composed
UI journey qualifies offline recovery and confirms that restoring accepted
evidence neither replays changes nor blocks later reviews. Existing book ZIP export
and one-time import remain unchanged and do not contain the new journal; keep
the recovery JSON with book backups.

### Release evidence still required

Use two real app clients and a disposable, explicitly authorized Drive library to
qualify cross-project and same-project access, new files, pagination, duplicate
names, renames/moves, revocation, account switching, reconnects and token expiry.
Exercise offline simultaneous edits, same-day totals, readback mismatches, lost
responses, multi-file interruptions, late local edits and restored backups. Verify
both import and export with actual TTU/Yatsu app UI. Provider fakes remain useful
for deterministic fault injection, but cannot prove scopes or Drive write
preconditions. No production credentials, scopes or user libraries were changed
as part of this research.

[hoshi-guide]: https://github.com/Manhhao/Hoshi-Reader/blob/main/TTUSYNC.md
[hoshi-privacy]: https://github.com/Manhhao/Hoshi-Reader/blob/main/PRIVACY.md
[yatsu-drive]: https://docs.yatsu.moe/google-drive-sync/
[scopes]: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
[appdata]: https://developers.google.com/workspace/drive/api/guides/appdata
[changes]: https://developers.google.com/workspace/drive/api/guides/manage-changes
[oauth]: https://developers.google.com/identity/protocols/oauth2/web-server
[ttu-drive]: https://github.com/ttu-ttu/ebook-reader/blob/e7ec1d2680b5121b97102753d14a7a49a9003761/apps/web/src/lib/data/storage/handler/gdrive-handler.ts

## Confirmed defects and fixes

### Missing remote state is not a reset

Previously `value: null` from an absent state file was changed into an empty state,
then merged with the previously synchronized baseline. If local data had not
changed, this deleted local bookmarks and statistics. A temporarily missing
cloud-synced file and deliberate reset are not equivalent.

A missing remote file with history in the last acknowledged baseline now leaves
local history and that baseline intact and offers explicit restoration from this
device. The existing conflict UI is reused: an empty available-remote-versions
list correctly offers no remote copy to select. First-time writing with an empty
baseline still works. An actual remote empty document remains a valid reset. An
explicit local reset followed by recovery writes an empty document rather than
pretending an absent file was successfully saved. No new ledger or schema is
introduced.

### Delayed errors must respect account generation

The HTTP client already checked account generation after success bodies, but not
after reading an error body. A delayed 401/account-changed response could clear a
newer account that signed in after the headers arrived. Recheck generation after
the asynchronous error-body read and before invalidating account state. This does
not retry failed writes or broaden auth permissions. The server companion tests
this with a genuine Django rejection streamed in two parts, not a mocked fetch.

## Review conclusions and launch boundaries

Keep the static frontend, optional account use, same-origin CSRF/session checks,
server-side credential encryption, one-use OAuth state, bounded provider adapters,
conditional cloud writes and append-only local revisions. These are useful
boundaries, not reasons to add another authority/coordinator layer.

Continue testing the composed production artifact with real Django/PostgreSQL and
a stateful fake provider. Vendor-format HTTP tests prove adapter behavior under
that model, not real-provider scope approval or final upload-session semantics.
Native OS chooser dialogs and OS-cloud propagation remain separate live checks.

The 64 KiB per-book state-document limit and retained local-revision cap still
bound long reading histories. They fail closed rather than truncating history,
but a long-history storage design and measured acceptance tests are needed before
advertising unlimited history sync. Native Manabi account/source integration is
also not completed merely by changing Web or upgrading the older TTU connector.
No existing production activation, native app branch, provider scope, or naming
configuration changes in this PR.
