/** @license BSD-3-Clause */
import { aborted, canonicalJSON, identifier, sha256, validateProvider } from './contracts.mjs';
const MAX_MODULE_BYTES = 8 * 1024 * 1024;
export function deploymentURL(value, base) {
  if (typeof value !== 'string') throw new TypeError('Missing deployment path');
  const url = new URL(value, base),
    origin = new URL(base);
  if (
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !['http:', 'https:'].includes(url.protocol) ||
    /%2f|%5c/i.test(url.pathname)
  ) {
    throw new Error('Preprocessor assets must be same-origin static files');
  }
  return url;
}
async function boundedBytes(response, maximum, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response body');
  const chunks = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    aborted(signal);
    while (true) {
      const { value, done } = await reader.read();
      aborted(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('Invalid preprocessor response stream');
      size += value.byteLength;
      if (!Number.isSafeInteger(size) || size > maximum)
        throw new Error('Preprocessor download exceeds budget');
      // A stream can reuse its backing buffer after read() returns.
      chunks.push(value.slice());
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function freezeJSON(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJSON(child);
    Object.freeze(value);
  }
  return value;
}
/** Data-only setup path: obtains the catalogue without evaluating the private
 * module or initializing Swift/MeCab. It does not download dictionary contents.
 * The application may use manifest.processingResources in its installation
 * coordinator before the user opens a book. No configured plugin => no request.
 */
export async function loadDeploymentManifest({
  manifestURL,
  baseURL,
  fetcher = globalThis.fetch,
  signal
} = {}) {
  aborted(signal);
  if (!manifestURL) return { manifest: null, assetBaseURL: null, status: 'not-configured' };
  const url = deploymentURL(manifestURL, baseURL);
  const response = await fetcher(url, {
    signal,
    credentials: 'same-origin',
    cache: 'no-cache',
    redirect: 'error'
  });
  aborted(signal);
  if (response.status === 404)
    return { manifest: null, assetBaseURL: null, status: 'not-installed' };
  if (!response.ok) throw new Error(`Preprocessor manifest HTTP ${response.status}`);
  const manifest = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(response, 65536, signal))
  );
  if (manifest?.protocol !== 1) throw new Error('Unsupported preprocessor manifest');
  identifier(manifest.release, 'deployment release');
  deploymentURL(manifest.entry?.path, url);
  if (!/^[a-f0-9]{64}$/.test(manifest.entry?.sha256 ?? ''))
    throw new Error('Missing module integrity');
  if (manifest.processingResources !== undefined && !Array.isArray(manifest.processingResources))
    throw new Error('Invalid processing catalogue');
  // Validate nesting/JSON shape before recursive freezing, and isolate callers
  // from the decoded object. Asset semantics are admitted by setup/install.
  const snapshot = freezeJSON(JSON.parse(canonicalJSON(manifest)));
  aborted(signal);
  return { manifest: snapshot, assetBaseURL: url.href, status: 'ready' };
}
export async function loadDeploymentPreprocessor({
  manifestURL,
  baseURL,
  fetcher = globalThis.fetch,
  importer = (url) => import(/* @vite-ignore */ url),
  report = () => {},
  signal
} = {}) {
  const configuration = await loadDeploymentManifest({ manifestURL, baseURL, fetcher, signal });
  if (configuration.manifest === null) return { provider: null, status: configuration.status };
  const { manifest, assetBaseURL } = configuration;
  const entryURL = deploymentURL(manifest.entry.path, assetBaseURL);
  const script = await fetcher(entryURL, { signal, credentials: 'same-origin', redirect: 'error' });
  aborted(signal);
  if (!script.ok) throw new Error(`Preprocessor module HTTP ${script.status}`);
  const bytes = await boundedBytes(script, MAX_MODULE_BYTES, signal);
  if ((await sha256(bytes)) !== manifest.entry.sha256)
    throw new Error('Preprocessor module integrity mismatch');
  aborted(signal);
  // Release tooling emits ONE self-contained module. Relative imports and
  // external CDN modules are not permitted in its release bundle.
  const objectURL = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  let candidate = null;
  try {
    const module = await importer(objectURL);
    aborted(signal);
    if (typeof module?.createPreprocessor !== 'function')
      throw new Error('Missing preprocessor factory');
    candidate = await module.createPreprocessor({ manifest, assetBaseURL, signal, report });
    aborted(signal);
    const provider = validateProvider(candidate);
    if (provider.release !== manifest.release) throw new Error('Mixed deployment generation');
    return { provider, status: 'ready' };
  } catch (error) {
    // Validation failure is also a failed construction. Do not leak a private
    // Worker or its dictionary leases because its returned contract was wrong.
    if (typeof candidate?.dispose === 'function') {
      try {
        await candidate.dispose();
      } catch {
        try {
          report({ type: 'plugin-cleanup-failed' });
        } catch {
          // Preserve the original provider validation error.
        }
      }
    }
    throw error;
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}
