/** @license BSD-3-Clause — Manabi media integration. */
import type { Track } from './contracts.js';
import type { Discovery } from './embedded.js';

/** Unknown inspection is not evidence of missing captions; explicit regeneration remains available. */
export function missingTranscriptDecision(tracks: readonly Pick<Track, 'complete' | 'forced' | 'language'>[],
    language: string, discovery: Discovery['state']): 'present' | 'missing' | 'inspect-manually' {
    if (tracks.some(t => t.complete && !t.forced && t.language.split('-')[0] === language.split('-')[0])) return 'present';
    return discovery === 'complete' ? 'missing' : 'inspect-manually';
}
