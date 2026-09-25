export interface BookResourceOptions {
  blobs: Record<string, Blob>;
  placeholderFor: (key: string) => string;
  inferMimeType: (key: string) => string | undefined | null;
  sanitizeSvg: (source: string) => string;
  createObjectURL?: (value: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  report?: (event: { type: string; name: string }) => void;
}

export class BookResourceLease {
  constructor(options: BookResourceOptions);
  resolveSourceImage(source: string): string | undefined;
  resolveRenderImage(source: string): string | undefined;
  imageUrls(): ReadonlySet<string>;
  prepare(options?: { signal?: AbortSignal }): Promise<void>;
  pictures(sourceImages: readonly string[], isPaginated: boolean): { url: string; unspoilered: boolean }[];
  dispose(reason?: unknown): void;
}
