# Standalone Slide demo

This demo bundles the actual Manabi Reader paginator, geometry, page-count,
page-turn controller, and discrete-turn sequence. It is not a second imitation
of the interaction. The template contains only controls and original sample text.

From the repository root after `pnpm install`:

```sh
node scripts/build-slide-demo.mjs
python3 -m http.server 8765 --directory demos/apple-books-slide-poc
```

Open `http://localhost:8765/` on the Mac, or the Mac's local-network IP at port
8765 in iPhone Safari on the same trusted Wi-Fi. Stop the server with Control-C.
The generated `index.html` contains its JavaScript and license notices, needs no
network dependencies, and can also be placed unchanged on a static website.
It is generated rather than checked in; the Foliate CI artifact includes it.

Hold an arrow key, then release. Or press and hold **Hold to skim**. The first
turn animates, intermediate turns commit without animation, and the reserved
last turn animates on key release / button-input quiet. Mouse drags on text
select; mouse drags from the margins turn pages. Touch and wheel still use the
reader's existing displacement-based gesture path, not the repeat-key sequence.

**Aa** offers English/LTR and vertical Japanese/RTL, text size, night paper,
a persisted **Page turn effect: Slide / None**, and held-pose inspection for Slide.
Pages are always square. The running title stays fixed; only the page numbers
move with the sheets. Dark paper uses a white overlay, light paper uses black.

None snaps to the selected page without an intermediate visual transition.
There is no leading/trailing animation or reserved key-repeat tail in None.
A swipe still qualifies by distance at release; book text stays still meanwhile.
Changing effects cancels an unfinished turn without advancing reading progress.

The artifact embeds SHA-256 hashes of all six source modules. Rebuild after
editing any of them. Test in real Safari before judging Apple-device input feel.

## Verification modes

```sh
# Normal website loading, including real sample Blob URLs:
SLIDE_DEMO_URL=http://127.0.0.1:8765/ python tests/browser/test_slide_demo.py

# Renderer/input-only qualification when browser navigation is unavailable:
python tests/browser/test_slide_demo.py
```

The second mode explicitly supplies text-only srcdoc fixtures to work around
about:blank's opaque Blob origins. That adapter is not shipped in the HTML and
does not qualify HTTP/file launch, Blob lifetimes, EPUB import, or the full
Svelte application. The permanent Chromium CI step uses the first mode.

See `docs/foliate-slide.md` for the sequence contract, remaining qualifications, and integration boundaries.
