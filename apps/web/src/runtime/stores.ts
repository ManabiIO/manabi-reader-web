/** @license BSD-3-Clause */
import { writable } from '../lib/state/store';
export const page = writable({ url: new URL(typeof location === 'undefined' ? 'https://manabi.io/reader-web/' : location.href), params: {} as Record<string, string>, state: {} as Record<string, unknown>, data: {} as Record<string, unknown> });
export const navigating = writable<null | { from: URL; to: URL }>(null);
export const updated = { ...writable(false), check: async () => false };
export function refreshLocation() { if (typeof location !== 'undefined') page.set({ url: new URL(location.href), params: {}, state: history.state ?? {}, data: {} }); }
if (typeof window !== 'undefined') window.addEventListener('popstate', refreshLocation);
