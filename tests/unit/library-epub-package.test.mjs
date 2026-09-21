/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  ZipWriter
} from '@zip.js/zip.js';
import { prepareBookImportFiles } from '../../apps/web/src/lib/functions/file-dom/prepare-book-import-files.ts';

const EPUB_MIME_TYPE = 'application/epub+zip';

function packageFile(relativePath, body, type = '') {
  const name = relativePath.split('/').at(-1);
  const file = new File([body], name, { type, lastModified: 1234 });
  Object.defineProperty(file, 'webkitRelativePath', {
    configurable: true,
    value: `Shelf/藪の中 2.epub/${relativePath}`
  });
  return file;
}

function packageFiles() {
  return [
    packageFile('mimetype', EPUB_MIME_TYPE),
    packageFile(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="item/standard.opf"/></rootfiles></container>',
      'application/xml'
    ),
    packageFile(
      'item/standard.opf',
      '<package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">藪の中</dc:title><dc:language xmlns:dc="http://purl.org/dc/elements/1.1/">ja</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
      'application/oebps-package+xml'
    ),
    packageFile('item/chapter.xhtml', '<html><body>これはテストです</body></html>', 'application/xhtml+xml'),
    packageFile('.DS_Store', 'ignored')
  ];
}

async function inspectZip(blob) {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const entries = await reader.getEntries();
    const names = entries.map((entry) => entry.filename);
    const mimetype = entries.find((entry) => entry.filename === 'mimetype');
    const mimetypeText = mimetype?.getData ? await mimetype.getData(new TextWriter()) : undefined;
    return { entries, names, mimetype, mimetypeText };
  } finally {
    await reader.close();
  }
}

async function wrappedPackage() {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const file of packageFiles()) {
    const relativePath = file.webkitRelativePath.split('/').slice(1).join('/');
    await writer.add(relativePath, new BlobReader(file));
  }
  await writer.add(
    '__MACOSX/藪の中 2.epub/._mimetype',
    new BlobReader(new Blob(['appledouble']))
  );
  const blob = await writer.close();
  return new File([blob], '藪の中 2.epub.zip', {
    type: 'application/zip',
    lastModified: 5678
  });
}

test('package-directory EPUB files are rebuilt as one standards-compliant EPUB', async () => {
  const notes = new File(['notes'], 'notes.txt', { type: 'text/plain' });
  Object.defineProperty(notes, 'webkitRelativePath', {
    configurable: true,
    value: 'Shelf/notes.txt'
  });

  const prepared = await prepareBookImportFiles([...packageFiles(), notes]);

  assert.deepEqual(
    prepared.map((file) => file.name),
    ['藪の中 2.epub', 'notes.txt']
  );
  assert.equal(prepared[0].type, EPUB_MIME_TYPE);
  assert.equal(prepared[0].lastModified, 1234);

  const archive = await inspectZip(prepared[0]);
  assert.equal(archive.entries[0].filename, 'mimetype');
  assert.equal(archive.mimetype?.compressionMethod, 0);
  assert.equal(archive.mimetypeText, EPUB_MIME_TYPE);
  assert.ok(archive.names.includes('META-INF/container.xml'));
  assert.ok(archive.names.includes('item/standard.opf'));
  assert.ok(archive.names.includes('item/chapter.xhtml'));
  assert.equal(archive.names.some((name) => name.includes('.DS_Store')), false);
});

test('.epub.zip transfer wrappers containing a package EPUB are normalized before import', async () => {
  const wrapper = await wrappedPackage();

  const prepared = await prepareBookImportFiles([wrapper]);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].name, '藪の中 2.epub');
  assert.equal(prepared[0].type, EPUB_MIME_TYPE);
  assert.equal(prepared[0].lastModified, 5678);

  const archive = await inspectZip(prepared[0]);
  assert.equal(archive.entries[0].filename, 'mimetype');
  assert.equal(archive.mimetype?.compressionMethod, 0);
  assert.equal(archive.mimetypeText, EPUB_MIME_TYPE);
  assert.equal(archive.names.some((name) => name.startsWith('__MACOSX/')), false);
  assert.deepEqual(
    archive.names.filter((name) => !name.endsWith('/')).sort(),
    ['META-INF/container.xml', 'item/chapter.xhtml', 'item/standard.opf', 'mimetype'].sort()
  );
});

test('ordinary ZIP backups are not treated as books', async () => {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  await writer.add('backup.json', new BlobReader(new Blob(['{}'])));
  const blob = await writer.close();

  const prepared = await prepareBookImportFiles([
    new File([blob], 'reader-backup.zip', { type: 'application/zip' })
  ]);

  assert.deepEqual(prepared, []);
});
