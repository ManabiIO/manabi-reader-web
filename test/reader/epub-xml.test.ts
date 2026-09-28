/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlobWriter,
  TextReader,
  ZipWriter
} from '../../apps/web/node_modules/@zip.js/zip.js/index.js';
import extractEpub from '../../apps/web/src/lib/functions/file-loaders/epub/extract-epub';

const chapter = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>本 &amp; 語</p></body></html>';
const options = { useWebWorkers: false };

async function fixture({
  fullPath = 'OPS/book.opf',
  rootAttribute = fullPath,
  manifest = '<item id="chapter1" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>',
  spine = '<itemref idref="chapter1"/>',
  metadata = '<dc:title>Fixture</dc:title>',
  doctype = '',
  files = { 'OPS/text/chapter.xhtml': chapter }
}: {
  fullPath?: string;
  rootAttribute?: string;
  manifest?: string;
  spine?: string;
  metadata?: string;
  doctype?: string;
  files?: Record<string, string>;
} = {}) {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>${doctype}
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="pub-id">urn:uuid:0d536143-4918-4599-b254-4f8eff26a4a4</dc:identifier>
        <dc:language>ja</dc:language><meta property="dcterms:modified">2026-09-28T00:00:00Z</meta>
        ${metadata}
      </metadata>
      <manifest>${manifest}</manifest><spine>${spine}</spine>
    </package>`;
  const entries = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="${rootAttribute}" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`,
    [fullPath]: opf,
    ...files
  };
  const writer = new ZipWriter(new BlobWriter(), options);
  for (const [name, contents] of Object.entries(entries)) {
    await writer.add(name, new TextReader(contents), { level: name === 'mimetype' ? 0 : 6 });
  }
  return { blob: await writer.close(), opf };
}

test('escaped container and manifest paths locate the original ZIP entries', async () => {
  const { blob, opf } = await fixture({
    fullPath: 'OPS/A&B.opf',
    rootAttribute: 'OPS/A&amp;B.opf',
    manifest: '<item id="chapter1" href="text/A&amp;B.xhtml" media-type="application/xhtml+xml"/>',
    files: { 'OPS/text/A&B.xhtml': chapter }
  });
  const loaded = await extractEpub(blob, options);
  assert.equal(loaded.contentsDirectory, 'OPS');
  assert.equal(loaded.result['text/A&B.xhtml'], chapter);
  assert.equal(loaded.result['OPS/A&B.opf'], opf, 'the original OPF text is not rewritten');
});

test('numeric XML references and percent-encoded URI punctuation decode in the correct order', async () => {
  const { blob } = await fixture({
    fullPath: 'OPS/本.opf',
    rootAttribute: 'OPS/&#x672C;.opf',
    manifest:
      '<item id="chapter1" href="text/&#26412;%23one.xhtml" media-type="application/xhtml+xml"/>',
    files: { 'OPS/text/本#one.xhtml': chapter }
  });
  const loaded = await extractEpub(blob, options);
  assert.equal(loaded.result['text/本%23one.xhtml'], chapter);
});

test('preview selection compares decoded manifest IDs with decoded spine references', async () => {
  const { blob } = await fixture({
    manifest:
      '<item id="chapter&#49;" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>',
    spine: '<itemref idref="chapter1"/>'
  });
  const loaded = await extractEpub(blob, { ...options, preview: true });
  assert.equal(loaded.result['text/chapter.xhtml'], chapter);
});

test('literal entity-looking filename text is decoded exactly once', async () => {
  const { blob } = await fixture({
    fullPath: 'OPS/A&amp;B.opf',
    rootAttribute: 'OPS/A&amp;amp;B.opf',
    manifest:
      '<item id="chapter1" href="text/A&amp;amp;B.xhtml" media-type="application/xhtml+xml"/>',
    files: { 'OPS/text/A&amp;B.xhtml': chapter }
  });
  const loaded = await extractEpub(blob, options);
  assert.equal(loaded.result['text/A&amp;B.xhtml'], chapter);
});

test('CDATA metadata and authored chapter markup are not attribute-decoded', async () => {
  const { blob, opf } = await fixture({ metadata: '<dc:title><![CDATA[A&amp;B]]></dc:title>' });
  const loaded = await extractEpub(blob, options);
  assert('package' in loaded.contents);
  assert.equal(loaded.contents.package.metadata['dc:title'], 'A&amp;B');
  assert.equal(loaded.result['text/chapter.xhtml'], chapter);
  assert.equal(loaded.result['OPS/book.opf'], opf);
});

test('document-defined entities remain disabled instead of selecting their expansion', async () => {
  const { blob } = await fixture({
    doctype: '<!DOCTYPE package [<!ENTITY target "text/chapter.xhtml">]>',
    manifest: '<item id="chapter1" href="&target;" media-type="application/xhtml+xml"/>'
  });
  await assert.rejects(extractEpub(blob, options), /Archive resource not found: OPS\/&target;/);
});

test('XML-equivalent manifest IDs still reject as duplicates', async () => {
  const { blob } = await fixture({
    manifest:
      '<item id="chapter1" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="chapter&#49;" href="text/other.xhtml" media-type="application/xhtml+xml"/>'
  });
  await assert.rejects(extractEpub(blob, options), /Duplicate EPUB manifest ID/);
});

test('XML-equivalent resource references still reject as duplicates', async () => {
  const { blob } = await fixture({
    manifest:
      '<item id="chapter1" href="text/A&amp;B.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="chapter2" href="text/A&#38;B.xhtml" media-type="application/xhtml+xml"/>',
    files: { 'OPS/text/A&B.xhtml': chapter }
  });
  await assert.rejects(extractEpub(blob, options), /Duplicate EPUB manifest resource/);
});

for (const [href, expected] of [
  ['&#46;&#46;/&#46;&#46;/outside.xhtml', /escapes its root/],
  ['h&#116;tps://example.invalid/book.xhtml', /relative local URI/],
  ['text/&#0;.xhtml', /Invalid XML character reference/]
] as const) {
  test(`decoded unsafe resource remains rejected: ${href}`, async () => {
    const { blob } = await fixture({
      manifest: `<item id="chapter1" href="${href}" media-type="application/xhtml+xml"/>`
    });
    await assert.rejects(extractEpub(blob, options), expected);
  });
}
