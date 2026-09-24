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
| Ghost / link buttons | Rounded rectangle, with size-specific corners |
| Generic icon buttons | Rounded rectangle unless explicitly changed |
| Modal dismiss control | Explicit circle, with a 44 px minimum hit target |

The `shape` property supports `auto`, `rounded`, `capsule` and `circle`. Use explicit
shapes for contextual controls instead of making every button inherit one radius.
The compact-size choice is an intentional density decision for this cross-platform
web app; it is not a claim that native iOS bordered buttons follow that same matrix.
Coarse-pointer hit targets grow independently of shape. Embedded input controls
forward their actual size. Text labels can wrap and grow vertically; icons remain
square. Press translation only runs when reduced motion is not requested.

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
The Appearance workflow runs this combined suite in Chromium and WebKit.
