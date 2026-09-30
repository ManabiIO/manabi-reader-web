# Cloud-backed snippets

Snippets are library documents, not EPUB-shaped database records and not browser-session notes.
Their canonical format is versioned TipTap JSON inside a UTF-8 `.manabi-snippet.json` file.
The embedded UUID survives edits, title changes and moves between providers. Content and
provider revision tokens are separate. A single primary location receives edits. Discovery is
order-independent for causal history: when two locations contain the same UUID and one clean
revision descends from the other, the descendant becomes the logical document and writable primary
regardless of which provider was listed first. Concurrent sibling revisions remain explicit
conflicts; secondary/ancestor copies stay visible rather than becoming writable replicas.

## Reading and editing

The Snippets destination and mixed collection/root-library views share a lightweight summary
catalog. Opening a document enters reading mode; Edit and Add text are explicit operations.
TipTap 3.31.3 is lazy-loaded only for editing/import/Markdown conversion. The editor uses the
upstream RubyText and UniqueID extensions, a closed schema and bounded sanitization. Reader
HTML is derived by an escaping renderer; lookup overlays and search presentation never become
canonical document content. Plain paste remains plain text; Markdown import is explicit.

Titles have an explicit automatic/custom policy. Automatic titles use heading/body base text
without interleaved furigana and truncate on grapheme boundaries; custom titles survive edits.
Drafts are private, owner-scoped IndexedDB records. Save commits a revision, Cancel can discard
only the draft, and Keep draft retains it. Recovering a draft claims a fresh editor session and
updates the reload URL before publishing the editor. Navigation ownership is independent of
reactive UI state: a late draft/record load cannot replace the next route, even after leaving
and returning to the same URL. Concurrent edits are rejected by revision, not silently overwritten.
An append operation captures its destination and receipt identity before asynchronous work.
Local editing, appending, trashing and restoring share the same bounded ancestry rule: the last
acknowledged provider revision remains a parent until its successor is saved, even after many
offline changes. Editing a portable import preserves its document ID but creates a new revision.

Furigana/link controls edit the whole existing mark when invoked at a caret. The toolbar exposes
active formatting and available undo/redo. The upstream blur-to-dismiss inline ruby widget is
replaced by that single guarded form, not a second untracked annotation editor. Apply and Escape
respect Japanese composition; Save
and Keep draft cannot silently omit an annotation still being entered outside the document.
Search passage links use the same selection handler as titles, so batch-selection mode does not
unexpectedly navigate away.

The reader supports horizontal/vertical reading, typography size, source attribution and
capture to a new/existing snippet. Capture provenance stores stable source identity rather than a
device-local numeric book URL. Snippet-to-snippet provenance resolves its `snippet:<UUID>` item
inside the current deployment, and automatic source titles use the same derived title shown to
the user. Book selection capture copies the selected authored DOM
before the annotation panel can lose selection. Stable block/quote locators restore reading
and search destinations; an ambiguous or deleted quote does not jump to an unrelated offset.
Reading state uses the existing conditional source-state transport with a domain-separated
`book_<sha256("manabi-snippet-reading-v1:" + UUID)>` key. No fake book database row is created.

## Storage and defaults

Reuse `SourceDescriptor`, source enumeration, complete cached traversal, file-path validation,
provider permissions and the authenticated Reader API. Snippet discovery uses a separate
catalog namespace so ordinary ebook imports are not broadened to arbitrary JSON files.
The backend counterpart is lake-of-fire/manabi#87 (`connections/<id>/documents/`).

A new document uses an explicitly selected location, otherwise the remembered destination,
otherwise the only eligible writable source. Multiple providers require a visible choice;
provider order does not decide. A remembered unavailable destination remains the intended home.
Users can choose a folder or create one in the destination picker and remember it. **Clear default
location** removes that preference; subsequent creation again uses the one-eligible-source rule or
asks when there are multiple eligible sources. Clearing the default never moves existing files. Cloud is not
required to start: choosing this-device-only is explicit and labeled, and Move publishes such
a document later. Native local-folder and strong-ETag WebDAV adapters are included. Local folder
writes cannot atomically exclude external applications; the picker warns users to close them.
Every local snippet read, capability check, folder creation, write and remove holds the same
connected-folder generation lock as book/state operations. Disconnect/reconnect therefore waits for
admitted physical I/O; queued snippet work revalidates the exact directory handle and durable write
consent before touching disk, so a reused source ID cannot retarget an older operation. If the same
portable snippet later reappears under a newly connected source ID, discovery may rebind the storage
home only when the old source is absent from that discovery snapshot and the newly found document is
identical or causally related. Dirty local descendants are preserved and uploaded over their remote
ancestor; sibling revisions still require explicit conflict resolution, and an upload targeting a
still-active source keeps ownership.
A first-create crash can leave File System Access's newly created directory entry at zero bytes.
Retry may reclaim only the exact deterministic filename for that pending snippet; unrelated
zero-byte names and non-empty malformed files are never overwritten.
Switching source/folder immediately invalidates the previous destination's write capability.
Only a successfully loaded folder can be chosen. Failed folder loads offer Retry, expired local
permissions offer renewal, and delayed folder creation cannot retarget a newer picker selection.

