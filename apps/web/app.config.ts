import type { ExpoConfig } from 'expo/config';
const base = process.env.BASE_PATH ?? '/reader-web';
if (base !== '' && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(base)) throw new Error('BASE_PATH must be root-relative without a trailing slash.');
if (process.env.VITE_GDRIVE_CLIENT_SECRET || process.env.VITE_ONEDRIVE_CLIENT_SECRET || process.env.EXPO_PUBLIC_GDRIVE_CLIENT_SECRET || process.env.EXPO_PUBLIC_ONEDRIVE_CLIENT_SECRET) throw new Error('Cloud client secrets belong on Django, never in a public app build.');
process.env.EXPO_PUBLIC_READER_BASE_PATH = base;
for (const key of ['BASE_PATH', 'CLEAR_ON_RELOAD', 'TTU_COMPATIBILITY_ROOT_NAME', 'STORAGE_ROOT_NAME', 'GDRIVE_AUTH_ENDPOINT', 'GDRIVE_TOKEN_ENDPOINT', 'GDRIVE_REFRESH_ENDPOINT', 'GDRIVE_REVOKE_ENDPOINT', 'GDRIVE_SCOPE', 'GDRIVE_CLIENT_ID', 'ONEDRIVE_AUTH_ENDPOINT', 'ONEDRIVE_TOKEN_ENDPOINT', 'ONEDRIVE_DISCOVERY', 'ONEDRIVE_SCOPE', 'ONEDRIVE_CLIENT_ID', 'ENABLE_VIDEO_LEARNING']) {
  if (process.env[`EXPO_PUBLIC_${key}`] === undefined && process.env[`VITE_${key}`] !== undefined) process.env[`EXPO_PUBLIC_${key}`] = process.env[`VITE_${key}`];
}
/** Android + web only. Apple's apps are separate native codebases. */
const config: ExpoConfig = {
  name: 'Manabi Reader', slug: 'manabi-reader', version: '2.0.0',
  scheme: 'manabi-reader', platforms: ['android', 'web'],
  android: { package: 'io.manabi.reader' },
  web: { bundler: 'metro', output: 'single', name: 'Manabi Reader' },
  plugins: ['expo-router', 'expo-document-picker', 'expo-file-system', 'expo-audio'],
  experiments: { typedRoutes: true, baseUrl: base },
  updates: { enabled: false },
};
export default config;
