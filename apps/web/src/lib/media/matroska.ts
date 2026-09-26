/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Text-only Matroska inspection. See tools/media/THIRD_PARTY.md for format references.
 * Finite, ranged reads; video/audio block bodies, attachments and fonts are never decoded.
 * Encrypted/compressed, laced or duration-less subtitle tracks are explicitly unsupported.
 */
import type { ByteSource } from './sources.js';
import type { Discovery, EmbeddedTrack } from './embedded.js';
import { LIMITS, language, validateCue } from './contracts.js';
import { plainCaption } from './captions.js';

const EBML = 0x1a45dfa3,
  SEGMENT = 0x18538067,
  INFO = 0x1549a966,
  TRACKS = 0x1654ae6b,
  CLUSTER = 0x1f43b675;
const topLevel = new Set([
  INFO,
  TRACKS,
  CLUSTER,
  0x114d9b74,
  0x1c53bb6b,
  0x1941a469,
  0x1043a770,
  0x1254c367
]);
const decoder = new TextDecoder('utf-8', { fatal: true });
interface Element {
  id: number;
  start: number;
  data: number;
  end: number;
  unknown: boolean;
}
interface Vint {
  length: number;
  value: number;
  unknown: boolean;
}
/** Preserve the marker for IDs; remove it for EBML sizes and block track numbers. */
export function readVint(bytes: Uint8Array, at = 0, id = false): Vint {
  const first = bytes[at];
  if (!first) throw new Error('Invalid EBML variable integer');
  let mask = 128,
    length = 1;
  while (!(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (length > (id ? 4 : 8) || at + length > bytes.length)
    throw new Error('Truncated EBML integer');
  let value = BigInt(id ? first : first & (mask - 1));
  for (let i = 1; i < length; i++) value = value * 256n + BigInt(bytes[at + i]);
  const unknown = !id && value === (1n << BigInt(7 * length)) - 1n;
  if (!unknown && value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('EBML integer exceeds safe range');
  return { length, value: unknown ? 0 : Number(value), unknown };
}
class Reader {
  private cache: Uint8Array = new Uint8Array();
  private cacheStart = 0;
  private count = 0;
  constructor(
    readonly source: ByteSource,
    readonly signal: AbortSignal
  ) {}
  async bytes(start: number, length: number): Promise<Uint8Array> {
    this.signal.throwIfAborted();
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length < 0 ||
      start + length > this.source.size ||
      length > 65536
    )
      throw new Error('Invalid or oversized Matroska metadata');
    if (!length) return new Uint8Array();
    if (start >= this.cacheStart && start + length <= this.cacheStart + this.cache.length)
      return this.cache.subarray(start - this.cacheStart, start - this.cacheStart + length);
    const end = Math.min(this.source.size, start + Math.max(length, 32768));
    const bytes = await this.source.read(start, end, this.signal);
    this.signal.throwIfAborted();
    if (bytes.length !== end - start) throw new Error('Truncated Matroska range');
    this.cacheStart = start;
    this.cache = bytes;
    return bytes.subarray(0, length);
  }
  async header(start: number, parentEnd: number): Promise<Element> {
    if (++this.count > 2000000) throw new Error('Matroska inspection exceeded its element budget');
    if (this.count % 4096 === 0) await new Promise((r) => setTimeout(r, 0));
    const b = await this.bytes(start, Math.min(12, parentEnd - start));
    const id = readVint(b, 0, true),
      size = readVint(b, id.length);
    const data = start + id.length + size.length,
      end = size.unknown ? parentEnd : data + size.value;
    if (!Number.isSafeInteger(end) || end > parentEnd || end < data)
      throw new Error('Invalid Matroska element bounds');
    if (size.unknown && id.value !== SEGMENT && id.value !== CLUSTER)
      throw new Error('Unknown-sized Matroska element is unsupported');
    return { id: id.value, start, data, end, unknown: size.unknown };
  }
  async children(parent: Element, maximum = 4096): Promise<Element[]> {
    const children: Element[] = [];
    for (let at = parent.data; at < parent.end; ) {
      const child = await this.header(at, parent.end);
      if (child.unknown || children.length >= maximum)
        throw new Error('Unsupported Matroska metadata nesting');
      children.push(child);
      at = child.end;
    }
    return children;
  }
  async uint(e: Element): Promise<number> {
    const length = e.end - e.data;
    if (length > 8) throw new Error('Invalid Matroska unsigned integer');
    let n = 0n;
    for (const byte of await this.bytes(e.data, length)) n = n * 256n + BigInt(byte);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Matroska integer is too large');
    return Number(n);
  }
  async text(e: Element): Promise<string> {
    if (e.end - e.data > 8192) throw new Error('Oversized Matroska text metadata');
    return decoder.decode(await this.bytes(e.data, e.end - e.data)).replace(/\0+$/, '');
  }
  async float(e: Element): Promise<number> {
    const b = await this.bytes(e.data, e.end - e.data),
      v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const n = b.length === 4 ? v.getFloat32(0) : b.length === 8 ? v.getFloat64(0) : NaN;
    if (!Number.isFinite(n)) throw new Error('Invalid Matroska floating point value');
    return n;
  }
}
interface Subtitle extends EmbeddedTrack {
  number: number;
  codec: string;
  defaultDuration: number;
  codecDelay: number;
  supported: boolean;
}
export function assCaption(packet: string): string {
  // Matroska removes the start/end fields. Text follows exactly eight commas;
  // commas inside dialogue must not be lost by splitting the whole packet.
  let at = 0;
  for (let i = 0; i < 8; i++) {
    at = packet.indexOf(',', at);
    if (at < 0) throw new Error('Invalid Matroska ASS event');
    at++;
  }
  let drawing = false,
    result = '',
    cursor = at;
  const overrides = /\{([^}]*)\}/g;
  overrides.lastIndex = at;
  for (let match; (match = overrides.exec(packet)); ) {
    if (!drawing) result += packet.slice(cursor, match.index);
    for (const mode of match[1].matchAll(/\\p(\d+)\b/g)) drawing = Number(mode[1]) !== 0;
    cursor = match.index + match[0].length;
  }
  if (!drawing) result += packet.slice(cursor);
  return plainCaption(result.replace(/\\[Nn]/g, '\n').replace(/\\h/g, '\u00a0'));
}
export async function discoverMatroska(
  source: ByteSource,
  signal: AbortSignal
): Promise<Discovery> {
  const warnings: string[] = [],
    subtitles = new Map<number, Subtitle>();
  const failTrack = (track: Subtitle, reason: string) => {
    if (track.supported) warnings.push(`Embedded track ${track.number}: ${reason}`);
    track.supported = false;
    track.cues = [];
  };
  try {
    if (!Number.isSafeInteger(source.size) || source.size <= 0)
      throw new Error('Invalid Matroska size');
    const reader = new Reader(source, signal),
      header = await reader.header(0, source.size);
    if (header.id !== EBML || header.end > 65536)
      throw new Error('Not a supported Matroska header');
    const fields = await reader.children(header),
      type = fields.find((e) => e.id === 0x4282);
    if (!type || !['matroska', 'webm'].includes(await reader.text(type)))
      throw new Error('Unknown EBML document type');
    const segment = await reader.header(header.end, source.size);
    if (segment.id !== SEGMENT || segment.end !== source.size)
      throw new Error('Multiple or missing Matroska segments are unsupported');
    let scale = 1000000,
      seenInfo = false,
      seenTracks = false;
    const clusters: Element[] = [];
    for (let at = segment.data; at < segment.end; ) {
      const e = await reader.header(at, segment.end);
      if (e.id === INFO) {
        if (seenInfo) throw new Error('Repeated Matroska segment info');
        seenInfo = true;
        const children = await reader.children(e),
          time = children.filter((c) => c.id === 0x2ad7b1);
        if (time.length > 1) throw new Error('Repeated timestamp scale');
        if (time.length) scale = await reader.uint(time[0]);
        if (!scale || scale > 1000000000) throw new Error('Unsupported Matroska timestamp scale');
      } else if (e.id === TRACKS) {
        if (seenTracks) throw new Error('Repeated Matroska tracks');
        seenTracks = true;
        const numbers = new Set<number>();
        for (const entry of (await reader.children(e, 128)).filter((c) => c.id === 0xae)) {
          const children = await reader.children(entry);
          const one = (id: number) => {
            const values = children.filter((c) => c.id === id);
            if (values.length > 1) throw new Error('Duplicate Matroska track field');
            return values[0];
          };
          const u = async (id: number, fallback: number) => {
            const item = one(id);
            return item ? reader.uint(item) : fallback;
          };
          const t = async (id: number, fallback: string) => {
            const item = one(id);
            return item ? reader.text(item) : fallback;
          };
          const number = await u(0xd7, 0),
            kind = await u(0x83, 0);
          if (!number || numbers.has(number))
            throw new Error('Invalid or duplicate Matroska track number');
          numbers.add(number);
          if (kind !== 17) continue;
          const codec = await t(0x86, ''),
            lang = await t(0x22b59d, await t(0x22b59c, 'eng'));
          let normalized: string;
          try {
            normalized = language(lang);
          } catch {
            normalized = 'und';
          }
          const track: Subtitle = {
            number,
            codec,
            label: `${normalized} · ${(await t(0x536e, 'Embedded')).slice(0, 500)}`,
            language: normalized,
            forced: !!(await u(0x55aa, 0)),
            cues: [],
            supported: true,
            defaultDuration: await u(0x23e383, 0),
            codecDelay: await u(0x56aa, 0)
          };
          subtitles.set(number, track);
          const timestampScale = one(0x23314f);
          if (!['S_TEXT/UTF8', 'S_TEXT/ASS', 'S_TEXT/SSA', 'S_TEXT/WEBVTT'].includes(codec))
            failTrack(track, `unsupported subtitle codec ${codec.slice(0, 80)}.`);
          else if (one(0x6d80))
            failTrack(track, 'compressed or encrypted subtitles are unsupported.');
          else if ((timestampScale && (await reader.float(timestampScale)) !== 1) || one(0x537f))
            failTrack(track, 'custom track timestamp scaling is unsupported.');
          else if (codec === 'S_TEXT/ASS' || codec === 'S_TEXT/SSA')
            warnings.push(
              `Embedded track ${number}: ASS dialogue is shown as plain text; styling and drawings are not reproduced.`
            );
        }
      } else if (e.id === CLUSTER) {
        if (e.unknown) {
          let end = e.data;
          while (end < e.end) {
            const child = await reader.header(end, e.end);
            if (topLevel.has(child.id)) break;
            if (child.unknown) throw new Error('Unsupported cluster nesting');
            end = child.end;
          }
          if (end === e.data) throw new Error('Empty unknown-size cluster');
          e.end = end;
        }
        if (clusters.length >= 100000) throw new Error('Too many Matroska clusters');
        clusters.push(e);
      } else if (e.unknown) throw new Error('Unknown-sized top-level element');
      at = e.end;
    }
    if (!seenTracks) throw new Error('Missing Matroska track metadata');
    let subtitleBytes = 0,
      cueCount = 0;
    for (const cluster of clusters) {
      // Timestamp may follow a BlockGroup. Buffer only tiny block descriptors.
      let timestamp: number | undefined;
      const blocks: { block: Element; duration?: number }[] = [];
      for (let at = cluster.data; at < cluster.end; ) {
        const e = await reader.header(at, cluster.end);
        if (e.id === 0xe7) {
          if (timestamp !== undefined) throw new Error('Duplicate cluster timestamp');
          timestamp = await reader.uint(e);
        } else if (e.id === 0xa3) blocks.push({ block: e });
        else if (e.id === 0xa0) {
          const children = await reader.children(e, 128),
            block = children.filter((c) => c.id === 0xa1),
            duration = children.filter((c) => c.id === 0x9b);
          if (block.length > 1 || duration.length > 1)
            throw new Error('Duplicate subtitle block fields');
          if (block.length)
            blocks.push({
              block: block[0],
              duration: duration.length ? await reader.uint(duration[0]) : undefined
            });
        }
        if (blocks.length > 100000) throw new Error('Too many cluster blocks');
        at = e.end;
      }
      if (timestamp === undefined) throw new Error('Missing cluster timestamp');
      for (const { block, duration } of blocks) {
        const b = await reader.bytes(block.data, Math.min(11, block.end - block.data)),
          number = readVint(b);
        if (number.unknown || !number.value) throw new Error('Invalid block track number');
        const track = subtitles.get(number.value);
        if (!track?.supported) continue;
        try {
          if (b.length < number.length + 3 || b[number.length + 2] & 6)
            throw new Error('laced/truncated subtitle blocks are unsupported.');
          const ticks = new DataView(b.buffer, b.byteOffset, b.byteLength).getInt16(number.length);
          const start = ((timestamp + ticks) * scale - track.codecDelay) / 1e9;
          const seconds =
            duration === undefined ? track.defaultDuration / 1e9 : (duration * scale) / 1e9;
          if (!seconds || !Number.isFinite(seconds))
            throw new Error('subtitle duration is missing.');
          const payload = block.data + number.length + 3,
            length = block.end - payload;
          if (length > 65536 || (subtitleBytes += length) > LIMITS.subtitleBytes)
            throw new Error('subtitle text exceeds the inspection budget.');
          const raw = decoder.decode(await reader.bytes(payload, length));
          const text =
            track.codec === 'S_TEXT/ASS' || track.codec === 'S_TEXT/SSA'
              ? assCaption(raw)
              : plainCaption(raw);
          if (text && start + seconds > Math.max(0, start)) {
            track.cues.push(
              validateCue({
                id: `mkv-${track.number}-${block.start}`,
                start: Math.max(0, start),
                end: start + seconds,
                text
              })
            );
            if (++cueCount > LIMITS.cues) throw new Error('too many subtitle cues.');
          }
        } catch (e) {
          signal.throwIfAborted();
          failTrack(track, e instanceof Error ? e.message : String(e));
        }
      }
    }
    const tracks = [...subtitles.values()]
      .filter((t) => t.supported)
      .map(({ label, language, forced, cues }) => ({
        label,
        language,
        forced,
        cues: cues.sort((a, b) => a.start - b.start || a.end - b.end)
      }));
    return {
      state: [...subtitles.values()].some((t) => !t.supported) ? 'unsupported' : 'complete',
      tracks,
      warnings
    };
  } catch (e) {
    signal.throwIfAborted();
    return {
      state: 'unsupported',
      tracks: [],
      warnings: [...warnings, e instanceof Error ? e.message : String(e)]
    };
  }
}
