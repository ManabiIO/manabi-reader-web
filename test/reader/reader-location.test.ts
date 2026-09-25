import assert from 'node:assert/strict';
import test from 'node:test';

import {
  codePointLength,
  projectResource,
  type PublicationResource
} from '../../apps/web/src/lib/reader-location';

type FakeNode = {
  nodeType: number;
  localName?: string;
  nodeName?: string;
  textContent?: string;
  data?: string;
  childNodes: FakeNode[];
  attrs?: Record<string, string>;
  hasAttribute?: (name: string) => boolean;
  getAttribute?: (name: string) => string | null;
};

const textNode = (data: string): FakeNode => ({
  nodeType: 3,
  textContent: data,
  data,
  childNodes: []
});

const element = (
  localName: string,
  children: FakeNode[],
  attrs: Record<string, string> = {}
): FakeNode => ({
  nodeType: 1,
  localName,
  nodeName: localName.toUpperCase(),
  childNodes: children,
  attrs,
  hasAttribute(name) {
    return Object.hasOwn(attrs, name);
  },
  getAttribute(name) {
    return attrs[name] ?? null;
  }
});

const resource: PublicationResource = {
  href: 'OPS/chapter.xhtml',
  spineIndex: 0,
  sectionId: 'ttu-chapter'
};

test('source projection works with XHTML-style lowercase local names', () => {
  const root = element('div', [
    element('p', [
      element('ruby', [textNode('漢'), element('rt', [textNode('かん')])]),
      textNode('字')
    ]),
    element('p', [textNode('次')])
  ]);

  const projected = projectResource(root as unknown as Element, resource);
  assert.equal(projected.text, '漢字\n次');
  assert.equal(projected.runs.map((run) => run.node.data).join(''), '漢字次');
});

test('source projection does not depend on the parent realm Element constructor', () => {
  const foreignLikeElement = element('p', [textNode('別')]);
  assert.equal(projectResource(foreignLikeElement as unknown as Element, resource).text, '別');
});

test('source coordinates count supplementary characters as Unicode code points', () => {
  assert.equal(codePointLength('𠀀字'), 2);
});
