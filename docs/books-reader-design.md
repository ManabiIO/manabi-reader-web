# Reader design: Books references, web adaptation

The reader should feel like a composed page, with a small set of reading controls
around it. The Library refinement is PR #26; this is a separate reader follow-up.

## References inspected

- [iOS 26 reader](https://support.apple.com/en-ca/guide/iphone/iphc1af7c57/26/ios/26):
  lower-corner reading menu, quiet page progress, close-book action, and a Themes
  & Settings panel over the page with A/A size controls and visual theme choices.
- [iPadOS 26 reader](https://support.apple.com/en-ca/guide/ipad/ipadc8494b6b/26/ipados/26):
  generous page margins, a centered reading column, chapter context above the
  page, and a small menu at the lower corner. Extra screen width does not mean
  stretching every line to the window edge.
- [macOS Tahoe appearance](https://support.apple.com/en-ca/guide/books/ibks8923126d/8.0/mac/26):
  reading appearance stays in the book; width determines whether a spread fits.
  Font, appearance mode and layout are separate choices.

Apple's version selector is explicitly 26. Preserve the Rhea/shadcn foundations:
opaque surfaces, restrained dividers, existing theme tokens, Phosphor icons,
Bits UI keyboard behavior and a web-appropriate Library back action.

## Implementation

1. Replace the invisible top reveal strip with an always discoverable 44px
   reading-menu button near the lower-right corner. Opening it reveals a quiet
   toolbar with the book title, Library and Bookmark. Commands use familiar
   icons and plain labels. Keep every existing reading command reachable.
2. Themes & Settings opens over the page. Large size controls, a font selector,
   visual theme tiles, System/Light/Dark, line spacing and Pages/Scroll update
   existing preferences. Advanced settings remain available. Do not invent
   brightness or device-orientation controls that the web cannot provide.
3. Reserve real space for the controls and safe areas in the reader's measured
   container. Use deliberate desktop margins, preserving explicit user measure
   settings and the existing pagination/position engine. Japanese vertical text,
   ruby, images and explicit fonts remain authoritative.
4. Center the quiet progress readout. Audio, tracking and sync use labelled
   icon buttons; expanded chrome exposes detailed progress controls. Do not invent page totals or
   time remaining from character counts.
5. Refine Contents with a clear title, current-chapter treatment, larger rows,
   readable progress, a full-width phone sheet and a 448px desktop side panel.

## Acceptance

Use actual browser interactions at phone, iPad and Mac widths in Chromium and
WebKit, including touch and keyboard. Verify menu focus and outside dismissal,
font/theme/mode persistence, position after reflow and reload, vertical and
horizontal books, safe-area/control clearance, long titles, Contents navigation,
selection and ruby ownership, completion, tracker and audiobook entry points.
Refresh before/after screenshots of reading, menu, appearance and Contents.

## Interaction details

The closed reading chrome keeps a 44px reveal button at the lower right and a
muted book title above the text. Expanded controls expose Library, Contents,
Bookmark, Themes & Settings and the existing reading commands. Physical padding
is measured by the pagination engine: phone pages reserve 72px above and 120px
below, while wide Japanese pages use a maximum 960px reading measure. Horizontal
pages retain the existing automatic column behavior and explicit user measure.

Themes & Settings uses the existing persistent preferences, including optional
account settings sync. Six visual theme tiles, appearance mode, text size, font,
line spacing and Pages/Scroll stay in the book; All Settings opens the complete
settings workspace. Imported or explicitly selected fonts remain available.
Closing the sheet returns focus to its live trigger or the persistent reading
control if outside dismissal has already collapsed the toolbar. The backdrop
handles fast touch taps directly, without depending on delayed outside-click
registration in the dialog library.
