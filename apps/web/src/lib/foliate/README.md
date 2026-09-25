# Foliate-derived EPUB core

This directory starts from Foliate.js commit `78914aef4466eb960965702401634c2cb348e9b1` and is intentionally limited to the EPUB reading primitives needed by Manabi Reader for Web.

Keep vendored upstream modules close to upstream so future audits remain reviewable. Web-specific archive, security, persistence, selection, and durable-location behavior belongs in adjacent Manabi adapters rather than being folded into the vendored files. Selected correctness fixes from Manabi Native should be ported only when they apply to ordinary browser EPUB reading and are covered by Web regressions.

See `LICENSE` and `/static/licenses/foliate-js.txt`.
