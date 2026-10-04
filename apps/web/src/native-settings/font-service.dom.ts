/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { fontFamilyGroupOne$, fontFamilyGroupTwo$, userFonts$ } from '../lib/data/store';
import { reservedFontNames, userFontsCacheName } from '../lib/data/fonts';
import {
  removeUserFont,
  saveUserFont,
  storedFontPaths
} from '../lib/components/settings/user-font-actions';
import { NativeFontService, type FontAuthority } from './font-service-core';
import type { FontFamily } from './font-contract';
const selected = (family: FontFamily) =>
  family === 'primary' ? fontFamilyGroupOne$ : fontFamilyGroupTwo$;
const assert = (authority: FontAuthority) => {
  authority.signal.throwIfAborted();
  authority.assertCurrent();
};
const catalog = (authority: FontAuthority) => ({
  read: () => {
    assert(authority);
    return userFonts$.getValue();
  },
  write: (fonts: ReturnType<typeof userFonts$.getValue>) => {
    assert(authority);
    userFonts$.next(fonts);
  }
});
export function createNativeFontService() {
  return new NativeFontService({
    catalog: () => userFonts$.getValue(),
    availablePaths: async () => storedFontPaths(await caches.open(userFontsCacheName)),
    hasFile: async (path) => !!(await (await caches.open(userFontsCacheName)).match(path)),
    selected: (family) => selected(family).getValue(),
    select: (family, name, authority) => {
      assert(authority);
      selected(family).next(name);
    },
    remove: async (font, family, authority) => {
      const cache = await caches.open(userFontsCacheName);
      assert(authority);
      await removeUserFont(
        {
          delete: async (path) => {
            assert(authority);
            const result = await cache.delete(path);
            assert(authority);
            return result;
          }
        },
        catalog(authority),
        font,
        {
          read: () => {
            assert(authority);
            return selected(family).getValue();
          },
          write: (name) => {
            assert(authority);
            selected(family).next(name);
          }
        }
      );
    },
    save: async (name, file, authority) => {
      const cache = await caches.open(userFontsCacheName);
      assert(authority);
      await saveUserFont(
        {
          put: async (path, response) => {
            assert(authority);
            await cache.put(path, response);
            assert(authority);
          }
        },
        catalog(authority),
        name,
        file,
        reservedFontNames
      );
    }
  });
}
