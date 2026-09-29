#!/usr/bin/env node
/** Finalize video assets: omit them when disabled, verify them when enabled. */
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = join(root, 'apps/web/static/moss');
const output = join(root, 'apps/web/build/moss');
const required = ['LICENSE-GGML.txt', 'LICENSE-MOSS.txt', 'moss.mjs', 'moss.wasm'];

if (process.env.VITE_ENABLE_VIDEO_LEARNING !== 'true') {
  await rm(output, { recursive: true, force: true });
  console.log('Video learning disabled: removed packaged MOSS runtimes');
  process.exit(0);
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (message) => {
  throw new Error(`MOSS deployment: ${message}`);
};
const readRegular = async (path) => {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) fail(`unsafe or missing file ${path}`);
  return readFile(path);
};
const sourceCode = (await readRegular(join(root, 'tools/media/build-moss.py'))).toString();
const modelCode = (
  await readRegular(join(root, 'apps/web/src/lib/media/model-cache.ts'))
).toString();
const match = (text, expression, name) => {
  const found = text.match(expression);
  if (!found) fail(`cannot determine ${name}`);
  return found[1];
};
const pin = match(sourceCode, /^PIN='([a-f0-9]{40})'$/m, 'MOSS source pin');
const port = match(sourceCode, /^PORT_REVISION='(manabi-web-v\d+)'$/m, 'port revision');
const ggml = match(sourceCode, /^GGML_PIN='([a-f0-9]{40})'$/m, 'ggml pin');
const engine = `${pin}+${port}`;
if (
  match(modelCode, /engineRevision: '([^']+)'/, 'application revision') !== engine ||
  match(modelCode, /ggmlRevision: '([^']+)'/, 'application ggml pin') !== ggml
)
  fail('application and builder revisions differ');

for (const mode of ['single', 'threaded']) {
  const directories = [join(source, mode), join(output, mode)];
  const manifests = [];
  for (const directory of directories) {
    const manifestBytes = await readRegular(join(directory, 'build.json'));
    if (manifestBytes.length > 65536) fail(`oversized manifest in ${directory}`);
    const manifest = JSON.parse(manifestBytes.toString());
    if (
      manifest.version !== 1 ||
      manifest.mode !== mode ||
      manifest.engineRevision !== engine ||
      manifest.ggmlCommit !== ggml
    )
      fail(`wrong runtime identity in ${directory}`);
    const names = Object.keys(manifest.files ?? {}).sort();
    if (
      required.some((name) => !names.includes(name)) ||
      names.some(
        (name) => !required.includes(name) && !/^moss[\w.-]*\.worker\.(?:m?js)$/.test(name)
      )
    )
      fail(`incomplete or unexpected runtime files in ${directory}`);
    const actual = (await readdir(directory)).sort();
    if (actual.join('\0') !== [...names, 'build.json'].sort().join('\0'))
      fail(`manifest does not enumerate every file in ${directory}`);
    for (const name of names) {
      const bytes = await readRegular(join(directory, name));
      if (!bytes.length || hash(bytes) !== manifest.files[name])
        fail(`checksum mismatch for ${mode}/${name}`);
      if (
        name === 'moss.wasm' &&
        !bytes.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
      )
        fail(`invalid WebAssembly binary for ${mode}`);
    }
    for (const [name, expected] of Object.entries(manifest.portSha256 ?? {})) {
      if (
        !/^[\w.-]+$/.test(name) ||
        hash(await readRegular(join(root, 'tools/media', name))) !== expected
      )
        fail(`builder source mismatch for ${name}`);
    }
    if (!Object.keys(manifest.portSha256 ?? {}).length) fail('missing builder source digests');
    manifests.push(manifestBytes);
  }
  if (!manifests[0].equals(manifests[1])) fail(`packaged ${mode} manifest differs from source`);
}
console.log(`Verified packaged MOSS runtimes: ${engine}, single and threaded`);
