/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useRoute } from 'expo-router';
import { ImportTtuScreen } from '../../settings-react';
import { base } from '../../runtime/paths';

export default function ImportRoute() {
  // Route admission precedes the address-bar commit. Use Expo's once-decoded
  // local params, just like the retained Library and Reader route owners.
  const params = useRoute().params ?? {};
  const url = new URL(
    `${base}/import-ttu`,
    typeof window === 'undefined' ? 'https://reader.invalid' : window.location.origin
  );
  for (const [name, value] of Object.entries(params)) {
    if (value == null) continue;
    if (name === '#') url.hash = Array.isArray(value) ? (value[0] ?? '') : value;
    else
      for (const item of Array.isArray(value) ? value : [value])
        url.searchParams.append(name, item);
  }
  return <ImportTtuScreen routeUrl={url.href} />;
}
