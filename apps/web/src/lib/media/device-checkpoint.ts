/** @license BSD-3-Clause — Manabi media integration. */
import { LIMITS, finite, onlyKeys, record, type Scope } from './contracts.js';
import { Sha256 } from './hash.js';
import type { ByteSource } from './sources.js';

/** Device-only hint, deliberately NOT a portable ContentKey or a proof of file equality. */
export type DeviceKey = `sampled-v1:${string}`;
export interface DevicePlayback {
    version: 1;
    position: number;
    duration: number;
    rate: number;
    finished: boolean;
    updatedAt: number;
}
export function validateDevicePlayback(value: unknown): DevicePlayback {
    const v = record(value);
    onlyKeys(v, ['version', 'position', 'duration', 'rate', 'finished', 'updatedAt']);
    if (v.version !== 1 || typeof v.finished !== 'boolean') throw new Error('Invalid device playback checkpoint');
    const duration = finite(v.duration, 0.001, LIMITS.duration);
    return { version: 1, duration, position: finite(v.position, 0, duration),
        rate: finite(v.rate, 0.25, 4), finished: v.finished,
        updatedAt: finite(v.updatedAt, 0, Number.MAX_SAFE_INTEGER) };
}
/** At most 96 KiB. Never promoted to account identity, even when sampling agrees. */
export async function deviceKey(source: ByteSource, signal: AbortSignal): Promise<DeviceKey> {
    if (!Number.isSafeInteger(source.size) || source.size <= 0) throw new Error('Invalid video size');
    const width = Math.min(source.size, 32768);
    const starts = [...new Set([0, Math.floor((source.size - width) / 2), source.size - width])];
    const hash = new Sha256();
    hash.update(new TextEncoder().encode(JSON.stringify(['device-video-v1', source.name, source.size, source.version])));
    for (const start of starts) {
        signal.throwIfAborted();
        const bytes = await source.read(start, start + width, signal);
        signal.throwIfAborted();
        if (bytes.length !== width) throw new Error('Incomplete video sample');
        hash.update(bytes);
    }
    return `sampled-v1:${hash.hex()}`;
}
export interface DeviceStore {
    local<T>(scope: Scope, kind: string, id: string): Promise<T | undefined>;
    putLocal(scope: Scope, kind: string, id: string, value: unknown): Promise<void>;
}
/** Serialize snapshots behind the initial read; a failed read cannot erase the unread record. */
export class DeviceCheckpoints {
    private tail: Promise<void> = Promise.resolve();
    private opened?: Promise<DevicePlayback | undefined>;
    private writable = false;
    private closing = false;
    constructor(private store: DeviceStore, private scope: Scope, private key: DeviceKey) {}
    load(): Promise<DevicePlayback | undefined> {
        return this.opened ??= this.store.local<unknown>(this.scope, 'device-playback', this.key).then(raw => {
            const value = raw === undefined ? undefined : validateDevicePlayback(raw);
            this.writable = true;
            return value;
        });
    }
    async save(value: DevicePlayback): Promise<void> {
        if (this.closing) return Promise.reject(new Error('Device playback storage is closed'));
        const snapshot = validateDevicePlayback(value);
        const result = this.tail.then(async () => {
            await this.load();
            if (!this.writable) throw new Error('Device playback saving is paused');
            await this.store.putLocal(this.scope, 'device-playback', this.key, snapshot);
        });
        this.tail = result.catch(() => { this.writable = false; });
        return result;
    }
    async close() { this.closing = true; await this.tail; }
}
