/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { parseBookExportParts, type BookExportPart } from '../features/library/export-options';
import { LIBRARY_ACTION_LIMIT } from './contract';

export const EXPORT_CHUNK_BYTES = 256 * 1024;
export const EXPORT_IDLE_MS = 10 * 60 * 1000;
export interface NativeBookExportRequest {
  token: string;
  keys: string[];
  parts: BookExportPart[];
}
export type NativeBookExportStatus = {
  token: string;
  completed: number;
  total: number;
} & (
  | { phase: 'preparing' }
  | { phase: 'ready'; filename: string; size: number }
  | { phase: 'error'; error: string }
);
export function parseBookExportRequest(value: unknown): NativeBookExportRequest {
  const input = value as Partial<NativeBookExportRequest>;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['token', 'keys', 'parts'].includes(key)) ||
    typeof input.token !== 'string' ||
    !input.token.length ||
    input.token.length > 128 ||
    !Array.isArray(input.keys) ||
    !input.keys.length ||
    input.keys.length > LIBRARY_ACTION_LIMIT ||
    input.keys.some((key) => typeof key !== 'string' || !key.length || key.length > 128) ||
    new Set(input.keys).size !== input.keys.length
  )
    throw new Error('Select imported books from the current Library page.');
  return { token: input.token, keys: [...input.keys], parts: parseBookExportParts(input.parts) };
}
