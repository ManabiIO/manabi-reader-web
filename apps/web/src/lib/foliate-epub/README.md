# Foliate-derived EPUB core

This directory contains the EPUB-only Foliate.js code used by Manabi Reader for Web.

- Upstream source: johnfactotum/foliate-js
- Pinned upstream revision: `78914aef4466eb960965702401634c2cb348e9b1`
- License: MIT; see `LICENSE.foliate-js.txt`
- Scope: EPUB publication parsing, EPUB CFI support, and the resource-loading foundation needed by the Reader Web EPUB renderer.

The Web fork intentionally does not import Foliate's PDF, MOBI/KF8, FB2, CBZ, TTS, demo reader, or media-overlay feature stack. Generic lifecycle fixes proven in Manabi Native's Foliate fork may be ported here selectively, with Web-specific regression coverage.
