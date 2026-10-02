/** @license BSD-3-Clause */
export const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
export const dev = process.env.NODE_ENV !== 'production';
export const building = !browser;
export const version = 'expo-migration';
