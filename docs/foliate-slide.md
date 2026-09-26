# Layered page turns on the Foliate EPUB reader

This change is stacked on Foliate migration PR #49 (`c8674948`), which is stacked
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
fill the viewport and share `--reader-page-radius` (square, 0px, unless an
embedding host supplies actual container geometry). Reading margins and safe-area insets sit inside the moving sheets. There
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
An unreadable chapter remains unknown while later chapters continue counting; a
later layout pass or foreground visit can retry it. Foreground measurements made
during an idle yield are reused rather than overwritten by unnecessary work.

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

Unlike the original prototype's transparent input overlay, the live iframe remains available
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
A pending chapter jump blocks swipe preparation, and superseded or destroyed
navigation releases late source URLs without publishing the stale chapter. Failed
chapter loads leave the current reading location intact. Promotion transfers
existing iframe focus so consecutive keyboard turns continue working. Writing
mode reflow updates both the viewport and the document's pagination axes.

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
tests cover prefix arithmetic, label formatting, cached layouts, stale jobs,
failed-chapter recovery, and foreground counts that arrive during an idle yield.
Regressions also exercise repeated keyboard turns in both reading directions,
horizontal/vertical mode changes, failed and superseded chapter jumps, late
resource release after teardown, and dragging from the page-number control.

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

## September 26 refinement: corners and rapid discrete navigation

The follow-up targets the integrated #55 source `92a53bfe9452ea0a3ad81824934113b369d82651`.
It does not enable the renderer gate, change release configuration, or merge the stack.

### Corners belong to the container, not a platform/device table

The old phone-55px/desktop-20px rules are removed. Both stationary and moving
surfaces resolve `border-radius: var(--reader-page-radius, 0px)`. An outer native
host or a deliberately rounded web container can set that inherited CSS token.
CSS shorthand permits asymmetric/elliptical corners. Remove the token when the
container is square or its geometry is unknown; clear stale values on window,
orientation, fullscreen, and display changes. Values must be expressed in the
web viewport's CSS-pixel coordinate system, not blindly copied as device pixels.
This patch provides the CSS contract; it does not add a Swift bridge.

There is no interoperable browser API for physical display/window corner radii.
`env(safe-area-inset-*)` gives a safe rectangle, not its enclosing curve. Insets
also reserve other UI; converting them to radii, sniffing the UA, or treating a
small viewport as an iPhone is not reliable. CSS `corner-shape` changes a drawn
curve; it does not detect hardware geometry. Square-by-default applies on iPhone
Safari too until geometry is supplied, rather than quietly guessing a radius.

Native SwiftUI now documents `GeometryProxy.concentricCornerRadii(in:)`, returning
optional radii for a specified frame relative to a known container shape. Its
current documentation lists it as beta, so a future native bridge must check SDK
and runtime availability, map physical corners, and handle `nil`. It is not a
promise to recover every physical screen shape automatically. In particular,
`containerCornerInsets` includes system controls and is not a substitute radius.

Primary references, reviewed 2026-09-26:
- https://www.w3.org/TR/css-env-1/#safe-area-insets
- https://developer.apple.com/documentation/swiftui/geometryproxy/concentriccornerradii(in:)
- https://developer.apple.com/documentation/swiftui/geometryproxy/containercornerinsets

### Leading animation, instant middle, animated tail

`PAGE_TURN_DURATION = 154` is exactly 70% of the old 220ms duration. It is shared
by discrete commands and gesture settlement; direct dragging still follows
pointer displacement. The existing cubic easing, layering, 15% parallax and 24%
under-page dimming are unchanged. Reduced Motion removes settlement animation.

The discrete sequence uses these rules:
1. An isolated request begins its animation as soon as the neighbor is prepared.
2. A request arriving while that turn is active finishes it immediately. Further
   intermediate neighbors are prepared and committed without animation.
3. Keep the newest neighbor prepared at progress zero, one turn ahead of the
   committed reading location. A subsequent request makes it an instant middle
   turn. Matched keyup, or 120ms without keyless button input, animates this final
   reserved turn once. No reverse-and-replay of an already committed page occurs.
4. `KeyboardEvent.repeat` and key identity survive the OS initial-repeat delay
   and iframe promotion. Keyup is observed in the outer document and active
   iframe. Custom Reader keybindings forward the same metadata through PageManager.
5. Preserve direction order, not just a net delta: impossible turns at a book
   edge must not cancel a later valid reversal. Equal consecutive directions are
   compacted as runs. Only one neighbor loads at a time. Loading is still async;
   removing animation waits does not eliminate actual chapter/font/layout work.
6. Resize, navigation cancellation, blur, hidden document, failure and destruction
   discard pending intents and stale results. One commit still emits one reading
   relocation. A canceled reserved tail is never persisted as a visited page.

The final request is necessarily held briefly: the controller cannot know which
request is last until release/quiet. While a key is held, committed location trails
requested location by at most the reserved neighbor once preparation catches up.
There is no queue of animations to play after release. If layout itself is slower
than input, ordered preparation still has to catch up; this is not an O(1) arbitrary
EPUB-location jump or a guarantee of native hardware latency.

### Standalone and tests

`node scripts/build-slide-demo.mjs` generates
`demos/apple-books-slide-poc/index.html` from the actual paginator, geometry,
page-count, gesture-controller and sequence modules. The output includes source
SHA-256 hashes and the Foliate license. No third-party network requests are made
by the demo. Source template: `demos/apple-books-slide-poc/template.html`.

New deterministic tests cover burst timing, key identity, slow preparation,
reversals, boundaries, reduced motion, failures, and cancellation. The built-app
`test_foliate_fast_turns.py` adds held-key cases in the outer document and both
LTR/vertical-RTL iframes, plus inherited asymmetric-corner checks. The original
keyframe suite now explicitly expects the square default instead of requiring a
nonzero radius. No original case or no-page-error assertion is removed.

`test_slide_demo.py` supports a served-HTML mode with real Blob URLs and an explicit
in-memory fixture mode. The latter feeds only the sample HTML through srcdoc and
preserves its fixture URL identity because this environment's about:blank origin
makes distinct blob:null URLs cross-origin. This adapter is test-only, is not in
the shipped HTML, and does not change sandbox attributes. In-memory passes do not
qualify HTTP/file launch, Blob lifetimes, EPUB import, or the full Svelte application.
The permanent Chromium CI step uses the served mode, without that adapter.
