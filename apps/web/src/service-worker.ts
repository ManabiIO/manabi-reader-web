/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';
import { userFontsCacheName } from '$lib/data/fonts';
import { registerReaderServiceWorker } from '$lib/service-worker/reader-service-worker.mjs';

// eslint-disable-next-line no-restricted-globals
const worker = self as unknown as ServiceWorkerGlobalScope;
registerReaderServiceWorker(worker, { build, files, prerendered, version, userFontsCacheName });
