/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { WifiSlash, Info } from '@phosphor-icons/react';
import { bookSyncStatus } from '$lib/manabi/books';
import { personalSyncStatus } from '$lib/manabi/personal-sync';
import { isOnline$ } from '$lib/data/store';
import { ConnectionNotice } from '../shared-ui/ConnectionNotice';
import { useStore } from './use-store';
import { base } from './paths';

export function WebConnectionStatus({ path }: { path: string }) {
  const online = useStore(isOnline$);
  const personal = useStore(personalSyncStatus);
  const books = useStore(bookSyncStatus);
  const attention =
    path.replace(/\/$/, '') !== '/connections' &&
    (['conflict', 'legacy_statistics'].includes(personal.state) ||
      Object.values(books).some((status) =>
        ['conflict', 'needs_reconnect', 'permission_required', 'unauthorized'].includes(
          status.state
        )
      ));
  return (
    <span className="connection-status">
      <ConnectionNotice
        online={online}
        inline
        statusIcon={
          online === false ? (
            <WifiSlash size={16} aria-hidden="true" />
          ) : (
            <Info size={16} aria-hidden="true" />
          )
        }
        syncAction={
          attention ? (
            <a className="connection-review-link" href={`${base}/connections`}>
              Review accounts and libraries
            </a>
          ) : undefined
        }
      />
    </span>
  );
}
