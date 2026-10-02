/** @license BSD-3-Clause */
/** Only trusted shell ↔ trusted reader host traffic uses this contract.
 * EPUB/dictionary documents never receive this capability or native actions.
 */
export const BRIDGE_VERSION = 1 as const;
export const MAX_BRIDGE_BYTES = 768 * 1024;
export const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
export const IMPORT_CHUNK_BYTES = 256 * 1024;
export const bridgeMethods = ['snapshot', 'library.query', 'open', 'close', 'settings', 'import.begin', 'import.chunk', 'import.commit', 'import.cancel', 'delete', 'account.refresh', 'account.logout', 'statistics.read', 'statistics.action'] as const;
export type BridgeMethod = typeof bridgeMethods[number];
export interface BridgeScope { session: string; epoch: number }
export interface BridgeRequest extends BridgeScope { version: typeof BRIDGE_VERSION; id: string; method: BridgeMethod; payload: Record<string, unknown> }
export type BridgeOutcome = 'not-started' | 'completed' | 'unknown';
export interface BridgeReply extends BridgeScope { version: typeof BRIDGE_VERSION; id: string; ok: boolean; outcome: BridgeOutcome; stale?: boolean; value?: unknown; error?: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
export function parseBridgeRequest(value: unknown): BridgeRequest {
  if (!record(value) || value.version !== BRIDGE_VERSION || !token(value.session) || !token(value.id) || !Number.isSafeInteger(value.epoch) || (value.epoch as number) < 0 || !bridgeMethods.includes(value.method as BridgeMethod) || !record(value.payload)) throw new Error('Invalid reader bridge request.');
  if (JSON.stringify(value).length > MAX_BRIDGE_BYTES) throw new Error('Reader bridge message exceeds the size limit.');
  return value as unknown as BridgeRequest;
}
export function sameScope(a: BridgeScope, b: BridgeScope) { return a.session === b.session && a.epoch === b.epoch; }
export function safeExternalLink(value: string): string | undefined {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
/** A request is never automatically replayed after a host/account change. */
export class BridgeAuthority {
  private outcomes = new Map<string, { fingerprint: string; reply: Promise<BridgeReply> }>();
  private scope: () => BridgeScope;
  private execute: (request: BridgeRequest, signal: AbortSignal) => Promise<unknown>;
  private lifetime: AbortSignal;
  constructor(scope: () => BridgeScope, execute: (request: BridgeRequest, signal: AbortSignal) => Promise<unknown>, lifetime: AbortSignal) { this.scope = scope; this.execute = execute; this.lifetime = lifetime; }
  async request(input: unknown): Promise<BridgeReply> {
    const request = parseBridgeRequest(input);
    const common = { version: BRIDGE_VERSION, id: request.id, session: request.session, epoch: request.epoch };
    const fingerprint = JSON.stringify(request);
    const previous = this.outcomes.get(request.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return { ...common, ok: false, outcome: 'not-started', error: 'Request identity was reused for different content.' };
      const saved = await previous.reply;
      return { ...saved, stale: !!saved.stale || this.lifetime.aborted || !sameScope(request, this.scope()) };
    }
    if (this.lifetime.aborted || !sameScope(request, this.scope())) return { ...common, ok: false, outcome: 'not-started', error: 'The reader or account changed. Refresh before trying again.' };
    // Refuse admission rather than dropping mutation outcomes and allowing a retry.
    if (this.outcomes.size >= 2048) return { ...common, ok: false, outcome: 'not-started', error: 'Reader command history is full. Restart the app to reconcile saved state.' };
    const reply = (async (): Promise<BridgeReply> => {
      try { const value = await this.execute(request, this.lifetime); return { ...common, ok: true, outcome: 'completed', stale: this.lifetime.aborted || !sameScope(request, this.scope()), value }; }
      catch (error) { return { ...common, ok: false, outcome: 'unknown', stale: this.lifetime.aborted || !sameScope(request, this.scope()), error: error instanceof Error ? error.message : 'The command could not complete. Refresh its saved state before retrying.' }; }
    })();
    this.outcomes.set(request.id, { fingerprint, reply });
    return reply;
  }
}
/** One bounded upload at a time. Bytes cross the bridge once; no whole-book base64 prop. */
export class ImportTransfer {
  private current?: { id: string; name: string; size: number; received: number; sequence: number; chunks: Uint8Array[]; scope: BridgeScope };
  begin(scope: BridgeScope, id: string, name: string, size: number) {
    if (this.current) throw new Error('Finish or cancel the current import first.');
    if (!token(id) || !/\.(epub|htmlz|txt)$/i.test(name) || name.length > 512 || /[\u0000/\\]/.test(name) || !Number.isSafeInteger(size) || size < 1 || size > MAX_IMPORT_BYTES) throw new Error('This file is not a supported book or exceeds the import limit.');
    this.current = { id, name, size, received: 0, sequence: 0, chunks: [], scope: { ...scope } };
  }
  chunk(scope: BridgeScope, id: string, sequence: number, bytes: Uint8Array) {
    const current = this.owned(scope, id);
    if (sequence !== current.sequence || bytes.byteLength < 1 || bytes.byteLength > IMPORT_CHUNK_BYTES || current.received + bytes.byteLength > current.size) throw new Error('Import chunks are out of order or exceed the declared file size.');
    current.chunks.push(bytes.slice()); current.received += bytes.byteLength; current.sequence++;
    return current.received;
  }
  commit(scope: BridgeScope, id: string) {
    const current = this.owned(scope, id);
    if (current.received !== current.size) throw new Error('The book transfer is incomplete.');
    this.current = undefined;
    return { name: current.name, size: current.size, chunks: current.chunks };
  }
  cancel() { this.current = undefined; }
  private owned(scope: BridgeScope, id: string) { const value = this.current; if (!value || value.id !== id || !sameScope(scope, value.scope)) throw new Error('The import belongs to an expired reader or account.'); return value; }
}
