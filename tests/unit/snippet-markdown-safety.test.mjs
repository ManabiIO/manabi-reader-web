/** @license BSD-3-Clause */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const browserGlobals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window)
};
const globals = new Map(
  Object.keys(browserGlobals).map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name)
  ])
);
for (const [name, value] of Object.entries(browserGlobals))
  Object.defineProperty(globalThis, name, { configurable: true, value });
after(() => {
  dom.window.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});
const {
  createEditor,
  exportMarkdown,
  importContent,
  markdownHTML,
  renderContent,
  requiresHTMLMarkdown
} = await import('../../apps/web/src/lib/snippets/editor.ts');
import {
  canonical,
  editSnippet,
  encodeSnippet,
  parseSnippet,
  validateContent
} from '../../apps/web/src/lib/snippets/document.ts';
import { readerHTML } from '../../apps/web/src/lib/snippets/presentation.ts';
import { legacySnippetLinks } from './fixtures/legacy-snippet-links.mjs';

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
        attrs: { id: randomUUID() },
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
          attrs: { id: randomUUID() },
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
          attrs: { id: randomUUID(), start: 0 },
          content: []
        }
      ]
    }),
    true
  );
});

test('underline and non-CommonMark list/link semantics select lossless HTML export', () => {
  const paragraph = (marks) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: randomUUID() },
        content: [{ type: 'text', text: 'styled', marks }]
      }
    ]
  });
  assert.equal(requiresHTMLMarkdown(paragraph([{ type: 'underline' }])), true);
  assert.equal(
    requiresHTMLMarkdown(
      paragraph([
        {
          type: 'link',
          attrs: {
            href: 'https://example.com/',
            target: '_self',
            rel: 'noopener',
            class: null,
            title: null
          }
        }
      ])
    ),
    true
  );
  assert.equal(
    requiresHTMLMarkdown({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { id: randomUUID(), start: 1, type: 'a' },
          content: [
            {
              type: 'listItem',
              attrs: { id: randomUUID() },
              content: [
                {
                  type: 'paragraph',
                  attrs: { id: randomUUID() },
                  content: [{ type: 'text', text: 'alpha' }]
                }
              ]
            }
          ]
        }
      ]
    }),
    true
  );
  assert.equal(requiresHTMLMarkdown(paragraph([{ type: 'bold' }])), false);
});

test('lossless fallback emits HTML that preserves underline and list marker type', () => {
  const underlined = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: randomUUID() },
        content: [{ type: 'text', text: 'underlined', marks: [{ type: 'underline' }] }]
      }
    ]
  };
  assert.match(exportMarkdown(underlined), /<u>underlined<\/u>/);

  const alphaList = {
    type: 'doc',
    content: [
      {
        type: 'orderedList',
        attrs: { id: randomUUID(), start: 1, type: 'a' },
        content: [
          {
            type: 'listItem',
            attrs: { id: randomUUID() },
            content: [
              {
                type: 'paragraph',
                attrs: { id: randomUUID() },
                content: [{ type: 'text', text: 'alpha' }]
              }
            ]
          }
        ]
      }
    ]
  };
  const markdown = exportMarkdown(alphaList);
  assert.match(markdown, /<ol[^>]*type="a"/);
  assert.match(markdown, />alpha</);
});

test('lossless HTML Markdown preserves safe non-default link semantics', () => {
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: randomUUID() },
        content: [
          {
            type: 'text',
            text: 'safe link',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: 'https://example.com/',
                  target: '_self',
                  rel: 'noopener',
                  class: null,
                  title: 'Example'
                }
              }
            ]
          }
        ]
      }
    ]
  };
  const markdown = exportMarkdown(content);
  assert.match(markdown, /target="_self"/);
  assert.match(markdown, /rel="noopener"/);
  const imported = importContent(markdown, 'markdown');
  const link = imported.content[0].content[0].marks.find((mark) => mark.type === 'link');
  assert.equal(link.attrs.href, 'https://example.com/');
  assert.equal(link.attrs.target, '_self');
  assert.equal(link.attrs.rel, 'noopener');
  assert.equal(link.attrs.title, 'Example');
});

