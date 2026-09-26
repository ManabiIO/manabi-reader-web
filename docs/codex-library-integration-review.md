# Codex integration review — 26 September 2026

Reviewed integration PR #55 at `73cab94de4c728ef4ad985df20dd88b13e7e0ebb`,
whose captured test composition is `8d6892205275404b7811463509a1f6b9fdffd535`.
Main is `3e04c3e36122e2200851b637477ca013c3c034b0`; old feature PR #43 remains
at `e0c941a59237343a66adb463f1de7fb9cc49c054`. The new work belongs on the
integrated stack, not a rewrite of #43.

The integrated branch already retains the local-library lifecycle repairs,
content-keyed same-title imports, WebKit byte-record persistence and the combined
schema upgrade, personal-sync changes, and the gated EPUB/Foliate stack. None of
those is reverted or independently reintroduced here. Renderer/release flags,
backend activation and original EPUB files remain unchanged.

## Reproductions and repairs

### Duplicate Library command and settings status ambiguity

The integrated header rendered two User guide commands. The existing strict
browser assertion failed in Chromium and WebKit. Remove the redundant plain
entry and retain the icon-bearing help command. Do not select the first duplicate
or relax the cardinality requirement.

The new offline status panel also exposed a flaw in a settings test: its CSS
selector matched both the search summary and an unrelated hidden status panel.
The search summary now has an accessible name and an ID associated with the
search field. The test targets that named status while preserving its actual
no-match assertion, reflow checks, themes and text scaling. The search behavior
itself was not broken in the baseline.

### Same-title sharing must not collapse distinct books

Two actual EPUB imports with equal titles and distinct contents reproduced a
Svelte duplicate-key error on the TTU sharing page. Publication choices now group
by the legacy folder title, show the number of copies, and disable ambiguous
choices without merging or deleting their independent local identities. Another
unambiguous book remains publishable in the same folder.

The transfer boundary now reads enough matching local records to detect ambiguity
before either import or publication. It rejects ambiguity rather than accepting IndexedDB's first title
match. The runtime regression uses real IndexedDB and an actual OPFS directory;
a rejected import/publication preserves both local copies and every remote byte.
TTU's title-addressed wire format is not replaced with a new schema.

### The shared publication list bypassed Library ownership filtering

A linked book hidden from the anonymous Library remained visible on the shared
publication page. The regression establishes the same stored book/link and
compares the two real routes. Sharing now reuses the existing account-visibility
rule and clears selection when the account changes. The transfer boundary reads
stored ownership links independently of the displayed choices and refuses a
foreign-account book before starting a transfer.

Account changes also cancel a queued source lock and feed the existing
replicator's cancellation signal. A real-lock regression changes away and back
before releasing the lock, verifies no transfer or source binding occurred, then
successfully performs a fresh explicit publication. The test intentionally drives
the real account store through the development module entry point; it does not
claim to execute a production authentication server.

Cancellation cannot undo an already accepted filesystem write or an already
committed transaction. This change does not make filesystem operations and the
two browser databases one atomic transaction, nor coordinate another reader app.

### A changed shared package bound the wrong local copy

Codex's content-aware import correctly preserves a changed package as a distinct
local book. The old sharing code then found a book by title again, updating the
oldest copy instead of the ID actually saved. A real TTU package/progress import
reproduces the new copy without its source association.

A narrow BrowserStorageHandler subclass records the real save result while
reusing the complete existing serializer/replicator. Source binding uses those
IDs, or the explicitly selected publication IDs, and reads current stored byte
records in one transaction. It only updates source metadata; it no longer
re-encodes and writes an older full-book snapshot. Missing or renamed targets
fail visibly, and a native abort drains transaction completion. Existing book
content and reading positions remain intact in the regression.

An updated package may leave two same-title copies intentionally. Further
legacy-title sharing requires resolving that ambiguity; it never silently picks
one. A TTU package export is still not a full Manabi notebook backup.

## Qualification design

Six new real-browser regressions cover duplicate-title UI/recovery,
foreign-account visibility, ambiguous transfer rejection, queued account
cancellation/retry, changed-package source binding, and all five legacy
filesystem/cloud cached-open entry points. Two unit additions cover pure
selection/ambiguity contracts including placeholder and prototype-like
titles. The existing native-format round trip and source-isolation assertions
are retained.

Shared TTU qualification now uses Playwright 1.63.0, matching the integrated
browser suites, and per-test persistent profiles for actual stored directory
capabilities. An ephemeral Chromium profile crashed locally when navigating with
those capabilities; that is not presented as an application repair or as private
mode certification. The static source-isolation test targets the named Read
button, rather than a text descendant. No page-error suppression or request
interception is introduced.

The existing runtime tests run the repository-local Vite executable directly;
this avoids requiring a separate package-manager executable merely to launch a
server after dependencies are installed. Final CI identities and outcomes belong
in the PR, not inferred from the previously green local-library checks.

Local validation: static build; default unit suite; Svelte check (zero errors,
one pre-existing unused `isBookmarkScreen` export warning in the gated Foliate
component); recommended component lint; and the named browser regressions.
Local WebKit lacks ICU 74, so WebKit execution must be verified in Ubuntu CI.
The baseline broader Appearance suite also recorded a WebKit optional-catalog
fetch error during navigation; its outcome must be checked separately rather than
hidden by these fixes.

## Primary references and limits

- [Playwright locators](https://playwright.dev/python/docs/locators): prefer named
  interactive roles; strictness is an assertion, not something to bypass with
  first-match selection.
- [Web Locks](https://www.w3.org/TR/web-locks/): queued cancellation differs from
  cancellation after grant; locks do not coordinate other devices.
- [IndexedDB](https://www.w3.org/TR/IndexedDB/): request success and transaction
  completion are separate, and read/write isolation is scoped to its stores.

This is an integration-boundary review, not certification of every EPUB,
physical iPhone, NAS provider, or all 300-plus commits in the stack. It adds no
runtime dependency, server, database schema, or permission. The browser test
version change does not change shipped application dependencies.

## Follow-through on legacy opening and final visual inspection

The explicit transfer fix initially left a related first-title assumption in
filesystem opening and the common Google Drive/OneDrive cached-read adapter.
The actual production adapters returned the first ID (or true for cached data)
when two different local editions shared both title and source. All five entry
points failed the new ambiguity regression. They now use one bounded selection
helper before remote access, reuse the same ambiguity rule, retain the existing
source guard, and decode the exact selected record snapshot. Reading a unique
cached copy still works on all three providers after the duplicate is resolved.
No cloud authorization or external provider is exercised by that regression.

Final sharing screenshots also exposed adjacent navigation links rendered
without readable separation. The shared navigation now has explicit spacing,
with a geometry assertion alongside the existing real two-copy UI test. Runtime
adapter tests wait for the real Svelte input action and hydrated Library rather
than treating an SSR-visible command as initialized stores. No arbitrary sleep
or error suppression is added. Local runtime startup was intermittently slow;
the final permanent nine-case safety suite passed in 42.2 seconds after the
hydration wait, with the two static sharing UI cases also passing.

The first #57 composition `2ae41bcdc3fd2fc10d892db05d647122ef7e031b` passed
Shared TTU, Books Library, Local Library and Appearance qualification. Its gated
Foliate WebKit keyframe case failed because `preparePageTurn` returned null
before `window.prepared.update` in the RTL case; this is not diagnosed as a
product defect versus a reflow/readiness race here. The failed matrix also skips
Chromium-only trusted-touch tests by design. That separate renderer result must
not be presented as green or silently waived. Final successor CI evidence belongs
in the PR rather than being inferred from those earlier results.
