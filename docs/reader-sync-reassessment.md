# Reader integration reassessment

## Current scope: continuous Google Drive compatibility

Decision updated 2026-10-22. The user's request for continuous ッツ (Ttsu) and
ideally Yatsu synchronization supersedes the earlier one-time-migration-only
scope. Google Drive is the first and only transport in this phase. Web is active;
Android is paused, Windows is deferred, and Apple clients are separate products.
Import/export stays available and independent of connection setup.

This is an integration design, executable reconciliation contract and bounded
state-file decoder, **not a released continuous-sync service**. The bridge modules
have no production caller, persistence, network access, OAuth credentials,
scheduler, or live write
adapter. Existing TTU-shaped Drive handlers and shared-folder auto import/export
are not evidence that the proposed safety requirements are already implemented.

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
inspection here was read-only; no backend credentials, scopes or routes changed.

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
planner together. TTU fixtures cover the common supported shape. This still needs
a verified decoded-book identity, stable Drive listing/download adapter, durable
journal, transactionally guarded local application, OAuth, scheduler and qualified
outgoing serializer. The decoder is not yet a production caller or write adapter.
No database or backup format changed in this increment.

The next provider boundary is a bounded, selected-root compatibility snapshot,
including stable file IDs and revisions across the book package and state files.
The existing frontend `CloudLibrary.read()` accepts EPUB/TXT/HTMLZ only; its normal
book path must stay constrained. The current backend byte endpoint alone does not
establish stable multi-file observations, so widening the frontend file filter
would not make a safe continuous-sync reader.

### Writes, failures and recovery

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

No persisted schema changes in this planner/decoder increment. When the journal and
connection records are implemented, backup/restore is part of that change: retain
local content, pending intent, accepted baselines, unresolved versions and
recovery evidence. Exclude access/refresh tokens, client secrets and live grants.
Restored connections start paused and require reconnection and a fresh preview
before any remote write. Restoring data must not replay historical uploads or
silently bind to a different Google account, folder or same-title book.

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
