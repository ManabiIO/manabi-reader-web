/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { createContext, useContext } from 'react';

/** Reserve 224 units for categories, 24 for spacing and at least 552 for editors.
 * Width belongs to the workspace, after outer padding and maximum-width limits.
 * Font scale is Android's text scale or the browser's root rem divided by 16. */
export function settingsWorkspaceGeometry(width: number, fontScale: number) {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? Math.max(1, fontScale) : 1;
  return {
    sidebar: Number.isFinite(width) && width / scale >= 800,
    sidebarWidth: 224 * scale,
    gap: 24 * scale
  };
}

export const SettingsGeometryContext = createContext(settingsWorkspaceGeometry(0, 1));
export const useSettingsGeometry = () => useContext(SettingsGeometryContext);
