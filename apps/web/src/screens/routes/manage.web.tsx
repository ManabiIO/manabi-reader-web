/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { useEffect, useState } from 'react';
import { useIsFocused, useRoute } from 'expo-router';
import { afterNavigate } from '../../runtime/navigation';
import { LibraryScreen } from '../../library-react';
import { base } from '../../runtime/paths';

export default function ManageRoute() {
  // Expo query params are already decoded by URLSearchParams. The local
  // search hook decodes them again, corrupting percent-bearing identities.
  const params = useRoute().params ?? {};
  const focused = useIsFocused();
  const [historyUrl, setHistoryUrl] = useState<string>();
  useEffect(() => {
    if (!focused) return;
    // Expo may reconcile a restored same-screen entry with stale route params.
    // The broker admits native popstate before downstream listeners see it;
    // retain that exact URL until the next admitted app navigation. Incoming
    // mounts still use their own params, never an unrelated global location.
    const traversed = () => {
      if (location.pathname === `${base}/manage`) setHistoryUrl(location.href);
    };
    window.addEventListener('popstate', traversed);
    const stop = afterNavigate((navigation) => {
      if (navigation.type === 'goto') setHistoryUrl(undefined);
    });
    return () => {
      window.removeEventListener('popstate', traversed);
      stop();
    };
  }, [focused]);
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
  return <LibraryScreen routeUrl={historyUrl ?? url.href} />;
}
