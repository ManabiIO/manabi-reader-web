/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BridgeScope } from './bridge-contract';
/** The DOM resolves saved appearance and custom themes for the native reader frame. */
export interface ReaderAppearance {
  mode: 'light' | 'dark';
  background: string;
}
export interface NativeBook {
  id: number;
  title: string;
  creators: string;
  characters: number;
  progress: number;
  image?: string;
  lastRead: number;
}
export interface SettingField {
  key: string;
  label: string;
  kind: 'boolean' | 'number' | 'text' | 'choice';
  value: string | number | boolean;
  min?: number;
  max?: number;
  choices?: string[];
}
export interface RuntimeSnapshot extends BridgeScope {
  books: NativeBook[];
  lastBookId?: number;
  totalBooks?: number;
  libraryPage?: { query: string; offset: number; limit: number };
  settings: SettingField[];
  account: { status: string; username?: string };
  loading: boolean;
  revision: number;
}
export const EMPTY_SNAPSHOT: RuntimeSnapshot = {
  session: '',
  epoch: 0,
  books: [],
  settings: [],
  account: { status: 'loading' },
  loading: true,
  revision: 0
};
