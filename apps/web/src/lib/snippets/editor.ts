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
    RubyText,
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
    Markdown
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
export function importContent(value: string, format: 'text' | 'html' | 'markdown'): TextNode {
  if (new TextEncoder().encode(value).length > MAX_SNIPPET_BYTES)
    throw new Error('Pasted content exceeds the 2 MiB limit.');
  if (format === 'text') return plainContent(value);
  // Markdown HTML also goes through the same DOM sanitization boundary.
  const html =
    format === 'html'
      ? value
      : (new MarkdownManager({ extensions: extensions() }).instance.parse(value, {
          async: false
        }) as string);
  const content = identifyBlocks(generateJSON(cleanHTML(html), extensions()) as TextNode, true);
  validateContent(content);
  getSchema(extensions()).nodeFromJSON(content).check();
  return content;
}
export function renderContent(content: TextNode): string {
  validateContent(content);
  return cleanHTML(generateHTML(content as JSONContent, extensions()));
}
export function exportMarkdown(content: TextNode): string {
  // CommonMark has no ruby construct. Raw HTML is valid Markdown and preserves it losslessly.
  const hasRuby = JSON.stringify(content).includes('"rubyText"');
  return hasRuby
    ? renderContent(content) + '\n'
    : new MarkdownManager({ extensions: extensions() }).serialize(content as JSONContent);
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
