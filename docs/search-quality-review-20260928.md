# Search quality review — 2026-09-28

## Scope

This follow-up to PR #84 addresses search-result clarity, native input ownership,
keyboard continuity, enlarged-text reflow and recoverable failures. It is not an
award assessment or a claim that the entire application meets an accessibility
standard. Original books, locators, source/account authority, database schemas,
dependencies and activation settings are unchanged by this delta.

The branch received main integration `04dc782796f20e39fbd5dc6a05302bebe2d4ece0`
during review. Its 867-file CI text source was verified against the retained
Git tree. Existing integrated work is preserved when publishing this follow-up;
a synthetic local text-only Git tree is not a complete repository.

## Contracts

- Each search result highlights precisely its own original-text occurrence.
  The search engine supplies UTF-16 excerpt boundaries derived from its source
  mapping; the UI never re-searches an excerpt or injects book text as HTML.
  Combining marks, supplementary characters, joined emoji and compatibility
  matches preserve the author's spelling. Search normalization and durable
  locator coordinates remain unchanged.
- Match tint is supplementary. Weight and an underline remain additional cues.
  A built-app regression measures foreground/background contrast in all seven
  presets in both modes, requiring at least 4.5:1 for the marked text. That
  measurement is not a whole-application contrast audit.
- Japanese composition owns Escape until composition ends. Provisional input
  does not dispatch a new search. Composition events in automation exercise
  the DOM contract, not a physical operating-system input method.
- Clear is an explicitly named 44-by-44 CSS-pixel button. It cancels old work,
  resets pagination and returns focus to the input. The duplicate native WebKit
  search-cancel decoration is suppressed, not the input's editing behavior.
- Showing another result batch focuses its first new result only while the
  initiating query/panel still owns the interaction. The last batch receives
  the same treatment after its Show more button disappears.
- The sheet is the only vertical scroll owner. Long titles and 200% root text
  cannot collapse a nested results scroller. Portrait and short-landscape
  cases require reachable input, clear control and the actual marked passage.
- Empty results explain a next step. Invalid input has validation feedback,
  not a meaningless retry. A deliberately injected Worker-start failure must
  recover by constructing and using a real Worker on Retry.

## Japanese interface fallback

The earlier Linux WebKit query capture displayed missing-glyph boxes for U+20BB7
although search worked. Font-table inspection confirms that the already bundled
Noto Sans JP regular face contains that character. The interface stack did not
name a bundled Japanese face. It now includes Noto Sans JP after the existing
native Japanese fonts and before generic sans-serif. System and native fonts
retain precedence; reading-font preferences and all font assets are unchanged.

This is not a new font download package or a promise of zero additional network
use: a device without the native glyph can request the existing approximately
3.4 MB regular face on first use. The existing font loading/cache policy remains.
Actual new glyph screenshots and physical-device qualification are distinct from
font-table membership and functional Unicode tests.

## Coverage and controls

Eight additional built-app methods extend the nine original product journeys.
Both modules inherit a helper-only base with zero test methods, preventing
inherited test-count inflation. Chromium and WebKit each run both modules;
per-case traces, screenshots, HTML, console diagnostics and page errors are
retained. The contrast matrix writes its measured values separately.

Ten new source-range cases extend the existing ten reader-worker cases. The
same final twenty component assertions produce ten failures on the preceding
production modules and twenty passes after repair. A separate execution with
the integrated source also passes twenty. Local execution uses complete
production module bodies with an explicit TypeScript loader and declared
platform dependencies; these are component results, not a local app build.

Pinned preparation run `36464507646` verified and formatted the fifteen-file
source patch, passed all twenty search cases, repository lint and Svelte checking
with zero errors or warnings. This preparation ran the preceding app plus its
reviewed lint coverage; it is not final combined-main browser qualification.
Immutable blobs are verified independently before publication on the current
full GitHub tree. The temporary source transporter is not in the feature tree.

The current main integration revealed a test-selector defect: Books and
Snippets both provide query-limit alerts. The Books boundary/recovery test now
asserts within its named Library search results region, retaining the exact
message, no-passage/no-retry conditions and successful passage navigation.
The older broad locator's strict-mode failure is not described as an absent
validation message.

## Qualification boundary

Real browser qualification belongs to its recorded CI composition. Preparation
or blob identity alone is not application acceptance. The PR's current result
records supersede earlier heads; cancelled or incomplete jobs are never counted
as passes.

Local app navigation is administrator-blocked. Visual review uses actual CI
screenshots, not a fabricated local renderer. Physical iOS/Safari, hardware
keyboards and Japanese input methods, screen-reader speech, OS text/zoom,
forced-color behavior and live provider/account acceptance remain separate.

The pre-follow-up integrated Foliate run `36461246288` failed a WebKit opaque
paper assertion, while its earlier RTL keyframe case passed. That is retained
as an independent wider-check finding, not waived or credited to this search
patch. The earlier run `36459162585` failed an RTL preparation case. Neither
failure establishes a root cause without further qualification. Nothing in
this follow-up weakens those assertions or changes the paginator.
