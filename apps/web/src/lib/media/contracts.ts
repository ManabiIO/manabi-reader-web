/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Versioned, portable media data. Credentials, file handles and model bytes never belong here. */
export type Scope = 'guest' | `account:${string}`;
export type ContentKey = `content:${string}`;
export interface Cue {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}
export interface Provenance {
  engine: string;
  engineRevision: string;
  model: string;
  modelRevision: string;
  modelSha256: string;
  quantization: string;
  audioTrack: string;
  windowSeconds: number;
  overlapSeconds: number;
  generatedAt: number;
}
export interface Track {
  version: 1;
  id: string;
  mediaKey: ContentKey;
  label: string;
  language: string;
  kind: 'transcription' | 'translation';
  origin: 'sidecar' | 'embedded' | 'generated';
  complete: boolean;
  forced: boolean;
  createdAt: number;
  cues: Cue[];
  provenance?: Provenance;
  derivedFrom?: {
    trackId: string;
    digest: string;
  };
}
export interface Playback {
  version: 1;
  mediaKey: ContentKey;
  position: number;
  duration: number;
  rate: number;
  finished: boolean;
  updatedAt: number;
  primary: string | null;
  secondary: string | null;
  delays: Record<string, number>;
}
export interface VideoInfo {
  version: 1;
  title: string;
  duration: number;
  width: number;
  height: number;
  addedAt: number;
}
export interface CaptionStyle {
  size: 0.75 | 1 | 1.25 | 1.5;
  color: 'white' | 'yellow';
  background: 0 | 0.5 | 0.8;
  edge: 'shadow' | 'outline' | 'none';
}
export const DEFAULT_STYLE: CaptionStyle = {
  size: 1,
  color: 'white',
  background: 0.5,
  edge: 'shadow'
};
export const LIMITS = {
  subtitleBytes: 5 * 1024 * 1024,
  cues: 50000,
  cueText: 8192,
  trackBytes: 16 * 1024 * 1024,
  duration: 604800,
  rangeBytes: 4 * 1024 * 1024
} as const;
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object');
  return value as Record<string, unknown>;
}
export function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k))) throw new Error('Unknown media field');
}
export function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('Invalid number');
  return value;
}
export function string(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted text.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    throw new Error('Invalid text');
  // Lone surrogates are not portable UTF-8 text.
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const m = value.charCodeAt(++i);
      if (!(m >= 0xdc00 && m <= 0xdfff)) throw new Error('Invalid Unicode');
    } else if (n >= 0xdc00 && n <= 0xdfff) throw new Error('Invalid Unicode');
  }
  return value;
}
export const isContentKey = (v: unknown): v is ContentKey =>
  typeof v === 'string' && /^content:[a-f0-9]{64}$/.test(v);
