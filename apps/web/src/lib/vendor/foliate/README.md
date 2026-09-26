# Foliate EPUB substrate

This directory vendors the EPUB-only pieces of Foliate.js used as the basis of
Manabi Reader Web's EPUB engine migration.

Upstream revision: `78914aef4466eb960965702401634c2cb348e9b1`

Included here: EPUB parsing, EPUB CFI, pagination, progress helpers, and overlay
geometry. Other Foliate formats, PDF, TTS, the demo reader, and unrelated
features are intentionally not vendored.

Manabi-specific browser security, durable ReaderLocator persistence, continuous
reading, annotations, search, library storage, and UI remain outside this
directory. Generic fixes proven in the native Manabi Foliate fork are ported
selectively with regression tests rather than copying its native viewer shell.

See `/THIRD_PARTY_EPUB_LICENSES.md` for the MIT notice.
