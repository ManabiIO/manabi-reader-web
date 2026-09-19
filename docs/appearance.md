# Appearance

Theme identity is separate from **System / Light / Dark**. New installations use
**Manabi + System**. Existing saved theme IDs and their light/dark intent survive
upgrade; existing custom theme records are never rewritten. The former portable
`system-theme` alias migrates to Manabi + System. The portable account `theme`
field now binds appearance, while `reader.themeName` binds identity. Wallpapers
and their adjustment settings remain browser-local and are not in that payload.

## Branding and prior art

Manabi's reading canvas is white in light mode and black in dark mode. Chrome is
slightly raised, with restrained accents rather than a colored reading page.

- Native reference (read-only): `aehlke/manabi-reader`, `v3-hotfix`,
  `ManabiReader/Resources/Common Colors.xcassets/Manabi Red.colorset/Contents.json`,
  blob `8c5c62f67c42bcd4fb7356561d594fcb8b168f14`. The native color is **Display P3**
  A1/1A/1D, not an sRGB hex value. Supporting browsers use its P3 components.
- Homepage reference (read-only): `lake-of-fire/manabi`,
  `website-next/src/styles/generated-theme.css`, blob
  `32f4158506ee77355a3f414adaf128ad8e9d8925`: Reader red `#A33539` is the
  sRGB fallback; gold `#D9B141` is the dark accent. Main content deliberately does
  not inherit the homepage's warm dark full-page background.
- Reviewed upstream `ttu-ttu/ebook-reader` issue #454 and PR #483 (whole-app
  theme request), plus scrollbar PR #393. This implementation uses semantic
  tokens and explicit component edits, not global overrides of `.bg-white`,
  form geometry, statistics data colors or descendant wildcard `!important`.
- No Yatsu Reader code or assets were consulted.

## Implementation contract

`theme-option.ts` remains compatible with the seven-field custom-theme format.
`themeForMode` keeps a custom palette's authored mode exactly and synthesizes an
opposite-mode tint without saving it. Paper, Ecru, Water, Slate, Charcoal and
Monochrome retain their stable historical IDs. Manabi is added, not substituted
for an existing choice. Preset original reading colors are retained in their
original mode. UI text is separate and contrast-checked on each opaque surface.

The generated `palettes.scss` contains both variants. Native CSS
`prefers-color-scheme` selects System; root `data-appearance` overrides it for
Light or Dark. Reader colors are CSS-variable references so switching modes does
not reconstruct EPUB DOM, remount content or trigger pagination. The tiny,
external `appearance-init.js` establishes persisted mode and preset before first
paint, works with the existing CSP, and is precached as a normal static asset.
The root runtime also updates browser chrome and reacts to custom-theme edits.

There is no global CSS filter. Real book images, cover art, semantic status
colors and heatmap data colors are deliberately not recolored. Shared headers,
menus, popovers, dialogs, form controls, selectors, metadata panels, statistics
surfaces, empty heatmap cells, focus rings and scrollbars consume theme tokens.

## Background storage and rendering

Two independent slots, `library` and `reader`, use the dedicated
`manabi-reader-appearance` IndexedDB database, not the released books database.
Images are browser-local; clearing site data removes them. No external image URL
input, account requirement, backend upload or localStorage/base64 image storage
is introduced. PNG, JPEG and still WebP uploads are bounded to 8 MiB, 24 million
pixels and 8192 pixels per dimension. Header admission happens before decode;
images are re-encoded without metadata and downscaled to a maximum 2560-pixel
edge. Unsupported SVG/GIF, malformed headers and animated WebP fail visibly.

Writes are serialized per slot. Replacing an image commits storage before
publishing its object URL; failures leave the last successful image in place.
Stale reads are fenced, object URLs are revoked on replacement/removal/disposal,
and cross-tab image changes reload through BroadcastChannel (focus fallback).
A decorative, pointer-transparent, viewport-fixed layer uses `cover` and centered
cropping. Only `/manage` and `/b` show images. Settings and other routes keep
opaque theme surfaces. Fade is independently adjustable 0–100% or disabled;
its separate overlay is white in light mode and black in dark mode. Forced-color
accessibility mode and printing hide decorative wallpapers.

## Checks

Run from the repository root (same toolchain as the existing Reader workflow):

```sh
node --experimental-strip-types tools/appearance/generate-css.mjs
node --experimental-strip-types tools/appearance/generate-css.mjs --check
node --experimental-strip-types --test tests/unit/*.test.mjs
pnpm --dir apps/web check
BASE_PATH=/Reader-Web pnpm build
python tests/browser/test_appearance.py
```

The browser suite extends the existing real static Reader tests and uses actual
EPUB import, real file inputs, IndexedDB, media emulation and offline reloads;
there is no request interception. Screenshots are generated fixtures only.
Images can still make low-fade text hard to read: the control explicitly tells
users to raise the fade, rather than pretending arbitrary photographs guarantee
contrast. Chromium automation is not a substitute for final Safari/iOS visual QA.
