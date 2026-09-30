/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import test from 'node:test';
import {\n  exportMarkdown,\n  markdownHTML,\n  requiresHTMLMarkdown\n} from '../../apps/web/src/lib/snippets/editor.ts';
import { validateContent } from '../../apps/web/src/lib/snippets/document.ts';

function text(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

test('Markdown import keeps ordinary alphabetic sentence prefixes as prose', () => {
  for (const value of ['Hi. there', 'Ok. Next step.', 'Ex) aside', 'iv. not a list']) {
    const html = markdownHTML(value);
    assert.equal(text(html), value, value);
    assert.match(html, /^<p>/, value);
    assert.doesNotMatch(html, /<ol\b/, value);
  }
});

test('Markdown import still recognizes numeric CommonMark ordered lists', () => {
  const html = markdownHTML('1. one\n2. two');
  assert.match(html, /<ol>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<li>two<\/li>/);
});

test('Markdown import preserves a valid zero-start ordered list', () => {
  const html = markdownHTML('0. zero\n1. one');
  assert.match(html, /<ol start="0">/);
  assert.match(html, /<li>zero<\/li>/);
  assert.match(html, /<li>one<\/li>/);
  assert.doesNotMatch(html, /<ol start="1">/);
});

test('Markdown parsing stays stable after repeated editor extension construction', async () => {
  const before = markdownHTML('Hi. there\n\n1. one\n2. two');
  const { extensions } = await import('../../apps/web/src/lib/snippets/editor.ts');
  for (let n = 0; n < 8; n++) extensions();
  const after = markdownHTML('Hi. there\n\n1. one\n2. two');
  assert.equal(after, before);
});

test('repeated Markdown serialization stays isolated and deterministic', () => {
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: crypto.randomUUID() },
        content: [
          { type: 'text', text: 'One ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' sentence.' }
        ]
      }
    ]
  };
  const first = exportMarkdown(content);
  for (let n = 0; n < 12; n++) assert.equal(exportMarkdown(content), first);
  assert.match(first, /One \*\*bold\*\* sentence\./);
});

test('ruby and zero-start lists select lossless HTML Markdown export', () => {
  assert.equal(
    requiresHTMLMarkdown({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: crypto.randomUUID() },
          content: [
            {
              type: 'text',
              text: '東京',
              marks: [{ type: 'rubyText', attrs: { rt: 'とうきょう' } }]
            }
          ]
        }
      ]
    }),
    true
  );
  assert.equal(
    requiresHTMLMarkdown({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { id: crypto.randomUUID(), start: 0 },
          content: []
        }
      ]
    }),
    true
  );
});

test('fenced code containing list-like prose is not treated as a list', () => {
  const markdown = ['```text', 'Hi. there', '0. zero', '```'].join('\n');
  const html = markdownHTML(markdown);
  assert.match(html, /<pre><code class="language-text">Hi\. there\n0\. zero\n<\/code><\/pre>/);
  assert.doesNotMatch(html, /<ol\b/);
});

test('snippet schema accepts zero-start ordered lists but still rejects negative starts', () => {
  const valid = {
    type: 'doc',
    content: [
      {
        type: 'orderedList',
        attrs: { id: crypto.randomUUID(), start: 0 },
        content: [
          {
            type: 'listItem',
            attrs: { id: crypto.randomUUID() },
            content: [
              {
                type: 'paragraph',
                attrs: { id: crypto.randomUUID() },
                content: [{ type: 'text', text: 'zero' }]
              }
            ]
          }
        ]
      }
    ]
  };
  assert.doesNotThrow(() => validateContent(valid));
  const invalid = structuredClone(valid);
  invalid.content[0].attrs.start = -1;
  assert.throws(() => validateContent(invalid));
});
