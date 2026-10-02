/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { base } from './paths';
const id = 'manabi-import-bootstrap';
/** Claim the browser's input synchronously, then remove the early UI before the
 * React importer becomes visible. The receiver can adopt the original input
 * into its mounted picker, retaining a file selection still in flight. Nothing
 * serializes, parses, stores or uploads its files here. Only the existing
 * consumeSelection/choose path may do that.
 */
export function consumeImportBootstrap(consume: (input: HTMLInputElement) => void): boolean {
  if (typeof document === 'undefined' || typeof location === 'undefined') return false;
  const root = document.getElementById(id);
  if (!root || root.parentElement !== document.body || root.tagName !== 'SECTION') return false;
  const route = `${base}/import-ttu`;
  if (root.dataset.importRoute !== route || location.pathname.replace(/\/$/, '') !== route) {
    root.remove();
    return false;
  }
  const input = root.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input || input.ownerDocument !== document || !input.isConnected) {
    root.remove();
    return false;
  }
  // Remove the claim marker before calling out: reentrancy or StrictMode must
  // not hand the same browser selection to another controller.
  root.removeAttribute('id');
  try {
    consume(input);
  } finally {
    root.remove();
  }
  return true;
}
/** A user who leaves the initial import route retires its selection rather than
 * letting an old, retained importer consume it on a later screen.
 */
export function retireImportBootstrapOutsideRoute() {
  if (typeof document === 'undefined' || typeof location === 'undefined') return;
  const root = document.getElementById(id);
  if (
    root?.parentElement === document.body &&
    root.tagName === 'SECTION' &&
    location.pathname.replace(/\/$/, '') !== `${base}/import-ttu`
  )
    root.remove();
}
