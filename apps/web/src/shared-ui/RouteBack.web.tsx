/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useState } from 'react';
import { usePathname, useRoute } from 'expo-router';
import { Button } from '../library-react/primitives';
import { readNavigationArrival } from '../runtime/navigation';
import { handleRouteBack } from './route-back-click.web';
import { base } from '../runtime/paths';
import { navigationReturnPath } from './navigation-context';
import { CaretLeft } from '@phosphor-icons/react';

export function RouteBack({ fallback = '/manage' }: { fallback?: string }) {
  const pathname = usePathname();
  const route = useRoute();
  const [href] = useState(() => {
    // Expo mounts before the browser location listener catches up. Capture the
    // admitted route's URL, including once-decoded query/hash values.
    const path = pathname.startsWith(`${base}/`) ? pathname : `${base}${pathname}`;
    const current = new URL(path, location.origin);
    for (const [name, value] of Object.entries(route.params ?? {})) {
      if (value == null) continue;
      const values = Array.isArray(value) ? value : [value];
      if (name === '#') current.hash = String(values[0] ?? '');
      else for (const item of values) current.searchParams.append(name, String(item));
    }
    return navigationReturnPath(current, readNavigationArrival(current)?.from, base, fallback);
  });
  return (
    <Button
      href={href}
      onClick={(event: MouseEvent) => handleRouteBack(event, href)}
      variant="ghost"
      size="icon-lg"
      shape="circle"
      aria-label="Back"
    >
      <CaretLeft size={20} aria-hidden="true" />
    </Button>
  );
}
