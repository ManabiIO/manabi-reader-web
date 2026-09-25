# Video transcript interaction and display

Reader PR #46; backend companion lake-of-fire/manabi#80.

## Visual references

Apple Music's time-synced lyrics and Spotify's lyrics presentation inform the
line-led typography, spacing and tonal focus:

- https://support.apple.com/en-us/105076
- https://support.spotify.com/us/article/lyrics/

The player does not copy lyrics, artwork, blur effects or branding. It has no
colored active-line rail, speaker/window badges, timestamps, cue counts,
"Original captions" subtitle, or Earlier/Later pagination controls.

## Interaction contract

First use presents existing subtitle tracks and a primary Generate transcript
alternative. Neither opening a video nor choosing an existing track starts MOSS
or downloads its model. No language or first-track assumption chooses the main
transcript. Completing a requested generation selects that track only while the
original selection intent still owns the player. A subsequent explicit selection
wins.

After main selection, a unique complete, non-forced, different-language track
matching browser language preferences can be suggested as translation. Regional
matches take precedence over language-family matches; ties stay unselected.
Automatic translation waits for the initial discovery pass and is re-evaluated
when additional tracks arrive: ties clear only the automatic suggestion, and a
unique exact locale match can supersede a family match. Initial setup does not
offer a translation before the main transcript is chosen.
Manual choices and Off survive later discovery and restoration. Metadata wins;
bounded kana/Hangul hints can help identify untagged text. Ambiguous Han, Latin,
mixed or short samples remain unknown. This is not spoken-language detection or
automatic translation.

The transcript's top-right ellipsis contains track selectors, Show/Hide
translation, Follow playback, Pause after each line, Themes & Settings, Add
subtitles, Download subtitles, overlay style/timing and Close transcript.
Download subtitles directly invokes the browser's SRT download. Subtitle export
never silently writes beside the original video or replaces an authored track.

Previous / Replay / Next are restrained controls beneath the video. The
icon-only theater toggle sits at the lower right. Closing the transcript keeps
time and track selections and exposes a reopen icon immediately to the left of
theater. Native video controls retain fullscreen; there is no duplicate custom
fullscreen control.

A/S/D and Space are player-scoped. Inputs, selectors, editable text, buttons,
native media controls, composition and modified/repeated keys retain their own
keyboard behavior. Pause-after-line waits for the overlapping dialogue unit;
seeking and track changes reset that boundary. Manual transcript scrolling stops
Follow playback. Explicit Previous / Replay / Next resumes following.

## Shared ebook appearance

Transcript text uses the actual ebook font/fallback, size, weight, line spacing,
reading palette and per-mode reading background. Themes & Settings mounts the
existing ReaderAppearance sheet and writes the same stores as ebooks. Only
ebook pagination controls are omitted. Caption contrast controls for text over
moving video remain distinct; they do not change transcript typography.

Continuous transcript scrolling moves a bounded overlapping row window, without
visible pagination controls. Speaker turns retain their order; A/B/A must not
become A/A/B. Text remains inert/selectable for copying or dictionary lookup.

## Diarization and portable subtitles

Canonical cues retain original text, independent timing and internal speaker
IDs. Window-scoped MOSS IDs do not establish a character's identity across an
entire film, and are never displayed as labels.

Sequential turns stay separately timed. Identified overlapping voices use
separate lines. SRT/VTT export splits overlaps at actual cue boundaries, preserving
currently active utterances without inventing word timing. Translation remains
a separately timed track, not another speaker. Unknown speaker identities are
not guessed and additional simultaneous voices are not silently discarded.

The hyphen-minus dialogue marker follows the English Netflix timed-text guide:
https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide
It is a style convention, not SRT syntax, a universal Japanese convention, or a
claim of complete Netflix delivery compliance.

## Ellipsis layout and lifecycle

The popover uses the visible viewport in layout coordinates, including keyboard
shrinkage and pinch-pan offsets. It prefers space below or above its trigger and
bounds long menus with an internal scroller. A focused timing input remains
visible when the viewport shrinks, without scrolling the video/page. Ordinary
manual menu scrolling is not pulled back to that input. Disposal removes viewport
listeners and rejects stale trigger actions.

`menu-placement.test.mjs` checks geometry independently. `menu-browser.py` tests
actual Chromium popover layout, focus and the compatibility fallback, with
keyboard/pinch bounds supplied as explicit simulated VisualViewport inputs.
Those cases are not physical-device keyboard or iOS IME qualification.

## Verification boundaries

The read-only Video player and transcript workflow installs the pinned dependency
lockfile, checks/builds the actual Svelte app, generates short English speech/video,
and runs core, player, workspace, Web Audio, menu and actual-app acceptance.

Actual-app acceptance covers real file/sidecar import, shared display preferences,
SRT downloads, transcript close/reopen and native IndexedDB reload. Isolated
controller tests use explicitly identified persistence/provider/recognition
doubles. Neither those doubles nor authored Japanese caption strings establish
Japanese speech or MOSS recognition accuracy.

Real single/threaded MOSS build/inference, Japanese synthesis/diarization,
cross-tab/suspension, live provider/account composition, and physical Safari/iOS
memory/performance/fullscreen behavior remain separate gates. The expensive
real-model workflow is manual; ordinary UI qualification does not download models.
