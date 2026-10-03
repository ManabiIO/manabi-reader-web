/** @license BSD-3-Clause */

/**
 * Identify optional externally built runtime trees by their distribution markers.
 * The application shell does not need to know a provider's public directory name.
 */
export function externalRuntimeAssets(files) {
  const paths = new Set(files);
  const roots = new Set(
    files
      .filter((file) => file.endsWith('/SOURCE.txt'))
      .map((file) => file.slice(0, -'SOURCE.txt'.length))
      .filter(
        (root) =>
          paths.has(root + 'manifest.json') && paths.has(root + 'corresponding-source.tar.gz')
      )
  );
  return files.filter((file) => [...roots].some((root) => file.startsWith(root)));
}
