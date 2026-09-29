/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';
import { userFontsCacheName } from '$lib/data/fonts';
import { registerReaderServiceWorker } from '$lib/service-worker/reader-service-worker.mjs';

// Optional analysis must not be fetched by the offline shell installer.
const lazyAssets = build.filter((path) =>
  /(?:^|\/)(?:voice-pitch\.worker-[^/]+\.js|swift-f0-0\.3\.0-[^/]+\.onnx|ort-wasm-simd-threaded-[^/]+\.wasm)$/.test(
    path
  )
);

// eslint-disable-next-line no-restricted-globals
const worker = self as unknown as ServiceWorkerGlobalScope;
registerReaderServiceWorker(worker, {
  build,
  files,
  prerendered,
  version,
  userFontsCacheName,
  lazyAssets
});