export const isUUID = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export const isDigest = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function language(value: unknown): string {
  const tag = string(value, 64);
  const aliases: Record<string, string> = {
    jpn: 'ja',
    eng: 'en',
    deu: 'de',
    ger: 'de',
    fra: 'fr',
    fre: 'fr',
    zho: 'zh',
    chi: 'zh',
    spa: 'es',
    kor: 'ko'
  };
  if (tag === 'und') return tag;
  // Shared wire subset: language, optional script/region, then unique variants.
  // Extensions/private-use were never accepted; reject malformed/duplicate regions
  // here too so server admission and Intl validation cannot disagree on the feed.
  const parts = tag.split('-');
  let i = 1;
  if (!/^[a-z]{2,3}$/i.test(parts[0])) throw new Error('Invalid language');
  if (/^[a-z]{4}$/i.test(parts[i] ?? '')) i++;
  if (/^(?:[a-z]{2}|[0-9]{3})$/i.test(parts[i] ?? '')) i++;
  const variants = parts.slice(i).map((v) => v.toLowerCase());
  if (
    variants.some((v) => !/^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/i.test(v)) ||
    new Set(variants).size !== variants.length
  )
    throw new Error('Invalid language');
  return Intl.getCanonicalLocales(aliases[tag.toLowerCase()] ?? tag)[0];
}
export function validateCue(value: unknown): Cue {
  const c = record(value);
  onlyKeys(c, ['id', 'start', 'end', 'text', 'speaker']);
  const start = finite(c.start, 0, LIMITS.duration),
    end = finite(c.end, 0, LIMITS.duration);
  if (end <= start) throw new Error('Caption must end after it starts');
  return {
    id: string(c.id, 160),
    start,
    end,
    text: string(c.text, LIMITS.cueText),
    ...(c.speaker === undefined ? {} : { speaker: string(c.speaker, 160) })
  };
}
export function validateTrack(value: unknown): Track {
  const t = record(value);
  onlyKeys(t, [
    'version',
    'id',
    'mediaKey',
    'label',
    'language',
    'kind',
    'origin',
    'complete',
    'forced',
    'createdAt',
    'cues',
    'provenance',
    'derivedFrom'
  ]);
  if (
    t.version !== 1 ||
    !isUUID(t.id) ||
    !isContentKey(t.mediaKey) ||
    typeof t.kind !== 'string' ||
    !['transcription', 'translation'].includes(t.kind) ||
    typeof t.origin !== 'string' ||
    !['embedded', 'sidecar', 'generated'].includes(t.origin) ||
    typeof t.complete !== 'boolean' ||
    typeof t.forced !== 'boolean' ||
    !Array.isArray(t.cues) ||
    t.cues.length > LIMITS.cues
  )
    throw new Error('Invalid subtitle track');
  if (new TextEncoder().encode(JSON.stringify(value)).length > LIMITS.trackBytes)
    throw new Error('Track exceeds 16 MiB');
  const cues = t.cues.map(validateCue);
  if (new Set(cues.map((c) => c.id)).size !== cues.length)
    throw new Error('Duplicate cue identity');
  let provenance: Provenance | undefined;
  if (t.provenance !== undefined) {
    const p = record(t.provenance);
    onlyKeys(p, [
      'engine',
      'engineRevision',
      'model',
      'modelRevision',
      'modelSha256',
      'quantization',
      'audioTrack',
      'windowSeconds',
      'overlapSeconds',
      'generatedAt'
    ]);
    if (!isDigest(p.modelSha256)) throw new Error('Invalid model digest');
    provenance = {
      engine: string(p.engine, 128),
      engineRevision: string(p.engineRevision, 128),
      model: string(p.model, 256),
      modelRevision: string(p.modelRevision, 128),
      modelSha256: p.modelSha256,
      quantization: string(p.quantization, 32),
      audioTrack: string(p.audioTrack, 128),
      windowSeconds: finite(p.windowSeconds, 1, 600),
      overlapSeconds: finite(p.overlapSeconds, 0, 30),
      generatedAt: finite(p.generatedAt, 0, Number.MAX_SAFE_INTEGER)
    };
  }
  if (t.origin === 'generated' && !provenance) throw new Error('Generated track needs provenance');
  let derivedFrom: Track['derivedFrom'];
  if (t.derivedFrom !== undefined) {
    const d = record(t.derivedFrom);
    onlyKeys(d, ['trackId', 'digest']);
    if (!isUUID(d.trackId) || !isDigest(d.digest)) throw new Error('Invalid translation source');
    derivedFrom = { trackId: d.trackId, digest: d.digest };
  }
  return {
    version: 1,
    id: t.id,
    mediaKey: t.mediaKey,
    label: string(t.label, 512),
    language: language(t.language),
    kind: t.kind as Track['kind'],
    origin: t.origin as Track['origin'],
    complete: t.complete,
    forced: t.forced,
    createdAt: finite(t.createdAt, 0, Number.MAX_SAFE_INTEGER),
    cues,
    ...(provenance ? { provenance } : {}),
    ...(derivedFrom ? { derivedFrom } : {})
  };
}
export function validatePlayback(value: unknown): Playback {
  const p = record(value);
  onlyKeys(p, [
    'version',
    'mediaKey',
    'position',
    'duration',
    'rate',
    'finished',
    'updatedAt',
    'primary',
    'secondary',
    'delays'
  ]);
  if (p.version !== 1 || !isContentKey(p.mediaKey) || typeof p.finished !== 'boolean')
    throw new Error('Invalid playback record');
  for (const id of [p.primary, p.secondary])
    if (id !== null && !isUUID(id)) throw new Error('Invalid selected track');
  if (p.primary !== null && p.primary === p.secondary)
    throw new Error('Cannot show the same track twice');
  const duration = finite(p.duration, 0, LIMITS.duration),
    position = finite(p.position, 0, LIMITS.duration);
  if (position > duration + 0.001) throw new Error('Position exceeds duration');
  const delays: Record<string, number> = Object.create(null);
  for (const [id, n] of Object.entries(record(p.delays))) {
    if (!isUUID(id) || Object.keys(delays).length >= 128) throw new Error('Invalid track offset');
    delays[id] = finite(n, -3600, 3600);
  }
  return {
    version: 1,
    mediaKey: p.mediaKey,
    position,
    duration,
    rate: finite(p.rate, 0.25, 3),
    finished: p.finished,
    updatedAt: finite(p.updatedAt, 0, Number.MAX_SAFE_INTEGER),
    primary: p.primary as string | null,
    secondary: p.secondary as string | null,
    delays
  };
}
export function validateInfo(value: unknown): VideoInfo {
  const p = record(value);
  onlyKeys(p, ['version', 'title', 'duration', 'width', 'height', 'addedAt']);
  if (p.version !== 1) throw new Error('Invalid video metadata');
  return {
    version: 1,
    title: string(p.title, 512),
    duration: finite(p.duration, 0, LIMITS.duration),
    width: finite(p.width, 0, 32768),
    height: finite(p.height, 0, 32768),
    addedAt: finite(p.addedAt, 0, Number.MAX_SAFE_INTEGER)
  };
}
export function validateStyle(value: unknown): CaptionStyle {
  const s = record(value);
  onlyKeys(s, ['size', 'color', 'background', 'edge']);
  if (
    ![0.75, 1, 1.25, 1.5].includes(s.size as number) ||
    typeof s.color !== 'string' ||
    !['white', 'yellow'].includes(s.color) ||
    ![0, 0.5, 0.8].includes(s.background as number) ||
    typeof s.edge !== 'string' ||
    !['shadow', 'outline', 'none'].includes(s.edge)
  )
    throw new Error('Invalid caption style');
  return s as unknown as CaptionStyle;
}
