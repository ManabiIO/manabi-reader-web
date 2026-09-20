import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';

/** @type {import('vite').UserConfig} */
export default {
  plugins: [tailwindcss(), sveltekit()],
  ssr: { noExternal: ['@fortawesome/*', '@popperjs/*'] }
};
