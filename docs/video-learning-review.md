# Video transcript interface

Reader PR #46; backend companion lake-of-fire/manabi#80. This document describes the interface, not approval to ship an unqualified MOSS runtime.

## Visual direction and shared settings

References: [Apple Music time-synced lyrics](https://support.apple.com/en-us/105076) and [Spotify lyrics](https://support.spotify.com/us/article/lyrics/). Use text-led layout, generous spacing and tonal emphasis for the active line. No colored left rail, decorative speaker badges, window IDs, timestamps, cue counts or pagination controls. Do not copy lyrics, album art or product assets.

The transcript subscribes to the ebook's existing font family/fallback, size, weight and line-spacing stores. Reading colors and per-mode background images also come from the existing Reader appearance system. Themes & Settings mounts the actual ReaderAppearance sheet; only ebook pagination controls are omitted. Changing these preferences affects ebooks too. Video-overlay appearance remains separate because moving pictures require different contrast treatment.

The transcript scrolls continuously through a bounded overlapping window of rows. Manual scroll stops Follow playback; Previous line, Replay line and Next line resume following intentionally. Keyboard actions stay local to the player and do not intercept typing, composition, modified/repeated keystrokes or native video controls.

## Setup and translation

First opening does not assume that Japanese, the first subtitle, or the browser language is the desired main transcript. Setup offers existing subtitle tracks and an explicit primary Generate transcript alternative. Selecting an existing track never starts MOSS. A requested generated track is selected when complete, unless the user has made a newer selection. Setup and Generate are hidden once a main track is chosen.

Only after choosing a main track may a unique complete, non-forced different-language track matching the browser's preferred languages be suggested as translation. Regional matches precede language-family matches. Ties and unknown languages remain unselected. Manual choices, including Off, win over later discovery and restoration. Language metadata takes priority; bounded kana/Hangul hints help with untagged Japanese/Korean text. Han, Latin, short or mixed samples are not assigned invented languages. This is not a general-purpose spoken-language detector or translation engine.

The ellipsis owns main/translation selectors, Show/Hide translation, Follow playback, Pause after each line, shared Themes & Settings, Add subtitles, Download subtitles, overlay timing/style and Close transcript. Download subtitles is an actual SRT browser download, not a source-folder write or a second export wizard. Closing the transcript preserves playback and selected tracks; its reopen icon appears to the left of the theater toggle below the video's bottom-right corner. Native video fullscreen remains; there is no second custom fullscreen control.

## Dialogue

Canonical cues retain independent timings, original text and speaker IDs internally. Speaker/window labels never appear in the transcript. Sequential turns stay separately timed and in their original order: A/B/A must not be regrouped as A/A/B. Identified overlapping speech receives separate dialogue lines. A translated subtitle is not treated as another speaker.

The [Netflix English timed-text guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide) uses a hyphen-minus without a following space for multiple speakers sharing a subtitle. This is a style convention, not an SRT syntax rule, universal Japanese typography, or a claim of full Netflix delivery compliance. Export splits overlaps at real cue boundaries without inventing word times. Unknown speaker identity is not guessed; extra simultaneous voices are not silently discarded. MOSS IDs remain window-scoped internally, not asserted as whole-film identities.

[Trancy](https://www.trancy.org/) and [asbplayer](https://docs.asbplayer.dev/docs/intro/) informed the video/reading split and subtitle navigation. Optional pause-after-line waits for the complete overlapping-speaker unit. Seeking or switching tracks resets that boundary. Browser media time is not sample-accurate scheduling.

## Verification boundaries

Tests distinguish the actual Svelte application, native IndexedDB, browser SRT downloads and Web Audio from isolated controller tests with explicit persistence/provider/recognition doubles. Reload acceptance first establishes that the selected track and view preference have actually committed to IndexedDB; displaying a row alone is not a persistence acknowledgement.

The read-only Video player and transcript PR workflow exercises inexpensive generated English fixtures, installed-app checks/build and browser regressions. It never downloads a speech model or deploys anything. Actual MOSS single/threaded builds, Japanese recognition and diarization/window-seam accuracy, live providers/account composition, native cross-tab/suspension and physical Safari/iOS performance remain separate qualification gates. Native fullscreen/PiP composition is also a device-level boundary.
