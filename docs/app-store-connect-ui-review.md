# App Store Connect reference and workspace review (2026-09-25)

Apple announced the refreshed **Analytics** experience on March 25, 2026:
https://developer.apple.com/news/?id=hh6v4b55

Apple's App Store Connect release notes also record a May 28, 2026 homepage
update: sign-in now lands directly in Apps, with other major sections available
from a navigation bar at the top of the page:
https://developer.apple.com/help/app-store-connect/release-notes/

First-party interface references:
- https://developer.apple.com/app-store-connect/analytics/
- https://developer.apple.com/app-store-connect/analytics/images/screen-hero-large_2x.png
- https://developer.apple.com/app-store-connect/analytics/images/screen-sales-medium_2x.png

These are public Apple screenshots, not an authenticated inspection of every
App Store Connect screen. They establish the 2026 Analytics refresh, not a claim
that the entire site was relaunched at the same time. No Apple assets are shipped.

The useful distinction from Apple.com marketing pages is compact **workspace
navigation**: underlined section choices, quiet sidebar selection, modest field
corners and grouped controls. Settings and Statistics share that visual treatment
without changing button semantics into incomplete ARIA tabs. Focus remains visible.
The reader's mode/layout choices stay rounded and neutral, not prominent CTAs.

The general review also repairs Statistics' fixed-header height assumption,
options-sheet width specificity and duplicate Start of Week IDs. Options use one
visible title, responsive labeled fields, distinct export/destructive groups, a
shared circular dismiss control and disabled controls while a write is pending.

Title selection used asynchronous viewport-based pagination with a resize handler
that returned its callback instead of invoking it. A bounded 25-row page now has
one sheet-owned scroll area and fully wrapping clickable labels. Empty searches,
resizing, enlarged fonts and draft edits cannot strand items in a collapsed inner
scroller. Searches are case-insensitive/NFC-normalized without rewriting stored
titles; selection remains private until Apply Filter. No history rows are changed.

`test_connect_ui.py` retains every prior Apple/catalog/continuation case and adds
workspace geometry, unique labels/date edits, 61-title pagination/private draft,
and enlarged reader appearance coverage. The pure title-filter model has direct
unit tests; the complete existing Rhea and Library suites remain separate gates.


## Follow-up visual audit

The refreshed Analytics screenshots also reinforce two workspace details that are
easy to miss when copying only the high-level look:

- side-panel filters keep their context and commit/cancel actions reachable while
  long result sets scroll;
- small chart/navigation tools read as quiet utility controls, while destructive
  row operations are visually distinct.

The Statistics title picker therefore keeps its header and Apply/Cancel footer
sticky in the single sheet scroll container. Bulk selection now means the current
matching set (search/date/selected-title filters), never hidden titles. Heatmap,
summary-row, and tracker-history utilities use the shared button primitives for
focus, pointer targets, disabled state, and destructive treatment.


The top-level Manabi workspace now reflects that May homepage change on wide
screens: Library, Statistics, and Settings are directly visible in the header.
The existing full navigation sheet remains available for secondary destinations
and remains the compact navigation on phones.
