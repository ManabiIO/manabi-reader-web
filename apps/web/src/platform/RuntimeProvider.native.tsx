/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { View, StyleSheet, AppState, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as WebBrowser from 'expo-web-browser';
import type { DOMProps } from 'expo/dom';
import ReaderRuntime, { type ReaderRuntimeRef } from './reader-runtime.dom';
import {
  safeExternalLink,
  IMPORT_CHUNK_BYTES,
  MAX_IMPORT_BYTES,
  type BridgeMethod,
  type BridgeReply
} from './bridge-contract';
import { EMPTY_SNAPSHOT, type ReaderAppearance, type RuntimeSnapshot } from './runtime-contract';
import { bytesToBase64 } from './transfer-encoding';
import { BridgeClient } from './bridge-client';
import {
  NativeReaderNavigation,
  parseNativeReaderIdentity,
  type NativeReaderState,
  type NativeReaderClose
} from './native-reader-navigation';
import { nativeNavigationPath } from './native-navigation';
import { selectNativeLibraryCover } from '../native-library/cover-selection';
import { selectNativeUserFont } from '../native-settings/font-selection';

type ReaderHostDOMProps = DOMProps & {
  manabiReaderHost: true;
  manabiReaderDevOrigin?: string;
  onReaderExternalLink(event: { nativeEvent: { url: string } }): void;
  onReaderHostError(event: { nativeEvent: { message: string } }): void;
};
interface RuntimeValue {
  reader: NativeReaderState;
  closeReader(): Promise<NativeReaderClose>;
  retryReader(): void;
  snapshot: RuntimeSnapshot;
  error: string;
  busy: boolean;
  command(method: BridgeMethod, payload?: Record<string, unknown>): Promise<unknown>;
  importBooks(): Promise<void>;
  importFont(name: string, signal: AbortSignal): Promise<boolean>;
  changeCover(selection: { token: string; key: string }, signal: AbortSignal): Promise<boolean>;
  clearError(): void;
}
const RuntimeContext = createContext<RuntimeValue | null>(null);
export function useReaderRuntime() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('Reader runtime is missing.');
  return value;
}
let serial = 0;
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [readerAppearance, setReaderAppearance] = useState<ReaderAppearance>({
    mode: 'light',
    background: '#ffffff'
  });
  const receiveAppearance = useCallback(async (next: ReaderAppearance) => {
    setReaderAppearance((current) =>
      current.mode === next.mode && current.background === next.background ? current : next
    );
  }, []);
  const ref = useRef<ReaderRuntimeRef>(null);
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const latest = useRef(snapshot);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const importActive = useRef(false);
  const path = usePathname();
  const latestPath = useRef(path);
  latestPath.current = path;
  const params = useGlobalSearchParams();
  const [reader, setReader] = useState<NativeReaderState>({
    visible: false,
    pending: false,
    error: ''
  });
  const navigationRef = useRef<NativeReaderNavigation | null>(null);
  const retiredSessions = useRef(new Set<string>());
  const receive = useCallback(async (next: RuntimeSnapshot) => {
    const previous = latest.current;
    if (retiredSessions.current.has(next.session)) return;
    if (
      next.session === previous.session &&
      (next.epoch < previous.epoch ||
        (next.epoch === previous.epoch && next.revision <= previous.revision))
    )
      return;
    if (previous.session && next.session !== previous.session) {
      // Keep all retired owners for this provider lifetime; reject rather than forget and reopen one.
      if (retiredSessions.current.size >= 64) {
        setError('The reader restarted too often. Restart the app to reconcile saved state.');
        return;
      }
      retiredSessions.current.add(previous.session);
    }
    latest.current = next;
    setSnapshot(next);
    clientRef.current?.retireStaleRequests();
    const destination = navigationRef.current?.setScope(next);
    if (destination) router.replace(destination);
  }, []);
  const clientRef = useRef<BridgeClient | null>(null);
  if (!clientRef.current)
    clientRef.current = new BridgeClient(
      () => latest.current,
      (request) => {
        const host = ref.current;
        if (typeof host?.execute !== 'function')
          throw new Error('The offline reader is still starting.');
        host.execute(request);
      }
    );
  const receiveReply = useCallback(async (reply: BridgeReply) => {
    clientRef.current?.receive(reply);
  }, []);
  const bridgeCommand = useCallback(
    async (method: BridgeMethod, payload: Record<string, unknown> = {}) => {
      const owner = { session: latest.current.session, epoch: latest.current.epoch };
      try {
        if (!latest.current.session) throw new Error('The offline reader is still starting.');
        const reply = await clientRef.current!.request(method, payload);
        if (!reply.ok || reply.stale)
          throw new Error(
            reply.error ||
              (reply.outcome === 'completed'
                ? 'The operation completed for the previous account. Refresh the Library to reconcile.'
                : 'The reader changed. Refresh saved state before trying again.')
          );
        if (
          reply.value &&
          typeof reply.value === 'object' &&
          'books' in reply.value &&
          'session' in reply.value
        )
          await receive(reply.value as RuntimeSnapshot);
        return reply.value;
      } catch (cause) {
        // Thumbnail reads own their fallback and bounded admission refresh. A
        // cancelled/expired image must not leave an error on a later screen.
        if (
          method !== 'library.cover.read' &&
          method !== 'library.cover.cancel' &&
          owner.session === latest.current.session &&
          owner.epoch === latest.current.epoch
        )
          setError(cause instanceof Error ? cause.message : 'The reader operation failed.');
        throw cause;
      }
    },
    [receive]
  );
  if (!navigationRef.current)
    navigationRef.current = new NativeReaderNavigation(
      bridgeCommand,
      (destination) => router.replace(destination as never),
      setReader
    );
  const command = useCallback(
    (method: BridgeMethod, payload: Record<string, unknown> = {}): Promise<unknown> => {
      if (method === 'open') {
        try {
          const identity = parseNativeReaderIdentity({
            id:
              payload.bookId === undefined
                ? undefined
                : typeof payload.bookId === 'number'
                  ? String(payload.bookId)
                  : null,
            snippet: payload.snippetId
          });
          return navigationRef.current!.ensureOpen(identity, payload);
        } catch (cause) {
          return Promise.reject(cause);
        }
      }
      if (method === 'library.content.cancel') {
        const cancelled = navigationRef.current!.cancelPassage(
          payload.token,
          latestPath.current === '/b'
        );
        return Promise.all([bridgeCommand(method, payload), cancelled]).then(([result]) => result);
      }
      if (method === 'library.catalog.open') {
        if (importActive.current)
          return Promise.reject(new Error('Another file import is in progress.'));
        importActive.current = true;
        setBusy(true);
        return navigationRef.current!.readCatalog(payload).finally(() => {
          importActive.current = false;
          if (mounted.current) setBusy(false);
        });
      }
      if (method === 'library.catalog.cancel') {
        const cancelled = navigationRef.current!.cancelCatalog(
          payload.token,
          latestPath.current === '/b'
        );
        return Promise.all([bridgeCommand(method, payload), cancelled]).then(([result]) => result);
      }
      if (method === 'close') return navigationRef.current!.close();
      if (method === 'snippets.action' && payload.type === 'read')
        return navigationRef.current!.readSnippet(payload);
      return bridgeCommand(method, payload);
    },
    [bridgeCommand]
  );
  const closeReader = useCallback(() => navigationRef.current!.close(), []);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) {
          navigationRef.current?.dispose();
          clientRef.current?.dispose();
        }
      });
    };
  }, []);
  async function importBooks() {
    if (importActive.current) return;
    importActive.current = true;
    setBusy(true);
    setError('');
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'text/plain', 'application/zip', 'application/octet-stream'],
        multiple: true,
        copyToCacheDirectory: true
      });
      if (selected.canceled) return;
      for (const asset of selected.assets) {
        const file = new File(asset.uri);
        const size = file.size;
        if (!size || size > MAX_IMPORT_BYTES)
          throw new Error(`${asset.name} exceeds the 256 MB import limit.`);
        const transferId = `transfer_${Date.now()}_${++serial}`;
        const owner = { session: latest.current.session, epoch: latest.current.epoch };
        await command('import.begin', { transferId, name: asset.name, size });
        const handle = file.open();
        try {
          let sent = 0;
          let sequence = 0;
          while (sent < size) {
            if (owner.session !== latest.current.session || owner.epoch !== latest.current.epoch)
              throw new Error('The account changed during import.');
            const bytes = handle.readBytes(Math.min(IMPORT_CHUNK_BYTES, size - sent));
            if (!bytes.length) throw new Error('The selected file ended before its declared size.');
            await command('import.chunk', {
              transferId,
              sequence: sequence++,
              data: bytesToBase64(bytes)
            });
            sent += bytes.length;
          }
          await command('import.commit', { transferId });
        } catch (cause) {
          if (owner.session === latest.current.session && owner.epoch === latest.current.epoch)
            await command('import.cancel', { transferId }).catch(() => {});
          throw cause;
        } finally {
          handle.close(); /* Picker-owned cached copy is temporary; no source file is deleted. */
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be imported.');
    } finally {
      importActive.current = false;
      setBusy(false);
    }
  }
  async function changeCover(selection: { token: string; key: string }, signal: AbortSignal) {
    if (importActive.current) throw new Error('Another file transfer is in progress.');
    importActive.current = true;
    setBusy(true);
    try {
      return await selectNativeLibraryCover(
        {
          scope: () => latest.current,
          pick: () =>
            DocumentPicker.getDocumentAsync({
              type: ['image/png', 'image/jpeg', 'image/webp'],
              multiple: false,
              copyToCacheDirectory: true
            }),
          file: (uri) => new File(uri),
          command
        },
        selection,
        signal
      );
    } finally {
      importActive.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function importFont(name: string, signal: AbortSignal) {
    if (importActive.current) throw new Error('Another file transfer is in progress.');
    importActive.current = true;
    setBusy(true);
    try {
      return await selectNativeUserFont(
        {
          scope: () => latest.current,
          pick: () =>
            DocumentPicker.getDocumentAsync({
              type: ['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'application/octet-stream'],
              multiple: false,
              copyToCacheDirectory: true
            }),
          file: (uri) => new File(uri),
          command
        },
        { name },
        signal
      );
    } finally {
      importActive.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const routeParams = JSON.stringify({ id: params.id, snippet: params.snippet });
  const retryReader = useCallback(() => {
    if (latest.current.session && !latest.current.loading)
      void navigationRef.current!.route(path, JSON.parse(routeParams));
  }, [path, routeParams]);
  useEffect(retryReader, [retryReader, snapshot.session, snapshot.epoch, snapshot.loading]);
  const reading = reader.visible;
  const dom: ReaderHostDOMProps = {
    style: styles.root,
    scrollEnabled: false,
    javaScriptCanOpenWindowsAutomatically: false,
    useExpoDOMWebView: true,
    unstable_useExpoModulesBridge: false,
    manabiReaderHost: true,
    ...(__DEV__ && process.env.EXPO_PUBLIC_READER_DEV_ORIGIN
      ? { manabiReaderDevOrigin: process.env.EXPO_PUBLIC_READER_DEV_ORIGIN }
      : {}),
    onReaderExternalLink: (event) => {
      const url = safeExternalLink(event.nativeEvent.url);
      if (url)
        void WebBrowser.openBrowserAsync(url).catch(() =>
          setError('The link could not be opened.')
        );
    },
    onReaderHostError: (event) =>
      setError(event.nativeEvent.message || 'The secure offline reader could not start.')
  };
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && latest.current.session)
        void command('account.refresh').catch(() => {});
    });
    return () => subscription.remove();
  }, [command]);
  const backPending = useRef(false);
  useEffect(() => {
    if (path !== '/b' && !reading) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!backPending.current) {
        backPending.current = true;
        void closeReader()
          .then((result) => {
            if (result.allowed) router.dismissTo(result.destination);
          })
          .catch(() => {})
          .finally(() => {
            backPending.current = false;
          });
      }
      return true;
    });
    return () => subscription.remove();
  }, [path, reading, closeReader]);
  return (
    <RuntimeContext.Provider
      value={{
        reader,
        closeReader,
        retryReader,
        snapshot,
        error,
        busy,
        command,
        importBooks,
        changeCover,
        importFont,
        clearError: () => setError('')
      }}
    >
      <View style={styles.root}>
        {children}
        <View
          pointerEvents={reading ? 'auto' : 'none'}
          accessibilityElementsHidden={!reading}
          importantForAccessibility={reading ? 'auto' : 'no-hide-descendants'}
          style={
            reading
              ? [
                  styles.reader,
                  {
                    backgroundColor: readerAppearance.background,
                    paddingTop: insets.top,
                    paddingRight: insets.right,
                    paddingBottom: insets.bottom,
                    paddingLeft: insets.left
                  }
                ]
              : styles.hidden
          }
        >
          {reading && <StatusBar style={readerAppearance.mode === 'dark' ? 'light' : 'dark'} />}
          <ReaderRuntime
            ref={ref}
            onReply={receiveReply}
            onSnapshot={receive}
            onAppearance={receiveAppearance}
            onNavigate={async (destination) => {
              const accepted = nativeNavigationPath(destination, '');
              if (!accepted) return;
              const readerExit = reading && (accepted === '/manage' || accepted === '/snippets');
              if (!/^\/b(?:[?#]|$)/.test(accepted)) navigationRef.current!.didExit();
              // Pop to the existing workspace so its shelf, search and page remain owned there.
              if (readerExit) router.dismissTo(accepted);
              else router.push(accepted as never);
            }}
            dom={dom}
          />
        </View>
      </View>
    </RuntimeContext.Provider>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  reader: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 5 },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    left: -10000,
    top: -10000,
    overflow: 'hidden',
    opacity: 0
  }
});
