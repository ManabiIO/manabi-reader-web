/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React, { useEffect, useState } from 'react';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { refreshLocation } from './stores';
import { installQualifiedWebNavigation } from './web-navigation-qualification';
export function RouterBinding() {
  const path = usePathname();
  const params = useGlobalSearchParams();
  const [error, setError] = useState('');
  useEffect(() => {
    const adapter = {
      sameDocumentHistory: true,
      // The web Slot router retains same-screen controllers without replacing
      // their browser entry. navigate() would lose the previous query URL.
      push: (path: string) => router.push(path as never),
      replace: (path: string) => router.replace(path as never)
    };
    return installQualifiedWebNavigation(window, adapter, setError);
  }, []);
  useEffect(refreshLocation, [path, params]);
  return error ? (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] flex flex-wrap items-center gap-3 border-b border-border bg-background p-4 text-foreground"
    >
      <p className="min-w-0 flex-1">
        Navigation paused: {error} Keep this reader open until your changes are saved.
      </p>
      <button
        type="button"
        className="min-h-[44px] rounded-xl border px-3"
        onClick={() => setError('')}
      >
        Dismiss navigation notice
      </button>
    </div>
  ) : null;
}
