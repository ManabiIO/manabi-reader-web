import { createRequire } from 'node:module';
import { mkdtemp, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const { build } = createRequire(new URL('../../package.json', import.meta.url))('esbuild');
const temp = await mkdtemp(join(tmpdir(), 'manabi-reader-tests-'));
try {
  const archive = join(temp, 'archive.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./archive.test.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: archive
  });
  const restored = join(temp, 'restored-book.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./restored-book.test.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: restored
  });
  const localMedia = join(temp, 'local-media.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./local-media.test.mjs', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: localMedia
  });
  const typography = join(temp, 'typography.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./typography.test.mjs', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: typography
  });
  const readerLocation = join(temp, 'reader-location.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./reader-location.test.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: readerLocation
  });
  const foliatePublication = join(temp, 'foliate-publication.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./foliate-publication.test.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: foliatePublication
  });
  const epubLinkTarget = join(temp, 'epub-link-target.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./epub-link-target.test.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: epubLinkTarget
  });
  const foliateLoader = join(temp, 'foliate-loader.test.mjs');
  await build({
    entryPoints: [fileURLToPath(new URL('./foliate-loader.test.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: foliateLoader
  });
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      fileURLToPath(new URL('./service-worker.test.mjs', import.meta.url)),
      archive,
      restored,
      localMedia,
      typography,
      readerLocation,
      foliatePublication,
      epubLinkTarget,
      foliateLoader
    ],
    { stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  const trash = join(process.env.HOME ?? tmpdir(), '.Trash', `manabi-reader-tests-${Date.now()}`);
  await mkdir(join(process.env.HOME ?? tmpdir(), '.Trash'), { recursive: true });
  await rename(temp, trash);
}
