# CPU-only MOSS browser assets

`python tools/media/build-moss.py` builds `single/moss.mjs` / `single/moss.wasm`
and their `threaded/` equivalents from the pinned C++/ggml source. These files
must be included by the deployment build. They are intentionally not fabricated
or committed here. Model weights are fetched on an explicit Generate action,
streamed into OPFS, and verified against the pinned SHA-256.

The application must serve `.wasm` as `application/wasm`. Threaded execution is
selected only when `crossOriginIsolated` and `SharedArrayBuffer` are available;
otherwise the single-thread SIMD runtime is used. This patch does not impose
COOP/COEP on the existing app or assume its OAuth/cloud flows are qualified under
isolation. Browser thread teardown, memory use and speed require real-device tests.

The build uses `-sDYNAMIC_EXECUTION=0`; deployment CSP should allow
`'wasm-unsafe-eval'`, never broaden to JavaScript `'unsafe-eval'`. Each runtime
directory includes the upstream MOSS and ggml notices plus build.json with source,
compiler, port and file digests. A stricter CSP attached to worker responses must
be qualified separately from the application's document meta policy.

Before any model download, the Worker verifies the module's ABI, engine revision,
ggml revision and actual single/shared-memory mode. A stale runtime directory fails
with a rebuild/deploy message; it is never silently assigned the app's expected
provenance. Rebuild both variants for `manabi-web-v2`. Changing a port revision
invalidates resumption of incomplete old-engine jobs, not completed subtitle tracks.

Required JavaScript/C functions, WORKERFS integration, typed heap views, the
cancellation address and pthread teardown are also checked before weight download.
The recipe explicitly produces separate `.wasm` assets and exports the heap views.

Both variants are compiled into isolated staging directories before local publication.
The installed pair is retained if prepublication validation fails; caught rename
failures restore the previous outputs. Failed recovery retains a named backup for
inspection. This is not an atomic live-deployment switch or crash-proof filesystem
transaction. Use the normal immutable deployment artifact/release process. Generated
runtime and recovery directories are Git-ignored, but must be deliberately included
in the final deployment artifact after their real build/recognition gates pass.
