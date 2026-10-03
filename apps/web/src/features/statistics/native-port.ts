/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { StatisticsPort, StatisticsSnapshot, StatisticsUiTheme } from './contract';
import { StatisticsTransferAssembly, type StatisticsTransferReply } from './transport';

export interface NativeStatisticsTransport {
  ownerKey(): string;
  command(
    method: 'statistics.read' | 'statistics.action',
    payload: Record<string, unknown>
  ): Promise<unknown>;
  selectionToken?: string;
  error?: string;
}
let readSerial = 0;
const themes = new Map<string, StatisticsUiTheme>();
const unavailable = (reason: string) => ({ available: false as const, reason });
export function createNativeStatisticsPort(transport: NativeStatisticsTransport): StatisticsPort {
  const originalOwner = transport.ownerKey();
  let retired = false;
  let initialized = false;
  let activeRequest: string | undefined;
  const cancel = (requestId: string) => {
    void transport
      .command('statistics.read', { sharedVersion: 1, cancel: true, requestId })
      .catch(() => {});
  };
  const assertCurrent = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (retired || transport.ownerKey() !== originalOwner)
      throw new Error('Statistics access changed. Return to Library and reopen Statistics.');
    if (transport.error) throw new Error(transport.error);
  };
  return {
    initialTheme: themes.get(originalOwner),
    capabilities: {
      goals: unavailable(
        'Reading goals are stored without account ownership. Goal display and editing are unavailable until goals can be assigned safely to this profile.'
      ),
      clipboard: unavailable(
        'Clipboard export is available in the web app. Native clipboard access has not been qualified.'
      ),
      ttuExport: unavailable(
        'TTU ZIP export is available in the web app. A scoped native file destination is not yet available.'
      ),
      rawRecovery: unavailable(
        'Raw recovery includes global ownerless history. Use the web app to review and download it.'
      ),
      globalDelete: unavailable(
        'Global ownerless history is not exposed on this device. Delete selected, proven reading history instead.'
      ),
      createDay: { available: true }
    },
    get ownerKey() {
      return transport.ownerKey();
    },
    initialQuery: () =>
      transport.selectionToken ? { selectionToken: transport.selectionToken } : {},
    subscribeInvalidation: () => {
      retired = false;
      return () => {};
    },
    async load(query, signal) {
      assertCurrent(signal);
      if (transport.selectionToken && query.selectionToken !== transport.selectionToken)
        throw new Error(
          'This Statistics route is restricted to its original Library selection. Return to Library to choose another book.'
        );
      const initialize = !initialized;
      const requestId = `statistics-${Date.now().toString(36)}-${++readSerial}`;
      activeRequest = requestId;
      const aborted = () => {
        if (transport.ownerKey() === originalOwner) cancel(requestId);
      };
      signal.addEventListener('abort', aborted, { once: true });
      const assembly = new StatisticsTransferAssembly();
      try {
        let cursor: string | undefined;
        do {
          assertCurrent(signal);
          const reply = (await transport.command('statistics.read', {
            sharedVersion: 1,
            ...(initialize ? { initialize: true } : {}),
            query,
            requestId,
            ...(cursor ? { cursor } : {})
          })) as StatisticsTransferReply;
          assertCurrent(signal);
          const result = assembly.append(reply);
          if (reply.complete) {
            const snapshot = result as StatisticsSnapshot;
            if (query.selectionToken && snapshot.query.selectionToken !== query.selectionToken)
              throw new Error('The Library Statistics selection changed. Reopen it from Library.');
            if (snapshot.uiTheme) {
              themes.set(originalOwner, snapshot.uiTheme);
              while (themes.size > 2) themes.delete(themes.keys().next().value!);
            }
            initialized = true;
            return snapshot;
          }
          cursor = reply.nextCursor;
        } while (cursor);
        throw new Error('Statistics transfer ended before all data arrived. Refresh Statistics.');
      } finally {
        signal.removeEventListener('abort', aborted);
      }
    },
    async mutate(mutation, signal) {
      assertCurrent(signal);
      await transport.command('statistics.action', { sharedVersion: 1, mutation });
      assertCurrent(signal);
    },
    async export() {
      throw new Error('Use the web app to export reading history.');
    },
    async copy() {
      throw new Error('Use the web app to copy reading history.');
    },
    release() {
      if (activeRequest && transport.ownerKey() === originalOwner) cancel(activeRequest);
      retired = true;
      activeRequest = undefined;
    }
  };
}
