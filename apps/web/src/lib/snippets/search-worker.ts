/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { getRecord } from './database';
import { isUUID, searchSnippet } from './document';
import type { SnippetHit } from './document';
self.onmessage = async ({ data }) => {
  const request = data as { requestId: number; owner: string; ids: string[]; query: string };
  try {
    if (
      !Number.isSafeInteger(request.requestId) ||
      typeof request.owner !== 'string' ||
      request.owner.length > 256 ||
      !Array.isArray(request.ids) ||
      request.ids.length > 50000 ||
      !request.ids.every(isUUID) ||
      typeof request.query !== 'string' ||
      request.query.length > 512
    )
      throw new Error('Invalid snippet search.');
    let matched = 0,
      truncated = false;
    let scanned = 0,
      failed = 0;
    let batch: { id: string; hits: SnippetHit[] }[] = [];
    for (const id of request.ids) {
      try {
        const record = await getRecord(request.owner, id);
        if (record && !record.document.trashedAt) {
          const hits = searchSnippet(record.document, request.query, 3);
          if (hits.length) {
            batch.push({ id, hits });
            matched++;
          }
        }
      } catch {
        failed++;
      }
      scanned++;
      if (matched >= 1000) {
        truncated = scanned < request.ids.length;
        break;
      }
      if (scanned % 20 === 0) {
        self.postMessage({ requestId: request.requestId, type: 'batch', batch, scanned, failed });
        batch = [];
      }
    }
    self.postMessage({
      requestId: request.requestId,
      type: 'done',
      batch,
      scanned,
      failed,
      truncated
    });
  } catch {
    self.postMessage({ requestId: request.requestId, type: 'error' });
  }
};
