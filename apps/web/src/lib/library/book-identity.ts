/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BookLink } from '../manabi/persistence';
import { bookKey, contentBookKey, sourceBookKey } from './organization-keys.ts';

export interface BookIdentityRecord {
  id: number;
  contentHash?: string;
  libraryOwner?: string;
}
export type BookIdentitySource = { id: string; owner: string | null; root: string };
type IdentityLink = Pick<
  BookLink,
  'sourceId' | 'owner' | 'root' | 'fileId' | 'contentHash' | 'bookId'
>;
export type BookIdentityMatch =
  | { kind: 'matched'; bookId: number }
  | { kind: 'ambiguous' }
  | { kind: 'unmatched' };

export function normalizedContentHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}
const contentIdentity = (owner: string | null, hash: string) => JSON.stringify([owner, hash]);
const linkSource = (link: IdentityLink): BookIdentitySource => ({
  id: link.sourceId,
  owner: link.owner,
  root: link.root
});
function match(ids: ReadonlySet<number>): BookIdentityMatch {
  if (ids.size > 1) return { kind: 'ambiguous' };
  const bookId = ids.values().next().value;
  return bookId === undefined ? { kind: 'unmatched' } : { kind: 'matched', bookId };
}

/** Read-only inventory shared by shelf projection and import. Links describe
 * physical copies; only a live book's own verified hash describes its content.
 * Deleted rows cannot create conflicts or authorize reuse of a different book.
 */
export class BookIdentityIndex {
  private readonly books = new Map<number, string>();
  private readonly byContent = new Map<string, Set<number>>();
  private readonly byFile = new Map<string, IdentityLink[]>();
  private readonly libraryOwners = new Map<number, string>();
  private readonly ambiguousLegacyOwners = new Set<number>();

  constructor(records: readonly BookIdentityRecord[], links: readonly IdentityLink[]) {
    const owners = new Map<number, Set<string | null>>();
    const linked = new Set<number>();
    for (const record of records) {
      const hash = normalizedContentHash(record.contentHash);
      if (hash && Number.isSafeInteger(record.id) && record.id > 0) {
        this.books.set(record.id, hash);
        if (record.libraryOwner !== undefined)
          this.libraryOwners.set(record.id, record.libraryOwner);
      }
    }
    for (const value of links) {
      const link = { ...value };
      const key = sourceBookKey(linkSource(link), link.fileId);
      const atFile = this.byFile.get(key) ?? [];
      atFile.push(link);
      this.byFile.set(key, atFile);
      linked.add(link.bookId);
      // A stale link cannot grant its account ownership of a live book whose
      // own content hash disagrees with the link's claim.
      if (
        this.books.get(link.bookId) !== normalizedContentHash(link.contentHash) ||
        (this.libraryOwners.has(link.bookId) && this.libraryOwners.get(link.bookId) !== link.owner)
      )
        continue;
      const scopes = owners.get(link.bookId) ?? new Set<string | null>();
      scopes.add(link.owner);
      owners.set(link.bookId, scopes);
    }
    for (const [bookId, hash] of this.books) {
      const inferred = owners.get(bookId);
      // Legacy rows predate durable libraryOwner. If the same numeric reading
      // history has valid private links from multiple accounts and no local
      // public copy, neither account is authority to reuse that row.
      if (
        !this.libraryOwners.has(bookId) &&
        inferred &&
        !inferred.has(null) &&
        inferred.size > 1
      ) {
        this.ambiguousLegacyOwners.add(bookId);
        continue;
      }
      // Browser imports without an owner belong to the local source scope.
      // A connected import keeps its recorded owner even if link publication
      // fails. Legacy books with only stale links have no safe inferred scope.
      for (const owner of inferred ??
        (this.libraryOwners.has(bookId)
          ? [this.libraryOwners.get(bookId)!]
          : linked.has(bookId)
            ? []
            : [null])) {
        const key = contentIdentity(owner, hash);
        const ids = this.byContent.get(key) ?? new Set<number>();
        ids.add(bookId);
        this.byContent.set(key, ids);
      }
    }
  }

  resolve(source: BookIdentitySource, fileId: string, contentHash?: string): BookIdentityMatch {
    const hash = normalizedContentHash(contentHash);
    if (contentHash !== undefined && !hash) return { kind: 'unmatched' };
    const exact = new Set<number>();
    for (const link of this.byFile.get(sourceBookKey(source, fileId)) ?? []) {
      if (this.ambiguousLegacyOwners.has(link.bookId)) continue;
      const linkedHash = normalizedContentHash(link.contentHash);
      if (
        linkedHash &&
        this.books.get(link.bookId) === linkedHash &&
        (!this.libraryOwners.has(link.bookId) ||
          this.libraryOwners.get(link.bookId) === link.owner) &&
        (!hash || hash === linkedHash)
      )
        exact.add(link.bookId);
    }
    if (exact.size) return match(exact);
    return hash
      ? match(this.byContent.get(contentIdentity(source.owner, hash)) ?? new Set())
      : { kind: 'unmatched' };
  }

