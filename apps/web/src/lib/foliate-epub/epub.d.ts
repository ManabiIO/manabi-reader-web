/**
 * Minimal type surface for the vendored EPUB-only Foliate core.
 * Runtime code is pinned in ./epub.js; keep this intentionally smaller than
 * Foliate's demo/viewer API so Web does not acquire unrelated format features.
 */
export interface FoliateSection {
  id: string;
  linear?: string;
  cfi?: string;
  load(): Promise<string | null>;
  unload?(): void;
  createDocument?(): Promise<Document>;
  size?: number;
  resolveHref?(href: string): string;
}

export interface FoliateNavigationItem {
  label?: string;
  href?: string;
  subitems?: FoliateNavigationItem[];
}

export interface FoliateManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string[];
  fallback?: string;
}

export interface FoliateEpubBook {
  resources: {
    manifest: FoliateManifestItem[];
    spine: Array<{ idref: string; linear?: string }>;
    cover?: FoliateManifestItem;
  };
  sections: FoliateSection[];
  toc?: FoliateNavigationItem[];
  pageList?: FoliateNavigationItem[];
  landmarks?: FoliateNavigationItem[];
  metadata?: Record<string, unknown>;
  rendition?: Record<string, unknown>;
  dir?: string;
  resolveHref(href: string): {
    index: number;
    anchor: (doc: Document) => Element | Range | number | null;
  } | null;
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
  isExternal(uri: string): boolean;
  destroy(): unknown;
}

export class EPUB {
  constructor(source: {
    loadText(uri: string, maximum?: number): Promise<string | null>;
    loadBlob(uri: string): Promise<Blob | null>;
    getSize(uri: string): number;
    resolveHref?: (href: string, owner: string) => string;
    resolveNavigationHref?: (href: string, owner: string) => string;
    sha1?: (value: string) => Promise<Uint8Array>;
  });
  init(): Promise<FoliateEpubBook>;
  destroy(): unknown;
}

export class Loader {
  constructor(source: {
    loadText(uri: string, maximum?: number): Promise<string | null>;
    loadBlob(uri: string): Promise<Blob | null>;
    resources: { manifest: Array<{ href: string; mediaType: string }> };
  });
  eventTarget: EventTarget;
  loadItem(item: { href: string; mediaType: string }, parents?: string[]): Promise<string | null>;
  unloadItem(item: { href: string }): void;
  destroy(): boolean;
}
