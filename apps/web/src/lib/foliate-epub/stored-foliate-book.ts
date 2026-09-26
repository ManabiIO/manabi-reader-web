/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { PublicationManifest } from '$lib/reader-location';
import { validateEpubPublication, type EpubResourceData } from './publication-data.ts';
import { getParagraphNodes } from '../components/book-reader/get-paragraph-nodes.ts';
import { getCharacterCount } from '../functions/get-character-count.ts';

const CSP =
  "default-src 'none'; img-src blob:; font-src 'self' blob: data:; " +
  "style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

export interface StoredFoliateSection {
  id: string;
  linear: 'yes';
  load(): Promise<string>;
  unload(): void;
  createDocument(): Promise<Document>;
  prepareDocument(document: Document): void;
  size: number;
}

export interface StoredFoliateBook {
  sections: StoredFoliateSection[];
  dir?: 'ltr' | 'rtl';
  captureState(index: number, document: Document): void;
  destroy(): void;
}

type ReadingState = { ruby: boolean[]; images: boolean[] };

/**
 * New EPUBs consume persisted per-resource documents directly. Only old books
 * use the joined-HTML compatibility adapter. Source DOMs are created on demand
 * with a small cache; opening a novel no longer constructs its whole DOM here.
 * Inputs have passed the same persisted-read sanitizer as the legacy surface.
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
    resources?: EpubResourceData[];
  } = {}
): {
  book: StoredFoliateBook;
  characterCounts: number[];
  sourceSection(index: number): Element | undefined;
  findSection(target: string): number;
} {
  const sourceCache = new Map<number, Element>();
  let sourceHtml: string[];
  let characterCounts: number[];
  if (resources) {
    validateEpubPublication({ version: 1, resources }, manifest);
    sourceHtml = resources.map((resource) => resource.html);
    characterCounts = resources.map((resource) => resource.characters);
  } else {
    const source = document.createElement('div');
    source.innerHTML = htmlContent;
    const sections = Array.from(source.children);
    if (sections.length !== manifest.resources.length)
      throw new Error('Stored EPUB publication manifest does not match its resources.');
    sourceHtml = sections.map((section) => section.outerHTML);
    characterCounts = sections.map((section) =>
      getParagraphNodes(section).reduce((count, node) => count + getCharacterCount(node), 0)
    );
  }
  const states = new Map<number, ReadingState>();
  const liveUrls = new Set<string>();
  let destroyed = false;
  const sourceSection = (index: number): Element | undefined => {
    if (destroyed || !Number.isSafeInteger(index) || index < 0 || index >= sourceHtml.length)
      return;
    let result = sourceCache.get(index);
    if (!result) {
      const root = document.createElement('div');
      root.innerHTML = sourceHtml[index];
      result = root.firstElementChild ?? undefined;
      if (!result) return;
    }
    sourceCache.delete(index);
    sourceCache.set(index, result);
    if (sourceCache.size > 3) sourceCache.delete(sourceCache.keys().next().value!);
    return result;
  };
  const sections = sourceHtml.map((body, index): StoredFoliateSection => {
    const resource = manifest.resources[index];
    let currentUrl: string | undefined;
    let references = 0;
    const css = resources?.[index].styleSheet ?? styleSheet;
    const markup =
      '<!doctype html><html' +
      (language ? ` lang="${escapeAttribute(language)}"` : '') +
      '><head><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(CSP)}">` +
      `<style>html,body{margin:0;padding:0}body{writing-mode:${writingMode};}${css}</style>` +
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
        references += 1;
        if (currentUrl) return currentUrl;
        currentUrl = URL.createObjectURL(new Blob([markup], { type: 'text/html' }));
        liveUrls.add(currentUrl);
        return currentUrl;
      },
      unload() {
        references = Math.max(0, references - 1);
        if (!currentUrl || references) return;
        if (liveUrls.delete(currentUrl)) URL.revokeObjectURL(currentUrl);
        currentUrl = undefined;
      },
      async createDocument() {
        if (destroyed) throw new DOMException('Publication is closed.', 'AbortError');
        return new DOMParser().parseFromString(markup, 'text/html');
      },
      prepareDocument(doc) {
        if (destroyed) return;
        const state = states.get(index);
        if (!state) return;
        doc.querySelectorAll('.book-content ruby').forEach((ruby, ordinal) => {
          ruby.classList.toggle('reveal-rt', state.ruby[ordinal] === true);
        });
        doc.querySelectorAll('.book-content img,.book-content svg').forEach((image, ordinal) => {
          if (!state.images[ordinal]) return;
          const wrapper = image.closest('[data-ttu-spoiler-img]');
          wrapper?.removeAttribute('data-ttu-spoiler-img');
          wrapper?.querySelector('.spoiler-label')?.remove();
          image.classList.add('ttu-unspoilered');
          image.querySelector('image')?.classList.add('ttu-unspoilered');
        });
      }
    };
  });
  return {
    characterCounts,
    sourceSection,
    findSection(target) {
      const direct = manifest.resources.findIndex((resource) => resource.sectionId === target);
      if (direct >= 0) return direct;
      for (let index = 0; index < sourceHtml.length; index++) {
        const section = sourceSection(index);
        if (section?.id === target || section?.querySelector(`#${CSS.escape(target)}`))
          return index;
      }
      return -1;
    },
    book: {
      sections,
      dir: direction,
      captureState(index, doc) {
        if (destroyed || !sections[index] || !doc.body) return;
        states.set(index, {
          ruby: Array.from(doc.querySelectorAll('.book-content ruby'), (ruby) =>
            ruby.classList.contains('reveal-rt')
          ),
          images: Array.from(
            doc.querySelectorAll('.book-content img,.book-content svg'),
            (image) => !image.closest('[data-ttu-spoiler-img]')
          )
        });
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        for (const url of liveUrls) URL.revokeObjectURL(url);
        liveUrls.clear();
        sourceCache.clear();
        states.clear();
        sourceHtml = [];
      }
    }
  };
}
