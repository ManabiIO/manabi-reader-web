/** @license BSD-3-Clause */
import {aborted, sha256} from '../preprocessing/contracts.mjs';

async function boundedBytes(stream, maximum, signal) {
  if (!stream || typeof stream.getReader !== 'function') throw new Error('Missing dictionary response body');
  const reader=stream.getReader(), chunks=[];
  let length=0;
  const cancel=()=>{ void reader.cancel(signal.reason).catch(()=>{}); };
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    aborted(signal);
    while (true) {
      const {value,done}=await reader.read(); aborted(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('Invalid dictionary stream');
      length+=value.byteLength;
      if (!Number.isSafeInteger(length) || length>maximum) throw new Error('Dictionary exceeds download/decompression budget');
      // Readers can reuse backing storage. Own all retained chunks.
      chunks.push(value.slice());
    }
    const bytes=new Uint8Array(length); let offset=0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
    return bytes;
  } catch(error) {
    try { await reader.cancel(error); } catch {}
    throw error;
  } finally { signal?.removeEventListener('abort',cancel); reader.releaseLock(); }
}
export const hasZipSignature=bytes=>bytes.length>=4 && bytes[0]===0x50 && bytes[1]===0x4b &&
  ((bytes[2]===3 && bytes[3]===4) || (bytes[2]===5 && bytes[3]===6));
/** Host-owned immutable release descriptor only. The checksum is of decoded ZIP
 * bytes. Fetch may already decode HTTP Content-Encoding: br; the filename alone
 * must not cause a second Brotli decode. ZIP structural/entry validation remains
 * the importer's responsibility. No opaque response or no-cors workaround. */
export async function fetchVerifiedDictionaryArchive(asset, {
  signal, fetcher=fetch, baseURL=globalThis.location?.href,
  allowedOrigins=['https://manabi.io'], maxTransferBytes=128*1024*1024,
  maxDecodedBytes=256*1024*1024,
  brotliStream=stream=>{
    try { return stream.pipeThrough(new DecompressionStream('brotli')); }
    catch { throw new Error('Brotli decompression is unavailable; a pinned decoder is required'); }
  }
}={}) {
  aborted(signal);
  if (!/^[a-f0-9]{64}$/.test(asset?.contentSha256 ?? '')) throw new Error('Missing reviewed dictionary checksum');
  if (!['zip','brotli-wrapped-zip'].includes(asset.sourceRepresentation)) throw new Error('Unknown dictionary representation');
  const url=new URL(asset.source,baseURL);
  if (url.protocol!=='https:' || url.username || url.password || !allowedOrigins.includes(url.origin)) throw new Error('Unapproved dictionary origin');
  for (const budget of [maxTransferBytes,maxDecodedBytes]) if (!Number.isSafeInteger(budget) || budget<=0) throw new Error('Invalid archive budget');
  const response=await fetcher(url.href,{signal,credentials:'omit',mode:'cors',redirect:'error',cache:'no-cache'});
  aborted(signal);
  if (!response.ok || response.type==='opaque') throw new Error('Dictionary request failed');
  const transfer=await boundedBytes(response.body,maxTransferBytes,signal);
  let bytes=transfer;
  if (!hasZipSignature(bytes) && asset.sourceRepresentation==='brotli-wrapped-zip') {
    const stream=new Blob([transfer]).stream();
    bytes=await boundedBytes(brotliStream(stream),maxDecodedBytes,signal);
  }
  aborted(signal);
  if (bytes.length>maxDecodedBytes || !hasZipSignature(bytes)) throw new Error('Dictionary is not an admitted ZIP representation');
  if (await sha256(bytes)!==asset.contentSha256) throw new Error('Dictionary content checksum mismatch');
  aborted(signal);
  return bytes;
}