The backend supports Google Drive, Dropbox and qualified OneDrive Personal document writes.
OneDrive Business/SharePoint writes are not advertised: its final conditional-commit contract
needs independent implementation/qualification. Reads/export remain available. OAuth upgrades
preserve authorized roots and all requests use existing session/CSRF/account guards.

## Crash and concurrency invariants

Body, summary and revision commit in one IndexedDB transaction. Before remote I/O an outbox
stores the _exact_ document, destination, allocation ID and expected provider token. Losing a
create response and then editing offline replays that original snapshot before uploading its
successor. An acknowledgement must own its pending snapshot. It cannot erase a newer edit.
Successful flushes drain successors with bounded work; errors do not become a tight retry loop.

Moving freezes a document revision and atomically stores its transfer journal. Copy/native move
is followed by read-back verification. Reading state travels before conditional source cleanup.
The destination is checked again after asynchronous reading-state I/O and immediately before
source cleanup, so an edit during that interval preserves the original. Only then is the new
primary location committed. A cleanup failure retains both files and can
resume without another upload. Source/destination edits halt cleanup. Keep both preserves
copies and releases the reservation rather than deleting an uncertain destination. There is
no claim of an atomic cross-provider transaction. Disconnect, failed scans and permission
errors are not deletion evidence. All async operations carry account/lifetime guards.

Automatic discovery runs while browsing the root library, Books/collections, or Snippets, not
while configuring connections or reading a book. Leaving these library routes cancels the scan
and any queued catalog/checkpoint publication. Cached summary updates, account isolation and
pending document saves remain active throughout the application. Brief reloads reuse recent
durable checkpoints; explicit Refresh still rescans. Source adapters must match their stored
ID, owner and root before access, so reconfiguring a WebDAV root cannot retarget saved reading data.

Indexing hydrates at most 100 documents/16 MiB in each pass and retains a checkpoint. Completed
sources do not restart during continuation passes. Corrupt files generate notices without
blocking later files. List views use summaries; body search runs in a worker and indexes base
text and authored ruby readings separately. Query/scope changes terminate old workers. Source
and collection filtering occurs before result limits. Snippets search defaults to all snippet
sources; All Library preserves the query and includes books. Drafts/other accounts/trash are
not searched by ordinary library search.

Collections use existing organization storage and preferences, adding `snippet:<UUID>` portable
members. The client sends the `snippets-v1` capability so an older client cannot silently strip
members in the backend compatibility path. Membership changes capture scope inside the shared
transaction. JSON backup import is additive and preserves conflicting bodies rather than
adopting another installation's provider locators. JSON/HTML/Markdown export is available;
ruby Markdown exports retain raw HTML rather than silently dropping annotations. Multi-document
backups preserve collection memberships. Reading state is independently stored at the source.

## Verification and rollout

`node test/snippets/run.mjs` executes production schema, native-IDB-compatible transaction code,
outbox and transfer orchestration against deterministic transport fixtures. The added cases
include lost create replies, concurrent edits, conflict resolution, account ABA, more than 100
index entries, interrupted moves, destination edits during reading-state transfer, route ABA,
default removal, canceled IndexedDB metadata transactions, and route-scoped discovery. Existing unit tests remain in
`tests/unit/*.test.mjs`.

`test/snippets/browser.mjs` drives the assembled production application, actual TipTap,
real workers and browser IndexedDB. It replaces only the authenticated HTTP boundary and tests
create/reload, search, append/cancel, draft recovery, collections/trash, ruby/IME event guards,
fresh-browser source discovery, cross-provider cleanup failure/resume and account isolation.
The CI workflow runs Chromium and WebKit after frozen-lock installation, lint, typecheck and
production prerendering. Mock transport acceptance is not live provider/OAuth certification.

Release qualification still requires real provider accounts/files, physical Japanese IME and
Safari/iOS checks, source permission renewal, external file modification, and quota/eviction
rehearsals. This PR does not enable production backend features, merge or deploy anything.
The local browser environment blocks loopback navigation by policy; that restriction is not
worked around. Assembled browser tests run in the repository's normal CI environment.
