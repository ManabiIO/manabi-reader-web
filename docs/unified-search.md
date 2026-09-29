# Unified dictionary and library search

## Interaction

The default **All** view has three independent sections, in this order:
**Dictionary**, **Titles**, **Content**. Exactly four pressed filter buttons are
shown: All, Dictionary, Titles, Content. Each All section previews at most two
matches, while its See all action selects the corresponding dedicated view.
Dictionary mode requests full structured entries; it does not stretch a clipped
preview. Titles/content reveal additional batches of 30 with a keyboard anchor.

Dictionary starts asynchronously and can fail independently of metadata or body
search. Raw text stays unchanged in the global input. The dictionary alone tries
Japanese spelling/romaji alternatives. Both search inputs retain composition-aware
updates, and Escape does not dismiss an active IME candidate list.

Books and snippets have differentiated icons and labels. Content rows identify the
source title and preserve the existing exact book/snippet locator; book highlights
use the engine-provided original-text offsets, never a new regex over normalized
text. Each source has separate loading, empty and retry UI. Body search remains
local; opening search never downloads a cloud book or starts transcription.

## Current composition boundary

This main-based implementation includes **books and snippets**, not videos.
Video library/transcript storage currently lives in the separate draft stack
Reader #46 / #67 / #79. Do not merge or activate that stack implicitly to make a
search checkbox look complete. A video adapter must be composed against its
chosen head, read only retained/authorized transcript tracks, return a timestamp
locator, and honor account changes. That adapter and its end-to-end navigation
remain an explicit follow-up before calling the entire requested feature complete.

The embedded renderer reuses Manabitan's static web structured definitions,
frequency information and dictionary media handling. The extension's own search
retains its full UI. Embedded audio, Anki and complete extension UI parity are not
claimed here. English-gloss search and new grammar data are also not implemented.

## Pinned assets and local ownership

`manabitan-version.json` selects an exact companion Manabitan source commit.
`pnpm prepare:dictionary` builds that revision (or a clean checkout supplied with
`MANABITAN_SOURCE`) and verifies generated assets. Normal root build/dev includes
this preparation; a warm local build reuses verified output. First preparation
needs GitHub/npm network access. Direct `apps/web` builds must prepare first.

Runtime assets are under `static/manabitan/<revision>/`; the optional Jitendex ZIP
is under `static/dictionary-archives/`. Existing service-worker exclusions prevent
both from becoming eager shell cache downloads. The runtime is dynamically loaded
only when dictionary search is used. Installing Jitendex or an imported ZIP is an
explicit action. The Jitendex archive is pinned by byte count and SHA-256.

One lease-owned worker is shared per tab. Closing search retires its worker; a
replacement waits for retirement. Other tabs' exclusive-storage failures appear
as dictionary errors, not as empty result lists. No user query is sent to a
third-party dictionary search service. Web dictionaries remain separate from the
installed extension's storage and preferences.

The GPL runtime retains LICENSE, per-file notices and corresponding source/build
instructions alongside the assets. Dictionary licensing remains separate.

## Research and acceptance

The Moe Way favors Yomitan strongly; its resources do not establish universal
consensus for Takoboto or a grammar-based reason to prefer it. Takoboto, Jotoba and
Jiten are the relevant references alongside Jisho. Jiten's combined
words/sentences/media entry point is especially aligned with this design.

Sources: https://learnjapanese.moe/resources/ ; https://takoboto.jp/ ;
https://jotoba.de/tour ; https://jiten.moe/ ;
https://www.w3.org/WAI/ARIA/apg/patterns/tabs/

Before merging: run query-lifetime unit tests, complete Svelte/TypeScript/lint and
production builds with the exact runtime pin, and browser-test no-extension setup,
Jitendex and custom dictionary import, Japanese IME, middle-of-input edits, stale
success/error suppression, independent section failures, full-entry expansion,
mobile layouts, light/dark themes, keyboard/assistive technology navigation,
account changes and exact passage navigation. Build/unit success is not a claim
of completed manual design or browser acceptance.
