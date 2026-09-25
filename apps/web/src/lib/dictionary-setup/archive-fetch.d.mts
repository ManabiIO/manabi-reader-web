import type {DictionaryAsset} from './installation.mjs';
export function hasZipSignature(bytes: Uint8Array): boolean;
export function fetchVerifiedDictionaryArchive(asset: DictionaryAsset & {sourceRepresentation: 'zip'|'brotli-wrapped-zip'}, options?: {
 signal?: AbortSignal; fetcher?: typeof fetch; baseURL?: string; allowedOrigins?: string[];
 maxTransferBytes?: number; maxDecodedBytes?: number;
 brotliStream?: (stream: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
}): Promise<Uint8Array>;
