/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useState } from 'react';
import { useRoute } from 'expo-router';
import { SettingsScreen } from '../../settings-react';
import { readNavigationArrival } from '../../runtime/navigation';
import { base } from '../../runtime/paths';

function SettingsVisit({ routeUrl }: { routeUrl: string }) {
  const [arrival] = useState(() => readNavigationArrival(routeUrl));
  return <SettingsScreen previousPage={arrival?.from} />;
}
export default function SettingsRoute() {
  const route = useRoute();
  // Preserve the once-decoded values, including percent-bearing return queries.
  const params = route.params ?? {};
  const url = new URL(
    `${base}/settings`,
    typeof window === 'undefined' ? 'https://reader.invalid' : window.location.origin
  );
  for (const [name, value] of Object.entries(params)) {
    if (value == null) continue;
    if (name === '#') url.hash = Array.isArray(value) ? (value[0] ?? '') : value;
    else
      for (const item of Array.isArray(value) ? value : [value])
        url.searchParams.append(name, item);
  }
  // A new Expo visit gets fresh arrival context; hash changes within it do not.
  return <SettingsVisit key={route.key} routeUrl={url.href} />;
}
