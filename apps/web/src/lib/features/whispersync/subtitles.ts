/** @license MIT — Manabi Reader adaptations; see docs/whispersync.md. */
export interface Cue {
  /** Generated identity, independent of optional/duplicate SRT or VTT identifiers. */
  id: number
  start: number
  end: number
  text: string
}

export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024
export const MAX_CUES = 50_000
export const MAX_CUE_TEXT = 8192
const timePattern = /^(?:(\d{2,6}):)?(\d{2}):(\d{2})[.,](\d{3})$/

export function parseTimestamp(value: string): number {
  const match = timePattern.exec(value)
  if (!match) throw new Error(`Invalid subtitle timestamp: ${value}`)
  const [, hours = '0', minutes, seconds, milliseconds] = match
  if (+minutes > 59 || +seconds > 59) throw new Error(`Invalid subtitle timestamp: ${value}`)
  return +hours * 3600 + +minutes * 60 + +seconds + +milliseconds / 1000
}

/** Always returned as plain text, never passed to {@html} or innerHTML. */
export function cueText(value: string): string {
  // Ruby pronunciation is not spoken twice. VTT voice, style, and timestamp tags
  // are metadata, not book text. Unknown tags remain literal, harmless text.
  const text = value
    .replace(/<(rt|rp)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(?:b|i|u|font|ruby|rt|rp|c|v|lang)(?:[.\s][^<>]*)?>/gi, '')
    .replace(/<(?:\d{2,6}:)?\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
      if (name.startsWith('#')) {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : +name.slice(1)
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code) : '\ufffd'
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[name.toLowerCase()] ?? entity
    })
    .trim()
  if (!text || text.length > MAX_CUE_TEXT) throw new Error('Subtitle line is empty or too long')
  return text
}

export function parseSubtitles(source: string): Cue[] {
  if (source.length > MAX_SUBTITLE_BYTES || new TextEncoder().encode(source).length > MAX_SUBTITLE_BYTES) {
    throw new Error('Subtitle file exceeds the 5 MiB limit')
  }
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) throw new Error('Subtitle file is empty')
  const blocks = normalized.split(/\n[ \t]*\n/)
  const vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized)
  const cues: Cue[] = []
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex]
    if (vtt && (blockIndex === 0 || /^(?:NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block))) continue
    const lines = block.split('\n')
    const timingLine = lines[0].includes('-->') ? 0 : 1
    const match = /^\s*(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(lines[timingLine] ?? '')
    if (!match) throw new Error(`Invalid subtitle block ${blockIndex + 1}: expected a timing line`)
    const start = parseTimestamp(match[1])
    const end = parseTimestamp(match[2])
    if (end <= start) throw new Error(`Subtitle block ${blockIndex + 1} must end after it starts`)
    cues.push({ id: cues.length, start, end, text: cueText(lines.slice(timingLine + 1).join('\n')) })
    if (cues.length > MAX_CUES) throw new Error('Subtitle file exceeds the 50,000 cue limit')
  }
  if (!cues.length) throw new Error('No subtitle cues found')
  return cues.sort((a, b) => a.start - b.start || a.id - b.id)
}

/** Latest-starting active cue wins overlaps; a gap has no active cue. */
export class CueTimeline {
  readonly cues: readonly Cue[]
  private readonly prefixEnd: number[]

  constructor(cues: readonly Cue[]) {
    this.cues = [...cues].sort((a, b) => a.start - b.start || a.id - b.id)
    let max = 0
    this.prefixEnd = this.cues.map((cue) => {
      max = Math.max(max, cue.end)
      return max
    })
  }

  at(audioTime: number, delay = 0): number {
    if (!Number.isFinite(audioTime) || !Number.isFinite(delay)) return -1
    const time = audioTime - delay
    let lo = 0
    let hi = this.cues.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.cues[mid].start <= time) lo = mid + 1
      else hi = mid
    }
    for (let i = lo - 1; i >= 0 && this.prefixEnd[i] > time; i -= 1) {
      if (this.cues[i].end > time) return i
    }
    return -1
  }

  adjacent(audioTime: number, direction: -1 | 1, delay = 0): number {
    if (!this.cues.length) return -1
    const active = this.at(audioTime, delay)
    if (active >= 0) return Math.max(0, Math.min(this.cues.length - 1, active + direction))
    const next = this.cues.findIndex((cue) => cue.start + delay > audioTime)
    if (direction === 1) return next < 0 ? this.cues.length - 1 : next
    return next < 0 ? this.cues.length - 1 : Math.max(0, next - 1)
  }
}
