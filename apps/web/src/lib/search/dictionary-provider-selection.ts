/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 *
 * This is the only Reader source module that selects the current dictionary
 * provider. A future provider replacement should switch this dependency
 * without changing provider-neutral Reader code.
 */

import { openManabitanDictionaryProvider } from './dictionary-providers/manabitan/adapter';
import type { OpenDictionaryProvider } from './dictionary-provider';

export const openDictionaryProvider: OpenDictionaryProvider = openManabitanDictionaryProvider;
