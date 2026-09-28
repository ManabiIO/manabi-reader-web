/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { finite, isDigest, onlyKeys, record } from './contracts.js';
import { Sha256 } from './hash.js';
import { sparseBounds, type SparseState } from './sparse-transcription.js';

/** Device-only evidence for audio that actually produced a saved hypothesis. */
export interface AudioProof {
  start: number;
  end: number;
  digest: string;
}

export function audioProof(start: number, end: number, pcm: Float32Array): AudioProof {
  if (!(pcm instanceof Float32Array) || !pcm.length || !pcm.every(Number.isFinite))
    throw new Error('Invalid audio proof input');
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return { start, end, digest: new Sha256().update(bytes).hex() };
}

/** Bounded native SHA-256 for one decoded input, not a whole-file hashing API.
 * digest copies the byte view on entry; await it before transferring PCM to MOSS.
 * Cancellation fences the result, not the browser's already-started hash operation.
 * The synchronous path remains for environments without Web Crypto. A native
 * failure is not silently retried on the UI thread or accepted without evidence.
 */
export async function audioProofAsync(
  start: number,
  end: number,
  pcm: Float32Array,
  signal: AbortSignal
): Promise<AudioProof> {
  signal.throwIfAborted();
  if (
    !(pcm instanceof Float32Array) ||
    !pcm.length ||
    pcm.length > 60 * 16000 ||
    !(pcm.buffer instanceof ArrayBuffer)
  )
    throw new Error('Invalid bounded audio proof input');
  // Avoid a callback invocation per sample; preserve exactly the finite-value check.
  for (let i = 0; i < pcm.length; i++)
    if (!Number.isFinite(pcm[i])) throw new Error('Invalid audio proof input');
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { start, end, digest: new Sha256().update(bytes).hex() };
  const result = await subtle.digest('SHA-256', bytes);
  signal.throwIfAborted();
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32)
    throw new Error('Invalid SHA-256 audio proof result');
  return {
    start,
    end,
    digest: Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    )
  };
}

/** Every saved sparse hypothesis must have one matching decoded-input proof. */
export function validateAudioProofs(
  value: unknown,
  sparse: SparseState,
  duration: number
): AudioProof[] {
  if (!Array.isArray(value)) throw new Error('Invalid saved audio proofs');
  const expected = [
    ...sparse.windows.flatMap((window, index) => (window ? [sparseBounds(index, duration)] : [])),
    ...sparse.repairs.flatMap((repair, index) =>
      repair
        ? [
            {
              start: sparseBounds(index, duration).start,
              end: sparseBounds(index + 1, duration).end
            }
          ]
        : []
    )
  ];
  if (value.length !== expected.length) throw new Error('Missing saved audio proof');
  const remaining = new Map<string, number>();
  for (const range of expected) {
    const key = `${range.start}:${range.end}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const proofs = value.map((raw) => {
    const proof = record(raw);
    onlyKeys(proof, ['start', 'end', 'digest']);
    const start = finite(proof.start, 0, duration);
    const end = finite(proof.end, 0, duration);
    if (start >= end || !isDigest(proof.digest)) throw new Error('Invalid saved audio proof');
    const key = `${start}:${end}`;
    const count = remaining.get(key) ?? 0;
    if (!count) throw new Error('Audio proof does not belong to saved inference');
    remaining.set(key, count - 1);
    return { start, end, digest: proof.digest };
  });
  if ([...remaining.values()].some(Boolean)) throw new Error('Missing saved audio proof');
  return proofs;
}
