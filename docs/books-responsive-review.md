# Books Library responsive refinement

This pass adapts the recent Apple Books references supplied for the Library to
the existing Rhea / shadcn-Svelte interface. It keeps the neutral appearance
tokens, Bits UI menus and sheets, Phosphor library icons, and the personal-library
scope. Bookstore, discovery, and purchase interfaces are outside this design.

## Reference review

Reviewed Apple's own screenshots with the version selector explicitly set to
iOS 26, iPadOS 26, and macOS Tahoe 26 (not the guide's newer default):

- [iPhone: Organize books](https://support.apple.com/en-ca/guide/iphone/iphab219b91/26/ios/26)
  shows a two-column cover grid, the paragraph-shaped Collections action beside
  overflow, and a small progress/ellipsis row beneath each cover.
- [iPad: Organize books](https://support.apple.com/en-ca/guide/ipad/ipad5ecae3c6/26/ipados/26)
  shows a four-column portrait shelf and an anchored Collections surface with
  an Edit action. Available width determines our compact layout; a wide iPad
  window can use the same persistent sidebar as desktop.
- [Books for macOS Tahoe](https://support.apple.com/en-ca/guide/books/welcome/8.0/mac/26)
  shows Library and My Collections groups in a persistent sidebar, a serif
  destination heading, and cover-led shelves without surrounding cards.
- [iPhone: Read books](https://support.apple.com/en-ca/guide/iphone/iphc1af7c57/26/ios/26)
  shows unobtrusive reading controls and a Themes & Settings surface over the
  page, with font size, appearance, and layout controls together.

We borrow that hierarchy and spacing while retaining Rhea tokens, opaque
surfaces, web search, accessible menu behavior, and the requested system-font
app name. Apple store tabs, purchase states, and glass effects do not belong in
this personal-library adaptation.

In the iPhone reference, the horizontal gap between covers is about 16% of a
cover's width. Our 390-pixel shelf uses a 24-pixel gap between 159-pixel covers,
or 15%, so the grid is already close in proportion. Apple's roughly 61-pixel
vertical gap lies below its large **Library** destination title; its screenshot
does not have Continue cards or a separate Books heading. Applying that gap to
our smaller section headings would exaggerate the whitespace the current
refinement is intended to remove. The measured web heading-to-Continue-card
gap is 20 pixels after the adjustment.

## Implemented

- The desktop collection sidebar is a full-height navigation surface beneath
  the toolbar, with a quiet divider and consistent section labels. It no longer
  looks like a detached settings card. Account-sync explanation remains in the
  Collections sheet, where organization is managed. Its sticky position follows
  the measured toolbar height, including the contextual selection row.
- The root has a Books heading, or Continue followed by Books when reading
  history exists. Search sits at the end of the top navigation bar: an inline
  field in regular layouts and a magnifying-glass button that opens a focused
  field in compact layouts. The system-font Manabi Reader for Web brand remains
  in that bar; pushed destinations retain their back action and title.
- The section rhythm is measured from element boxes instead of visual guesswork:
  the Continue heading ends 20 CSS pixels before its cards (a 16-pixel margin
  plus the scroll track's 4-pixel focus-outline inset). The Books heading has
  a 16-pixel margin beneath it, and the Continue-to-Books section gap is 28
  pixels (40 pixels from the visible card bottom, including the track's 12-pixel
  bottom inset). The older layout reserved a 44-pixel search-height row plus 28
  pixels below it, which made the content look detached from its heading,
  especially on desktop.
- Covers use a fluid grid based on the available shelf width. Two columns fit
  even at 320 CSS pixels. Wider shelves grow covers until another minimum-width
  column fits, then redistribute the space. Spacing is relative to the shelf,
  including the space consumed by the desktop sidebar.
- Series artwork stays behind and above-left of its front cover. Status rows
  align with individual books. Series hero and Finished timeline breakpoints
  use the content container instead of viewport width, so the sidebar cannot
  force a two-column hero into insufficient space.
- The directional binding crease is narrower, with lower-contrast shadow and
  highlight stops, closer to the subtle fold visible in the Apple references.
- The compact Collections sheet keeps its title and Edit/Close actions in a
  single nonoverlapping row, including at narrow widths and with long names.
- Narrow overflow submenus open below their trigger and stay within the
  viewport. Each submenu uses a portal so ancestor scrolling cannot clip its
  touch targets in WebKit. Touch menu rows have 44px targets.
- Dropdown surfaces explicitly use horizontal writing mode, keeping the
  reader's Tools menu legible when the book uses vertical Japanese text.
- Unimported series previews only show Reading now when they have a book ID
  matching the active reader; two missing IDs are not a match.

The compact/regular navigation transition remains at 1024 CSS pixels. Browser
zoom naturally reduces available CSS pixels and selects the compact layout.
Touch targets remain at least 44 pixels in the Library; text and content are
allowed to reflow instead of shrinking controls.

## Regression coverage

The existing Books Library workflow runs the added browser cases in Chromium
and WebKit. Filesystem-backed series cases run in Chromium, matching the
existing File System Access capability boundary.

- Grid widths: 320, 390, 430, 768, 1023, 1024, 1200, 1300, 1400, and 1728.
- Cover fit and bottom alignment for portrait, narrow, landscape, and square
  artwork; equal status baselines; cover growth followed by a new column.
- Compact/desktop transitions in both directions; narrow Collections editing,
  long Unicode names, nested rename dialog, contextual selection/export, and
  sidebar position while scrolling with selection active.
- Continue, measured section gaps, author/title wrapping, list layout, top-bar
  search order and Clear Search after resizing, without changes to bookmark or
  statistics records.
- Series stack direction and status alignment; hero reflow at the desktop
  sidebar breakpoint and at wider content widths.
- Touch interaction in dark mode with reduced motion, nested menu bounds, and
  horizontal reader menus at phone and desktop widths. The reader case checks
  actual Settings bounds and navigates with a normal click: WebKit's viewport
  intersection observer reported zero for a visibly rendered, clickable menu
  item in the vertical-writing document.

Visual review uses real built-app screenshots with illustrative fixture books.
Viewport and browser-engine checks are not physical-device Safari certification.
The local HTTP test server uses a scoped connection backlog of 128: the default
queue of five dropped concurrent module requests on macOS. A real HTTP asset
burst reproduced the resets independently of the UI. Browser-error assertions
remain strict.

## Reader: proposed next pass

The reader is captured in its current state in this pass, with the dropdown
writing-mode defect corrected. Its toolbar and reading layout are not otherwise
redesigned by the Library refinement.

Current behavior: reading controls are revealed by an invisible 32px strip at
the top; the toolbar shows Library, Contents, Bookmark and Tools. A persistent
32px footer mixes Progress, optional tracking/sync, and reading position. The
reading surface already supports horizontal/vertical Japanese text, ruby,
continuous/paginated modes, typography preferences, bookmarks, and statistics.

The next pass should preserve that engine and replace the surrounding chrome:

1. **Discoverable, quiet controls.** Introduce an explicit 44px reading-menu
   affordance. In expanded mode, show Back to Library, the current title or
   chapter, bookmark, and reading menu. Dismissal must preserve text selection,
   dictionary lookup, edge paging, keyboard focus, and save-before-navigation.
2. **Reading appearance in place.** Put font size, font family, line spacing,
   theme and page/scroll choices in a Rhea sheet on iPhone and an anchored
   popover on desktop. Include an Advanced Settings link. Controls should
   update the actual existing preferences and restore position after reflow.
3. **A calm progress footer.** Center the real chapter/progress indicator, with
   a scrubber only while controls are expanded. Expose detailed character
   counts and tracking through a secondary panel, keeping pause/status
   discoverable. Respect existing choices about which statistics are visible.
4. **Intentional page framing.** On desktop, use the existing text-measure
   preference to form a centered page with generous margins. Offer a spread
   only when it fits and only for paginated mode. On iPhone, reserve safe-area
   space and use all available reading width. Never force horizontal text or
   a Western font onto a vertical Japanese book.
5. **One Contents surface.** Use a bottom sheet in compact width and a side
   panel on desktop, with current chapter state, long-title wrapping, chapter
   navigation and bookmarks. Keep all existing reading commands reachable.

Use restrained opaque token surfaces, fine dividers, and familiar Phosphor
glyphs. Avoid imitating Liquid Glass, adding decorative page curls, or replacing
the user's reader colors. The first implementation slice should be toolbar and
progress presentation; typography/position behavior should be a separate slice.

Reader acceptance must cover actual touch and keyboard interactions, safe-area
padding, 200% zoom/reflow, both writing directions and reading modes, ruby and
images, position preservation after font changes, selection/lookup ownership,
focus restoration, autosave, completion, and recovery. It must not infer a
precise page count or reading-time estimate from unavailable data.
