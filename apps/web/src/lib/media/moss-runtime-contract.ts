/** @license BSD-3-Clause — Manabi media integration. */
import { MOSS } from './model-cache.js';

export const MOSS_WEB_ABI = 1;
export interface RuntimeIdentity {
    UTF8ToString(pointer: number): string;
    HEAP32?: Int32Array;
    _moss_web_abi_version?(): number;
    _moss_web_engine_revision?(): number;
    _moss_web_ggml_revision?(): number;
}

/** Verify the compiled module before downloading weights or assigning provenance.
 * This catches stale deployments/caches and incompatible runtime directories. It is
 * a compatibility check for app-owned code, not a signature for untrusted modules.
 */
export function assertRuntimeIdentity(runtime: RuntimeIdentity, expectedThreaded?: boolean): void {
    const fail = () => { throw new Error('The MOSS runtime is outdated or incompatible. Rebuild and deploy both CPU runtimes before generating transcripts.'); };
    try {
        if (runtime._moss_web_abi_version?.() !== MOSS_WEB_ABI) fail();
        const engine = runtime._moss_web_engine_revision?.();
        const ggml = runtime._moss_web_ggml_revision?.();
        if (!Number.isSafeInteger(engine) || engine! <= 0 || !Number.isSafeInteger(ggml) || ggml! <= 0) fail();
        if (runtime.UTF8ToString(engine!) !== MOSS.engineRevision ||
            runtime.UTF8ToString(ggml!) !== MOSS.ggmlRevision) fail();
        if (expectedThreaded !== undefined) {
            if (!(runtime.HEAP32 instanceof Int32Array)) fail();
            const shared = typeof SharedArrayBuffer !== 'undefined' && runtime.HEAP32!.buffer instanceof SharedArrayBuffer;
            if (shared !== expectedThreaded) fail();
        }
    } catch { fail(); }
}


/** Verify the actual JavaScript/C entry points before a large model download.
 * An ABI number alone cannot catch a link recipe that dropped a required export.
 */
export function assertRuntimeBindings(value: unknown, threaded: boolean): void {
    const fail = () => { throw new Error('The MOSS runtime is missing required bindings. Rebuild and deploy both CPU runtimes before downloading its model.'); };
    try {
        if (!value || typeof value !== 'object') fail();
        const runtime = value as Record<string, unknown>;
        for (const name of ['ccall', 'UTF8ToString', '_malloc', '_free', '_moss_web_load', '_moss_web_cancel_ptr', '_moss_web_begin',
            '_moss_transcribe_capi_transcribe_pcm', '_moss_transcribe_capi_last_error',
            '_moss_transcribe_capi_free_string', '_moss_transcribe_capi_free']) {
            if (typeof runtime[name] !== 'function') fail();
        }
        const fs = runtime.FS as Record<string, unknown> | undefined;
        if (!fs || !['mkdir', 'mount', 'unmount'].every(name => typeof fs[name] === 'function') || !runtime.WORKERFS) fail();
        if (!(runtime.HEAP32 instanceof Int32Array) || !(runtime.HEAPF32 instanceof Float32Array) ||
            runtime.HEAP32.buffer !== runtime.HEAPF32.buffer) fail();
        const heap = runtime.HEAP32 as Int32Array;
        const offset = (runtime._moss_web_cancel_ptr as () => number)();
        if (!Number.isSafeInteger(offset) || offset <= 0 || offset % 4 || offset + 4 > heap.byteLength) fail();
        if (threaded && typeof (runtime.PThread as { terminateAllThreads?: unknown } | undefined)?.terminateAllThreads !== 'function') fail();
    } catch { fail(); }
}
