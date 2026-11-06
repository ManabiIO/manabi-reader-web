/** @license BSD-3-Clause */
import process from 'node:process';
/** Reviewed product identities. Paths are build inputs, never URL parameters. */
export const readerEditions = Object.freeze({
  manabitan: Object.freeze({
    id: 'manabitan',
    name: 'Manabitan Reader',
    basePath: '/manabitan-reader',
    storageNamespace: 'manabitan-reader-v1',
    provider: 'manabitan',
    androidPackage: 'io.manabi.manabitan.reader'
  }),
  manabi: Object.freeze({
    id: 'manabi',
    name: 'Manabi Reader for Web',
    basePath: '/reader-web',
    storageNamespace: 'manabi-reader-v1',
    provider: 'external',
    androidPackage: 'io.manabi.reader'
  })
});
export function readerEdition(id = process.env.READER_EDITION ?? 'manabitan') {
  if (!Object.hasOwn(readerEditions, id)) throw new Error(`Unknown Reader edition: ${id}`);
  return readerEditions[id];
}
