# Layered page turns on the Foliate EPUB reader

This change is stacked on Foliate migration PR #49 (`8ced19ee`), which is stacked
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

The paginator owns at most the committed view and one prepared neighboring view.
Preparation emits no load/relocate event and cannot update bookmarks or progress.
Promotion reuses the prepared sheet in place: reparenting an iframe would reload
its browsing context. Consumers receive the new active document only on commit,
followed by exactly one page relocation. Cancellation leaves the original document
and reading location intact. Resource references, stale asynchronous loads,
resize, typography changes, external navigation and destruction are fenced.

Theme variables are copied across the iframe boundary; the paper is opaque so
text cannot show through the overlapping sheets. Selection, locator projection,
character progress and annotations continue to use the committed document.

The stack also repairs an existing PR #49 archive-index refactor that had removed
the `openFoliateEpub` function, leaving invalid asynchronous code in a synchronous
indexing helper. This prerequisite repair is a separate commit.
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

The tests import EPUBs through the built application's UI, inspect both directions
at 25/50/75%, reverse held gestures, exercise wheel/keyboard/reduced motion,
selection, chapter seams, stale preparation, reflow and teardown. Trusted touch
drags use Chromium's input protocol; WebKit runs the other tests. Screenshots are
written to `test-results/foliate-slide/` and uploaded by the dedicated CI workflow.
The fixture observes the closed shadow root without changing its mode or replacing
production rendering. Geometry assertions include actual computed transforms,
layer order, matching corners, opaque paper, full-viewport sheet/background/shade
bounds, absence of sheet shadows, and bounded iframe count. Chapter links are
exercised after promoting a prepared iframe.

Physical iPhone Safari and Mac trackpad acceptance is still required for hardware
feel; desktop WebKit and Chromium input emulation do not establish that result.

Local verification on macOS: the installed Playwright WebKit 26 runtime failed
before Reader opened, with a native IndexedDB Blob-write error reproduced in a
minimal database probe. This is not recorded as a passing WebKit result. The
Linux WebKit CI leg still exercises real import and rendering without a storage
mock. Chromium covers the actual built application locally.
