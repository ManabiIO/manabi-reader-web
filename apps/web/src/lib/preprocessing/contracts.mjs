/** @license BSD-3-Clause */
// Public, provider-neutral contracts. No proprietary analysis implementation.
export const PROTOCOL_VERSION = 1;
export const CACHE_SCHEMA = 2;
export const MAX_CHAPTER_BYTES = 16 * 1024 * 1024;
export const MAX_RESULT_BYTES = 64 * 1024 * 1024;
export const utf8Size = (value) => new globalThis.TextEncoder().encode(value).byteLength;
export function aborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new globalThis.DOMException('Aborted', 'AbortError');
}
export function canonicalJSON(value) {
  const ancestors = new Set();
  const encode = (item, depth) => {
    if (depth > 128) throw new TypeError('Contract nesting exceeds budget');
    if (item === null || typeof item === 'boolean' || typeof item === 'string')
      return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (
      typeof item !== 'object' ||
      (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)
    )
      throw new TypeError('Contract contains a non-JSON value');
    if (ancestors.has(item)) throw new TypeError('Contract contains a cycle');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        const parts = [];
        for (let index = 0; index < item.length; index++) {
          if (!Object.hasOwn(item, index)) throw new TypeError('Contract contains a sparse array');
          parts.push(encode(item[index], depth + 1));
        }
        return '[' + parts.join(',') + ']';
      }
      return (
        '{' +
        Object.keys(item)
          .sort()
          .map((k) => JSON.stringify(k) + ':' + encode(item[k], depth + 1))
          .join(',') +
        '}'
      );
    } finally {
      ancestors.delete(item);
    }
  };
  return encode(value, 0);
}
export async function sha256(value) {
  const bytes = typeof value === 'string' ? new globalThis.TextEncoder().encode(value) : value;
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), (n) => n.toString(16).padStart(2, '0')).join('');
}
export function identifier(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192)
    throw new TypeError(`Invalid ${label}`);
  return value;
}
export function validateProvider(provider) {
  if (!provider || provider.protocol !== PROTOCOL_VERSION)
    throw new Error('Unsupported preprocessor protocol');
  identifier(provider.id, 'provider identity');
  identifier(provider.release, 'provider release');
  for (const method of ['fingerprint', 'preprocess', 'mount', 'dispose']) {
    if (typeof provider[method] !== 'function')
      throw new TypeError(`Preprocessor is missing ${method}`);
  }
  return provider;
}
export function validateResult(result, fingerprint) {
  if (!result || result.protocol !== PROTOCOL_VERSION || result.fingerprint !== fingerprint)
    throw new Error('Stale or unsupported chapter result');
  if (typeof result.html !== 'string' || utf8Size(result.html) > MAX_RESULT_BYTES)
    throw new Error('Invalid chapter HTML');
  const encoded = canonicalJSON(result);
  if (utf8Size(encoded) > MAX_RESULT_BYTES) throw new Error('Chapter result exceeds memory budget');
  if (result.sidecar === undefined) throw new Error('Missing chapter sidecar');
  if (result.sidecar !== null && fingerprint === null)
    throw new Error('Annotations require an analysis generation');
  if (!Array.isArray(result.vocabulary)) throw new Error('Missing vocabulary projection');
  if (result.sidecar === null && result.vocabulary.length !== 0)
    throw new Error('Unprocessed output cannot contain vocabulary');
  const seenVocabulary = new Set();
  for (const row of result.vocabulary) {
    identifier(row.term, 'term');
    identifier(row.key, 'vocabulary key');
    if (seenVocabulary.has(row.key)) throw new Error('Duplicate vocabulary key');
    seenVocabulary.add(row.key);
    if (row.reading !== null && typeof row.reading !== 'string') throw new Error('Invalid reading');
    if (!Number.isSafeInteger(row.count) || row.count <= 0)
      throw new Error('Invalid occurrence count');
  }
  return JSON.parse(encoded);
}
export async function chapterCacheKey({
  provider,
  fingerprint,
  source,
  bookKey,
  chapterID,
  baseURL,
  contextKey,
  resourceVersion,
  analysisOptions = {}
}) {
  return sha256(
    canonicalJSON({
      schema: CACHE_SCHEMA,
      protocol: PROTOCOL_VERSION,
      provider: provider.id,
      release: provider.release,
      fingerprint,
      source: await sha256(source),
      bookKey,
      chapterID,
      baseURL,
      contextKey,
      resourceVersion,
      analysisOptions
    })
  );
}
export function unchangedChapter(html, fingerprint = null) {
  return { protocol: PROTOCOL_VERSION, fingerprint, html, sidecar: null, vocabulary: [] };
}
export function normalizeChapterResult(output, html, fingerprint) {
  if (output === null) return unchangedChapter(html, fingerprint);
  const result = validateResult(output, fingerprint);
  if (result.sidecar === null && result.html !== html)
    throw new Error('A transformation requires a sidecar');
  return result;
}
export const identityPreprocessor = Object.freeze({
  protocol: PROTOCOL_VERSION,
  id: 'identity',
  release: '1',
  fingerprint: async () => null,
  preprocess: async () => null,
  mount: () => () => {},
  dispose: () => {}
});
