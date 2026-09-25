/** @license BSD-3-Clause — Manabi media integration. */
import { record, onlyKeys, isUUID, isContentKey, isDigest, finite, string, language, validateCue, type ContentKey, type Cue } from './contracts.js';
import { planWindows } from './moss-output.js';

/** Device-only jobs. Never included in the personal account feed. */
export interface Job {
    version: 1;
    id: string;
    mediaKey: ContentKey;
    language: string;
    audioTrack: string;
    duration: number;
    status: 'queued' | 'running' | 'paused' | 'failed' | 'complete';
    nextWindow: number;
    cues: Cue[];
    modelSha256: string;
    engineRevision: string;
    createdAt: number;
    completedAt?: number;
    error?: string;
    ownerId?: string;
    leaseUntil?: number;
    cancelRequested?: boolean;
}
export const JOB_LEASE_MS = 90_000;

export function validateJob(value: unknown): Job {
    const j = record(value);
    onlyKeys(j, ['version', 'id', 'mediaKey', 'language', 'audioTrack', 'duration', 'status',
        'nextWindow', 'cues', 'modelSha256', 'engineRevision', 'createdAt', 'completedAt',
        'error', 'ownerId', 'leaseUntil', 'cancelRequested']);
    if (j.version !== 1 || !isUUID(j.id) || !isContentKey(j.mediaKey) || !isDigest(j.modelSha256) ||
        typeof j.status !== 'string' || !['queued', 'running', 'paused', 'failed', 'complete'].includes(j.status) ||
        !Array.isArray(j.cues) || j.cues.length > 50_000) throw new Error('Invalid saved transcription job');
    const duration = finite(j.duration, 0, 604800), windows = planWindows(duration);
    if (!Number.isSafeInteger(j.nextWindow) || (j.nextWindow as number) < 0 || (j.nextWindow as number) > windows.length ||
        (j.status === 'complete' && j.nextWindow !== windows.length)) throw new Error('Invalid saved transcription checkpoint');
    const audioTrack = string(j.audioTrack, 128);
    if (!/^\d{1,10}$/.test(audioTrack) || !Number.isSafeInteger(Number(audioTrack))) throw new Error('Invalid saved audio track');
    const cues = j.cues.map(validateCue), nextWindow = j.nextWindow as number;
    if (new Set(cues.map(c => c.id)).size !== cues.length || cues.some(c => {
        const match = /^w(\d+)\//.exec(c.id);
        return !match || Number(match[1]) >= nextWindow || c.end > duration + .001;
    })) throw new Error('Caption does not belong to a completed transcription window');
    if (new TextEncoder().encode(JSON.stringify(j)).length > 16 * 1024 * 1024) throw new Error('Saved transcription is too large');
    if (j.ownerId !== undefined && !isUUID(j.ownerId)) throw new Error('Invalid job owner');
    if ((j.ownerId === undefined) !== (j.leaseUntil === undefined)) throw new Error('Invalid job lease');
    if (j.cancelRequested !== undefined && typeof j.cancelRequested !== 'boolean') throw new Error('Invalid cancellation request');
    return { version: 1, id: j.id, mediaKey: j.mediaKey, language: language(j.language), audioTrack,
        duration, status: j.status as Job['status'], nextWindow, cues, modelSha256: j.modelSha256,
        engineRevision: string(j.engineRevision, 128), createdAt: finite(j.createdAt, 0, Number.MAX_SAFE_INTEGER),
        ...(j.completedAt === undefined ? {} : { completedAt: finite(j.completedAt, 0, Number.MAX_SAFE_INTEGER) }),
        ...(j.error === undefined ? {} : { error: string(j.error, 2048) }),
        ...(j.ownerId === undefined ? {} : { ownerId: j.ownerId as string, leaseUntil: finite(j.leaseUntil, 0, Number.MAX_SAFE_INTEGER) }),
        ...(j.cancelRequested === undefined ? {} : { cancelRequested: j.cancelRequested as boolean }) };
}
export class JobOwnershipLost extends Error {
    constructor() { super('This transcription was cancelled or taken over by another tab.'); this.name = 'JobOwnershipLost'; }
}
export function ownsJob(job: Job | undefined, ownerId: string) {
    return !!job && job.status === 'running' && job.ownerId === ownerId && !job.cancelRequested;
}
export function releasedJob(job: Job, status: Job['status']): Job {
    const { ownerId: _owner, leaseUntil: _lease, cancelRequested: _cancel, ...rest } = job;
    return { ...rest, status };
}
