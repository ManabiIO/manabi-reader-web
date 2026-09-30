# Unified dictionary and library search

## Interaction

Search has two independent controls.

**Search in** selects the source family: **Everything**, **Books**, or
**Snippets**. **Everything** includes Dictionary, saved book/snippet metadata and
body text, and—only in video-enabled builds—saved video titles and already
published transcript tracks. **Books** and **Snippets** never initialize the
other source's search lifetime. Their source choice is navigation state, survives
reloads, and does not rewrite the editable query.

**Show** selects the result presentation: **All**, **Dictionary**, **Titles**, or
**Content**. Dictionary is available only for Everything. All previews at most
two results from each section; See all switches to the corresponding dedicated
view. Dictionary mode requests full structured entries instead of stretching a
clipped preview. Titles rank displayed titles globally across source types as
exact, prefix, token-boundary, then interior substring matches; source type never
lets a weaker displayed-title match outrank a stronger one. Visible title matches
are highlighted using ranges mapped back to the original text, including
compatibility-width and ligature cases. Books admitted only by canonical title,
author, series/folder, or collection metadata remain visible after literal title
matches and show that provenance instead of pretending the displayed title
matched. Content stays source-diverse because book, snippet and transcript body
workers do not expose directly comparable relevance scores. Titles and Content
reveal additional batches of 30 with a keyboard focus anchor.

Every asynchronous source owns cancellation, stale-result suppression, loading,
failure and retry independently. A dictionary, snippet, video-store, or book-body
failure must not erase successful sibling results. Switching to Books does not
require Snippets scope readiness, and vice versa.

## Code ownership

- `media/search-text.ts` owns dependency-free normalization, field precedence,
  ranking and metadata highlight offsets. Both Reader and the standalone media
  build compile this implementation. `library/search-normalization.ts` preserves
  existing library and worker imports through re-exports.
- `search/result-rows.ts` turns book, snippet and video hits into display rows
  with typed navigation targets. Canonical book/snippet locators and precise video
  timestamps remain source data; the component opens those targets.
- `search/source-session.ts` owns concurrent Content source admission, stable
  interleaving, partial-result failures and cancellation. Each source reports
  completion through its batches; receiving its cleanup only confirms admission.
  A session retires workers returned after cancellation and suppresses results
  after an account boundary changes.
- `search/unified-search.svelte` owns scope/filter interactions, query admission,
  navigation, accessible rendering and focus. Dictionary, Titles and Content keep
  their independent query lifetimes. Source workers own idempotent termination,
  including initial receiver/postMessage failures.

## Dictionary behavior

Raw text stays unchanged in the global input. Dictionary search alone evaluates
Japanese spelling and romaji alternatives using Manabitan's existing converter
and Yomitan-derived translator/deinflector.

Exact and deinflected results always outrank completion. When all exact candidates
miss, the pinned runtime may perform a conservative implicit prefix lookup only
for a completed Japanese candidate of at least two code points with no remaining
Latin letters. This allows partial romaji such as `gakko` to become
`がっこ` and complete to words such as `学校` without turning arbitrary
English or unfinished romaji into prefix enumeration. Prefix-derived results are
labeled explicitly. A trailing `*` remains the explicit prefix-search form.

Both search inputs retain composition-aware updates; intermediate IME text is not
submitted, and Escape does not dismiss an active IME candidate list.

The embedded renderer reuses Manabitan's static structured definitions, frequency
information and dictionary media handling. The extension keeps its full UI.
Embedded audio, Anki and complete extension-UI parity are not claimed here.
English-gloss reverse search and new grammar data are not implemented.

## Books, snippets and video

Books and snippets retain differentiated labels and canonical locators. Content
highlights always use source-produced original-text offsets rather than re-searching
a displayed excerpt with a regex. This preserves compatibility-width text,
furigana-backed snippet matches, ligatures and supplementary characters. Snippet
navigation preserves the existing snippet locator.

