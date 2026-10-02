/** @license BSD-3-Clause */
/** Public HTML bootstrap hashes are added by the build, never by imported books. */
export function readerContentSecurityPolicy(scriptHashes = []) {
  if (scriptHashes.some(hash => !/^sha256-[A-Za-z0-9+/]{43}=$/.test(hash))) throw new Error('Invalid inline bootstrap hash.');
  const directives = {
    'script-src': ['self', 'wasm-unsafe-eval', ...scriptHashes],
    'object-src': ['none'],
    'base-uri': ['none'],
    'worker-src': ['self', 'blob:'],
    'form-action': ['self']
  };
  return Object.entries(directives).map(([name, values]) => `${name} ${values.map(value => value.endsWith(':') ? value : `'${value}'`).join(' ')}`).join('; ');
}
