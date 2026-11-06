/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { WifiSlash, Info } from '@phosphor-icons/react';
import { bookSyncStatus } from '$lib/manabi/books';
import { personalSyncStatus } from '$lib/manabi/personal-sync';
import { account, accountGeneration, localUser } from '$lib/manabi/client';
import { readerBridgeAutomaticStatus } from '$lib/manabi/reader-bridge-automatic';
import { isOnline$ } from '$lib/data/store';
import { ConnectionNotice } from '../shared-ui/ConnectionNotice';
import { useStore } from './use-store';
import { base } from './paths';
import { page } from './stores';
import { localProgressStatus, retryLocalProgressSave } from './local-progress-status';

export function WebConnectionStatus({ path }: { path: string }) {
  const online = useStore(isOnline$);
  const personal = useStore(personalSyncStatus);
  const books = useStore(bookSyncStatus);
  const session = useStore(account);
  const profile = useStore(localUser);
  const automatic = useStore(readerBridgeAutomaticStatus);
  const progress = useStore(localProgressStatus);
  const route = useStore(page);
  const owner = session.session?.user?.id ?? null;
  const progressState =
    path.replace(/\/$/, '') === '/b' &&
    progress?.bookId === Number(route.url.searchParams.get('id')) &&
    progress.profileId === (profile?.id ?? null) &&
    progress.generation === accountGeneration()
      ? progress.state
      : 'unknown';
  const bridgeAttention =
    owner !== null &&
    automatic.owner === owner &&
    Object.values(automatic.records).some((status) =>
      ['changed', 'review', 'retry', 'paused'].includes(status.state)
    );
  const attention =
    path.replace(/\/$/, '') !== '/connections' &&
    (bridgeAttention ||
      ['conflict', 'legacy_statistics'].includes(personal.state) ||
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
        progressState={progressState}
        retryProgress={() => {
          // The owning commit publishes failure; this handler only contains its
          // rejection so the persistent explanation remains available.
          if (progressState === 'failed' && progress)
            void retryLocalProgressSave(progress).catch(() => {});
        }}
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
