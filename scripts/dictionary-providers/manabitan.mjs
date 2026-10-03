/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureDictionaryRepository } from '../dictionary-source.mjs';

const run = (program, args, cwd) =>
  execFileSync(program, args, { cwd, stdio: 'inherit', timeout: 600000 });
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export async function createManabitanDictionaryProvider(root) {
  const version = JSON.parse(
    await fs.readFile(
      path.join(root, 'apps/web/src/lib/search/dictionary-providers/manabitan/version.json'),
      'utf8'
    )
  );
  if (
    version.repository !== 'ManabiIO/manabitan' ||
    !/^[a-f0-9]{40}$/.test(version.revision) ||
    version.sourceBranch !== 'develop' ||
    !Number.isSafeInteger(version.mergedPullRequest) ||
    version.mergedPullRequest <= 0
  )
    throw new Error('Invalid pinned Manabitan source.');

  return {
    id: 'manabitan',
    revision: version.revision,
    requiredDistributionFiles: ['LICENSE', 'corresponding-source.tar.gz', 'SOURCE.txt'],
    obsoletePublicPaths: ['manabitan'],

    async build({ destination, cache }) {
      await fs.mkdir(cache, { recursive: true });
      const explicitSource = process.env.MANABITAN_SOURCE
        ? path.resolve(process.env.MANABITAN_SOURCE)
        : undefined;
      const source = await ensureDictionaryRepository(
        explicitSource ?? path.join(cache, 'source'),
        !explicitSource
      );

      if (!explicitSource) {
        let current;
        try {
          current = git(['rev-parse', 'HEAD'], source);
        } catch {
          /* Initial checkout. */
        }
        if (current !== version.revision) {
          run(
            'git',
            ['fetch', '--depth=1', 'https://github.com/ManabiIO/manabitan.git', version.revision],
            source
          );
          run('git', ['checkout', '--detach', version.revision], source);
        }
      }

      if (
        git(['rev-parse', 'HEAD'], source) !== version.revision ||
        git(['status', '--porcelain', '--untracked-files=normal'], source)
      )
        throw new Error('Manabitan source must be the exact clean pinned commit.');

      run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], source);
      run('npm', ['run', 'build:libs'], source);
      run(process.execPath, ['web/build.mjs'], source);

      const built = path.join(source, 'builds/manabitan-web');
      const manifest = JSON.parse(await fs.readFile(path.join(built, 'manifest.json'), 'utf8'));
      if (
        manifest.revision !== version.revision ||
        manifest.searchVersion !== 1 ||
        manifest.apiVersion !== 1
      )
        throw new Error(
          'Built Manabitan runtime does not implement the required provider contract.'
        );

      await fs.rm(destination, { recursive: true, force: true });
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(built, destination, { recursive: true });

      run(
        'git',
        [
          'archive',
          '--format=tar.gz',
          `--output=${path.join(destination, 'corresponding-source.tar.gz')}`,
          version.revision
        ],
        source
      );
      await fs.writeFile(
        path.join(destination, 'SOURCE.txt'),
        `Manabitan ${version.revision}\nSource: https://github.com/ManabiIO/manabitan/tree/${version.revision}\nMerged to: ${version.sourceBranch} via PR #${version.mergedPullRequest}\nGPL-3.0-or-later; retain LICENSE and per-file notices.\nCorresponding source archive: corresponding-source.tar.gz\nThe source archive intentionally omits Git metadata. The runtime manifest embeds git rev-parse HEAD, so for an exact manifest rebuild use the pinned Git checkout above, then run: npm ci; npm run build:libs; node web/build.mjs\n`
      );
    }
  };
}
