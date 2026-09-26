# Manabi Reader · native Rhea UI

Manabi Reader Web has not shipped. This is a first-release interface, not an
installed-user migration. Four independent wallpaper slots remain the only
background schema; a missing Light or Dark image never borrows the other image.

## Components and theme contract

The official shadcn-svelte Rhea registry is the source of the committed UI
components. The pinned stack is shadcn-svelte 1.7.0, Svelte 5.57.1, Bits UI 2.19.2,
Tailwind CSS/Vite plugin 4.3.3 and Lucide Svelte 1.47.0. Upstream MIT attribution is
retained in `THIRD_PARTY_UI_LICENSES.md`. Generated source is owned by this project;
no remote registry, UI CDN or account server is needed at runtime.

React shadcn/ui's July 2026 Base UI default is not a Svelte runtime. Official
shadcn-svelte Rhea uses Bits UI. This application does not add a React renderer.

All presets use canonical shadcn background/foreground, card, popover, primary,
secondary, muted, accent, destructive, border, input, ring, sidebar and chart
pairs. Manabi's native/homepage red and gold remain the default brand colors;
main content remains white in Light and black in Dark. System/Light/Dark and the
first-paint bootstrap retain one CSS-driven appearance authority. Reader colors
remain separate from application controls, preserving custom authored palettes.

## Navigation and preserved features

The personal Library's Library actions menu provides Statistics, Settings,
Accounts and Libraries, Shared Libraries, and Add Books → Import from Ttu Ebook
Reader. The labelled Navigate sheet remains on Settings, Statistics, and legacy
storage views. It uses native links, current-page semantics, keyboard dismissal
and focus restoration. See [TTU feature parity](ttu-feature-parity.md) for the
current feature-to-control map and qualification limits.

The Library toolbar retains files/folders, backup import, Ttu import, capability-
aware storage sources, all seven original sort fields and both directions,
selection, select-all, export, selected statistics, statistics deletion, book
deletion, cancellation/progress, issue reporting and the diagnostic count import.
Book cards remain selectable and expose metadata and removal through Book actions.

The reading toolbar keeps Library, Contents and Bookmark visible. Reading tools
contains return-to-bookmark, jump, image gallery, Complete Book, Show/Set/Reset
Point, fullscreen, autoscroll speed, Settings and Statistics. Conditional actions
still obey their original capabilities. Existing callbacks—not replacement
navigation—retain save-before-leaving behavior. Reading-tracker controls, reading
progress, ruby, images, chapter navigation, paginated/continuous modes and keyboard
bindings are retained. App controls and open menus own their keys and wheel
movements, so navigating a menu cannot turn the underlying book's pages.

Statistics retains Summary/Heatmap, title filters, date ranges, aggregation,
per-row edits, export/deletion, goals and TMW copy actions. Options use the Rhea
sheet. The content offset accounts for the two-row toolbar.

## Settings

All 65 original setting groups and their value bindings are recorded in
`tests/fixtures/settings-manifest.json` and verified by a source-contract test.
The workspace adds Appearance, Fonts & text, Page layout, Reading controls,
Library & sync and Tracking & goals categories, plus All settings. Search spans
all categories and requires every query word. Fields are hidden, not destroyed,
when filtering; changing categories does not lose a partially edited value.

Boolean choices use labelled switches, discrete choices use selected-state
buttons and numeric/text values use Rhea inputs. Font availability and the
portable YuKyokasho preference remain separate. Local fallback to Klee One is not
an account-setting change; a no-op field focus or Escape does not commit it.
Reading goals retain their explicit Save/Cancel flow. Storage capability and
sync controls, custom font import and custom theme editing remain available.

Image Gallery is a full-viewport Rhea dialog with a thumbnail list, labelled
Previous/Next controls, keyboard and wheel navigation, accessible spoiler reveal,
and a mobile full-image view with return to the list. Gallery chrome uses UI
tokens rather than arbitrary EPUB colors. Closing restores the reader controls.

The global dialog manager now uses the Rhea/Bits focus trap and Escape/outside
handling while preserving each operation's close-disabled contract. Legacy
informational popovers use Bits UI with the same dynamic anchoring and close
notifications. Font Awesome and Popper runtime dependencies are removed; icons
are Lucide. Custom book artwork and provider logos are not recoloured.

## Regression qualification

`test_rhea_ui.py` extends the actual appearance/reader tests; it adds menu and
sheet keyboard operation, mobile overflow, category/search persistence, custom
palette focus/escape, explicit font selection, reading-key isolation, all export
parts, all sorting options and statistics navigation. Additional checks cover
autosave while a menu owns focus, conditionally available setting counts, and
real multi-image EPUB galleries on desktop and mobile. The suite runs on the
built `/reader-web/` application in Chromium and regular-profile WebKit. It does
not intercept requests or substitute UI/storage/font implementations.

The original reader-recovery, filesystem/shared-library and Ttu import/export
qualification suites remain enabled. WebKit server-outage testing stops the
actual origin; it is not native Safari airplane-mode qualification. Physical
Safari/iOS layout and native file-picker checks remain distinct from automation.

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/web exec svelte-kit sync
pnpm exec eslint .
node tools/appearance/lint.mjs
pnpm --dir apps/web check
node --experimental-strip-types tools/appearance/generate-css.mjs --check
node --experimental-strip-types --test tests/unit/*.test.mjs test/reader/typography.test.mjs
BASE_PATH=/reader-web pnpm build
python -m pip install playwright==1.63.0
python -m playwright install --with-deps chromium webkit
APPEARANCE_BROWSER=chromium python tests/browser/test_rhea_ui.py
APPEARANCE_BROWSER=webkit python tests/browser/test_rhea_ui.py
```

### Pointer ownership

Reader toolbar dismissal observes pointerdown capture, not a late click after
Bits UI has opened a modal menu and changed body pointer events. The original
composed path preserves trigger/portal ownership; real outside taps still close
the toolbar. Automatic bookmark commits do not close it. Browser acceptance
checks focus return after Escape, subsequent outside dismissal, actual scheduled
bookmark persistence, and Jump/Complete dialog cancellation without losing tools.
