/** @license BSD-3-Clause */
export interface DictionaryAsset {
  id: string;
  label: string;
  purpose: 'processing' | 'definitions';
  revision: string;
  /** SHA-256 of the decoded ZIP, not a mutable URL or a server ETag. */
  contentSha256: string;
  source: string;
  [key: string]: unknown;
}
export interface ArtifactReceipt {
  id: string;
  purpose: 'processing' | 'definitions';
  contentSha256: string;
  artifactID: string;
  artifactSha256: string;
  importerVersion: string;
  formatVersion: string;
  verified: true;
}
export interface ProcessingSet {
  schema: 1;
  fingerprint: string;
  resources: ArtifactReceipt[];
}
export interface InstallationStorage {
  withLock<T>(operation: () => Promise<T>, options: { signal?: AbortSignal }): Promise<T>;
  ensure(asset: DictionaryAsset, options: { signal?: AbortSignal }): Promise<ArtifactReceipt>;
  activateProcessingSet(set: ProcessingSet, options: { signal?: AbortSignal }): Promise<void>;
  readProcessingSet(options: { signal?: AbortSignal }): Promise<ProcessingSet | null>;
}
export function installationPlan(
  selected: DictionaryAsset[],
  processing?: DictionaryAsset[]
): readonly DictionaryAsset[];
export function processingSetFingerprint(receipts: ArtifactReceipt[]): Promise<string | null>;
export class DictionaryInstallationCoordinator {
  readonly processingResourceCount: number;
  constructor(options: {
    processingAssets?: DictionaryAsset[];
    storage: InstallationStorage;
    report?: (state: Readonly<Record<string, unknown>>) => void;
  });
  install(
    selected: DictionaryAsset[],
    options?: { signal?: AbortSignal }
  ): Promise<{ installed: string[]; processingFingerprint: string | null }>;
}
