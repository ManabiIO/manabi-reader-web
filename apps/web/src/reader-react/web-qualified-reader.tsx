/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import React, { useEffect, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { account, accountGeneration, localUser } from '../lib/manabi/client';
import { captureLibraryOperation } from '../lib/manabi/operation-scope';
import { WebReaderLifetime } from './web-reader-lifetime';

export function QualifiedWebReader({ routeUrl }: { routeUrl: string }) {
  const focused = useIsFocused();
  const [owner, setOwner] = useState<{ epoch: number; current(): boolean }>();
  useEffect(() => {
    let alive = true;
    let epoch = 0;
    let operation: ReturnType<typeof captureLibraryOperation> | undefined;
    let generation = -1;
    const current = () => {
      try {
        operation?.assertCurrent();
        return alive && !!operation && generation === accountGeneration();
      } catch {
        return false;
      }
    };
    const update = () => {
      if (current()) return;
      operation?.stop();
      operation = captureLibraryOperation();
      generation = accountGeneration();
      const admitted = operation;
      const admittedGeneration = generation;
      setOwner({
        epoch: ++epoch,
        current: () => {
          try {
            admitted.assertCurrent();
            return alive && operation === admitted && admittedGeneration === accountGeneration();
          } catch {
            return false;
          }
        }
      });
    };
    const stopAccount = account.subscribe(update);
    const stopProfile = localUser.subscribe(update);
    return () => {
      alive = false;
      stopAccount();
      stopProfile();
      operation?.stop();
    };
  }, []);
  return owner ? (
    <WebReaderLifetime
      routeUrl={routeUrl}
      focused={focused}
      ownerEpoch={owner.epoch}
      isCurrentOwner={owner.current}
    />
  ) : null;
}
