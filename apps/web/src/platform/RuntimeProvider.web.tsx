/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { ConnectionStatusPath } from '../runtime/ConnectionStatus';
import Runtime from '../runtime/Runtime.web';
import { RouterBinding } from '../runtime/router-binding';
import '../shared-ui/web-design.css';
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <>
      <RouterBinding />
      <Runtime />
      <ConnectionStatusPath.Provider value={path}>{children}</ConnectionStatusPath.Provider>
    </>
  );
}
