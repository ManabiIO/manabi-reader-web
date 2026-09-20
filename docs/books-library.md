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

Only subdirectories may have `.Manabi-Reader.yaml`. Its bounded, name-only YAML
schema is `name: "Display name"`. Plain and single-quoted names are also read;
complex YAML, duplicate/unknown fields and invalid files are not silently
rewritten. Existing cloud sidecars are read within the already selected root;
this requires no new provider grant. Missing names fall back to directory names.

**Collections are many-to-many memberships.** Books and Finished are the two
smart views. Custom collections have stable UUIDs and support create, rename,
delete, add and remove membership. Collection deletion never deletes books.
Collections and book display-name/binding overrides are currently stored in
this browser's IndexedDB, not in the series YAML and not synchronized between
devices. The sheet states this explicitly. Importing a source book or moving its
original relocates its presentation/membership keys rather than losing them.
Renaming a book changes its display name, not its filename or the inherited
canonical title used by reading statistics.

**Completion belongs to reading state.** A bookmark may contain `completion`
with `state`, `modifiedAt`, and a `finishedOn` calendar date when finished. The
same field is validated and preserved in managed progress sync and bookmark
migration. An explicit Still Reading choice overrides a 100% position, without
resetting the position, scroll, counts or statistics. A delayed autosave cannot
erase a newer finish/date choice. The first actual 100% save records a date;
historical 100% bookmarks with no date remain unknown until edited. Existing
Complete Book statistics are a distinct analytics operation, not invoked by
these library actions. The reader's explicit Complete Book action also publishes
a new completion decision, so it can supersede Still Reading; ordinary autosaves
cannot. Sync retains the existing whole-bookmark conflict
boundary, rather than claiming independent field conflict resolution.

## Physical grouping and recovery

Create Series moves at least two originals within one **local folder mount**
into a new subdirectory. It does not pretend browser imports still have writable
original file handles. Cloud originals remain read-only under the current
backend/grants; cloud moves and renames need a separately authorized write
contract. No OAuth scope is widened here.

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

## Library chrome

The browser-owned personal library uses one title bar rather than exposing the
inherited Book Manager command row. Collections has a dedicated round action;
imports, selection, account/library navigation, statistics/settings, help and
legacy storage views remain available from the labelled overflow menu. Selection
and replication controls appear contextually only while those operations are
active. The shelf row is reserved for View, Organize and search so the primary
surface stays about the user's books rather than storage machinery.

## Covers and views

Grid and list share the same projection, filters, menus and source identities.
Two covers overlap on a series tile; the destination shows up to five distinct
covers in a centered fan. Covers preserve intrinsic aspect ratio and have a
subtle directional binding and shadow. Monochrome service glyphs identify
Google Drive, Dropbox and OneDrive; mounted folders use a disk icon; browser-only
imports have no source icon. Missing/failed artwork remains an accessible title
cover. Labeled menus, keyboard focus, reduced motion and forced colors use the
existing UI primitives.

Visible connected EPUB covers load through a two-worker, bounded preview queue,
without importing a book or changing reading state. Only selected manifest
resources are decoded for previews; thumbnail cache entries are capped at 1 MiB
and 500 entries. Refresh rescans before replacing the last usable catalog and
invalidates preview generations. Failed scans do not delete books or history.

Direction uses explicit EPUB spine page progression first, then text-weighted
computed writing-mode/direction from a sanitized scriptless, networkless frame.
Language is never a binding-direction heuristic. Ambiguous/missing evidence and
unresolved styles remain unknown; the book menu allows a cover-only override.
The reader's own layout and user-selected writing mode are not changed.

## Qualification

Production-code unit tests cover flattening, nested ordering, filter identity,
YAML, progress parsing, completion dates/stale autosaves, and direction policy.
Browser qualification exercises the actual built application and real browser
filesystem handles, not replacement UI or intercepted network requests.
Recorded results and any unexecuted platform boundaries are kept in the PR.
