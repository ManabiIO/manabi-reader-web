/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Only trusted shell ↔ trusted reader host traffic uses this contract.
 * EPUB/dictionary documents never receive this capability or native actions.
 */
export const BRIDGE_VERSION = 1 as const;
export const MAX_BRIDGE_BYTES = 768 * 1024;
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
export const MAX_COVER_IMPORT_BYTES = 32 * 1024 * 1024;
export const COVER_IMPORT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Opaque selected-book admission only; never a path, URL, or native capability. */
export interface CoverImportTarget {
  token: string;
  key: string;
  type: (typeof COVER_IMPORT_TYPES)[number];
}
export function parseCoverImportTarget(value: unknown): CoverImportTarget {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['token', 'key', 'type'].includes(key)) ||
    typeof value.token !== 'string' ||
    !value.token.length ||
    value.token.length > 128 ||
    typeof value.key !== 'string' ||
    !value.key.length ||
    value.key.length > 128 ||
    !COVER_IMPORT_TYPES.includes(value.type as CoverImportTarget['type'])
  )
    throw new Error('Choose a PNG, JPEG, or WebP cover for the current Library selection.');
  return { token: value.token, key: value.key, type: value.type as CoverImportTarget['type'] };
}
export const IMPORT_CHUNK_BYTES = 256 * 1024;
export const MAX_IMPORT_TRANSFERS = 2048;
const MAX_MUTATION_RECEIPTS = 2048;
const MAX_TRANSIENT_RECEIPTS = 16;
const MAX_PENDING_TRANSIENT_RECEIPTS = 32;
const IMPORT_CHUNK_ID_PREFIX = 'import_chunk_';
/** UTF-8 length without allocating another copy of chunked transfer payloads. */
export function bridgeMessageBytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

export const bridgeMethods = [
  'snapshot',
  'route',
  'library.query',
  'library.state',
  'library.action',
  'library.content.start',
  'library.content.read',
  'library.content.cancel',
  'library.cover.read',
  'library.cover.cancel',
  'library.catalog.start',
  'library.catalog.read',
  'library.catalog.open',
  'library.catalog.cancel',
  'settings.state',
  'settings.action',
  'snippets.state',
  'snippets.action',
  'open',
  'close',
  'settings',
  'import.begin',
  'import.chunk',
  'import.commit',
  'import.cancel',
  'delete',
  'account.refresh',
  'account.logout',
  'statistics.read',
  'statistics.action'
] as const;
export type BridgeMethod = (typeof bridgeMethods)[number];
/** Reserved read_ identities can only query state. They can never become mutations,
 * even after their bounded reply cache expires. A later query may observe newer state.
 */
export const readOnlyBridgeMethods: readonly BridgeMethod[] = [
  'snapshot',
  'library.query',
  'library.state',
  'library.content.read',
  'library.cover.read',
  'library.catalog.read',
  'settings.state',
  'snippets.state',
  'statistics.read'
];

