/** @license BSD-3-Clause — Manabi media integration. */
import { validateCue, type Cue } from './contracts.js';
/** Strict whole-window parse, preserving bracketed numbers inside spoken text.
 * A numeric bracket ends a segment only at EOF or before another start/speaker pair.
 * Completed results require a final timestamp; partial tails are not published.
 */
export function parseMoss(raw: string, duration: number): Cue[] {
    if (typeof raw !== 'string' || raw.length > 1024 * 1024 ||
        !Number.isFinite(duration) || duration <= 0 || duration > 64)
        throw new Error('Invalid MOSS window/output');
    const number = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
    const opening = new RegExp(`\\[(${number})\\]\\[(S\\d{1,15})\\]`, 'y');
    const closing = new RegExp(`^\\[(${number})\\]`);
    const out: Cue[] = [];
    const skipSpace = (at: number) => { while (at < raw.length && /\s/.test(raw[at])) at++; return at; };
    let at = skipSpace(0);
    while (at < raw.length) {
        opening.lastIndex = at;
        const startToken = opening.exec(raw);
        if (!startToken) throw new Error('Malformed MOSS output');
        const textStart = opening.lastIndex;
        let scan = textStart, accepted = false;
        for (;;) {
            scan = raw.indexOf('[', scan);
            if (scan < 0) break;
            // Reference timestamp tokens are bounded; large bracketed numbers stay text.
            const endToken = closing.exec(raw.slice(scan, scan + 34));
            if (endToken) {
                const next = skipSpace(scan + endToken[0].length);
                opening.lastIndex = next;
                if (next === raw.length || opening.test(raw)) {
                    const start = Number(startToken[1]), end = Number(endToken[1]);
                    const text = raw.slice(textStart, scan).trim();
                    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start ||
                        start > duration + 1 || end > duration + 2)
                        throw new Error('Invalid MOSS timestamps');
                    if (text) {
                        if (start >= duration || Math.min(end, duration) <= start)
                            throw new Error('MOSS speech has no usable time interval');
                        out.push(validateCue({ id: `cue-${out.length}`, start, end: Math.min(end, duration), text, speaker: startToken[2] }));
                        if (out.length > 50000) throw new Error('Too many MOSS cues');
                    }
                    at = next; accepted = true; break;
                }
            }
            scan++;
        }
        if (!accepted) throw new Error('Incomplete MOSS output');
    }
    return out;
}
export interface Window {
    index: number;
    start: number;
    end: number;
    coreStart: number;
    coreEnd: number;
}
export function planWindows(duration: number, seconds = 60, overlap = 2): Window[] {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 604800 || !Number.isFinite(seconds) || !Number.isFinite(overlap) || seconds < 1 || Math.ceil(duration / seconds) > 10080 || seconds <= overlap * 2 || seconds > 60 || overlap < 0)
        throw new Error('Invalid transcription window');
    return Array.from({ length: Math.ceil(duration / seconds) }, (_, index) => ({ index, start: Math.max(0, index * seconds - overlap), end: Math.min(duration, (index + 1) * seconds + overlap), coreStart: index * seconds, coreEnd: Math.min(duration, (index + 1) * seconds) }));
}
export function ownedCues(cues: Cue[], w: Window): Cue[] {
    return cues.map(c => ({ ...c, start: c.start + w.start, end: c.end + w.start })).filter(c => { const mid = (c.start + c.end) / 2; return mid >= w.coreStart && mid < w.coreEnd; }).map(c => ({ ...c, id: `w${w.index}/${c.id}`, ...(c.speaker ? { speaker: `w${w.index}/${c.speaker}` } : {}) }));
}
