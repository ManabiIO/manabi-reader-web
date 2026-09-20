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
import { isOPFType, type EpubContent, type EpubOPFContent } from './types';
import { resolveArchivePath } from '../utils/limited-archive';

const unknown = (): DirectionEvidence => ({ value: 'unknown', source: 'unknown' });
// Normalize before CSSOM parsing: engines may discard the EPUB alias otherwise.
const normalize = (css: string) =>
  css.replace(/(^|[;{])(\s*)-(?:epub|webkit)-writing-mode\s*:/gi, '$1$2writing-mode:');
const values: Record<string, RegExp> = {
  'writing-mode':
    /^(horizontal-tb|vertical-rl|vertical-lr|sideways-rl|sideways-lr|inherit|initial|unset|revert)$/,
  direction: /^(ltr|rtl|inherit|initial|unset|revert)$/,
  display:
    /^(none|contents|block|inline|inline-block|flex|inline-flex|grid|inline-grid|flow-root|list-item|table|inline-table|table-row|table-cell|table-row-group|table-header-group|table-footer-group|table-column|table-column-group|table-caption|inherit|initial|unset|revert)$/,
  visibility: /^(visible|hidden|collapse|inherit|initial|unset|revert)$/
};
function declarations(style: CSSStyleDeclaration) {
  const result: string[] = [];
  for (let index = 0; index < style.length; index++) {
    const property = style.item(index),
      value = style.getPropertyValue(property).trim().toLowerCase();
    if (values[property]?.test(value))
      result.push(
        `${property}:${value}${style.getPropertyPriority(property) ? ' !important' : ''}`
      );
    else if (property === 'all' || values[property]) throw new Error('Unresolved flow declaration');
  }
  return result.join(';');
}
function inline(css: string, document: Document) {
  if (css.length > 16384) throw new Error('Excessive inline flow style');
  const style = document.createElement('span').style;
  style.cssText = normalize(css);
  return declarations(style);
}
/** Only enum-valued flow/visibility properties reach the frame. No URL, font, content or script. */
function stylesheet(css: string, document: Document) {
  if (css.length > 2 * 1024 * 1024 || /@(?:import|layer|container|scope)\b/i.test(css))
    throw new Error('Unresolved conditional or imported flow style');
  const Sheet = (document.defaultView as Window & typeof globalThis).CSSStyleSheet;
  if (typeof Sheet?.prototype.replaceSync !== 'function') throw new Error('CSS parser unavailable');
  const sheet = new Sheet();
  sheet.replaceSync(normalize(css));
  let count = 0;
  const rules = (items: CSSRuleList): string =>
    Array.from(items)
      .map((rule) => {
        if (++count > 8192) throw new Error('Excessive flow rules');
        if (rule.type === 1) {
          const ordinary = rule as CSSStyleRule;
          if (ordinary.selectorText.length > 2048 || /[\\<>@{}]/.test(ordinary.selectorText))
            throw new Error('Unresolved selector');
          const body = declarations(ordinary.style);
          return body ? `${ordinary.selectorText}{${body}}` : '';
        }
        if (rule.type === 4 || rule.type === 12) {
          const conditional = rule as CSSMediaRule | CSSSupportsRule;
          return `@${rule.type === 4 ? 'media' : 'supports'} ${conditional.conditionText}{${rules(conditional.cssRules)}}`;
        }
        // Font faces/keyframes cannot change the static flow. Unsupported grouping must not be guessed.
        if ('cssRules' in rule && rule.type !== 7) throw new Error('Unresolved flow grouping');
        return '';
      })
      .join('\n');
  return rules(sheet.cssRules);
}

/** Authored spine first. Otherwise sample inert XHTML, not language or user-selected reading mode. */
export function epubDirection(
  contents: EpubContent | EpubOPFContent,
  resources: Record<string, string | Blob>,
  ownerDocument: Document
): DirectionEvidence {
  const opf = isOPFType(contents);
  const spine = opf ? contents['opf:package']['opf:spine'] : contents.package.spine;
  const explicit = spine['@_page-progression-direction'];
  if (explicit === 'ltr' || explicit === 'rtl') return resolvePageDirection(explicit);
  if (!ownerDocument.body || !ownerDocument.defaultView) return unknown();
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
    .filter((item) => item && !item['@_properties']?.split(/\s+/).includes('nav'))
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
    if (!doc || !view) return unknown();
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body></body></html>`
    );
    doc.close();
    for (const item of documents) {
      if (!item || typeof resources[item['@_href']] !== 'string') return unknown();
      // XML DOMParser is inert. Never attach its nodes: clone only safe structural elements,
      // literal text, class/id/dir and the flow-only enum declarations above.
      const parsed = new DOMParser().parseFromString(
        String(resources[item['@_href']]),
        'application/xhtml+xml'
      );
      if (parsed.querySelector('parsererror')) return unknown();
      const body = parsed.querySelector('body');
      if (!body) return unknown();
      const css: string[] = [];
      // Preserve link/embedded stylesheet document order and declaration priorities.
      for (const node of parsed.querySelectorAll('link[rel~="stylesheet"],style')) {
        if (node.localName === 'style') css.push(stylesheet(node.textContent || '', ownerDocument));
        else {
          const path = resolveArchivePath(item['@_href'], node.getAttribute('href') || '');
          const source = resources[path];
          if (typeof source !== 'string') return unknown();
          css.push(stylesheet(source, ownerDocument));
        }
      }
      doc.body.replaceChildren();
      doc.head.querySelectorAll('style').forEach((style) => style.remove());
      const style = doc.createElement('style');
      style.textContent = css.join('\n');
      doc.head.appendChild(style);
      const attributes = (target: Element, original: Element) => {
        for (const name of ['id', 'class', 'dir', 'style']) target.removeAttribute(name);
        for (const name of ['id', 'class', 'dir'])
          if (original.hasAttribute(name)) target.setAttribute(name, original.getAttribute(name)!);
        if (original.hasAttribute('style'))
          target.setAttribute('style', inline(original.getAttribute('style')!, ownerDocument));
        if (original.hasAttribute('hidden')) target.setAttribute('hidden', '');
        else target.removeAttribute('hidden');
      };
      attributes(doc.documentElement, parsed.documentElement);
      attributes(doc.body, body);
      let nodes = 0,
        characters = 0;
      const clone = (source: Node, parent: Node) => {
        if (++nodes > 4000 || characters >= 16000) return;
        if (source.nodeType === Node.TEXT_NODE) {
          const text = (source.textContent || '').slice(0, 16000 - characters);
          characters += text.length;
          parent.appendChild(doc.createTextNode(text));
        } else if (source instanceof Element) {
          const tag = source.localName.toLowerCase();
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
              'nav',
              'img',
              'video',
              'audio',
              'template'
            ].includes(tag)
          )
            return;
          const safe =
            /^(p|div|span|section|article|main|aside|h[1-6]|ruby|rb|ul|ol|li|table|tbody|tr|td|a|em|strong|b|i|br)$/.test(
              tag
            )
              ? tag
              : 'div';
          const element = doc.createElement(safe);
          attributes(element, source);
          parent.appendChild(element);
          if (view.getComputedStyle(element).display === 'none') return;
          source.childNodes.forEach((child) => clone(child, element));
        }
      };
      body.childNodes.forEach((node) => clone(node, doc.body));
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const count = node.textContent?.trim().length || 0;
        if (!count || !node.parentElement) continue;
        const computed = view.getComputedStyle(node.parentElement);
        const range = doc.createRange();
        range.selectNodeContents(node);
        if (!range.getClientRects().length || computed.visibility !== 'visible') continue;
        samples.push({
          writingMode: computed.writingMode,
          direction: computed.direction,
          characters: count
        });
      }
    }
    return resolvePageDirection(undefined, samples);
  } catch {
    return unknown();
  } finally {
    frame.remove();
  }
}
