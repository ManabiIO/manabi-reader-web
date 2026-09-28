/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { get } from 'svelte/store';
import {
  account,
  accountScope,
  currentUser,
  localProfileUser,
  localUser,
  IntegrationError
} from '../manabi/client';
import type { Guard } from './database';
export interface SnippetScope {
  owner: string;
  guard: Guard;
}
function identity() {
  if (get(account).status === 'loading') return 'loading';
  const user = localProfileUser();
  return user ? `account:${user.id}` : 'local';
}
let epoch = 0,
  previous = identity();
function observe() {
  const next = identity();
  if (next !== previous) {
    previous = next;
    epoch++;
  }
}
account.subscribe(observe);
localUser.subscribe(observe);
/** Local ownership and authenticated transport lifetime are distinct, including offline relaunch. */
export function scope(): SnippetScope {
  observe();
  const owner = identity(),
    admitted = epoch,
    auth = currentUser() ? accountScope() : undefined;
  if (owner === 'loading') throw new IntegrationError('busy');
  return {
    owner,
    guard() {
      observe();
      if (
        admitted !== epoch ||
        identity() !== owner ||
        (auth && (!currentUser() || accountScope().generation !== auth.generation))
      )
        throw new IntegrationError('account_changed', 409);
    }
  };
}
