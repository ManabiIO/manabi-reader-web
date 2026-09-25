import process from 'node:process';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const base = process.env.BASE_PATH ?? '/Reader-Web';
if (base !== '' && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(base)) {
  throw new Error('BASE_PATH must be a root-relative path without a trailing slash');
}
if (process.env.VITE_GDRIVE_CLIENT_SECRET || process.env.VITE_ONEDRIVE_CLIENT_SECRET) {
  throw new Error('Cloud client secrets belong on Django, never in a public Vite build');
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({ script: true })],
  kit: {
    paths: { base, relative: false },
    adapter: adapter({ fallback: '404.html', strict: true }),
    // Enumerate Reader routes explicitly. Account links belong to Django and
    // must not be crawled as though SvelteKit could prerender the auth server.
    prerender: { crawl: false, entries: ['*'] },
    csp: {
      mode: 'hash',
      directives: {
        // MOSS/SIMD capability checks need WASM compilation, not JavaScript eval.
        'script-src': ['self', 'wasm-unsafe-eval'],
        'object-src': ['none'],
        'base-uri': ['none'],
        'worker-src': ['self', 'blob:'],
        'form-action': ['self']
      }
    }
  }
};

export default config;
