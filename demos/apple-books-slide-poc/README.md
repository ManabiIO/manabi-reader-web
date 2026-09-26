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
held-pose inspection, and an explicitly manual corner preview. Corners default
to square. Set inherited `--reader-page-radius` only when the embedding host
knows its container geometry; it is not inferred from a platform/device table.

The artifact embeds SHA-256 hashes of all five source modules. Rebuild after
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

See `docs/foliate-slide.md` for the sequence contract, native corner API research,
remaining qualifications, and integration boundaries.
