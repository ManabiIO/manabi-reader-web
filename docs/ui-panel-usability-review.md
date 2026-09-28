# Custom-panel usability review — September 28, 2026

Base: `d0afc6fab0530c597e68b5345ab28ab138d16ac1` (current main after #68).
This follows the earlier Apple.com / App Store Connect design work without
reopening closed #41 or changing the source-identity, storage, or video stacks.

## Findings and implementation

- Heatmap details still positioned a small ghost X over arbitrary text. The
  shared 44px neutral circular close now owns a header column; date and details
  wrap in a viewport-bounded panel. Escape/X returns focus to the selected day;
  outside-pointer dismissal does not steal focus from the clicked destination.
- The externally anchored popover toggled closed on repeated activation.
  `openAt` is idempotent; queued day selection is fenced against replacement,
  year/filter changes and destruction. The wrapper also fences its delayed
  open notification. Existing ordinary popover Trigger toggling is retained.
- Heatmap days were hundreds of independent Tab stops with incomplete button
  emulation. Native buttons now provide Enter/Space behavior; one roving stop
  retains the chosen day. Arrows move days/weeks, Home/End move to week edges,
  Control+Home/End to year edges. Padding cells stay disabled and unannounced.
  The calendar remains a named group, not an incomplete ARIA grid. Chart cell
  size is intentionally distinct from the 44px dismissal target.
- Calendar cells could grow but never shrink on resize, and month-label columns
  were reused across different years/week starts. Layout now uses the actual
  remaining grid width and rebuilds month columns from current calendar days.
  Day focus has a visible ring and reveals itself past sticky weekday labels.
- The title filter's sticky bars could cover focused checkboxes despite passing
  viewport-intersection checks. Measured scroll padding and focus reveal keep
  controls in the usable center. When fewer than 160 CSS pixels remain between
  bars, both return to normal flow rather than swallowing a short viewport.
  Draft selection and Apply/Cancel semantics are unchanged.

The implementation continues the existing quiet workspace hierarchy: neutral
panel surfaces, restrained borders, dedicated circular dismissal and readable
text rather than additional glass/blur or decorative motion. Heatmap entrance
animation now respects reduced motion.

## Verification boundaries

`panel-usability.test.mjs` tests production calendar navigation/geometry and
sticky-inset calculations. `test_panel_usability.py` adds six independent
actual-app cases to Appearance in Chromium and WebKit, including pointer hit
checks (not just element visibility), enlarged text, short viewports, native
keyboard activation/focus return, repeated activation, and calendar resizing.
The original suites remain enabled. The existing heatmap test now focuses its
chosen date before checking the single retained tab stop; it no longer assumes
the test fixture's date is the machine's current date.

Local environment: Node 22.16.0, no installed project dependencies or browser
executables. Pure tests and standalone helper type checking can run locally;
Svelte compilation and actual-app browser acceptance require the CI toolchain.
Do not substitute component/model results for browser or physical iOS evidence.
Main's baseline Appearance run 36393688231 already failed the WebKit catalog
account-switch teardown on an access-control fetch error. That unrelated failure
is not waived by this change. Exact follow-up status belongs in the PR.

Primary implementation references:
- https://www.bits-ui.com/docs/components/popover
- https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- Apple references and their public-only scope remain in
  `app-store-connect-ui-review.md` and `control-refinement.md`.


## Input ownership and final visual follow-up

The shared Tab fallback formerly picked the first selector match rather than the
first usable Tab destination. Two native Chromium fixtures reproduce the defect:
a disabled-fieldset input leaves focus outside, while a negative-tabindex button
is incorrectly focused. Light-DOM candidate selection now respects native
`:disabled` (including first-legend exceptions), negative indices, hidden/inert
content, checked-radio groups and positive Tab order. This remains a fallback for
our ordinary portaled modal content, not a new shadow-DOM focus manager.

A deferred fallback must also honor newer input. Bubble-phase cancellation, a
subsequent pointer gesture, a newer dialog awaiting autofocus, browser modifiers,
and closed/disconnected contexts cannot be overruled by the pending frame. The
normal Bits UI focus scope remains the primary owner. No dependency is added.

Gallery wheel handling is attached to the viewer, not the window. Browser zoom,
modified/horizontal gestures, other panes and genuinely scrollable image regions
keep their native behavior. Configured unmodified navigation remains available;
native Enter/Space control activation, IME, editing and modal Tab/Escape take
precedence. Delayed thumbnail/viewer focus is canceled by a newer choice or close.
The full-screen header and scroll areas have safe-area-aware padding and visible
viewer focus. Physical mobile zoom/safe-area qualification is still separate.

The previous head's rendered 200%-text heatmap capture showed the year squeezed
between two utility buttons. The heading and utility group now wrap as units;
the year never breaks into individual digits. No text-size reduction is used.

Validation is layered: lifecycle/input unit tests use declared platform doubles;
eight native DOM cases bundle the real focus helper and real candidate selection;
the gallery and heatmap regressions run against the built app. Local native DOM
execution used the production TypeScript with type syntax/import/export wrappers
removed, not a second focus implementation. Local Chromium passes those eight
cases; actual-app localhost navigation is blocked in this environment. The CI
build and Chromium/WebKit app suites remain required. All existing suites stay
enabled. Current commit IDs, totals and integration results belong in the PR.
