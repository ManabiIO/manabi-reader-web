/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { configure as zipConfigure } from '@zip.js/zip.js';

export default function initZipSettings() {
  zipConfigure({
    useWebWorkers: !usesAndroidChromiumZipWorkerWorkaround()
  });
}

function usesAndroidChromiumZipWorkerWorkaround() {
  if (typeof window === 'undefined') return false;
  // Keep the existing Android Chromium fallback until affected devices are
  // qualified with ZIP workers. This does not identify Kiwi or control layout.
  return (
    /Android\b/i.test(window.navigator.userAgent) &&
    /\bChrome\/\d/i.test(window.navigator.userAgent)
  );
}
