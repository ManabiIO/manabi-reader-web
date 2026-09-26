# Shared library interoperability and qualification

## Current boundary

A shared TTU library is `ttu-reader-data/<encoded-title>/`, not simply a folder
of EPUBs. Its book ZIP, progress JSON and day-statistics JSON use TTU exporter 1 /
database 6–8 filenames. New browser exports currently use database 8; the
Shared TTU libraries page uses the existing TTU storage engine,
not Manabi Web private sidecars. Native app integration is tracked by
`aehlke/manabi-reader#162`, based on the root app's main branch and Core#129.

The Accounts page's managed Google/OneDrive/Dropbox connections and its ordinary
EPUB local-folder mode currently use a different reading-state format. Full
native managed-source interoperability remains unfinished. In particular,
Google appDataFolder is private to its application, not a shared TTU directory.
No new provider or native transport is claimed by this safety patch.

## Fixed failure cases

- A same-titled local book cannot be silently rebound to a different filesystem,
  direct Google Drive, or direct OneDrive source while opening a shared book.
  Matching names alone are not evidence that packages or reading history match.
- The filesystem adapter with caching disabled re-enumerates current files even
  after a previous list/read. External replacement and disappearance no longer
  reuse stale handles. Removing cached directory entries does not delete local
  books, bookmarks, or statistics.
- Direct cloud readers use the same logical-file selector as local TTU folders:
  duplicate required payloads require repair rather than selecting the first
  file; unsupported versions fail closed.
- Selecting a per-book folder is rejected before creating a nested library.
  Opening a missing library cannot create one; explicit creation still works.

These guards do not turn filesystem writes into cross-process compare-and-swap.
They do not prove lossless simultaneous edits from unmodified upstream TTU,
cloud-client conflict resolution, OS picker dialogs, or completed cloud upload.
A successful local write is distinct from eventual iCloud/Drive upload.

## Verification layers

`tests/unit/shared-library.test.mjs` exercises production source identity and
file-format selectors with input/output assertions. No source-string checks.

`tests/browser/test_shared_safety.py` has two distinct layers:

1. Actual production static-app E2E: real EPUB parsing, TTU package publication,
   shared-library opening, preservation of a different local copy, and repeated
   imports of native-format day statistics without double counting.
2. Browser integration: production modules loaded by the project's Vite server,
   real IndexedDB and FileSystemDirectoryHandle objects. One actual filesystem
   adapter instance sees external revision replacement, conflict and disappearance.
   The actual Google/OneDrive open paths reject local source collisions before
   attempting authorization. This is not a live cloud-service test.

Vite is used only by the integration test and is terminated when the suite ends.
Production still uses the static adapter build under `/reader-web/`. No test
interface is added to the deployed app, and no browser method, network response,
storage handler, database, or reader UI is replaced. Native-format progress in
the browser fixture is intentional test input, not evidence that the Swift
coordinator has run. The native companion tests must run in the Apple workspace.
