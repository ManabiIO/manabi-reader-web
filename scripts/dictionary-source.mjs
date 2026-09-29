/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Never let Git discover a containing application's repository for a build cache. */
export async function ensureDictionaryRepository(directory, initialize = false) {
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE || process.env.GIT_COMMON_DIR) {
    throw new Error('Dictionary builds require an unredirected Git environment.');
  }
  if (initialize) await fs.mkdir(directory, { recursive: true });
  if ((await fs.lstat(directory)).isSymbolicLink()) {
    throw new Error('Dictionary source cannot be a symbolic repository root.');
  }
  const source = await fs.realpath(directory);
  try {
    const metadata = await fs.lstat(path.join(source, '.git'));
    if (metadata.isSymbolicLink() || (initialize && !metadata.isDirectory())) {
      throw new Error('Dictionary cache must have independent repository metadata.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!initialize) throw new Error('Dictionary source must be a repository root.');
    execFileSync('git', ['init', '--quiet', source], { stdio: 'pipe' });
  }
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: source,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  if ((await fs.realpath(top)) !== source) {
    throw new Error('Dictionary source must be an independent repository root.');
  }
  return source;
}
