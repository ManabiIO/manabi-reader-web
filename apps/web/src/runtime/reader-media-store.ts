/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { storageName } from './edition';
import { MediaStore } from '../lib/media/store';

/** All Reader UI/profile/search consumers share the selected edition's store. */
export function createReaderMediaStore(factory?: IDBFactory): MediaStore {
  return new MediaStore(factory, storageName('manabi-media-v1'));
}
