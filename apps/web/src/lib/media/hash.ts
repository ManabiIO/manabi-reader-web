/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Incremental SHA-256; never materializes an entire movie/model in memory. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
const rr = (n: number, s: number) => (n >>> s) | (n << (32 - s));
export class Sha256 {
  private state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  private tail = new Uint8Array(64);
  private words = new Uint32Array(64);
  private tailView = new DataView(this.tail.buffer);
  private used = 0;
  private size = 0;
  private finished = false;
  update(bytes: Uint8Array): this {
    if (this.finished) throw new Error('Digest is finalized');
    this.size += bytes.length;
    if (!Number.isSafeInteger(this.size) || this.size > Number.MAX_SAFE_INTEGER / 8)
      throw new Error('Input too large');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 0;
    while (p < bytes.length) {
      if (!this.used && bytes.length - p >= 64) {
        this.block(view, p);
        p += 64;
      } else {
        const n = Math.min(64 - this.used, bytes.length - p);
        this.tail.set(bytes.subarray(p, p + n), this.used);
        p += n;
        this.used += n;
        if (this.used === 64) {
          this.block(this.tailView, 0);
          this.used = 0;
        }
      }
    }
    return this;
  }
  private block(view: DataView, offset: number) {
    // Reuse the message schedule: a 648 MB model otherwise creates more than
    // ten million typed arrays, views and temporary state arrays.
    const w = this.words,
      state = this.state;
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      w[i] =
        (w[i - 16] +
          (rr(a, 7) ^ rr(a, 18) ^ (a >>> 3)) +
          w[i - 7] +
          (rr(b, 17) ^ rr(b, 19) ^ (b >>> 10))) >>>
        0;
    }
    let a = state[0],
      b = state[1],
      c = state[2],
      d = state[3],
      e = state[4],
      f = state[5],
      g = state[6],
      h = state[7];
    for (let i = 0; i < 64; i++) {
      const t1 =
          (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0,
        t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  hex(): string {
    if (this.finished) throw new Error('Digest is finalized');
    const bits = this.size * 8,
      pad = new Uint8Array(this.used < 56 ? 64 - this.used : 128 - this.used);
    pad[0] = 128;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, Math.floor(bits / 2 ** 32));
    view.setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    this.finished = true;
    return [...this.state].map((x) => x.toString(16).padStart(8, '0')).join('');
  }
}
export const digestText = (text: string) =>
  new Sha256().update(new TextEncoder().encode(text)).hex();
export async function hashBlob(
  blob: Blob,
  signal: AbortSignal,
  progress: (n: number) => void = () => {}
): Promise<string> {
  const hash = new Sha256();
  for (let at = 0; at < blob.size; at += 1024 * 1024) {
    signal.throwIfAborted();
    hash.update(new Uint8Array(await blob.slice(at, at + 1024 * 1024).arrayBuffer()));
    progress(Math.min(blob.size, at + 1024 * 1024));
    await new Promise((r) => setTimeout(r, 0));
  }
  signal.throwIfAborted();
  return hash.hex();
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}
