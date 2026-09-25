import type {JSONValue, Preprocessor} from './index.d.mts';
import type {DictionaryAsset} from '../dictionary-setup/installation.d.mts';
export interface DeploymentManifest {
 protocol: 1; release: string; entry: {path: string; sha256: string; bytes?: number};
 processingResources?: readonly DictionaryAsset[];
 assets?: Record<string, JSONValue>;
}
export interface DeploymentLoadOptions {
 manifestURL?: string; baseURL?: string; signal?: AbortSignal;
 report?: (event: Record<string, unknown>) => void;
}
export function deploymentURL(value: string, base: string | URL): URL;
export function loadDeploymentManifest(options?: DeploymentLoadOptions): Promise<
 {manifest: DeploymentManifest; assetBaseURL: string; status: 'ready'} |
 {manifest: null; assetBaseURL: null; status: 'not-configured' | 'not-installed'}>;
export function loadDeploymentPreprocessor(options?: DeploymentLoadOptions): Promise<{
 provider: Preprocessor | null; status: 'not-configured' | 'not-installed' | 'ready'
}>;