export interface BridgeScope {
  session: string;
  epoch: number;
}
export interface BridgeRequest extends BridgeScope {
  version: typeof BRIDGE_VERSION;
  id: string;
  method: BridgeMethod;
  payload: Record<string, unknown>;
}
export type BridgeOutcome = 'not-started' | 'completed' | 'unknown';
export interface BridgeReply extends BridgeScope {
  version: typeof BRIDGE_VERSION;
  id: string;
  ok: boolean;
  outcome: BridgeOutcome;
  stale?: boolean;
  value?: unknown;
  error?: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const token = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
/** Canonical identities cannot be reused for another transfer, sequence, or method.
 * Legacy command/UUID identities remain protected by the permanent mutation ledger.
 */
export function importChunkRequestId(transferId: unknown, sequence: unknown): string {
  if (!token(transferId) || !Number.isSafeInteger(sequence) || (sequence as number) < 0)
    throw new Error('Invalid import chunk identity.');
  return `${IMPORT_CHUNK_ID_PREFIX}${transferId}_${sequence}`;
}
const transientChunkRequest = (value: Record<string, unknown>) =>
  typeof value.id === 'string' && value.id.startsWith(IMPORT_CHUNK_ID_PREFIX);
export function parseBridgeRequest(value: unknown): BridgeRequest {
  if (
    !record(value) ||
    value.version !== BRIDGE_VERSION ||
    !token(value.session) ||
    typeof value.id !== 'string' ||
    !(token(value.id) || (transientChunkRequest(value) && (value.id as string).length <= 158)) ||
    !Number.isSafeInteger(value.epoch) ||
    (value.epoch as number) < 0 ||
    !bridgeMethods.includes(value.method as BridgeMethod) ||
    !record(value.payload)
  )
    throw new Error('Invalid reader bridge request.');
  if (value.id.startsWith('read_') && !readOnlyBridgeMethods.includes(value.method as BridgeMethod))
    throw new Error('Read-only request identity cannot authorize a mutation.');
  if (
    transientChunkRequest(value) &&
    (value.method !== 'import.chunk' ||
      value.id !== importChunkRequestId(value.payload.transferId, value.payload.sequence))
  )
    throw new Error('Import chunk identity must match its transfer and sequence.');
  if (bridgeMessageBytes(JSON.stringify(value)) > MAX_BRIDGE_BYTES)
    throw new Error('Reader bridge message exceeds the size limit.');
  return value as unknown as BridgeRequest;
}
export function sameScope(a: BridgeScope, b: BridgeScope) {
  return a.session === b.session && a.epoch === b.epoch;
}
export function safeExternalLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
/** A request is never automatically replayed after a host/account change. */
type Receipt = {
  fingerprint: string | Promise<string>;
  hashed: boolean;
  settled: boolean;
  reply: Promise<BridgeReply>;
};
const fingerprintHash = async (value: string): Promise<string> =>
  Array.from(
    new Uint8Array(
      await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    )
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
export class BridgeAuthority {
  private outcomes = new Map<string, Receipt>();
  private reads = new Map<string, Receipt>();
  private chunks = new Map<string, Receipt>();
  private importTransfer?: ImportTransfer;
  private scope: () => BridgeScope;
  private execute: (request: BridgeRequest, signal: AbortSignal) => Promise<unknown>;
  private lifetime: AbortSignal;
  constructor(
    scope: () => BridgeScope,
    execute: (request: BridgeRequest, signal: AbortSignal) => Promise<unknown>,
    lifetime: AbortSignal,
    importTransfer?: ImportTransfer
  ) {
    this.scope = scope;
    this.execute = execute;
    this.lifetime = lifetime;
    this.importTransfer = importTransfer;
    if (importTransfer) {
      if (lifetime.aborted) importTransfer.cancel();
      else lifetime.addEventListener('abort', () => importTransfer.cancel(), { once: true });
    }
  }
  async request(input: unknown): Promise<BridgeReply> {
    const request = parseBridgeRequest(input);
    const common = {
      version: BRIDGE_VERSION,
      id: request.id,
      session: request.session,
      epoch: request.epoch
    };
    const fingerprint = JSON.stringify(request);
    const readOnly = request.id.startsWith('read_');
    const transientChunk = request.id.startsWith(IMPORT_CHUNK_ID_PREFIX);
    const transient = readOnly || transientChunk;
    const receipts = readOnly ? this.reads : transientChunk ? this.chunks : this.outcomes;
    const previous = receipts.get(request.id);
    if (previous) {
      let matches: boolean;
      try {
        const hashed = previous.hashed;
        matches =
          (await previous.fingerprint) ===
          (hashed ? await fingerprintHash(fingerprint) : fingerprint);
      } catch {
        return {
          ...common,
          ok: false,
          outcome: 'unknown',
          error:
            'A previous command receipt could not be verified. Reconcile saved state before retrying.'
        };
      }
      if (!matches)
        return {
          ...common,
          ok: false,
          outcome: 'not-started',
          error: 'Request identity was reused for different content.'
        };
      const saved = await previous.reply;
      return {
        ...saved,
        stale: !!saved.stale || this.lifetime.aborted || !sameScope(request, this.scope())
      };
    }
    if (this.lifetime.aborted || !sameScope(request, this.scope()))
      return {
        ...common,
        ok: false,
        outcome: 'not-started',
        error: 'The reader or account changed. Refresh before trying again.'
      };
    // Refuse admission rather than dropping mutation outcomes and allowing a retry.
    if (
      transient
        ? [...receipts.values()].filter((receipt) => !receipt.settled).length >=
          MAX_PENDING_TRANSIENT_RECEIPTS
        : this.outcomes.size >= MAX_MUTATION_RECEIPTS
    )
      return {
        ...common,
        ok: false,
        outcome: 'not-started',
        error: readOnly
          ? 'Too many state queries are pending. Wait before refreshing.'
          : transientChunk
            ? 'Too many import chunks are pending. Wait before trying again.'
            : 'Reader command history is full. Restart the app to reconcile saved state.'
      };
    if (transientChunk) {
      try {
        if (!this.importTransfer) throw new Error('Sequenced import transfers are unavailable.');
        // Once evicted, an old chunk can only be rejected, never executed again:
        // admission consumes a sequence even when execution or acknowledgement fails.
        this.importTransfer.admitChunk(
          request,
          request.payload.transferId as string,
          request.payload.sequence as number
        );
      } catch (error) {
        return {
          ...common,
          ok: false,
          outcome: 'not-started',
          error: error instanceof Error ? error.message : 'The import chunk was not admitted.'
        };
      }
    }
    const reply = (async (): Promise<BridgeReply> => {
      try {
        const value = await this.execute(request, this.lifetime);
        return {
          ...common,
          ok: true,
          outcome: 'completed',
          stale: this.lifetime.aborted || !sameScope(request, this.scope()),
          value
        };
      } catch (error) {
        // A failed transient acknowledgement must not make this sequence reusable.
        // Abandon only its matching upload; a newer account/transfer is independent.
        if (transientChunk)
          this.importTransfer?.retire(request, request.payload.transferId as string);
        return {
          ...common,
          ok: false,
          outcome: 'unknown',
          stale: this.lifetime.aborted || !sameScope(request, this.scope()),
          error:
            error instanceof Error
              ? error.message
              : 'The command could not complete. Refresh its saved state before retrying.'
        };
      }
    })();
    const receipt: Receipt = { fingerprint, reply, hashed: false, settled: false };
    receipts.set(request.id, receipt);
    void reply.then(() => {
      receipt.settled = true;
      // Chunk transfer receipts must not retain an entire second base64 copy of
      // every imported book. Preserve cryptographic payload-reuse detection.
      if (!readOnly && fingerprint.length > 1024 && globalThis.crypto?.subtle) {
        const digest = fingerprintHash(fingerprint);
        receipt.fingerprint = digest;
        receipt.hashed = true;
        void digest.catch(() => {
          receipt.fingerprint = fingerprint;
          receipt.hashed = false;
        });
      }
      if (transient) {
        let settled = [...receipts.values()].filter((entry) => entry.settled).length;
        for (const [id, entry] of receipts) {
          if (settled <= MAX_TRANSIENT_RECEIPTS) break;
          if (entry.settled) {
            receipts.delete(id);
            settled--;
          }
        }
      }
    });
    return reply;
  }
}
/** One bounded upload at a time. Bytes cross the bridge once; no whole-book base64 prop. */
export class ImportTransfer {
  get active() {
    return !!this.current;
  }
  // Never recycle an admitted identity, even after cancel, commit, or account ABA.
  // Keep the compact tombstones bounded and refuse new uploads at capacity.
  private usedIds = new Set<string>();
  private current?: {
    id: string;
    name: string;
    size: number;
    received: number;
    sequence: number;
    admittedSequence: number;
    chunks: Uint8Array[];
    scope: BridgeScope;
    cover?: CoverImportTarget;
  };
  begin(scope: BridgeScope, id: string, name: string, size: number) {
    if (!/\.(epub|htmlz|txt)$/i.test(name))
      throw new Error('This file is not a supported book or exceeds the import limit.');
    this.start(scope, id, name, size);
  }
  beginCover(scope: BridgeScope, id: string, name: string, size: number, input: unknown) {
    const cover = parseCoverImportTarget(input);
    if (size > MAX_COVER_IMPORT_BYTES) throw new Error('Choose a cover image smaller than 32 MB.');
    this.start(scope, id, name, size, cover);
  }
  private start(
    scope: BridgeScope,
    id: string,
    name: string,
    size: number,
    cover?: CoverImportTarget
  ) {
    if (this.current) throw new Error('Finish or cancel the current import first.');
    if (
      !token(id) ||
      typeof name !== 'string' ||
      !name.length ||
      name.length > 512 ||
      // eslint-disable-next-line no-control-regex -- reject control characters at the input boundary
      /[\u0000/\\]/.test(name) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > MAX_IMPORT_BYTES
    )
      throw new Error('This file is not a supported book or exceeds the import limit.');
    if (this.usedIds.has(id)) throw new Error('This import identity has already been used.');
    if (this.usedIds.size >= MAX_IMPORT_TRANSFERS)
      throw new Error('Import identity history is full. Restart the app before importing again.');
    this.usedIds.add(id);
    this.current = {
      id,
      name,
      size,
      received: 0,
      sequence: 0,
      admittedSequence: -1,
      chunks: [],
      scope: { ...scope },
      ...(cover ? { cover } : {})
    };
  }
  admitChunk(scope: BridgeScope, id: string, sequence: number) {
    const current = this.owned(scope, id);
    if (sequence !== current.sequence || sequence <= current.admittedSequence)
      throw new Error('Import chunk receipt expired or its sequence is out of order.');
    current.admittedSequence = sequence;
  }
  /** Retire a failed upload without cancelling a newer upload or account. */
  retire(scope: BridgeScope, id: string) {
    if (this.current?.id === id && sameScope(scope, this.current.scope)) this.cancel();
  }
  chunk(scope: BridgeScope, id: string, sequence: number, bytes: Uint8Array) {
    const current = this.owned(scope, id);
    if (
      sequence !== current.sequence ||
      bytes.byteLength < 1 ||
      bytes.byteLength > IMPORT_CHUNK_BYTES ||
      current.received + bytes.byteLength > current.size
    )
      throw new Error('Import chunks are out of order or exceed the declared file size.');
    current.chunks.push(bytes.slice());
    current.received += bytes.byteLength;
    current.sequence++;
    return current.received;
  }
  commit(scope: BridgeScope, id: string) {
    const current = this.owned(scope, id);
    if (current.received !== current.size) throw new Error('The book transfer is incomplete.');
    this.current = undefined;
    return {
      name: current.name,
      size: current.size,
      chunks: current.chunks,
      ...(current.cover ? { cover: current.cover } : {})
    };
  }
  cancel() {
    this.current = undefined;
  }
  private owned(scope: BridgeScope, id: string) {
    const value = this.current;
    if (!value || value.id !== id || !sameScope(scope, value.scope))
      throw new Error('The import belongs to an expired reader or account.');
    return value;
  }
}
