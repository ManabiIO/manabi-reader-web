# Personal-library interface

This is the next layer after the Rhea redesign (PR #11, merged at
`d61e5c93001b975a2ab8ae4299643648e2759413`). It changes the library, not the reader
layout. There is no store, recommendations, audiobook navigation or Home feed.
The existing Rhea/Bits UI components and Manabi appearance tokens are retained.

## Three separate kinds of organization

**Series are directories.** Each connected source is traversed independently,
with opaque provider IDs and explicit parentage. Empty and single-child wrappers
are visually flattened recursively; no file moves occur during scanning. A
multi-child folder becomes a series, whose subseries precede its individual
books. Filtering never changes a series ID or flattens it merely because only
one unfinished book remains. The source root itself is not a series.

Only subdirectories may have `.manabi-reader.yaml`. Its bounded, name-only YAML
schema is `name: "Display name"`. The former `.Manabi-Reader.yaml` spelling remains
readable for existing libraries but is never created. Plain and single-quoted names are also read;
complex YAML, duplicate/unknown fields and invalid files are not silently
rewritten. Existing cloud sidecars are read within the already selected root;
this requires no new provider grant. Missing names fall back to directory names.

**Collections are many-to-many memberships.** Books and Finished are smart
views; Want to Read is a built-in, explicitly curated reading list. Custom collections have stable UUIDs and support create, rename,
delete, add and remove membership. Collection deletion never deletes books.
Collections and book display-name, cover and binding overrides are stored in
the organization preference, separate from series YAML. They remain available
locally in IndexedDB and sync through the existing Manabi account preference
document when account sync is enabled. Known books use content hashes as stable
organization identities so provider and path changes do not lose memberships or
presentation overrides. References to unavailable books are retained for later
reconnection but are hidden from shelves and excluded from visible counts.
The account API accepts only canonical `content:<sha256>` references and bounded
PNG, JPEG or WebP cover data; browser IDs, provider locators, remote URLs and
credential-shaped fields fail its closed organization schema.
Renaming a book changes its display name, not its filename or the inherited
canonical title used by reading statistics.

### Want to Read

Want to Read always appears between Books and Finished in the sidebar and compact
Collections sheet, including when empty. Its reserved `want-to-read` collection ID
uses the existing organization preference contract. It cannot be renamed or deleted;
a custom collection with the same name remains independent. Book menus, the Add to
Collection dialog, and selected-book actions support adding/removing membership.
The destination supports search, Grid/List, sorting, and the Not Finished filter.
Counts include available books once, regardless of how many matching aliases they
have. Unavailable references remain saved and reappear when the book is available.
Older account settings that omit this built-in collection retain this device's
local-only membership; shared membership removals still apply. Collection dialogs
scroll within the viewport and provide 44px touch targets for their actions.

Membership is independent of progress and completion, so starting or finishing a
book does not silently remove it. Removing it from this list does not delete the
book or its other memberships. This is a list for personal-library books, without
store items, purchases, recommendations, or title-only placeholders.

New direct imports retain the original file's SHA-256, just as connected imports
do. Export/restore preserves that identity. Existing local-only memberships are
promoted when an original is reimported, a backup restores its identity, or a connected book is opened. Legacy
imports and unopened connected previews without a known content hash remain local
until then; browser IDs and provider locators are never uploaded as book identities.
Identical filenames alone do not establish identity, and adding to Want to Read
never imports a connected preview or enables account sync.

Visible connected previews verify the original file's SHA-256 without adding the
book to browser reading storage. A collection, Want to Read, or display-name edit
on a preview verifies the bytes again before saving under `content:<sha256>`.
This lets organization follow a file that receives a new provider ID, moves to
another folder or is copied between local and cloud sources. The browser keeps
reading records attached to its existing book ID when a same-owner source link
is reconnected. A cross-account or local/cloud copy may have a separate browser
book ID while sharing the portable organization key. Two available physical
copies can appear as separate Books tiles; missing references do not inflate
collection counts. Files with the same title but different bytes remain
separate identities.
Discovery remains lazy: a collection filter does not download every hidden file
in a large connected library. Open or scroll the Books/series view to preview a
newly located file, then its verified identity can appear in collections.