Video search is read-only over the media database. Titles come from saved
`video_info` records. Content search reads only complete, published transcript
tracks and applies saved per-track subtitle delays when producing timestamp
locators. It does **not** reconnect a File/cloud source, download video bytes,
start MOSS, or publish a transcript. Equivalent cues across candidate tracks are
deduplicated; authored transcription tracks retain preference over generated or
translation duplicates. Transcript excerpts remain bounded but center on the
source-mapped match, so a long cue cannot clip the matching text off-screen.
Results are bounded per video and overall.

Transcript navigation uses
`/videos?media=<content-key>&time=<seconds>&track=<track-id>`. Opening such a
result reuses the media workspace's normal source/account checks, selects the
matched published track when it still exists, seeks while paused, and never
autoplays.

Transcript search enumerates validated track manifests once per query, groups
them by content identity, skips videos with no transcript manifest without
opening another IndexedDB transaction, and hydrates only the required caption
pages. Account changes and query replacement cancel publication.

## Release and ownership boundary

Video learning is integrated in Reader PR #157 but remains a **default-off build
feature**. `VITE_ENABLE_VIDEO_LEARNING=true` enables Videos navigation,
video search, the media profile watcher and the `/videos` workspace. Ordinary
builds hide those entry points; direct `/videos` access renders a page-not-found
view without mounting the workspace. Heavy media modules are loaded dynamically
only in enabled paths.

MOSS runtime files are excluded from the offline application shell in every
build. Enabled builds retain and verify the pinned single/threaded runtime.
Default-off production builds remove `build/moss` after compilation and CI
asserts that no MOSS artifact remains. This front-end gate does not enable the
separate Reader backend serving/API boundary.

The historical video stack (#46 / #67 / #79 / #153) is superseded by #157.
Do not land new product fixes on those closed branches.

## Pinned dictionary assets and local ownership

`manabitan-version.json` selects an exact companion Manabitan commit.
`pnpm prepare:dictionary` builds that revision (or a clean checkout supplied
with `MANABITAN_SOURCE`) and verifies generated assets. Normal root build/dev
includes this preparation; a warm local build reuses verified output. First
preparation needs GitHub/npm network access. Direct `apps/web` builds must
prepare first.

Runtime assets are under `static/manabitan/<revision>/`; the optional Jitendex
ZIP is under `static/dictionary-archives/`. Service-worker exclusions keep both
out of eager shell caching. The runtime is dynamically loaded only when dictionary
search is used. Installing Jitendex or an imported ZIP is explicit. The Jitendex
archive is pinned by byte count and SHA-256.

One lease-owned dictionary worker is shared per tab. Closing search retires its
worker; a replacement waits for retirement. Other tabs' exclusive-storage
failures appear as dictionary errors rather than empty results. No user query is
sent to a third-party dictionary service. Web dictionaries remain separate from
the installed extension's storage and preferences.

The GPL runtime retains LICENSE, per-file notices and corresponding source/build
instructions alongside the assets. Dictionary licensing remains separate.

## Research and acceptance

The Moe Way strongly favors Yomitan; its resources do not establish universal
consensus for Takoboto or a grammar-based reason to prefer it. Takoboto, Jotoba
and Jiten remain useful references alongside Jisho. Jiten's combined
words/sentences/media entry point is especially aligned with this design.

Sources: https://learnjapanese.moe/resources/ ; https://takoboto.jp/ ;
https://jotoba.de/tour ; https://jiten.moe/ ;
https://www.w3.org/WAI/ARIA/apg/patterns/tabs/

Merge qualification belongs to the exact selected Reader and Manabitan heads:
query-lifetime tests; Svelte/TypeScript/lint and production builds; no-extension
setup; Jitendex/custom ZIP import; Japanese IME and middle-of-input edits;
exact/deinflected/prefix precedence; stale success/error suppression; independent
source failures; full-entry expansion; mobile/200% text; light/dark themes;
keyboard and assistive-technology navigation; account/scope changes; exact
book/snippet navigation; video timestamp navigation; and enabled/default-off
packaging. Build or unit success alone is not manual/browser qualification.
