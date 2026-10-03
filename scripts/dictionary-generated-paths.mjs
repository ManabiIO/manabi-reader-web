/** @license BSD-3-Clause */
import fs from 'node:fs/promises';
import path from 'node:path';

export function safeRelativePath(value) {
  return (
    typeof value === 'string' &&
    !!value &&
    !path.isAbsolute(value) &&
    !value.includes('\\') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

export async function ensureGeneratedDirectory(directory) {
  try {
    const metadata = await fs.lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error(`Generated dictionary path must be a real directory: ${directory}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(directory, { recursive: true });
  }
}

export async function pruneGeneratedDirectory(directory, keep = new Set()) {
  await ensureGeneratedDirectory(directory);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (keep.has(entry.name)) continue;
    await fs.rm(path.join(directory, entry.name), { recursive: true, force: true });
  }
}