Accepted account organization is committed before settings sync reports success.
Remote changes notify other open Library tabs, and organization changes remain
observable while account settings are open outside the Library.

**Completion belongs to reading state.** A bookmark may contain `completion`
with `state`, `modifiedAt`, and a `finishedOn` calendar date when finished. The
same field is validated and preserved in content-keyed Manabi account sync and
bookmark migration. An explicit Still Reading choice overrides a 100% position, without
resetting the position, scroll, counts or statistics. A delayed autosave cannot
erase a newer finish/date choice. The first actual 100% save records a date;
historical 100% bookmarks with no date remain unknown until edited. Existing
Complete Book statistics are a distinct analytics operation, not invoked by
these library actions. The reader's explicit Complete Book action also publishes
a new completion decision, so it can supersede Still Reading; ordinary autosaves
cannot. IndexedDB remains the immediate source of reading state while signed-in
accounts sync resume, completion and daily statistics through Manabi. The
provider-managed state files are migration input, not a second active authority.
Independent resume fields can merge; conflicting edits remain reviewable.

## macOS package EPUB import

Some EPUBs are stored on macOS as Finder file packages: directories presented as one document.
The ordinary **Import File(s)** path is the primary compatibility route for these packages.
Current Chromium (`chrome/browser/file_select_helper_mac.mm`) and WebKit
(`Source/WebCore/fileapi/FileCocoa.mm`) detect selected macOS packages and expose a temporary
ZIP replacement to web content. A selected `Book.epub` package therefore reaches JavaScript as
`Book.epub.zip` with `application/zip`.

The importer recognizes that browser handoff by filename, then accepts it only if the ZIP actually
contains a valid EPUB package (`mimetype` plus `META-INF/container.xml`). Generic ZIP backups
remain excluded from book import. Package-directory selection and drag/drop remain secondary
fallbacks for browsers that expose the package's member files directly.

`__MACOSX` and AppleDouble `._*` entries are optional Finder/archive metadata, not EPUB content.
They are never required for package import and are discarded if a supplied wrapper contains them.

Browser CI exercises the post-picker `.epub.zip` / `application/zip` File shape through the
real book file input. The native macOS picker transformation itself belongs to the browser and is
documented by the upstream Chromium/WebKit implementations rather than emulated as application
behavior.

## Physical grouping and recovery

Create Series moves at least two originals within one **local folder mount**
into a new subdirectory. It does not pretend browser imports still have writable
original file handles. OneDrive series editing is a separate, incremental
`Files.ReadWrite` capability: the Library prepares a plan for review, then
executes native provider steps under a server journal. Existing read-only grants
remain usable if the user declines the upgrade. Google Drive and Dropbox series
editing remain unavailable until their scoped mutation contracts are complete.

Local moves request write permission from the user's action, reject existing
destinations and filename collisions, journal a plan before writing, copy and
hash-verify every destination, publish unchanged-content source links, then
recheck and remove originals. The journal survives browser reload and exposes
Resume Folder Change. Partial or externally changed files stop the operation;
there is no destructive rollback or blind overwrite. The journal is local
IndexedDB, so users must not clear site data during an unfinished operation.
File System Access cannot atomically exclude external editors/cloud clients;
close those writers during grouping. Native OS chooser prompts and live cloud
client propagation require separate platform qualification.

Series rename changes its YAML display name, not the physical folder path.
Existing book IDs, source hashes, progress baselines and canonical titles remain
unchanged. Copy/delete is not advertised as an atomic filesystem rename.
The canonical marker filename is all lowercase: `.manabi-reader.yaml`.

OneDrive create/move/rename plans are confined to one selected root and account.
Each provider step is claimed before its network call, reconciled after an
uncertain response, and verified before a relocation receipt is published.
Partial success is shown instead of rolling back or overwriting another change.
The Library applies receipts idempotently to invalidate folder listings while
book identity, progress, notes, collections and presentation stay intact.

## Library chrome

