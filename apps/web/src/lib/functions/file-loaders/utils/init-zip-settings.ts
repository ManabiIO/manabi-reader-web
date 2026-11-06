/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { configure as zipConfigure } from '@zip.js/zip.js';

export default function initZipSettings() {
  zipConfigure({
    useWebWorkers: !isKiwiBrowser()
  });
}

function isKiwiBrowser() {
  if (typeof window === 'undefined') return false;
  // Retain the Android Chromium ZIP-worker workaround without a general UA
  // database. This is a compression capability workaround, never layout logic.
  return (
    /Android\b/i.test(window.navigator.userAgent) &&
    /\bChrome\/\d/i.test(window.navigator.userAgent)
  );
}
