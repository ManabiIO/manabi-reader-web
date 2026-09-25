/** @license BSD-3-Clause */

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_SVG_BYTES = 16 * 1024 * 1024;
const RASTER_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif'
]);

/**
 * One read lifetime owns its image URLs. Analysis uses only resolveSourceImage;
 * it never sees the renewable URLs or starts image decoding. The caller supplies
 * the existing book sanitizer, not a second security policy.
 */
export class BookResourceLease {
  #entries;
  #sourceImages;
  #renderImages;
  #urls;
  #sanitizeSvg;
  #createObjectURL;
  #revokeObjectURL;
  #report;
  #controller;
  #opening;
  #ready;
  #disposed;

  constructor({
    blobs,
    placeholderFor,
    inferMimeType,
    sanitizeSvg,
    createObjectURL = (blob) => globalThis.URL.createObjectURL(blob),
    revokeObjectURL = (url) => globalThis.URL.revokeObjectURL(url),
    report = () => {}
  }) {
    if (
      !blobs ||
      typeof blobs !== 'object' ||
      typeof placeholderFor !== 'function' ||
      typeof inferMimeType !== 'function' ||
      typeof sanitizeSvg !== 'function' ||
      typeof createObjectURL !== 'function' ||
      typeof revokeObjectURL !== 'function'
    ) {
      throw new TypeError('Incomplete book resource composition');
    }
    this.#entries = [];
    this.#sourceImages = new Map();
    this.#renderImages = new Map();
    this.#urls = new Set();
    this.#sanitizeSvg = sanitizeSvg;
    this.#createObjectURL = createObjectURL;
    this.#revokeObjectURL = revokeObjectURL;
    this.#report = report;
    this.#controller = new globalThis.AbortController();
    this.#opening = null;
    this.#ready = false;
    this.#disposed = false;
    for (const [key, original] of Object.entries(blobs)) {
      if (!(original instanceof globalThis.Blob) || original.size > MAX_IMAGE_BYTES) {
        throw new Error('Book image exceeds the size limit');
      }
      const mime = (original.type || inferMimeType(key) || '').split(';', 1)[0].toLowerCase();
      if (mime === 'image/svg+xml' && original.size > MAX_SVG_BYTES) {
        throw new Error('Book SVG exceeds the size limit');
      }
      if (mime !== 'image/svg+xml' && !RASTER_TYPES.has(mime)) continue;
      const placeholder = placeholderFor(key);
      if (typeof placeholder !== 'string' || !placeholder) {
        throw new Error('Invalid book image placeholder');
      }
      const aliases = [placeholder, `ttu:${key}`];
      for (const alias of aliases) {
        if (this.#sourceImages.has(alias)) throw new Error('Ambiguous book image reference');
        this.#sourceImages.set(alias, placeholder);
      }
      this.#entries.push(Object.freeze({ key, original, mime, placeholder, aliases }));
    }
  }

  #assertLive() {
    this.#controller.signal.throwIfAborted();
    if (this.#disposed) throw new globalThis.DOMException('Book resources disposed', 'AbortError');
  }

  /** Normalize declared legacy aliases into stable imported placeholders. */
  resolveSourceImage(source) {
    this.#assertLive();
    return this.#sourceImages.get(source);
  }

  /** Admission is separate from a sanitizer callback, which may swallow errors. */
  assertReady() {
    this.#assertLive();
    if (!this.#ready) throw new Error('Book image resources are not ready');
  }

  /** Does not trust a saved or foreign blob URL. */
  resolveRenderImage(source) {
    this.assertReady();
    return this.#renderImages.get(source);
  }

  imageUrls() {
    this.assertReady();
    return new Set(this.#urls);
  }

  prepare({ signal } = {}) {
    signal?.throwIfAborted();
    this.#assertLive();
    const onAbort = () => this.dispose(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!this.#opening) {
      this.#opening = this.#initialize().catch((error) => {
        this.dispose(error);
        throw error;
      });
    }
    return signal
      ? this.#opening.finally(() => signal.removeEventListener('abort', onAbort))
      : this.#opening;
  }

  async #svgText(blob) {
    const signal = this.#controller.signal;
    signal.throwIfAborted();
    let onAbort;
    const canceled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([blob.text(), canceled]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async #initialize() {
    const replacements = new Map();
    for (const { original, mime, aliases } of this.#entries) {
      this.#assertLive();
      let value = original;
      if (mime === 'image/svg+xml') {
        const text = await this.#svgText(original);
        this.#assertLive();
        const sanitized = this.#sanitizeSvg(text);
        if (typeof sanitized !== 'string') throw new Error('SVG sanitizer must return text');
        value = new globalThis.Blob([sanitized], { type: mime });
      } else if (original.type !== mime) {
        value = new globalThis.Blob([original], { type: mime });
      }
      this.#assertLive();
      const url = this.#createObjectURL(value);
      if (typeof url !== 'string' || !url.startsWith('blob:') || this.#urls.has(url)) {
        throw new Error('Invalid or duplicate book image URL');
      }
      if (this.#disposed) {
        this.#revoke(url);
        this.#assertLive();
      }
      this.#urls.add(url);
      for (const alias of aliases) replacements.set(alias, url);
    }
    this.#assertLive();
    // A failed/canceled batch never exposes a partially bound resource map.
    this.#renderImages = replacements;
    this.#ready = true;
  }

  /** First occurrence in canonical DOM order, including escaped resource names. */
  pictures(sourceImages, isPaginated) {
    this.assertReady();
    const seen = new Set();
    const pictures = [];
    for (const source of sourceImages) {
      const url = this.#renderImages.get(source);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      pictures.push({ url, unspoilered: !isPaginated });
    }
    return pictures;
  }

  dispose(reason = new globalThis.DOMException('Book resources disposed', 'AbortError')) {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#ready = false;
    this.#controller.abort(reason);
    const urls = [...this.#urls];
    this.#urls.clear();
    this.#renderImages.clear();
    this.#sourceImages.clear();
    this.#entries = [];
    for (const url of urls) this.#revoke(url);
  }

  #revoke(url) {
    try {
      this.#revokeObjectURL(url);
    } catch (error) {
      try {
        this.#report({ type: 'book-resource-cleanup-failed', name: error?.name ?? 'Error' });
      } catch {
        /* Diagnostics must not stop release of the remaining URLs. */
      }
    }
  }
}
