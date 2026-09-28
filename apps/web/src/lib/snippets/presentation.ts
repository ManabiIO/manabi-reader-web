/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { safeLink, validateContent, type TextNode, type SnippetLocator, isUUID } from './document';
import type { SnippetRecord } from './database';
import type { SnippetSummary } from './summary';

const escape = (text: unknown) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
/** Closed-schema rendering does not load the editor, accept arbitrary HTML, or save reader decorations. */
export function readerHTML(content: TextNode): string {
  validateContent(content);
  function render(node: TextNode, path: string): string {
    if (node.type === 'text') {
      let html = escape(node.text);
      for (const mark of [...(node.marks ?? [])].reverse()) {
        const tag = (
          { bold: 'strong', italic: 'em', underline: 'u', strike: 's', code: 'code' } as Record<
            string,
            string
          >
        )[mark.type];
        if (tag) html = `<${tag}>${html}</${tag}>`;
        else if (mark.type === 'rubyText')
          html = `<ruby>${html}<rt>${escape(mark.attrs?.rt)}</rt></ruby>`;
        else if (mark.type === 'link' && safeLink(mark.attrs?.href))
          html = `<a href="${escape(mark.attrs!.href)}" target="_blank" rel="noopener noreferrer nofollow">${html}</a>`;
      }
      return html;
    }
    if (node.type === 'hardBreak') return '<br>';
    const children = (node.content ?? []).map((child, i) => render(child, `${path}.${i}`)).join('');
    if (node.type === 'doc') return children;
    const tag = (
      {
        paragraph: 'p',
        heading: `h${node.attrs?.level ?? 2}`,
        blockquote: 'blockquote',
        bulletList: 'ul',
        orderedList: 'ol',
        listItem: 'li',
        codeBlock: 'pre',
        horizontalRule: 'hr'
      } as Record<string, string>
    )[node.type];
    if (!tag) throw new Error('Unsupported snippet node.');
    const id = escape(node.attrs?.id ?? path);
    const attrs =
      ` data-id="${id}"` +
      (node.type === 'orderedList' ? ` start="${Number(node.attrs?.start ?? 1)}"` : '');
    return node.type === 'horizontalRule'
      ? `<hr${attrs}>`
      : `<${tag}${attrs}>${node.type === 'codeBlock' ? `<code>${children}</code>` : children}</${tag}>`;
  }
  return render(content, '0');
}
export function saveLabel(
  record:
    | Pick<SnippetRecord, 'destination' | 'dirty' | 'conflicts' | 'transfer' | 'issue'>
    | SnippetSummary
): string {
  if (record.transfer) return 'Move needs completion';
  if (typeof record.conflicts === 'number' ? record.conflicts > 0 : record.conflicts.length > 0)
    return 'Conflicting versions · both kept';
  if (!record.destination) return 'On this device only';
  const provider = record.destination.source.provider;
  const label =
    (
      {
        google: 'Google Drive',
        dropbox: 'Dropbox',
        onedrive: 'OneDrive',
        local: 'connected folder',
        webdav: 'WebDAV'
      } as Record<string, string>
    )[provider] ?? provider;
  if (record.dirty) return `Saved on this device · waiting for ${label}`;
  return `Saved to ${label}`;
}
export function parseLocator(raw: string | null): SnippetLocator | undefined {
  if (!raw || raw.length > 16000) return;
  try {
    const x = JSON.parse(raw) as SnippetLocator;
    if (
      x &&
      typeof x.blockId === 'string' &&
      x.blockId.length <= 256 &&
      typeof x.quote === 'string' &&
      x.quote.length <= 4000 &&
      typeof x.before === 'string' &&
      x.before.length <= 256 &&
      Number.isSafeInteger(x.offset) &&
      x.offset >= 0 &&
      x.offset <= 2 * 1024 * 1024 &&
      isUUID(x.revision)
    )
      return x;
  } catch {
    /* An invalid navigation hint cannot change a document. */
  }
  return undefined;
}
/** A return link cannot navigate to another origin, protocol, or arbitrary authenticated route. */
export function safeReturn(raw: string | null, base: string): string {
  const fallback = `${base}/snippets`;
  if (
    !raw ||
    raw.length > 20000 ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    // eslint-disable-next-line no-control-regex -- Reject NUL in navigation targets.
    /[\\\u0000-\u0020]/.test(raw)
  )
    return fallback;
  try {
    const u = new URL(raw, 'https://reader.invalid');
    if (
      u.origin !== 'https://reader.invalid' ||
      ![`${base}/snippets`, `${base}/manage`].includes(u.pathname)
    )
      return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}
