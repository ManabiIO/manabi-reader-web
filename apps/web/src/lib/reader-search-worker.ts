/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { codePointLength, type PublicationResource } from './reader-location';
import { foldSearchCase } from './library/search-normalization';

interface SearchRequest {
  type: 'search';
  requestId: number;
  bookGeneration: number;
  query: string;
  matchCase: boolean;
  resources: { resource: PublicationResource; text: string }[];
}

interface CancelRequest {
  type: 'cancel';
  requestId: number;
}

export interface ReaderSearchHit {
  resource: PublicationResource;
  start: number;
  end: number;
  excerpt: string;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const maxResults = 10000;
const batchSize = 50;
const chunkSize = 32768;
// Request IDs increase for the lifetime of one worker. A canceled debounce may
// never dispatch a search, so retaining every canceled ID would grow forever.
let cancelledThrough = -1;

self.onmessage = (event: MessageEvent<SearchRequest | CancelRequest>) => {
  if (event.data.type === 'cancel') {
    cancelledThrough = Math.max(cancelledThrough, event.data.requestId);
    return;
  }
  const request = event.data;
  void search(request).catch(() => {
    // Async rejections do not reliably surface as Worker.onerror on the host.
    // Only the still-current request may report an error to its panel.
    if (request.requestId > cancelledThrough)
      self.postMessage({
        type: 'error',
        requestId: request.requestId,
        bookGeneration: request.bookGeneration
      });
  });
};

async function search(request: SearchRequest) {
  const { requestId, bookGeneration, matchCase } = request;
  if (requestId <= cancelledThrough) return;
  const needle = fold(request.query, matchCase);
  if (!needle || codePointLength(request.query) > 512) {
    self.postMessage({ type: 'done', requestId, bookGeneration, total: 0, truncated: false });
    return;
  }
  let total = 0;
  let batch: ReaderSearchHit[] = [];
  let truncated = false;
  // Keep a scan budget across spine boundaries too: many short chapters must
  // not monopolize the worker just because none reaches chunkSize on its own.
  let workSinceYield = 0;
  const emit = () => {
    if (!batch.length || requestId <= cancelledThrough) return;
    self.postMessage({ type: 'batch', requestId, bookGeneration, hits: batch });
    batch = [];
  };

  for (const { resource, text } of request.resources) {
    let buffer = '';
    let starts: number[] = [];
    let ends: number[] = [];
    let sourceStarts: number[] = [];
    let sourceEnds: number[] = [];
    let point = 0;
    let scanned = 0;
    const process = (final: boolean) => {
      const scanTo = final ? buffer.length : Math.max(0, buffer.length - needle.length + 1);
      let at = buffer.indexOf(needle, scanned);
      while (at >= 0 && at < scanTo) {
        const start = starts[at];
        const end = ends[at + needle.length - 1];
        // Search uses folded text, but the preview must show the author's
        // spelling, normalization and complete graphemes, not that index text.
        const excerptStart = sourceStarts[Math.max(0, at - 64)];
        const excerptEnd = sourceEnds[Math.min(buffer.length - 1, at + needle.length + 63)];
        batch.push({ resource, start, end, excerpt: text.slice(excerptStart, excerptEnd) });
        total += 1;
        if (batch.length >= batchSize) emit();
        if (total >= maxResults) {
          truncated = true;
          break;
        }
        at = buffer.indexOf(needle, at + 1);
      }
      scanned = scanTo;
      if (!final) {
        const keep = Math.min(needle.length + 128, buffer.length);
        const removed = buffer.length - keep;
        buffer = buffer.slice(-keep);
        starts = starts.slice(-keep);
        ends = ends.slice(-keep);
        sourceStarts = sourceStarts.slice(-keep);
        sourceEnds = sourceEnds.slice(-keep);
        scanned = Math.max(0, scanned - removed);
      }
    };

    for (const item of segmenter.segment(text)) {
      if (requestId <= cancelledThrough) return;
      const normalized = fold(item.segment, matchCase);
      const nextPoint = point + codePointLength(item.segment);
      buffer += normalized;
      for (let index = 0; index < normalized.length; index += 1) {
        starts.push(point);
        ends.push(nextPoint);
        sourceStarts.push(item.index);
        sourceEnds.push(item.index + item.segment.length);
      }
      point = nextPoint;
      workSinceYield += item.segment.length;
      if (buffer.length >= chunkSize) {
        process(false);
        if (truncated) break;
      }
      if (workSinceYield >= chunkSize) {
        workSinceYield = 0;
        // Yield even when the accumulated work came from short resources.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (requestId <= cancelledThrough) return;
      }
    }
    if (truncated) break;
    process(true);
    emit();
    // The cap can be reached in the final (short) chunk too. Do not scan
    // subsequent resources and emit an extra hit at their next chunk boundary.
    if (truncated) break;
  }
  emit();
  if (requestId > cancelledThrough)
    self.postMessage({ type: 'done', requestId, bookGeneration, total, truncated });
}

function fold(value: string, matchCase: boolean) {
  const normalized = value.normalize('NFC');
  return matchCase ? normalized : foldSearchCase(normalized);
}
