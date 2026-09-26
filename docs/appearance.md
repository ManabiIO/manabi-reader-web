# Appearance

## Product status

Manabi Reader Web has not shipped and has no installed user base. Background images
have only the first-release schema described below. There is no single-image
migration, automatic sharing, or substitution between Light and Dark. Compatibility
with imported Ttu Ebook Reader books, backups, and reading data is a separate
contract and must be retained.

## Themes and branding

Theme identity and System / Light / Dark are separate settings. The default is
Manabi + System. Manabi uses a white reading canvas in Light and black in Dark,
with restrained raised surfaces and brand accents rather than a colored page.

Brand references consulted read-only:

- Native `aehlke/manabi-reader`, `v3-hotfix`,
  `ManabiReader/Resources/Common Colors.xcassets/Manabi Red.colorset/Contents.json`,
  blob `8c5c62f67c42bcd4fb7356561d594fcb8b168f14`. The native red is Display P3
  A1/1A/1D, not an sRGB hex value.
- `lake-of-fire/manabi`, `website-next/src/styles/generated-theme.css`, blob
  `32f4158506ee77355a3f414adaf128ad8e9d8925`. Reader red `#A33539` is the sRGB
  fallback; gold `#D9B141` is the dark accent.
- Upstream whole-app theme issue #454 and PR #483 in `ttu-ttu/ebook-reader`, plus
  scrollbar PR #393. No Yatsu Reader source or assets were consulted.

Paper, Ecru, Water, Slate, Charcoal and Monochrome retain their upstream theme IDs.
Custom palettes use the seven-field format and keep their authored values. The
opposite appearance is derived without rewriting the definition. UI surfaces and
text are independently contrast-checked, so arbitrary custom page colors cannot
hide application controls. Artwork and meaningful statistics colors are not
blanket-recolored.

Generated `palettes.scss` and native `prefers-color-scheme` implement System mode;
`data-appearance` provides explicit overrides. The external, local
`appearance-init.js` restores appearance before first paint under the existing CSP.
Mode changes do not recreate EPUB DOM or change reading position. Storage
notifications re-read authoritative preferences without echoing stale values into
another tab. Malformed optional custom-theme JSON is ignored in memory, not
silently overwritten. Only built-in theme names cross the account boundary;
custom definitions and backgrounds are local.

## Backgrounds

The dedicated `manabi-reader-appearance` IndexedDB database stores one
`{light, dark}` record per surface (`library`, `reader`). All four slots are
independent. Choose or remove either image, or use Remove both for that surface.
An empty slot means the plain theme background, even if the other mode has an image.

Only `/manage` and `/b` render the corresponding decorative image. Images use
centered cover sizing, fixed to the viewport, with pointer events disabled. Fade
is optional and adjustable from 0 to 100 percent per surface. Light fades toward
white and Dark toward black. Previews show both modes independently of the app's
current mode. Printing and forced-colors accessibility hide decorative wallpaper.

PNG, JPEG and still WebP uploads are bounded to 8 MiB, 24 million pixels and
8192 pixels per dimension. Header checks precede decoding. Images are re-encoded
without metadata and reduced to a maximum 2560-pixel edge; native PNG encoding is
accepted when WebP encoding is unavailable. Unsupported or corrupt images fail
visibly. A failed replacement keeps the previous image; corrupt stored records
have a Remove/retry path. Stored data is decoded before publication, object URLs
are cleaned up, and unchanged revisions avoid repeat decoding on focus.

Image preparation occurs outside IndexedDB transactions. Reading, updating one
slot and writing the record use a single read/write transaction, preventing two
tabs editing different modes from overwriting each other. Removal is atomic too.
BroadcastChannel notifications and focus refresh update other tabs. Images are
never uploaded or embedded in account settings; clearing site data removes them.

## Typography

YuKyokasho is the preferred primary font when both native directional faces are
usable. Horizontal text uses YuKyokasho Yoko and vertical text uses YuKyokasho.
Otherwise this device uses Klee One. This device-local fallback must not overwrite
the portable preference. Explicit choices, including Noto Serif JP and imported
fonts, remain user-controlled. Merely focusing the field or cancelling an edit
with Escape cannot save a different font.

Font layout has a bounded initial deadline and observes individual FontFace
completion as well as FontFaceSet events. Late completion remeasures geometry and
preserves the intended character position, including a restored bookmark.

## Verification

```sh
node --experimental-strip-types tools/appearance/generate-css.mjs --check
node --experimental-strip-types --test tests/unit/*.test.mjs test/reader/typography.test.mjs
node tools/appearance/lint.mjs
pnpm --dir apps/web check
BASE_PATH=/reader-web pnpm build
python -m playwright install --with-deps chromium webkit
APPEARANCE_BROWSER=chromium python tests/browser/test_appearance_refinement.py
APPEARANCE_BROWSER=webkit python tests/browser/test_appearance_refinement.py
```

Tests use real static pages, EPUB import, images, IndexedDB and live tabs, without
request interception. WebKit uses isolated disk-backed profiles because its
private/ephemeral profile cannot store IndexedDB Blobs. Its network-disruption
tests stop the real loopback origin and verify a negative-control request fails;
this proves server-independent reload, not native Safari airplane-mode behavior.
Desktop automation does not replace final Safari/iOS device and native picker QA.
Arbitrary photos may require a stronger fade for readable text.
