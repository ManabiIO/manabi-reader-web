/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  resolvePageDirection,
  type DirectionEvidence,
  type FlowSample
} from '$lib/library/direction';
import {
  sanitizeBookHtml,
  sanitizeBookStyleSheet
} from '../../book-security/book-content-security';
import { isOPFType, type EpubContent, type EpubOPFContent } from './types';
import { resolveArchivePath } from '../utils/limited-archive';

/**
 * Use the authored page progression, not the app's language or user-selected reading mode.
 * When absent, inspect the browser's actual CSS cascade in a scriptless, networkless frame.
 * Only a structural clone (no URLs, event handlers, images, custom elements or SVG) enters it.
 */
export function epubDirection(
  contents: EpubContent | EpubOPFContent,
  resources: Record<string, string | Blob>,
  ownerDocument: Document
): DirectionEvidence {
  const opf = isOPFType(contents);
  const spine = opf ? contents['opf:package']['opf:spine'] : contents.package.spine;
  const explicit = spine['@_page-progression-direction'];
  if (explicit === 'ltr' || explicit === 'rtl') return resolvePageDirection(explicit);
  if (!ownerDocument.body || !ownerDocument.defaultView) return resolvePageDirection(undefined);
  const manifest = opf
    ? contents['opf:package']['opf:manifest']['opf:item']
    : contents.package.manifest.item;
  const refs = opf
    ? contents['opf:package']['opf:spine']['opf:itemref']
    : contents.package.spine.itemref;
  const byId = new Map(manifest.map((item) => [item['@_id'], item]));
  const documents = (Array.isArray(refs) ? refs : [refs])
    .filter((ref) => ref && ref['@_linear'] !== 'no')
    .map((ref) => byId.get(ref['@_idref']))
    .filter(
      (item) =>
        item &&
        !item['@_properties']?.split(/\s+/).includes('nav') &&
        typeof resources[item['@_href']] === 'string'
    )
    .slice(0, 12);
  const frame = ownerDocument.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:800px;height:600px;opacity:0;pointer-events:none';
  ownerDocument.body.appendChild(frame);
  const samples: FlowSample[] = [];
  try {
    const doc = frame.contentDocument,
      view = frame.contentWindow;
    if (!doc || !view) return resolvePageDirection(undefined);
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body></body></html>`
    );
    doc.close();
    for (const item of documents) {
      if (!item) continue;
      // Parse with the same sanitizer as the importer, before even making a detached DOM.
      const embedded: string[] = [];
      const raw = String(resources[item['@_href']]);
      const parsed = new DOMParser().parseFromString(
        sanitizeBookHtml(raw, {
          document: ownerDocument,
          wholeDocument: true,
          onEmbeddedStyle: (css) => embedded.push(css)
        }),
        'text/html'
      );
      doc.body.replaceChildren();
      doc.head.querySelectorAll('style').forEach((style) => style.remove());
      // Link elements are removed by sanitization. Read only manifest-owned CSS references
      // from the detached source document; no fetch ever occurs.
      const source = new DOMParser().parseFromString(raw, 'application/xhtml+xml');
      const linked: string[] = [];
      let missingStyle = false;
      for (const link of source.querySelectorAll('link[rel~="stylesheet"]')) {
        try {
          const path = resolveArchivePath(item['@_href'], link.getAttribute('href') || '');
          const content = resources[path];
          if (typeof content === 'string') linked.push(content);
          else missingStyle = true;
        } catch {
          missingStyle = true; /* External/escaping references are not evidence. */
        }
      }
      if (missingStyle || [...linked, ...embedded].some((css) => /@import\b/i.test(css))) continue;
      const style = doc.createElement('style');
      style.textContent = sanitizeBookStyleSheet(
        [...linked, ...embedded].join('\n'),
        ownerDocument
      ).replace(/-(?:epub|webkit)-writing-mode\s*:/gi, 'writing-mode:');
      doc.head.appendChild(style);
      for (const [target, original] of [
        [doc.documentElement, parsed.documentElement],
        [doc.body, parsed.body]
      ]) {
        for (const name of ['id', 'class', 'dir', 'style']) {
          target.removeAttribute(name);
          if (original?.hasAttribute(name)) target.setAttribute(name, original.getAttribute(name)!);
        }
      }
      let nodes = 0,
        characters = 0;
      const clone = (sourceNode: Node, parent: Node) => {
        if (++nodes > 4000 || characters > 16000) return;
        if (sourceNode.nodeType === Node.TEXT_NODE) {
          const text = (sourceNode.textContent || '').slice(0, 16000 - characters);
          characters += text.length;
          parent.appendChild(doc.createTextNode(text));
        } else if (sourceNode instanceof Element) {
          const tag = sourceNode.localName.toLowerCase();
          if (
            [
              'script',
              'style',
              'link',
              'meta',
              'iframe',
              'object',
              'svg',
              'math',
              'rt',
              'rp',
              'nav'
            ].includes(tag)
          )
            return;
          // Unknown tags are inert divs; no custom-element construction or URL attributes.
          const safeTag =
            /^(p|div|span|section|article|main|aside|h[1-6]|ruby|rb|ul|ol|li|table|tbody|tr|td|a|em|strong|b|i|br)$/.test(
              tag
            )
              ? tag
              : 'div';
          const element = doc.createElement(safeTag);
          for (const name of ['id', 'class', 'dir', 'style']) {
            if (sourceNode.hasAttribute(name))
              element.setAttribute(name, sourceNode.getAttribute(name)!);
          }
          parent.appendChild(element);
          sourceNode.childNodes.forEach((child) => clone(child, element));
        }
      };
      parsed.body.childNodes.forEach((node) => clone(node, doc.body));
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const count = node.textContent?.trim().length || 0;
        if (!count || !node.parentElement) continue;
        const computed = view.getComputedStyle(node.parentElement);
        if (computed.display === 'none' || computed.visibility === 'hidden') continue;
        samples.push({
          writingMode: computed.writingMode,
          direction: computed.direction,
          characters: count
        });
      }
    }
    return resolvePageDirection(undefined, samples);
  } catch {
    // Malformed books may be readable even when their direction cannot be established.
    return resolvePageDirection(undefined);
  } finally {
    frame.remove();
  }
}
