/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Temporary CI qualification split. Remove after the actual browser matrix
 * passes and promote the qualified lifetime as the single supported web path. */
export const qualifyWebReaderLifetime = process.env.EXPO_PUBLIC_QUALIFY_WEB_READER_LIFETIME === '1';
