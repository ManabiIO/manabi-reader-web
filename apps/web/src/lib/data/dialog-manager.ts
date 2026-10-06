/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { ComponentType } from 'react';
import type { StorageKey } from './storage/storage-types';
import { writableSubject } from '$lib/functions/svelte/store';

export interface SyncSelection {
  id: string;
  label: string;
  type: StorageKey;
}

export interface Dialog {
  component: ComponentType<any> | string;
  props?: Record<string, any>;
  disableCloseOnClick?: boolean;
  zIndex?: string;
}

const dialogs$ = writableSubject<Dialog[]>([]);

export const dialogManager = {
  dialogs$
};
