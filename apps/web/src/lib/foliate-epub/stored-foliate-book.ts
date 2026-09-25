/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationManifest } from '$lib/reader-location';

const CSP =
  "default-src 'none'; img-src blob: data:; media-src blob: data:; font-src blob: data:; " +
  "style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'";

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

export interface StoredFoliateSection {
  id: string;
  linear: 'yes';
  load(): Promise<string>;
  unload(): void;
  createDocument(): Promise<Document>;
  size: number;
}

export interface StoredFoliateBook {
  sections: StoredFoliateSection[];
  dir?: 'ltr' | 'rtl';
  destroy(): void;
}

/**
 * Adapt Reader Web's existing sanitized stored representation to Foliate's
 * section interface. This is the migration bridge for already-imported books;
 * new import work can later populate the same interface directly from EPUB.
 */
export function createStoredFoliateBook(
  htmlContent: string,
  styleSheet: string,
  manifest: PublicationManifest,
  document: Document,
  {
    language = '',
    writingMode = 'horizontal-tb',
    direction
  }: {
    language?: string;
    writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
    direction?: 'ltr' | 'rtl';
  } = {}
): { book: StoredFoliateBook; sourceSections: Element[] } {
  const source = document.createElement('div');
  source.innerHTML = htmlContent;
  const sourceSections = Array.from(source.children);
  if (sourceSections.length !== manifest.resources.length)
    throw new Error('Stored EPUB publication manifest does not match its resources.');

  const liveUrls = new Set<string>();
  let destroyed = false;
  const sections = sourceSections.map((section, index): StoredFoliateSection => {
    const resource = manifest.resources[index];
    let currentUrl: string | undefined;
    const body = section.outerHTML;
    const markup =
      '<!doctype html><html' +
      (language ? ` lang="${escapeAttribute(language)}"` : '') +
      '><head><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(CSP)}">` +
      `<style>html,body{margin:0;padding:0}body{writing-mode:${writingMode};}${styleSheet}</style>` +
      '</head><body>' +
      `<main class="book-content" data-manabi-spine-index="${resource.spineIndex}" data-manabi-section-id="${escapeAttribute(resource.sectionId)}">` +
      body +
      '</main></body></html>';

    return {
      id: resource.href,
      linear: 'yes',
      size: new TextEncoder().encode(markup).byteLength,
      async load() {
        if (destroyed) throw new DOMException('Publication is closed.', 'AbortError');
        if (currentUrl) return currentUrl;
        currentUrl = URL.createObjectURL(new Blob([markup], { type: 'text/html' }));
        liveUrls.add(currentUrl);
        return currentUrl;
      },
      unload() {
        if (!currentUrl) return;
        URL.revokeObjectURL(currentUrl);
        liveUrls.delete(currentUrl);
        currentUrl = undefined;
      },
      async createDocument() {
        if (destroyed) throw new DOMException('Publication is closed.', 'AbortError');
        return new DOMParser().parseFromString(markup, 'text/html');
      }
    };
  });

  return {
    sourceSections,
    book: {
      sections,
      dir: direction,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        for (const section of sections) section.unload();
        for (const url of liveUrls) URL.revokeObjectURL(url);
        liveUrls.clear();
      }
    }
  };
}
