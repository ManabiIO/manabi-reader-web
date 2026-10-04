/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useRoute } from 'expo-router';
import { LibraryScreen } from '../../library-react';
import { base } from '../../runtime/paths';

export default function ManageRoute() {
  // Expo query params are already decoded by URLSearchParams. The local
  // search hook decodes them again, corrupting percent-bearing identities.
  const params = useRoute().params ?? {};
  // Incoming and retained Expo screens own their parameters independently of
  // the browser history update, which can still describe the outgoing screen.
  const url = new URL(
    `${base}/manage`,
    typeof window === 'undefined' ? 'https://reader.invalid' : window.location.origin
  );
  for (const [name, value] of Object.entries(params)) {
    if (value == null) continue;
    if (name === '#') url.hash = Array.isArray(value) ? (value[0] ?? '') : value;
    else
      for (const item of Array.isArray(value) ? value : [value])
        url.searchParams.append(name, item);
  }
  return <LibraryScreen routeUrl={url.href} />;
}