  /** A path-only override is not permission to decorate replacement bytes. */
  allowsSourceAlias(source: BookIdentitySource, fileId: string, contentHash?: string): boolean {
    const claims = this.byFile.get(sourceBookKey(source, fileId)) ?? [];
    const hash = normalizedContentHash(contentHash);
    return (
      !claims.length ||
      (!!hash && claims.every((link) => normalizedContentHash(link.contentHash) === hash))
    );
  }
}

/** expectedBookId is a stale-selection check, never authority to skip conflicts. */
export function resolveImportedBook(
  records: readonly BookIdentityRecord[],
  links: readonly IdentityLink[],
  source: BookIdentitySource,
  fileId: string,
  contentHash: string,
  expectedBookId?: number
): number | undefined {
  const hash = normalizedContentHash(contentHash);
  if (!hash) throw new Error('The book content identity is invalid.');
  if (
    expectedBookId !== undefined &&
    (!Number.isSafeInteger(expectedBookId) || expectedBookId <= 0)
  )
    throw new Error('The selected book identity is invalid.');
  const result = new BookIdentityIndex(records, links).resolve(source, fileId, hash);
  if (result.kind === 'ambiguous')
    throw new Error(
      'This file matches multiple saved reading histories. No reading history was selected.'
    );
  const bookId = result.kind === 'matched' ? result.bookId : undefined;
  if (expectedBookId !== undefined && bookId !== expectedBookId)
    throw new Error('The book identity or contents changed. Refresh the Library and try again.');
  return bookId;
}

/** Link IDs are opaque: a local move intentionally retains its existing row ID.
 * Reusing the old path must neither return that moved row nor overwrite it.
 * Call inside the link transaction, with a precomputed collision-free fallback.
 */
export function selectBookLink(
  links: readonly BookLink[],
  proposed: BookLink,
  compatibleBookIds: ReadonlySet<number>,
  fallbackId: string
): BookLink {
  const locator = sourceBookKey(linkSource(proposed), proposed.fileId);
  const hash = normalizedContentHash(proposed.contentHash);
  if (!hash || !compatibleBookIds.has(proposed.bookId))
    throw new Error('The saved book identity changed before the file could be linked.');
  const exact = links.filter(
    (link) =>
      sourceBookKey(linkSource(link), link.fileId) === locator &&
      normalizedContentHash(link.contentHash) === hash &&
      compatibleBookIds.has(link.bookId)
  );
  if (exact.some((link) => link.bookId !== proposed.bookId))
    throw new Error('The file has conflicting saved reading histories. Refresh the Library.');
  if (exact.length) return [...exact].sort((a, b) => a.id.localeCompare(b.id))[0];
  const ids = new Set(links.map((link) => link.id));
  if (!ids.has(proposed.id)) return { ...proposed, contentHash: hash };
  if (!fallbackId || ids.has(fallbackId)) throw new Error('The file link changed. Try again.');
  return { ...proposed, id: fallbackId, contentHash: hash };
}

/** Promote legacy aliases only when all retained claims agree. The original
 * alias survives an ambiguous migration rather than being assigned by order.
 */
export function organizationIdentityReplacements(
  links: readonly IdentityLink[],
  records: readonly BookIdentityRecord[]
): Map<string, string> {
  const liveHashes = new Map(
    records.map((record) => [record.id, normalizedContentHash(record.contentHash)])
  );
  const hashes = new Map<string, string | null>();
  for (const link of links) {
    const hash = normalizedContentHash(link.contentHash);
    for (const key of [bookKey(link.bookId), sourceBookKey(linkSource(link), link.fileId)]) {
      if (!hash) hashes.set(key, null);
      else if (!hashes.has(key)) hashes.set(key, hash);
      else if (hashes.get(key) !== hash) hashes.set(key, null);
    }
  }
  const replacements = new Map<string, string>();
  for (const [key, hash] of hashes) {
    if (!hash) continue;
    // A stale physical claim must not move another live book's personal metadata.
    if (key.startsWith('book:') && liveHashes.get(Number(key.slice(5))) !== hash) continue;
    replacements.set(key, contentBookKey(hash));
  }
  return replacements;
}
