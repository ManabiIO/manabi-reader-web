/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { stdout } from 'node:process';
import ts from 'typescript';
import { fileURLToPath, URL } from 'node:url';

const root = new URL('../', import.meta.url);
const names = [
  'slide-geometry.ts',
  'page-counts.ts',
  'paginator.js',
  'page-turn-sequence.ts',
  'page-turn-controller.ts'
];
const imports = {};
const hashes = {};
for (const name of names) {
  const source = readFileSync(new URL('apps/web/src/lib/foliate-epub/' + name, root), 'utf8');
  hashes[name] = createHash('sha256').update(source).digest('hex');
  const js = ts
    .transpileModule(source, {
      fileName: name,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        removeComments: false
      }
    })
    .outputText.replace(/(['"])\.\/([^'"]+)\1/g, (_, quote, path) => {
      const basename = path.replace(/\.(ts|js)$/, '');
      if (!names.some((name) => name.replace(/\.(ts|js)$/, '') === basename)) {
        throw new Error('Unbundled import: ' + path);
      }
      return quote + '@slide/' + basename + quote;
    });
  imports['@slide/' + name.replace(/\.(ts|js)$/, '')] =
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
}
let template = readFileSync(new URL('demos/apple-books-slide-poc/template.html', root), 'utf8');
const license = readFileSync(
  new URL('apps/web/src/lib/foliate-epub/LICENSE.foliate-js.txt', root),
  'utf8'
);
template = template.replace(
  '<!-- BUNDLE -->',
  '<!-- Foliate.js license\n' +
    license +
    '\n-->\n' +
    '<script type="importmap">' +
    JSON.stringify({ imports }) +
    '</script>\n' +
    '<script type="application/json" id="source-hashes">' +
    JSON.stringify(hashes) +
    '</script>'
);
const output = new URL('demos/apple-books-slide-poc/index.html', root);
writeFileSync(output, template);
stdout.write(
  `${fileURLToPath(output)}: ${Buffer.byteLength(template)} bytes; actual reader modules bundled\n`
);
