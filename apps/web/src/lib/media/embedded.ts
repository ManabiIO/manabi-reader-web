/** @license BSD-3-Clause — Manabi media integration. */
/** Bounded text-subtitle inspection. No video decoding and no whole-file buffering.
 * Nonfragmented MP4 tx3g/wvtt and Matroska text tracks are supported. Other formats return an explicit
 * unsupported state; that is never interpreted as proof that captions are absent.
 */
import { discoverMatroska } from './matroska.js';
import { type ByteSource } from './sources.js';
import { type Cue, language, LIMITS, validateCue } from './contracts.js';
import { plainCaption } from './captions.js';
export interface EmbeddedTrack {
    label: string;
    language: string;
    forced: boolean;
    cues: Cue[];
}
export interface Discovery {
    state: 'complete' | 'unsupported';
    tracks: EmbeddedTrack[];
    warnings: string[];
}
interface Box {
    type: string;
    start: number;
    data: number;
    end: number;
}
const decoder = new TextDecoder('utf-8', { fatal: true });
const four = (bytes: Uint8Array, start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
function u32(b: Uint8Array, p: number) { if (p < 0 || p + 4 > b.length)
    throw new Error('Truncated MP4 metadata'); return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(p); }
function u64(b: Uint8Array, p: number) { const n = u32(b, p) * 2 ** 32 + u32(b, p + 4); if (!Number.isSafeInteger(n))
    throw new Error('MP4 offset is too large'); return n; }
function boxes(b: Uint8Array, start = 0, end = b.length): Box[] {
    const result: Box[] = [];
    for (let p = start; p < end;) {
        if (end - p < 8)
            throw new Error('Truncated MP4 box');
        let length = u32(b, p), header = 8;
        const type = four(b, p + 4);
        if (length === 1) {
            length = u64(b, p + 8);
            header = 16;
        }
        if (length === 0)
            length = end - p;
        if (length < header || p + length > end)
            throw new Error('Invalid MP4 box bounds');
        result.push({ type, start: p, data: p + header, end: p + length });
        if (result.length > 100000)
            throw new Error('Too many MP4 boxes');
        p += length;
    }
    return result;
}
function child(b: Uint8Array, parent: Box, type: string): Box | undefined { return boxes(b, parent.data, parent.end).find(x => x.type === type); }
const payload = (b: Uint8Array, box: Box | undefined) => box ? b.subarray(box.data, box.end) : undefined;
function table(b: Uint8Array | undefined, width: number): {
    count: number;
    at: number;
} { if (!b || b.length < 8)
    throw new Error('Missing MP4 sample table'); const count = u32(b, 4); if (count > 100000 || 8 + count * width > b.length)
    throw new Error('Invalid MP4 sample table'); return { count, at: 8 }; }
async function mp4(source: ByteSource, signal: AbortSignal): Promise<Discovery> {
    let moov: Uint8Array | undefined, fragmented = false, offset = 0, count = 0;
    while (offset < source.size) {
        signal.throwIfAborted();
        if (source.size - offset < 8)
            throw new Error('Truncated MP4 header');
        const h = await source.read(offset, Math.min(source.size, offset + 16), signal);
        let size = u32(h, 0), header = 8;
        const type = four(h, 4);
        if (size === 1) {
            size = u64(h, 8);
            header = 16;
        }
        if (size === 0)
            size = source.size - offset;
        if (size < header || offset + size > source.size)
            throw new Error('Invalid MP4 file bounds');
        if (++count > 100000)
            throw new Error('Too many MP4 boxes');
        if (type === 'moof')
            fragmented = true;
        if (type === 'moov') {
            if (moov || size > 32 * 1024 * 1024)
                throw new Error('Duplicate or oversized movie metadata');
            moov = new Uint8Array(size - header);
            for (let at = 0; at < moov.length; at += 1024 * 1024) {
                const end = Math.min(moov.length, at + 1024 * 1024);
                moov.set(await source.read(offset + header + at, offset + header + end, signal), at);
            }
        }
        offset += size;
    }
    if (!moov)
        return { state: 'unsupported', tracks: [], warnings: ['This file has no readable MP4 movie metadata.'] };
    if (fragmented)
        return { state: 'unsupported', tracks: [], warnings: ['Embedded captions in fragmented MP4 need an external subtitle file in this version.'] };
    const root: Box = { type: 'moov', start: 0, data: 0, end: moov.length }, tracks: EmbeddedTrack[] = [], warnings: string[] = [];
    const mvhd = payload(moov, child(moov, root, 'mvhd'));
    const movieScale = mvhd ? u32(mvhd, mvhd[0] === 1 ? 20 : 12) : 0;
    for (const trak of boxes(moov).filter(x => x.type === 'trak')) {
        const mdia = child(moov, trak, 'mdia');
        if (!mdia)
            continue;
        const hdlr = payload(moov, child(moov, mdia, 'hdlr'));
        if (!hdlr || !['text', 'sbtl', 'subt', 'clcp'].includes(four(hdlr, 8)))
            continue;
        try {
            const mdhd = payload(moov, child(moov, mdia, 'mdhd'));
            if (!mdhd)
                throw new Error('Missing subtitle timing metadata');
            const scale = u32(mdhd, mdhd[0] === 1 ? 20 : 12), langAt = mdhd[0] === 1 ? 32 : 20;
            if (!scale || mdhd.length < langAt + 2)
                throw new Error('Invalid subtitle timescale');
            const code = (mdhd[langAt] << 8) | mdhd[langAt + 1], tag = String.fromCharCode(((code >> 10) & 31) + 96, ((code >> 5) & 31) + 96, (code & 31) + 96);
            let lang = 'und';
            try {
                lang = language(tag);
            }
            catch { /* unknown language */ }
            const minf = child(moov, mdia, 'minf'), stbl = minf && child(moov, minf, 'stbl');
            if (!stbl)
                throw new Error('Missing subtitle sample index');
            const stsd = payload(moov, child(moov, stbl, 'stsd'));
            if (!stsd || u32(stsd, 4) !== 1)
                throw new Error('Multiple subtitle sample descriptions are not supported');
            const descriptions = boxes(stsd, 8);
            const codec = descriptions[0]?.type;
            if (!['tx3g', 'wvtt'].includes(codec))
                throw new Error(`Embedded ${codec ?? 'unknown'} captions are not supported`);
            let shift = 0;
            const edts = child(moov, trak, 'edts'), elst = edts && payload(moov, child(moov, edts, 'elst'));
            if (elst) {
                const wide = elst[0] === 1, width = wide ? 20 : 12, { count } = table(elst, width);
                if (count > 2 || !movieScale)
                    throw new Error('Complex subtitle edit list is unsupported');
                let empty = 0, seen = false;
                for (let i = 0; i < count; i++) {
                    const at = 8 + i * width, duration = wide ? u64(elst, at) : u32(elst, at), timeAt = at + (wide ? 8 : 4);
                    let mediaTime: number;
                    if (wide) {
                        const high = u32(elst, timeAt), low = u32(elst, timeAt + 4);
                        mediaTime = high === 0xffffffff && low === 0xffffffff ? -1 : u64(elst, timeAt);
                    }
                    else
                        mediaTime = new DataView(elst.buffer, elst.byteOffset).getInt32(timeAt);
                    const rate = u32(elst, at + width - 4);
                    if (rate !== 0x10000)
                        throw new Error('Subtitle edit rate is unsupported');
                    if (mediaTime === -1 && !seen)
                        empty += duration / movieScale;
                    else if (mediaTime >= 0 && !seen) {
                        shift = empty - mediaTime / scale;
                        seen = true;
                    }
                    else
                        throw new Error('Complex subtitle edits are unsupported');
                }
            }
            const stsz = payload(moov, child(moov, stbl, 'stsz'));
            if (!stsz)
                throw new Error('Missing subtitle sizes');
            const constant = u32(stsz, 4), samples = u32(stsz, 8);
            if (samples > 100000 || (!constant && 12 + 4 * samples > stsz.length))
                throw new Error('Invalid subtitle sample count');
            const sizes = Array.from({ length: samples }, (_, i) => constant || u32(stsz, 12 + i * 4));
            if (sizes.some(n => n > 65536) || sizes.reduce((a, b) => a + b, 0) > LIMITS.subtitleBytes)
                throw new Error('Embedded subtitles exceed size limits');
            const durations: number[] = [], ctts: number[] = [];
            const stts = payload(moov, child(moov, stbl, 'stts'));
            const dt = table(stts, 8);
            for (let i = 0; i < dt.count; i++) {
                const n = u32(stts!, 8 + i * 8), duration = u32(stts!, 12 + i * 8);
                if (durations.length + n > samples)
                    throw new Error('Invalid subtitle duration table');
                for (let j = 0; j < n; j++)
                    durations.push(duration);
            }
            if (durations.length !== samples)
                throw new Error('Subtitle timestamps do not match samples');
            const composition = payload(moov, child(moov, stbl, 'ctts'));
            if (composition) {
                const ct = table(composition, 8);
                for (let i = 0; i < ct.count; i++) {
                    const n = u32(composition, 8 + i * 8), at = 12 + i * 8, value = composition[0] === 1 ? new DataView(composition.buffer, composition.byteOffset).getInt32(at) : u32(composition, at);
                    if (ctts.length + n > samples)
                        throw new Error('Invalid composition table');
                    for (let j = 0; j < n; j++)
                        ctts.push(value);
                }
                if (ctts.length !== samples)
                    throw new Error('Invalid composition count');
            }
            const co64 = payload(moov, child(moov, stbl, 'co64')), stco = co64 ?? payload(moov, child(moov, stbl, 'stco'));
            const chunks = table(stco, co64 ? 8 : 4), stsc = payload(moov, child(moov, stbl, 'stsc')), mapping = table(stsc, 12);
            const maps = Array.from({ length: mapping.count }, (_, i) => ({ first: u32(stsc!, 8 + i * 12), count: u32(stsc!, 12 + i * 12), description: u32(stsc!, 16 + i * 12) }));
            if (samples && (!maps.length || maps[0].first !== 1))
                throw new Error('Missing subtitle chunk map');
            for (let i = 0; i < maps.length; i++)
                if (!maps[i].count || maps[i].description !== 1 || (i > 0 && maps[i].first <= maps[i - 1].first))
                    throw new Error('Invalid subtitle chunk map');
            const cues: Cue[] = [];
            let sample = 0, time = 0, mapIndex = 0;
            for (let chunk = 0; chunk < chunks.count; chunk++) {
                while (mapIndex + 1 < maps.length && maps[mapIndex + 1].first <= chunk + 1)
                    mapIndex++;
                let at = co64 ? u64(stco!, 8 + chunk * 8) : u32(stco!, 8 + chunk * 4);
                for (let n = 0; n < maps[mapIndex].count; n++) {
                    if (sample >= samples)
                        throw new Error('Too many subtitle samples');
                    const size = sizes[sample];
                    if (at + size > source.size)
                        throw new Error('Subtitle sample exceeds file');
                    const data = size ? await source.read(at, at + size, signal) : new Uint8Array();
                    const start = (time + (ctts[sample] ?? 0)) / scale + shift, end = start + durations[sample] / scale;
                    texts: for (const text of decodeSample(codec, data)) {
                        if (!text.trim() || end <= Math.max(0, start))
                            continue texts;
                        cues.push(validateCue({ id: `sample-${sample}-${cues.length}`, start: Math.max(0, start), end, text: plainCaption(text) }));
                        if (cues.length > LIMITS.cues)
                            throw new Error('Too many embedded captions');
                    }
                    time += durations[sample];
                    sample++;
                    at += size;
                }
            }
            if (sample !== samples)
                throw new Error('Incomplete subtitle sample index');
            tracks.push({ label: `${lang} · Embedded`, language: lang, forced: false, cues });
        }
        catch (e) {
            warnings.push(e instanceof Error ? e.message : String(e));
        }
    }
    return { state: warnings.length ? 'unsupported' : 'complete', tracks, warnings };
}
function decodeSample(codec: string, data: Uint8Array): string[] {
    if (!data.length)
        return [];
    if (codec === 'tx3g') {
        if (data.length < 2)
            throw new Error('Truncated text subtitle');
        const length = (data[0] << 8) | data[1];
        if (length > data.length - 2)
            throw new Error('Truncated text subtitle');
        const bytes = data.subarray(2, 2 + length);
        if (bytes[0] === 0xff && bytes[1] === 0xfe)
            return [new TextDecoder('utf-16le', { fatal: true }).decode(bytes)];
        if (bytes[0] === 0xfe && bytes[1] === 0xff)
            return [new TextDecoder('utf-16be', { fatal: true }).decode(bytes)];
        return [decoder.decode(bytes)];
    }
    return boxes(data).filter(b => b.type === 'vttc').flatMap(b => boxes(data, b.data, b.end).filter(p => p.type === 'payl').map(p => decoder.decode(data.subarray(p.data, p.end))));
}
export async function discoverEmbedded(source: ByteSource, signal: AbortSignal): Promise<Discovery> {
    if (/\.(mkv|webm)$/i.test(source.name)) return discoverMatroska(source, signal);
    if (!/\.(mp4|m4v|mov)$/i.test(source.name))
        return { state: 'unsupported', tracks: [], warnings: ['Embedded subtitle discovery is not yet available for this container. Existing sidecars can still be loaded.'] };
    return mp4(source, signal);
}
