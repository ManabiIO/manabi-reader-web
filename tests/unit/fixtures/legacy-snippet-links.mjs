/** @license BSD-3-Clause */
// Version-1 portable bytes admitted before link display hardening. Keep this
// independent of createSnippet so a changed writer cannot conceal a read regression.
export function legacySnippetLinks() {
  const links = [
    { text: 'External self', target: '_self', rel: 'external' },
    { text: 'Empty self', target: '_self', rel: '' },
    { text: 'Opener blank', target: '_blank', rel: 'OpEnEr external' },
    { text: 'Noreferrer blank', target: '_blank', rel: 'noreferrer' },
    { text: 'Default opener', target: null, rel: 'opener' },
    { text: 'Default links', target: null, rel: null },
    { text: 'Bounded metadata', target: '_blank', rel: 'x'.repeat(120) }
  ];
  return {
    format: 'manabi-snippet',
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    revision: '22222222-2222-4222-8222-222222222222',
    parents: ['33333333-3333-4333-8333-333333333333'],
    title: { mode: 'custom', text: 'Legacy link metadata' },
    createdAt: 1000,
    modifiedAt: 2000,
    captures: ['44444444-4444-4444-8444-444444444444'],
    source: { title: 'Original source', url: 'https://example.com/source', quote: 'Authored text' },
    content: {
      type: 'doc',
      content: links.map(({ text, ...attrs }, index) => ({
        type: 'paragraph',
        attrs: { id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0') },
        content: [
          {
            type: 'text',
            text,
            marks: [
              {
                type: 'link',
                attrs: {
                  href: 'https://example.com/legacy/' + index,
                  ...attrs,
                  class: null,
                  title: 'Original link'
                }
              }
            ]
          }
        ]
      }))
    }
  };
}
