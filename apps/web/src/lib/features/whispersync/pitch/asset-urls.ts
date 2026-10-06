/** Resolve Metro's document-relative DOM assets before fetching inside a worker.
 * The base is provided by our owning document, never inferred from the worker
 * chunk under _expo/static/js/web/ (or Metro's blob worker wrapper). */
export function resolveSwiftF0AssetURLs(baseURL: string, model: string, wasm: string) {
  return {
    model: new URL(model, baseURL).href,
    wasm: new URL(wasm, baseURL).href
  };
}
