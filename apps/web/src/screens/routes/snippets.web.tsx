/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useLocalSearchParams } from 'expo-router';
import { SnippetsScreen } from '../../snippets-react';
import { base } from '../../runtime/paths';

export default function SnippetsRoute() {
  const params = useLocalSearchParams();
  // Expo admits this screen before its history listener updates window.location.
  // Retained screens must also keep their own snippet/draft and return target.
  const url = new URL(
    `${base}/snippets`,
    typeof window === 'undefined' ? 'https://reader.invalid' : window.location.origin
  );
  for (const [name, value] of Object.entries(params)) {
    if (value == null) continue;
    if (name === '#') url.hash = Array.isArray(value) ? (value[0] ?? '') : value;
    else
      for (const item of Array.isArray(value) ? value : [value])
        url.searchParams.append(name, item);
  }
  return <SnippetsScreen routeUrl={url.href} />;
}
