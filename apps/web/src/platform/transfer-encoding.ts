/** @license BSD-3-Clause */
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Works in Hermes and browsers without assuming Node's Buffer or btoa globals. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    parts.push(alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] + (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] : '=') + (i + 2 < bytes.length ? alphabet[c & 63] : '='));
  }
  return parts.join('');
}
