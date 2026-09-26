# Layered page turns on the Foliate EPUB reader

This change is stacked on Foliate migration PR #49 (`8699d92a`), which is stacked
on reader integration PR #47. It retains that migration's activation gate:
`localStorage.setItem('manabi-dev-foliate-epub', 'true')`, followed by a reload.
Removing the Foliate migration gate is a separate release decision. Continuous
reading and non-EPUB readers keep their existing implementations.

## Presentation and input

The source prototype is `apple-books-slide-poc` at `f2f51f5d`. A forward turn
slides the current sheet off the next page. The underlying page moves 15% of
reader width and loses a 24% black shade. A backward turn brings the previous
sheet over the current page with the inverse dimming. Both use horizontal screen
coordinates, including vertical Japanese whose internal Foliate layout scrolls
vertically. RTL reverses the physical directions. The page frame and moving sheet
fill the viewport and share `--reader-page-radius` (55px on phones, 20px on larger
windows). Reading margins and safe-area insets sit inside the moving sheets. There
is no drop shadow; the full underlying page receives only the dimming overlay.
Browsers do not expose a physical display's corner radius.

The first turn intent immediately collapses the controls, including the floating
toggle and bottom action buttons. The bottom-center indicator is inside each
sheet, so both outgoing and incoming labels move and dim with their paper. Tapping
the active indicator toggles the controls: a known page displays `13` while hidden
and `13 of 15` while expanded. If later chapters remain uncounted it displays `13`;
if a preceding chapter is unknown it displays a character-weighted percentage.

Chapter counts are measured sequentially in an inert, invisible Foliate view at
the same layout and typography as the active reader, after fonts and images
settle. This work yields between chapters and never navigates the visible reader.
Four layout results are cached in memory for the current book's reading session.
ResizeObserver and typography changes select a new layout key and cancel stale
measurements; returning to a cached layout reuses its counts. Prefix counts become
available before the complete total, and the active chapter is immediately known.

Touch displacement controls a turn after horizontal intent is established.
Long presses, existing selections, taps on links/ruby/images, and pinch zoom
keep their document behavior. Horizontal drags can start on illustrated pages;
only a claimed drag suppresses its subsequent click. Mouse drags in the page margins turn
pages; mouse drags on text select text. Horizontal trackpad/wheel input and
vertical mouse-wheel input are accumulated as distance, including line/page delta
modes. A wheel gesture settles after 180ms of quiet. Half a page commits the turn;
a shorter drag returns to the starting page. Arrow/Page keys and page controls
use the same preparation/promotion path. Reduced motion removes the settling
animation while keeping direct manipulation.

Unlike the demo's transparent input overlay, the live iframe remains available
for selection and dictionary hit testing. Therefore content gestures use a small
pointer/wheel adapter rather than a native scroll rail or ScrollTimeline. Browser
wheel events do not expose a reliable distinction between fingers and momentum;
physical trackpad feel remains an acceptance item.

## Ownership

The paginator owns at most the committed view, one prepared neighboring view,
and one invisible background measurement view.
Preparation emits no load/relocate event and cannot update bookmarks or progress.
Promotion reuses the prepared sheet in place: reparenting an iframe would reload
its browsing context. Consumers receive the new active document only on commit,
followed by exactly one page relocation. Cancellation leaves the original document
and reading location intact. Resource references, stale asynchronous loads,
resize, typography changes, external navigation and destruction are fenced.

Theme variables are copied across the iframe boundary; the paper is opaque so
text cannot show through the overlapping sheets. Selection, locator projection,
character progress and annotations continue to use the committed document.

The Foliate dependency includes the archive opener and module-resolution repairs
needed by this integration.
Existing cross-resource link regression coverage also caught the saved-content
sanitizer dropping importer-generated chapter targets. Only bounded chapter
indices and fragment IDs are retained during stored-book reads; raw imports still
discard supplied navigation metadata. Fragment-only links are resolved against the
app URL so they remain valid inside a blob-backed iframe.

## Verification

```sh
node --test tests/unit/foliate-*.test.mjs
BASE_PATH=/reader-web pnpm build
python -m pip install 'playwright==1.55.0'
python -m playwright install chromium webkit
python tests/browser/test_foliate_slide.py
SLIDE_BROWSER=webkit python tests/browser/test_foliate_slide.py
```

The gesture tests import text-only EPUBs through the built application's UI, inspect both directions
at 25/50/75%, reverse held gestures, exercise wheel/keyboard/reduced motion,
selection, chapter seams, stale preparation, reflow and teardown. Trusted touch
drags use Chromium's input protocol; WebKit runs the other tests. Screenshots are
written to `test-results/foliate-slide/` and uploaded by the dedicated CI workflow.
The fixture observes the closed shadow root without changing its mode or replacing
production rendering. Geometry assertions include actual computed transforms,
layer order, matching corners, opaque paper, full-viewport sheet/background/shade
bounds, absence of sheet shadows, and bounded iframe count. Chapter links are
exercised after promoting a prepared iframe.
Additional tests compare background counts with every foreground chapter, resize
the reader, change text size through the appearance UI, verify indicators on both
sheets, and delay real resource loads to exercise each partial-count state. Unit
tests cover prefix arithmetic, label formatting, cached layouts, and stale jobs.

Physical iPhone Safari and Mac trackpad acceptance is still required for hardware
feel; desktop WebKit and Chromium input emulation do not establish that result.

The image-containing regression EPUB fails during import in Playwright WebKit on
both macOS and Linux, before Reader opens. The macOS native IndexedDB Blob-write
error was independently reproduced in a minimal database probe. This storage
dependency issue remains unresolved. The gesture suite uses a text-only EPUB on
both engines so it exercises real import, rendering and input without a storage
mock. The existing Chromium security/Japanese-content regression retains its
embedded image coverage; passing WebKit gesture tests do not establish image-import
compatibility.
