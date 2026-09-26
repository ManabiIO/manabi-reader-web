/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationManifest } from '$lib/reader-location';
import type { EpubResourceData } from './publication-data';

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
 * New imports provide individual resource content/styles through this interface.
 * Only older records use the combined-HTML compatibility path.
 */
export function createStoredFoliateBook(
  htmlContent: string,
  styleSheet: string,
  manifest: PublicationManifest,
  document: Document,
  {
    language = '',
    writingMode = 'horizontal-tb',
    direction,
    resources
  }: {
    language?: string;
    writingMode?: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
    direction?: 'ltr' | 'rtl';
    /** Validated, sanitized and hydrated by the current Web read lifetime. */
    resources?: readonly EpubResourceData[];
  } = {}
): { book: StoredFoliateBook; sourceSections: Element[] } {
  const sourceSections = resources
    ? resources.map((resource, index) => {
        const expected = manifest.resources[index];
        if (
          !expected ||
          expected.href !== resource.href ||
          expected.spineIndex !== resource.spineIndex ||
          expected.sectionId !== resource.sectionId
        )
          throw new Error('EPUB rendering resources do not match the publication.');
        const holder = document.createElement('div');
        holder.innerHTML = resource.html;
        const section = holder.firstElementChild;
        if (holder.children.length !== 1 || !section || section.id !== expected.sectionId)
          throw new Error('EPUB resource has an invalid section root.');
        return section;
      })
    : (() => {
        const source = document.createElement('div');
        source.innerHTML = htmlContent;
        return Array.from(source.children);
      })();
  if (sourceSections.length !== manifest.resources.length)
    throw new Error('Stored EPUB publication manifest does not match its resources.');

  for (const [index, resource] of manifest.resources.entries()) {
    if (
      !resource ||
      resource.spineIndex !== index ||
      typeof resource.href !== 'string' ||
      !resource.href ||
      typeof resource.sectionId !== 'string'
    )
      throw new Error('Stored EPUB publication has an invalid resource identity.');
  }

  const disposers: Array<() => void> = [];
  let destroyed = false;
  const sections = sourceSections.map((section, index): StoredFoliateSection => {
    const resource = manifest.resources[index];
    let currentUrl: string | undefined;
    let references = 0;
    const body = section.outerHTML;
    const markup =
      '<!doctype html><html' +
      (language ? ` lang="${escapeAttribute(language)}"` : '') +
      '><head><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(CSP)}">` +
      `<style>html,body{margin:0;padding:0}body{writing-mode:${writingMode};}${resources?.[index].styleSheet ?? styleSheet}</style>` +
      '</head><body>' +
      `<main class="book-content" data-manabi-spine-index="${resource.spineIndex}" data-manabi-section-id="${escapeAttribute(resource.sectionId)}">` +
      body +
      '</main></body></html>';

    const dispose = () => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
        currentUrl = undefined;
      }
      references = 0;
    };
    disposers.push(dispose);

    return {
      id: resource.href,
      linear: 'yes',
      size: new TextEncoder().encode(markup).byteLength,
      async load() {
        if (destroyed) throw new DOMException('Publication is closed.', 'AbortError');
        if (currentUrl) {
          references += 1;
          return currentUrl;
        }
        // A failed URL allocation must not retain a phantom reference.
        const url = URL.createObjectURL(new Blob([markup], { type: 'text/html' }));
        currentUrl = url;
        references = 1;
        return url;
      },
      unload() {
        references = Math.max(0, references - 1);
        if (!currentUrl || references) return;
        dispose();
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
        for (const dispose of disposers) dispose();
        disposers.length = 0;
      }
    }
  };
}
