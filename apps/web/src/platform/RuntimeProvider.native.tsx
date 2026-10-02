/** @license BSD-3-Clause */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, StyleSheet, AppState, BackHandler } from 'react-native';
import { router, usePathname } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as WebBrowser from 'expo-web-browser';
import type { DOMProps } from 'expo/dom';
import ReaderRuntime, { type ReaderRuntimeRef } from './reader-runtime.dom';
import { BRIDGE_VERSION, safeExternalLink, IMPORT_CHUNK_BYTES, MAX_IMPORT_BYTES, type BridgeMethod, type BridgeReply } from './bridge-contract';
import { EMPTY_SNAPSHOT, type RuntimeSnapshot } from './runtime-contract';
import { bytesToBase64 } from './transfer-encoding';
import { BridgeClient } from './bridge-client';

type ReaderHostDOMProps = DOMProps & {
  manabiReaderHost: true;
  manabiReaderDevOrigin?: string;
  onReaderExternalLink(event: { nativeEvent: { url: string } }): void;
  onReaderHostError(event: { nativeEvent: { message: string } }): void;
};
interface RuntimeValue { snapshot: RuntimeSnapshot; error: string; busy: boolean; command(method: BridgeMethod, payload?: Record<string, unknown>): Promise<unknown>; importBooks(): Promise<void>; clearError(): void }
const RuntimeContext = createContext<RuntimeValue | null>(null);
export function useReaderRuntime() { const value = useContext(RuntimeContext); if (!value) throw new Error('Reader runtime is missing.'); return value; }
let serial = 0;
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const ref = useRef<ReaderRuntimeRef>(null); const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT); const latest = useRef(snapshot); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const importActive = useRef(false); const path = usePathname();
  const receive = useCallback(async (next: RuntimeSnapshot) => {
    const previous = latest.current;
    if (next.session === previous.session && (next.epoch < previous.epoch || next.epoch === previous.epoch && next.revision <= previous.revision)) return;
    latest.current = next; setSnapshot(next);
  }, []);
  const clientRef = useRef<BridgeClient | null>(null);
  if (!clientRef.current) clientRef.current = new BridgeClient(() => latest.current, request => {
    const host = ref.current;
    if (typeof host?.execute !== 'function') throw new Error('The offline reader is still starting.');
    host.execute(request);
  });
  const receiveReply = useCallback(async (reply: BridgeReply) => { clientRef.current?.receive(reply); }, []);
  const command = useCallback(async (method: BridgeMethod, payload: Record<string, unknown> = {}) => {
    try {
      if (!latest.current.session) throw new Error('The offline reader is still starting.');
      const reply = await clientRef.current!.request(method, payload);
      if (!reply.ok || reply.stale) throw new Error(reply.error || (reply.outcome === 'completed' ? 'The operation completed for the previous account. Refresh the Library to reconcile.' : 'The reader changed. Refresh saved state before trying again.'));
      if (reply.value && typeof reply.value === 'object' && 'books' in reply.value && 'session' in reply.value) await receive(reply.value as RuntimeSnapshot);
      return reply.value;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The reader operation failed.'); throw cause; }
  }, [receive]);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; queueMicrotask(() => { if (!mounted.current) clientRef.current?.dispose(); }); }; }, []);
  async function importBooks() {
    if (importActive.current) return;
    importActive.current = true; setBusy(true); setError('');
    try {
      const selected = await DocumentPicker.getDocumentAsync({ type: ['application/epub+zip', 'text/plain', 'application/zip', 'application/octet-stream'], multiple: true, copyToCacheDirectory: true });
      if (selected.canceled) return;
      for (const asset of selected.assets) {
        const file = new File(asset.uri); const size = file.size;
        if (!size || size > MAX_IMPORT_BYTES) throw new Error(`${asset.name} exceeds the 256 MB import limit.`);
        const transferId = `transfer_${Date.now()}_${++serial}`; const owner = { session: latest.current.session, epoch: latest.current.epoch };
        await command('import.begin', { transferId, name: asset.name, size });
        const handle = file.open();
        try {
          let sent = 0; let sequence = 0;
          while (sent < size) {
            if (owner.session !== latest.current.session || owner.epoch !== latest.current.epoch) throw new Error('The account changed during import.');
            const bytes = handle.readBytes(Math.min(IMPORT_CHUNK_BYTES, size - sent));
            if (!bytes.length) throw new Error('The selected file ended before its declared size.');
            await command('import.chunk', { transferId, sequence: sequence++, data: bytesToBase64(bytes) }); sent += bytes.length;
          }
          await command('import.commit', { transferId });
        } catch (cause) { await command('import.cancel').catch(() => {}); throw cause; }
        finally { handle.close(); /* Picker-owned cached copy is temporary; no source file is deleted. */ }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The file could not be imported.'); }
    finally { importActive.current = false; setBusy(false); }
  }
  const reading = path === '/b';
  const dom: ReaderHostDOMProps = {
    style: styles.root, scrollEnabled: false, javaScriptCanOpenWindowsAutomatically: false,
    useExpoDOMWebView: true, unstable_useExpoModulesBridge: false, manabiReaderHost: true,
    ...(__DEV__ && process.env.EXPO_PUBLIC_READER_DEV_ORIGIN ? { manabiReaderDevOrigin: process.env.EXPO_PUBLIC_READER_DEV_ORIGIN } : {}),
    onReaderExternalLink: event => { const url = safeExternalLink(event.nativeEvent.url); if (url) void WebBrowser.openBrowserAsync(url).catch(() => setError('The link could not be opened.')); },
    onReaderHostError: event => setError(event.nativeEvent.message || 'The secure offline reader could not start.')
  };
  useEffect(() => { const subscription = AppState.addEventListener('change', state => { if (state === 'active' && latest.current.session) void command('account.refresh').catch(() => {}); }); return () => subscription.remove(); }, [command]);
  useEffect(() => { if (!reading) return; const subscription = BackHandler.addEventListener('hardwareBackPress', () => { void command('close').then(result => { if (result && typeof result === 'object' && 'allowed' in result && result.allowed) router.replace('/manage'); }).catch(() => {}); return true; }); return () => subscription.remove(); }, [reading, command]);
  return <RuntimeContext.Provider value={{ snapshot, error, busy, command, importBooks, clearError: () => setError('') }}><View style={styles.root}>{children}<View pointerEvents={reading ? 'auto' : 'none'} accessibilityElementsHidden={!reading} importantForAccessibility={reading ? 'auto' : 'no-hide-descendants'} style={reading ? styles.reader : styles.hidden}><ReaderRuntime ref={ref} onReply={receiveReply} onSnapshot={receive} onNavigate={async destination => { if (/^\/(manage|settings|connections|statistics|snippets|shared-library|import-ttu|auth|videos|b)(?:\?|$)/.test(destination)) router.push(destination as never); }} dom={dom}/></View></View></RuntimeContext.Provider>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, reader: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 5 }, hidden: { position: 'absolute', width: 1, height: 1, left: -10000, top: -10000, overflow: 'hidden', opacity: 0 } });
