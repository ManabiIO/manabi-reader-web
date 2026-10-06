/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
export const dev = process.env.NODE_ENV !== 'production';
export const building = !browser;
export const version = 'expo-migration';
