/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Versioned data transport; no storage, account, rendering or native imports. */
export const STATISTICS_CHUNK_CHARACTERS = 8000;
export const STATISTICS_REPLY_MAX_BYTES = 64 * 1024;
/** Explicit transfer memory admission: at most16MiB UTF-16 projection per retained owner.
 * Oversized metadata fails visibly; it is never presented as a truncated result. */
export const STATISTICS_TRANSFER_MAX_CHARACTERS = 8 * 1024 * 1024;
export interface StatisticsTransferReply {
  sharedVersion: 1;
  snapshotId: string;
  sequence: number;
  chunk: string;
  totalCharacters: number;
  complete: boolean;
  nextCursor?: string;
}
interface Transfer {
  snapshotId: string;
  owner: string;
  query: string;
  encoded: string;
  offset: number;
  sequence: number;
  created: number;
}
/** At most two compact serialized projections, not a raw-history copy per cursor. */
export class StatisticsTransfers {
  private transfers = new Map<string, Transfer>();
  constructor(
    private readonly now = () => Date.now(),
    private readonly token = () => crypto.randomUUID(),
    private readonly ttl = 120000
  ) {}
  clear(owner?: string) {
    for (const [key, value] of this.transfers)
      if (!owner || value.owner === owner) this.transfers.delete(key);
  }
  begin(snapshotId: string, owner: string, query: string, data: unknown) {
    this.expire();
    this.clear(owner);
    while (this.transfers.size >= 2) this.transfers.delete(this.transfers.keys().next().value!);
    const encoded = JSON.stringify(data);
    if (
      !snapshotId ||
      snapshotId.length > 96 ||
      encoded.length > STATISTICS_TRANSFER_MAX_CHARACTERS
    )
      throw new Error(
        'This Statistics projection exceeds the device transfer memory limit. Open Statistics for an individual Library book or use the web app.'
      );
    return this.page({
      snapshotId,
      owner,
      query,
      encoded,
      offset: 0,
      sequence: 0,
      created: this.now()
    });
  }
  snapshot(cursor: string, owner: string, query: string) {
    return this.require(cursor, owner, query).snapshotId;
  }
  isFinal(cursor: string, owner: string, query: string) {
    const value = this.require(cursor, owner, query);
    return value.encoded.length - value.offset <= STATISTICS_CHUNK_CHARACTERS;
  }
  next(cursor: string, owner: string, query: string) {
    const transfer = this.require(cursor, owner, query);
    this.transfers.delete(cursor); // Single-use order token: duplicate/late pages cannot advance twice.
    return this.page(transfer);
  }
  private expire() {
    for (const [key, value] of this.transfers)
      if (this.now() < value.created || this.now() - value.created > this.ttl)
        this.transfers.delete(key);
  }
  private require(cursor: string, owner: string, query: string) {
    this.expire();
    const transfer = this.transfers.get(cursor);
    if (!transfer || transfer.owner !== owner || transfer.query !== query)
      throw new Error('This statistics transfer changed or expired. Refresh Statistics.');
    return transfer;
  }
  private page(transfer: Transfer): StatisticsTransferReply {
    const chunk = transfer.encoded.slice(
      transfer.offset,
      transfer.offset + STATISTICS_CHUNK_CHARACTERS
    );
    transfer.offset += chunk.length;
    const complete = transfer.offset === transfer.encoded.length;
    const nextCursor = complete ? undefined : this.token();
    if (nextCursor) this.transfers.set(nextCursor, transfer);
    return {
      sharedVersion: 1,
      snapshotId: transfer.snapshotId,
      sequence: transfer.sequence++,
      chunk,
      totalCharacters: transfer.encoded.length,
      complete,
      ...(nextCursor ? { nextCursor } : {})
    };
  }
}
/** Reject missing/reordered/inconsistent pages, never expose an incomplete model. */
export class StatisticsTransferAssembly {
  private snapshotId = '';
  private sequence = 0;
  private totalCharacters = -1;
  private chunks: string[] = [];
  private length = 0;
  private finished = false;
  append(value: StatisticsTransferReply): unknown | undefined {
    if (
      this.finished ||
      !value ||
      value.sharedVersion !== 1 ||
      value.sequence !== this.sequence ||
      typeof value.snapshotId !== 'string' ||
      !value.snapshotId ||
      value.snapshotId.length > 96 ||
      typeof value.chunk !== 'string' ||
      value.chunk.length === 0 ||
      value.chunk.length > STATISTICS_CHUNK_CHARACTERS ||
      (!value.complete && value.chunk.length !== STATISTICS_CHUNK_CHARACTERS) ||
      !Number.isSafeInteger(value.totalCharacters) ||
      value.totalCharacters < 0 ||
      value.totalCharacters > STATISTICS_TRANSFER_MAX_CHARACTERS ||
      typeof value.complete !== 'boolean' ||
      (value.complete
        ? value.nextCursor !== undefined
        : typeof value.nextCursor !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(value.nextCursor))
    )
      throw new Error('Incomplete statistics transfer. Refresh Statistics.');
    if (this.sequence === 0) {
      this.snapshotId = value.snapshotId;
      this.totalCharacters = value.totalCharacters;
    }
    if (this.snapshotId !== value.snapshotId || this.totalCharacters !== value.totalCharacters)
      throw new Error('Statistics changed during transfer. Refresh Statistics.');
    this.sequence++;
    this.length += value.chunk.length;
    if (
      this.length > this.totalCharacters ||
      (!value.complete && this.length >= this.totalCharacters)
    )
      throw new Error('Invalid statistics transfer length.');
    this.chunks.push(value.chunk);
    if (!value.complete) return;
    if (this.length !== this.totalCharacters)
      throw new Error('Incomplete statistics transfer. Refresh Statistics.');
    this.finished = true;
    const result = JSON.parse(this.chunks.join(''));
    this.chunks = [];
    if (!result || result.snapshotId !== this.snapshotId)
      throw new Error('Statistics transfer identity changed.');
    return result;
  }
}

/** Cancelling before the async owner admits a read must not reopen it later.
 * Saturation fails closed for one transfer lifetime rather than evicting a still-
 * live cancellation. This bounds memory without making an old cancellation ABA. */
export class StatisticsCancellationLedger {
  private cancelled = new Map<string, number>();
  private blockedUntil = 0;
  constructor(
    private readonly now = () => Date.now(),
    private readonly ttl = 120000,
    private readonly capacity = 128
  ) {}
  private key(owner: string, requestId: string) {
    return `${owner}\0${requestId}`;
  }
  private expire() {
    for (const [key, expires] of this.cancelled)
      if (this.now() >= expires) this.cancelled.delete(key);
  }
  cancel(owner: string, requestId: string) {
    this.expire();
    const key = this.key(owner, requestId);
    if (!this.cancelled.has(key) && this.cancelled.size >= this.capacity) {
      this.blockedUntil = this.now() + this.ttl;
      this.cancelled.clear();
    }
    this.cancelled.set(key, this.now() + this.ttl);
  }
  assertNotCancelled(owner: string, requestId: string) {
    this.expire();
    if (this.now() < this.blockedUntil || this.cancelled.has(this.key(owner, requestId)))
      throw new Error(
        'This Statistics request was cancelled. Start a new request after the current transfer window.'
      );
  }
}
