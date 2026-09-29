/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { displayTitle, passages } from './document';
import type { SnippetRecord, Location } from './database';

/** Lists never load full editable documents or private drafts. Rebuildable in the document transaction. */
export interface SnippetSummary {
  key: string;
  owner: string;
  id: string;
  revision: string;
  title: string;
  excerpt: string;
  createdAt: number;
  modifiedAt: number;
  trashedAt?: number;
  readAt?: number;
  /** Changes only when the durable reading locator changes; used to refresh an open reader. */
  progressAt?: number;
  dirty: boolean;
  progressDirty: boolean;
  conflicts: number;
  transfer?: string;
  issue?: string;
  locations: Pick<Location, 'source' | 'fileId' | 'token' | 'missing' | 'observedRevision'>[];
  destination?: { source: Location['source']; parent: string };
}
export function summarize(record: SnippetRecord): SnippetSummary {
  const doc = record.document;
  return {
    key: record.key,
    owner: record.owner,
    id: doc.id,
    revision: doc.revision,
    title: displayTitle(doc),
    excerpt: passages(doc.content)
      .map((p) => p.text)
      .join('\n')
      .slice(0, 240),
    createdAt: doc.createdAt,
    modifiedAt: doc.modifiedAt,
    trashedAt: doc.trashedAt,
    readAt: record.readAt,
    progressAt: record.progressAt,
    dirty: record.dirty,
    progressDirty: !!record.progressDirty,
    conflicts: record.conflicts.length,
    transfer: record.transfer,
    issue: record.issue,
    locations: record.locations.map(({ source, fileId, token, missing, observedRevision }) => ({
      source,
      fileId,
      token,
      missing,
      observedRevision
    })),
    destination: record.destination
      ? { source: record.destination.source, parent: record.destination.parent }
      : undefined
  };
}
