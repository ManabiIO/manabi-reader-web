/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { base } from '$app/paths';

// Navigation and the compiled asset base must have one source of truth.
export const basePath = process.env.EXPO_PUBLIC_BASE_PATH || 'https://manabi.io';
export const pagePath = base;
export const clearConsoleOnReload = !!process.env.EXPO_PUBLIC_CLEAR_ON_RELOAD || false;
// This root belongs only to the legacy TTU-compatible storage engine.
// Manabi-native local folders use the chosen folder directly plus .manabi-reader metadata.
export const ttuCompatibilityRootName =
  process.env.EXPO_PUBLIC_TTU_COMPATIBILITY_ROOT_NAME ||
  process.env.EXPO_PUBLIC_STORAGE_ROOT_NAME ||
  'ttu-reader-data';
export const gDriveAuthEndpoint =
  process.env.EXPO_PUBLIC_GDRIVE_AUTH_ENDPOINT || 'https://accounts.google.com/o/oauth2/v2/auth';
export const gDriveTokenEndpoint =
  process.env.EXPO_PUBLIC_GDRIVE_TOKEN_ENDPOINT || 'https://oauth2.googleapis.com/token';
export const gDriveRefreshEndpoint =
  process.env.EXPO_PUBLIC_GDRIVE_REFRESH_ENDPOINT || 'https://oauth2.googleapis.com/token';
export const gDriveRevokeEndpoint =
  process.env.EXPO_PUBLIC_GDRIVE_REVOKE_ENDPOINT || 'https://oauth2.googleapis.com/revoke';
export const gDriveScope =
  process.env.EXPO_PUBLIC_GDRIVE_SCOPE || 'https://www.googleapis.com/auth/drive.file';
export const gDriveClientId = process.env.EXPO_PUBLIC_GDRIVE_CLIENT_ID || '';
export const gDriveClientSecret = '';
export const oneDriveAuthEndpoint =
  process.env.EXPO_PUBLIC_ONEDRIVE_AUTH_ENDPOINT ||
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
export const oneDriveTokenEndpoint =
  process.env.EXPO_PUBLIC_ONEDRIVE_TOKEN_ENDPOINT ||
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
export const oneDriveDiscoveryEndpoint =
  process.env.EXPO_PUBLIC_ONEDRIVE_DISCOVERY ||
  'https://login.microsoftonline.com/consumers/v2.0/.well-known/openid-configuration';
export const oneDriveScope = process.env.EXPO_PUBLIC_ONEDRIVE_SCOPE || 'files.readwrite';
export const oneDriveClientId = process.env.EXPO_PUBLIC_ONEDRIVE_CLIENT_ID || '';
export const oneDriveClientSecret = '';
