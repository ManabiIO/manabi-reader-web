/** @license BSD-3-Clause */

/**
 * Identify optional externally built runtime trees by Reader-owned publication metadata.
 * The application shell does not need to know a provider's public directory name or license.
 */
export function externalRuntimeAssets(files) {
  const paths = new Set(files);
  const roots = new Set(
    files
      .filter((file) => file.endsWith('/reader-runtime.json'))
      .map((file) => file.slice(0, -'reader-runtime.json'.length))
      .filter((root) => paths.has(root + 'manifest.json'))
  );
  return files.filter((file) => [...roots].some((root) => file.startsWith(root)));
}
