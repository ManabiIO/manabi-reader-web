/** @license BSD-3-Clause */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SnippetReader, type createReader } from '../snippets-react';
import type { SnippetRecord } from '$lib/snippets/database';
import type { SnippetScope } from '$lib/snippets/scope';
import type { ReaderScreenHandle } from '../reader-react';
/** This is reading content, kept in the same trusted DOM surface as EPUBs. */
export function EmbeddedSnippetReader({ record, scope, registerHandle, onExit }: {
  record: SnippetRecord; scope: SnippetScope;
  registerHandle(handle: ReaderScreenHandle | undefined): void;
  onExit(): void;
}) {
  const controller = useRef<ReturnType<typeof createReader> | undefined>(undefined);
  const [error, setError] = useState('');
  const running = useRef<Promise<boolean> | undefined>(undefined);
  const bind = useCallback((value: ReturnType<typeof createReader> | undefined) => { controller.current = value; }, []);
  const close = useCallback(() => { if (!controller.current) return Promise.resolve(false); return running.current ??= (async () => {
    try { await controller.current!.flushPosition(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Reading position could not be saved.'); return false; }
    finally { running.current = undefined; }
  })(); }, []);
  useEffect(() => { registerHandle({ requestClose: close }); return () => registerHandle(undefined); }, [registerHandle, close]);
  return <section className="fixed inset-0 overflow-auto bg-background p-4 text-foreground" aria-label="Snippet reader"><button type="button" onClick={() => { void close().then(allowed => { if (allowed) onExit(); }); }} className="mb-4 rounded-full border px-4 py-2">Close reader</button>{error && <p role="alert">{error}</p>}<SnippetReader document={record.document} selectedScope={scope} locator={record.progress} bindings={{ this: bind }}/></section>;
}
