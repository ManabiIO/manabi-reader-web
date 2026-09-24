/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { codePointLength, type PublicationResource } from './reader-location';

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
  const needle = fold(request.query, matchCase);
  if (!needle || codePointLength(request.query) > 512) {
    self.postMessage({ type: 'done', requestId, bookGeneration, total: 0, truncated: false });
    return;
  }
  let total = 0;
  let batch: ReaderSearchHit[] = [];
  let truncated = false;
  const emit = () => {
    if (!batch.length || requestId <= cancelledThrough) return;
    self.postMessage({ type: 'batch', requestId, bookGeneration, hits: batch });
    batch = [];
  };

  for (const { resource, text } of request.resources) {
    let buffer = '';
    let starts: number[] = [];
    let ends: number[] = [];
    let point = 0;
    let scanned = 0;
    const process = (final: boolean) => {
      const scanTo = final ? buffer.length : Math.max(0, buffer.length - needle.length + 1);
      let at = buffer.indexOf(needle, scanned);
      while (at >= 0 && at < scanTo) {
        const start = starts[at];
        const end = ends[at + needle.length - 1];
        const excerptStart = Math.max(0, at - 64);
        const excerptEnd = Math.min(buffer.length, at + needle.length + 64);
        batch.push({ resource, start, end, excerpt: buffer.slice(excerptStart, excerptEnd) });
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
      }
      point = nextPoint;
      if (buffer.length < chunkSize) continue;
      process(false);
      if (truncated) break;
      // A worker cannot receive cancel while one synchronous scan monopolizes its event loop.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (truncated) break;
    process(true);
    emit();
  }
  emit();
  if (requestId > cancelledThrough)
    self.postMessage({ type: 'done', requestId, bookGeneration, total, truncated });
}

function fold(value: string, matchCase: boolean) {
  const normalized = value.normalize('NFC');
  return matchCase ? normalized : normalized.toLowerCase();
}
