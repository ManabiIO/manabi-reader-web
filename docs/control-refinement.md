# Button shapes and modal behavior

Manabi's shadcn-svelte controls remain a web adaptation, not a SwiftUI replica.
Apple's WWDC25 guidance makes bordered buttons capsule-shaped by default and
specifically retains rounded rectangles for mini, small and medium macOS controls.
It does not establish a universal capsule rule for every button style.
Reference: https://developer.apple.com/videos/play/wwdc2025/323/ (Controls, 14:03).

## Web control mapping

| Context | Automatic shape |
| --- | --- |
| Regular / large primary, secondary, outline and destructive buttons | Capsule |
| Compact xs / sm buttons | Rounded rectangle, 6 / 8 px corners |
| Ghost buttons | Rounded rectangle, with size-specific corners |
| Text links | No filled container or automatic radius |
| Generic icon buttons | Rounded rectangle unless explicitly changed |
| Modal dismiss control | Explicit circle, with a 44 px minimum hit target |

The `shape` property supports `auto`, `rounded`, `capsule` and `circle`. Use explicit
shapes for contextual controls instead of making every button inherit one radius.
The compact-size choice is an intentional density decision for this cross-platform
web app; it is not a claim that native iOS bordered buttons follow that same matrix.
Coarse-pointer hit targets grow independently of shape. Embedded input controls
forward their actual size. Text labels can wrap and grow vertically; icons remain
square. Activation changes color rather than translating the control.

## Modal contracts

Shared headers reserve the dismiss target. A bounded one-column grid allows long
labels and enlarged text to shrink/wrap rather than causing horizontal overflow.
On opening a dialog, focus a visible editable field, or the dialog itself when the
first control is below a long description. Do not start an information dialog
already scrolled to its footer. Callers may override `onOpenAutoFocus` explicitly.
`closeDisabled` prevents X, Escape and outside-pointer dismissal while a collection
write is pending; it does not prevent deliberate programmatic closing on success.

Search projection and its worker are allocated on demand. Failed worker creation,
runtime errors and message deserialization errors settle the busy state and offer
retry. A dismissed IME composition does not block the next opening. Existing
locator-generation fences still protect navigation after dismissal or replacement.

## Verification

`tests/unit/button-render.test.mjs` compiles and renders the actual Svelte controls,
including the 48 style/size combinations and explicit shape overrides.
`tests/browser/test_control_refinement.py` inherits every existing modal regression
and adds worker recovery, interrupted IME, distinct button shapes, landscape notes,
reduced-motion press behavior and a real queued IndexedDB collection write.
The Appearance workflow runs this suite through the later combined Apple-controls
entry point in Chromium and WebKit.

## Follow-up reassessment of #41

- Navigation now uses the same circular dismissal primitive instead of its
  remaining absolute-positioned text Close control.
- The visible-field / modal-start autofocus policy also applies to sheets,
  preserving caller overrides. A long book title must not open Search Book
  already scrolled past its heading and close button.
- Search results share the sheet's outer scroll area. The previous nested flex
  scroller could collapse to zero height in short viewports with large headers;
  its buttons could exist in the DOM but be impossible to click.
- Forced-colors dismissal has an explicit system-color border. Contrast tests
  preserve the useful palette coverage from overlapping #40, without restoring
  its blanket capsule rule or adding a second modal layout implementation.
- The real search worker now stops at its 10,000-result cap when that limit is
  reached in a short final chunk as well as a large intermediate chunk. Direct
  bundled-worker tests cover the cap, Unicode coordinates, cancellation and
  request-scoped error recovery.

Additional actual-app browser cases cover enlarged landscape search, navigation
header geometry/focus return, pending selection versus a new query, and forced
colors where the engine supports emulation. These are part of the combined
Appearance suite, not a substituted UI scaffold.

## Text-only scaling

The shared dismissal stays 44 CSS px with a fixed inset/reservation. Dialog
padding and viewport gutters likewise stay bounded so 200% text does not reduce
headings to one or two characters per line. Full-page browser zoom still scales
the CSS pixels; this does not cap text sizes or the generic text-button size
matrix. Collections retain full-height groups in the outer sheet scroller, and
the 320px/200% regression checks readable headings as well as normal Rename/Save
clicks. The notes import label also reflects its disabled input during writes.

## Apple.com action hierarchy (2026-09-25)

References reviewed: https://www.apple.com/ and https://www.apple.com/mac/.
The homepage pairs prominent filled and outlined actions; the product pages also
use lighter text links. These are visual references, not native iOS shape rules
or a claim of an exact copy of Apple's stylesheets. Manabi keeps its own brand
red/gold, theme tokens, fonts and shadcn-svelte/Bits UI implementation.

- `default`: opaque accent fill, normal-weight label, subtle opaque hover tint.
- `outline`: transparent surface, 1px accent border and label; fills on hover.
- `secondary`: quiet neutral fill for supporting actions and utilities.
- `ghost`: unbordered application utility, with a restrained hover surface.
- `link`: text action with hover underline, no empty capsule/border/padding;
  add an aria-hidden chevron at navigation call sites rather than forcing every
  link to imply navigation.
- `CloseButton`: the existing neutral 44px circle, with independently tinted X.

The app still reserves automatic capsules for regular/large bordered actions;
compact/embedded controls keep their own shapes. Large calls to action use 17px
at a 16px root size and 22px side insets. These are our chosen web proportions,
not measurements attributed to Apple. Text can enlarge and wrap; no fixed-height
text clipping or press translation is used. The main empty-Library import is
prominent; migrations are text links; storage connections stay neutral.

The custom-theme input migration initially passed type checks but crashed during
client mounting: its bound ref was undefined while Input defaults to null. The
caller now initializes the ref to null. Filter/Tracker also now each render one
visible Bits UI title, rather than both a hidden title and a duplicate heading.
The original browser regressions remain; the new combined Apple controls entry
point adds real idle/hover/contrast/geometry checks, native import activation,
repeated theme-editor opening, validation, cancellation, and saving.
