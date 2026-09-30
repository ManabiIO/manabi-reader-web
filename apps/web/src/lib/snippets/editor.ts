/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  Editor,
  generateHTML,
  generateJSON,
  getSchema,
  type Extensions,
  type JSONContent
} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import RubyText from '@tiptap/extension-ruby-text';
import UniqueID from '@tiptap/extension-unique-id';
import { Markdown, MarkdownManager } from '@tiptap/markdown';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  identifyBlocks,
  MAX_SNIPPET_BYTES,
  plainContent,
  validateContent,
  type TextNode
} from './document';

export function extensions(): Extensions {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        autolink: false,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null }
      }
    }),
    // Use the guarded annotation form in editor.svelte. Upstream's inline widget
    // dismisses uncommitted text on blur, outside Save/Keep-draft coordination.
    RubyText.configure({ allowClickToEdit: false }),
    UniqueID.configure({
      types: [
        'paragraph',
        'heading',
        'blockquote',
        'bulletList',
        'orderedList',
        'listItem',
        'codeBlock',
        'horizontalRule'
      ]
    }),
    Markdown.configure({ marked: new Marked() })
  ];
}
export function cleanHTML(html: string): string {
  if (new TextEncoder().encode(html).length > MAX_SNIPPET_BYTES)
    throw new Error('Pasted content exceeds the 2 MiB limit.');
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'div',
      'br',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'strong',
      'b',
      'em',
      'i',
      's',
      'del',
      'u',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'hr',
      'ruby',
      'rb',
      'rt',
      'rp',
      'span'
    ],
    ALLOWED_ATTR: ['href', 'title', 'start', 'type', 'data-id'],
    ALLOW_DATA_ATTR: false,
    ADD_URI_SAFE_ATTR: ['data-id', 'start', 'type', 'title'],
    FORBID_TAGS: [
      'style',
      'script',
      'iframe',
      'object',
      'embed',
      'svg',
      'math',
      'img',
      'video',
      'audio'
    ],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i
  });
}
export function markdownHTML(value: string): string {
  // TipTap 3.31.x registers an experimental ordered-list tokenizer which treats
  // alphabetic/roman sentence prefixes (for example "Hi. there") as list markers.
  // Import only needs CommonMark -> HTML, so use an isolated vanilla Marked lexer.
  // Never share its tokenizer registry with an editor or another import.
  return new Marked().parse(value, { async: false }) as string;
}
export function importContent(value: string, format: 'text' | 'html' | 'markdown'): TextNode {
  if (new TextEncoder().encode(value).length > MAX_SNIPPET_BYTES)
    throw new Error('Pasted content exceeds the 2 MiB limit.');
  if (format === 'text') return plainContent(value);
  // Markdown HTML also goes through the same DOM sanitization boundary.
  const html = format === 'html' ? value : markdownHTML(value);
  const content = identifyBlocks(generateJSON(cleanHTML(html), extensions()) as TextNode, true);
  validateContent(content);
  getSchema(extensions()).nodeFromJSON(content).check();
  return content;
}
export function renderContent(content: TextNode): string {
  validateContent(content);
  return cleanHTML(generateHTML(content as JSONContent, extensions()));
}
export function requiresHTMLMarkdown(content: TextNode): boolean {
  if (content.marks?.some((mark) => mark.type === 'rubyText')) return true;
  if (content.type === 'orderedList' && content.attrs?.start === 0) return true;
  return content.content?.some(requiresHTMLMarkdown) ?? false;
}
export function exportMarkdown(content: TextNode): string {
  // CommonMark has no ruby construct. TipTap 3.31.x also serializes a valid
  // zero-start ordered list as starting at one. Raw HTML is valid Markdown and
  // is the lossless representation for either case.
  return requiresHTMLMarkdown(content)
    ? renderContent(content) + '\n'
    : new MarkdownManager({ extensions: extensions(), marked: new Marked() }).serialize(
        content as JSONContent
      );
}
export function createEditor(
  element: HTMLElement,
  content: TextNode,
  onUpdate: (content: TextNode) => void
): Editor {
  validateContent(content);
  const configured = extensions();
  getSchema(configured).nodeFromJSON(content).check();
  return new Editor({
    element,
    extensions: configured,
    content: content as JSONContent,
    editorProps: {
      attributes: {
        class: 'snippet-editable',
        'aria-label': 'Snippet text',
        role: 'textbox',
        'aria-multiline': 'true',
        lang: 'ja'
      },
      transformPastedHTML: cleanHTML
    },
    onUpdate: ({ editor }) => onUpdate(editor.getJSON() as TextNode)
  });
}
