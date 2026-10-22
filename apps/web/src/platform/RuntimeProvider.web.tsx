/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { ConnectionStatusContent } from '../runtime/ConnectionStatus';
import { WebConnectionStatus } from '../runtime/WebConnectionStatus';
import Runtime from '../runtime/Runtime.web';
import { RouterBinding } from '../runtime/router-binding';
import '../shared-ui/web-design.css';
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <>
      <RouterBinding />
      <Runtime />
      <ConnectionStatusContent.Provider value={<WebConnectionStatus path={path} />}>
        {children}
      </ConnectionStatusContent.Provider>
    </>
  );
}
