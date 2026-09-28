# Reader Contents and dialog refinement

Review date: September 28, 2026. Initial integration base:
`077c2b00f9d835e624df40d49d140e2155be7254` (main after #74 and #80).

## Design direction

Continue the existing Manabi control system rather than starting another redesign.
Apple Books is the reference for content-led reading and a clear chapter list;
Apple.com is the reference for primary, neutral and text-action hierarchy. The
public App Store Connect Analytics redesign is the reference for quiet management
surfaces, thin separators and restrained selection states. It is not a reason to
turn every control or information group into a large filled card.

Public references reviewed:

- [Apple Books user guide for Mac](https://support.apple.com/guide/books/welcome/mac).
- [Apple Mac website](https://www.apple.com/mac/).
- [App Store Connect Analytics](https://developer.apple.com/app-store-connect/analytics/)
  and its public product screenshot.
- [App Store Connect release notes](https://developer.apple.com/help/app-store-connect/release-notes/):
  Analytics changed March 25, 2026; the May 28 home-page change opens directly to
  Apps with top navigation. These are distinct updates, not a claim that every
  authenticated screen was inspected.

Contents now has a wrapping book title, a compact progress summary separated by
one rule, quiet selected chapter rows and the existing neutral circular dismissal.
The Sheet is the sole scroll owner: short landscape viewports and enlarged text
must not squeeze the chapter list between oversized fixed header/footer regions.
Footer actions wrap and remain reachable through ordinary scrolling. Position,
confirmation and message dialogs reuse the existing Manabi Input/Button primitives,
including the primary/neutral distinction and at least 44 CSS px action height.
No Apple assets or font files are copied.

## Reproduced correctness findings

- Empty chapter data dereferenced a missing current section. An orphaned child
  could produce index -1, which the old boolean navigation check treated as true.
  The shared chapter model now represents absence explicitly and bounds both
  navigation directions. Vertical-mode direction labels are retained.
- Zero/malformed chapter weights could expose NaN as progress. Unknown progress
  now has an explicit unavailable state, not fabricated zero progress. Missing
  chapter counts and genuine zero-length chapters remain distinguishable.
- A Contents selection created an unowned global page-event subscription. Manual
  dismissal left it alive; a late event/timer could close a reopened panel and
  change tracker pause state. One panel-owned controller now cancels on dismissal,
  supersession and teardown, including callbacks already waiting to execute.
  It enrolls before navigation to retain synchronous cached-page events.
- The same empty chapter assumption affected the reading tracker's chapter ETA.
  It now reports N/A when chapter data or a valid reading speed is unavailable.
- Jump to Position did not validate an empty, fractional or out-of-range value
  before resolving, and always initialized to 1 even for a higher minimum.
  Submission validates finite safe integers and bounds, retains invalid input for
  correction and supports normal form submission. IME Enter does not submit while
  composing. Resolver/close dispatch happens at most once.
- Confirmation cleanup now settles at most once while preserving the existing
  callback convention: true means cancelled, false means confirmed.

The page-change event remains untagged. This patch owns listener lifetime and
preserves the existing 200 ms debounce; it does not claim that an arbitrary
renderer event proves completion of a particular navigation request. There is no
new timeout that resumes tracking before arrival.

## Verification

Executed locally with Node 22.16.0 against verified repository text sources:

```sh
node --experimental-strip-types --test \
  tests/unit/chapter-model.test.mjs \
  tests/unit/chapter-navigation.test.mjs \
  tests/unit/reader-dialog-results.test.mjs
```

35 cases passed, with no failures/skips/cancellations. Model tests execute the
production helpers. Navigation tests use native EventTarget and controlled timers.
Dialog tests execute the complete production component scripts with declared
Svelte lifecycle/dispatch substitutes; they are not rendered Svelte tests.

The exact same 13 dialog cases against the original production scripts gave
6 passes and 7 failures. All 13 pass after repair. The original scripts were
restored from verified Git blobs for that negative control, not reimplemented.

Python syntax checking and patch whitespace checking pass. A broader source-subset
run executed 482 passing cases but could not load 14 test modules because project
dependencies such as esbuild and fake-indexeddb were unavailable. It is not a
passing full-project run. Local source materialization omits dependencies and
binary assets; the pinned Node 24.21 / TypeScript 6 / Svelte build belongs to CI.

Five additional compiled-app browser journeys are registered by a non-TestCase
mixin in the existing Connect suite. All previous suites, assertions, security
checks and workflow permissions remain:

1. Contents chapter actions and close/footer remain reachable at 320x360 and 200%
   text, with one scroll owner and actual pointer hit testing.
2. Invalid position input stays open; valid Enter submission closes normally.
3. Error messages and shared dialog controls reflow in light/dark appearance.
4. The reading tracker opens for existing TXT support without chapter metadata.
5. Holding the real renderer's page-event dispatch, dismissing/reopening Contents
   and releasing those events cannot close the new panel.

These five browser cases are added qualification, not locally executed results.
The actual application/importer/native storage is used; only the final case holds
its event-dispatch boundary. Normal Appearance CI runs Chromium and WebKit and
retains screenshots. Physical iOS/macOS Safari, real IME, touch, safe-area and
screen-reader acceptance remain separate from automated desktop browser evidence.

## Integration boundaries

This change is separate from #72's modal/gallery/heatmap fixes and #83's Library
selection/metadata/chrome work. It preserves main's account ownership, direct
content identity and WebDAV repairs. No storage schema, account authority, book
bytes, dependencies, reader renderer, enabled formats, synchronization protocol,
feature gate or deployment changes are made. No PR is merged by this review.
