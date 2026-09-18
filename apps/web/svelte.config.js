import process from 'node:process';
import adapter from '@sveltejs/adapter-static';
import preprocess from 'svelte-preprocess';

const base = process.env.BASE_PATH ?? '/Reader-Web';
if (base !== '' && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(base)) {
  throw new Error('BASE_PATH must be a root-relative path without a trailing slash');
}
if (process.env.VITE_GDRIVE_CLIENT_SECRET || process.env.VITE_ONEDRIVE_CLIENT_SECRET) {
  throw new Error('Cloud client secrets belong on Django, never in a public Vite build');
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: { immutable: true },
  preprocess: [preprocess({ postcss: true })],
  kit: {
    paths: { base, relative: false },
    adapter: adapter({ fallback: '404.html', strict: true }),
    csp: {
      mode: 'hash',
      directives: {
        'script-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['none'],
        'worker-src': ['self', 'blob:'],
        'form-action': ['self']
      }
    }
  }
};

export default config;
