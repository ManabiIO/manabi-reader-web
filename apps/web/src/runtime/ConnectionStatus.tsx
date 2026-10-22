/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { createContext, useContext, type ReactNode } from 'react';

// Only the web shell supplies this slot. Embedded reader surfaces keep their
// native owner without importing Expo UI or the web connection subscriptions.
export const ConnectionStatusContent = createContext<ReactNode>(null);

export function ConnectionStatus() {
  return useContext(ConnectionStatusContent);
}
