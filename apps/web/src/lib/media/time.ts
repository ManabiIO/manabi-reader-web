/** @license BSD-3-Clause — Manabi media integration. */
/** Playback labels use the same non-negative clock in shelves and transcripts. */
export function formatMediaTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return '—';
    const whole = Math.floor(Math.max(0, seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor(whole / 60) % 60;
    const remainder = String(whole % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}