The browser-owned personal library uses one title bar rather than exposing the
inherited Book Manager command row. In compact horizontal size, the title leads
the bar and the Collections action opens the grouped collection sheet. There is
no sidebar or hamburger control. The sheet exposes Books, Want to Read, Finished, custom collections,
counts and Edit/Done management. At widths of 1024px and above, the Collections
action disappears and a persistent inset, rounded collection sidebar is shown instead.
Compact search opens from a 44px title-bar action and replaces the title row with
a focused search field and Cancel; Escape/Cancel clears the query and restores
focus to that action. Desktop keeps its inline field. Navigation glyphs use bold
Phosphor strokes at 24px (28px for the ellipsis).

Grid metadata follows the fitted cover width, with the visible ellipsis aligned
to its right edge inside a 44px target. At a 390px viewport, 24px gutters and gaps
give 159px covers; the metadata center is 16px below the cover. The supplied Books
reference has a gap about 15% of cover width and metadata center about 10% below
its bottom edge. Unopened books use a blue NEW chip; started books keep their
percentage and finished books retain Finished. Section headings use weight 500.
Imports, selection, View Options, Organize Library, account/library navigation,
statistics/settings, help and legacy storage views remain available from the
labelled overflow menu. Root navigation identifies Manabi Reader for Web. A
pushed collection or series replaces that brand with a back action and
destination title. Selection and replication controls appear contextually only
while those operations are active. The shelf row pairs Books or Continue with
search. The brand aligns with the shelf headings at compact and desktop widths.
Routine collection buttons use neutral system-gray fills with dark or light text
for the active appearance; the Manabi accent remains available for emphasis.
The desktop rail floats inside the viewport with 16px insets; shelf geometry
and series-hero reflow use the available content width. See
[`books-responsive-review.md`](books-responsive-review.md) for the responsive
qualification matrix and the proposed reader follow-up.

Reader search, saved annotations, return navigation, scrubbing, Line Guide and
their local-first account data model are specified in
[`../specs/reader-parity-architecture.md`](../specs/reader-parity-architecture.md).

The Continue shelf scrolls to the edges of the content pane. Its first and last
cards retain the same inset as the headings, while intermediate cards pass
through that inset during scrolling. The next card is not clipped at the grid's
inner margin, and scrolling the shelf does not widen the page.

## Covers and views

Grid and list share the same projection, filters, menus and source identities.
The follow-up destination model, selection rules, Continue shelf, Finished
timeline, series reading target, creator metadata and visual qualification
matrix are specified in
[`library-experience-spec.md`](library-experience-spec.md).
Two covers overlap on a series tile; the destination shows up to five distinct
covers in a centered fan. Covers preserve intrinsic aspect ratio and have a
subtle directional binding and shadow. Monochrome service glyphs identify
Google Drive, Dropbox and OneDrive; mounted folders use a disk icon; browser-only
imports have no source icon. Missing/failed artwork remains an accessible title
cover. Labeled menus, keyboard focus, reduced motion and forced colors use the
existing UI primitives.

Visible connected EPUB covers load through a two-worker, bounded preview queue,
without importing a book or changing reading state. The original bytes are
hashed before the preview is cached; only selected manifest
resources are decoded for previews; thumbnail cache entries are capped at 1 MiB
and 500 entries. Refresh rescans before replacing the last usable catalog and
invalidates preview generations. Failed scans do not delete books or history.

Direction uses explicit EPUB spine page progression first, then text-weighted
computed writing-mode/direction from a sanitized scriptless, networkless frame.
Language is never a binding-direction heuristic. Ambiguous/missing evidence and
unresolved styles remain unknown. Change Cover stores presentation artwork
separately from the original ebook and its direction evidence. The reader's own
layout and user-selected writing mode are not changed.

## Qualification

Production-code unit tests cover flattening, nested ordering, filter identity,
YAML, progress parsing, completion dates/stale autosaves, and direction policy.
Browser qualification exercises the actual built application and real browser
filesystem handles, not replacement UI or intercepted network requests.
Recorded results and any unexecuted platform boundaries are kept in the PR.