function assertLegacyLinkDOM(container) {
  const links = [...container.querySelectorAll('a')];
  assert.equal(links.length, 7);
  assert.equal(links[0].getAttribute('target'), '_self');
  assert.equal(links[0].getAttribute('rel'), 'external');
  assert.equal(links[1].getAttribute('target'), '_self');
  assert.equal(links[1].getAttribute('rel'), '');
  for (const link of links.slice(2)) {
    const rel = link.getAttribute('rel').toLowerCase().split(/\s+/);
    assert.equal(link.getAttribute('target'), '_blank');
    assert.ok(rel.includes('noopener'));
    assert.ok(rel.includes('noreferrer'));
    assert.ok(!rel.includes('opener'));
  }
}

test('legacy v1 links remain byte-stable while reader, HTML and Markdown displays are safe', () => {
  const legacy = legacySnippetLinks();
  const bytes = canonical(legacy) + '\n';
  const saved = parseSnippet(bytes);
  for (const render of [readerHTML, renderContent, exportMarkdown]) {
    const container = globalThis.document.createElement('div');
    container.innerHTML = render(saved.content);
    assertLegacyLinkDOM(container);
    assert.equal(encodeSnippet(saved), bytes);
    assert.deepEqual(saved, legacy);
  }
  const roundTrip = importContent(exportMarkdown(saved.content), 'markdown');
  const selfLinks = roundTrip.content.slice(0, 2).map((block) => block.content[0].marks[0].attrs);
  assert.equal(selfLinks[0].target, '_self');
  assert.equal(selfLinks[0].rel, 'external');
  assert.equal(selfLinks[1].target, '_self');
  assert.equal(selfLinks[1].rel, '');
});

test('editor DOM hardens legacy and later link marks without mutating the saved revision', () => {
  const saved = legacySnippetLinks();
  const bytes = canonical(saved) + '\n';
  const host = globalThis.document.createElement('div');
  globalThis.document.body.append(host);
  const updates = [];
  const editor = createEditor(host, saved.content, (content) => updates.push(content));
  try {
    assertLegacyLinkDOM(host);
    assert.equal(updates.length, 0, 'opening an editor cannot manufacture a save');
    assert.deepEqual(
      editor.getJSON().content.map((block) => block.content[0].marks[0].attrs.rel),
      saved.content.content.map((block) => block.content[0].marks[0].attrs.rel),
      'DOM safety must not rewrite the working model metadata'
    );
    // Exercise the actual link renderer again after creation, rather than only
    // proving that the initial content was pre-sanitized.
    editor.commands.setContent(saved.content, { emitUpdate: false });
    assertLegacyLinkDOM(host);
    const edited = structuredClone(saved.content);
    edited.content[0].content[0].text += ' edited';
    editor.commands.setContent(edited, { emitUpdate: true });
    assert.ok(updates.length > 0);
    const next = editSnippet(saved, updates.at(-1), saved.title.text);
    assert.equal(next.id, saved.id);
    assert.notEqual(next.revision, saved.revision);
    assert.ok(next.parents.includes(saved.revision));
    assert.equal(encodeSnippet(saved), bytes);
    assertLegacyLinkDOM(host);
  } finally {
    editor.destroy();
    host.remove();
  }
});

test('v1 rel remains bounded metadata and URL, class and schema guards still reject invalid content', () => {
  const legacy = legacySnippetLinks();
  assert.doesNotThrow(() => validateContent(legacy.content));
  for (const attrs of [
    { rel: 'x'.repeat(121) },
    { rel: 12 },
    { rel: '\u0000' },
    { href: 'javascript:alert(1)' },
    { class: 'foreign-class' },
    { target: '_top' },
    { unknownAttribute: 'unexpected' }
  ]) {
    const invalid = structuredClone(legacy.content);
    Object.assign(invalid.content[0].content[0].marks[0].attrs, attrs);
    assert.throws(() => validateContent(invalid), JSON.stringify(attrs));
  }
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
        attrs: { id: randomUUID(), start: 0 },
        content: [
          {
            type: 'listItem',
            attrs: { id: randomUUID() },
            content: [
              {
                type: 'paragraph',
                attrs: { id: randomUUID() },
                content: [{ type: 'text', text: 'zero' }]
              }
            ]
          }
        ]
      }
    ]
  };
  assert.doesNotThrow(() => validateContent(valid));
  const invalid = globalThis.structuredClone(valid);
  invalid.content[0].attrs.start = -1;
  assert.throws(() => validateContent(invalid));
});
