/** @license BSD-3-Clause */
import {aborted, canonicalJSON, sha256} from '../preprocessing/contracts.mjs';

const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
function copyAsset(asset, purpose) {
  if (!asset || !id(asset.id) || typeof asset.label !== 'string' || !asset.label ||
      typeof asset.revision !== 'string' || !asset.revision || !hash(asset.contentSha256)) {
    throw new TypeError('Dictionary assets need immutable identity, revision and content checksum');
  }
  // A host-owned source token can identify an already hashed local ZIP. Never
  // accept asset configuration or executable module URLs from ebook content.
  if (typeof asset.source !== 'string' || !asset.source) throw new TypeError('Missing dictionary source');
  if (asset.purpose !== purpose) throw new TypeError('Processing dictionaries are not definition dictionaries');
  return Object.freeze(JSON.parse(canonicalJSON(asset)));
}
export function installationPlan(selectedDefinitions, processingAssets = []) {
  if (!Array.isArray(selectedDefinitions) || !Array.isArray(processingAssets)) throw new TypeError('Invalid installation selection');
  if (selectedDefinitions.length === 0) return Object.freeze([]);
  const entries = new Map();
  // Processing requirements are NOT optional definition checkboxes. Importing
  // any dictionary (recommended, custom, frequency, local file) includes them.
  for (const [assets, purpose] of [[processingAssets, 'processing'], [selectedDefinitions, 'definitions']]) {
    for (const raw of assets) {
      const asset = copyAsset(raw, purpose), existing = entries.get(asset.id);
      if (existing && canonicalJSON(existing) !== canonicalJSON(asset)) throw new Error('Conflicting dictionary identities');
      entries.set(asset.id, asset);
    }
  }
  return Object.freeze([...entries.values()]);
}
function verifiedReceipt(receipt, asset) {
  if (!receipt || receipt.id !== asset.id || receipt.contentSha256 !== asset.contentSha256 ||
      receipt.purpose !== asset.purpose || !id(receipt.artifactID) || !hash(receipt.artifactSha256) ||
      typeof receipt.importerVersion !== 'string' || !receipt.importerVersion ||
      typeof receipt.formatVersion !== 'string' || !receipt.formatVersion || receipt.verified !== true) {
    throw new Error('Dictionary import did not produce a verified artifact receipt');
  }
  return Object.freeze(JSON.parse(canonicalJSON(receipt)));
}
/** Only immutable processing bytes/import semantics affect text analysis.
 * Definition ordering, titles, Anki settings and display-only updates do not. */
export async function processingSetFingerprint(receipts) {
  if (!Array.isArray(receipts) || receipts.length === 0) return null;
  const ids = new Set();
  const identities = receipts.map((receipt) => {
    if (!receipt || !id(receipt.id) || ids.has(receipt.id) || !hash(receipt.contentSha256) || !hash(receipt.artifactSha256) ||
        receipt.purpose !== 'processing' || receipt.verified !== true ||
        typeof receipt.importerVersion !== 'string' || !receipt.importerVersion || typeof receipt.formatVersion !== 'string' || !receipt.formatVersion) throw new Error('Invalid processing generation');
    ids.add(receipt.id);
    return {id: receipt.id, contentSha256: receipt.contentSha256, artifactSha256: receipt.artifactSha256,
      importerVersion: receipt.importerVersion, formatVersion: receipt.formatVersion};
  }).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return 'processing-set-v2:' + await sha256(canonicalJSON(identities));
}
/** Storage adapter owns real ZIP admission, immutable staging and one atomic
 * processing-set pointer. ensure() must verify/reopen existing artifacts too.
 * withLock must serialize installations across tabs (not just this instance).
 * No completed flag is set before a durable publish/readback acknowledges it. */
export class DictionaryInstallationCoordinator {
  constructor({processingAssets = [], storage, report = () => {}}) {
    this.processingAssets = Object.freeze(processingAssets.map((a) => copyAsset(a, 'processing')));
    for (const method of ['withLock', 'ensure', 'activateProcessingSet', 'readProcessingSet']) {
      if (typeof storage?.[method] !== 'function') throw new TypeError('Missing installation storage method: ' + method);
    }
    this.storage = storage;
    this.report = (state) => { try { report(Object.freeze({...state})); } catch {} };
  }
  get processingResourceCount() { return this.processingAssets.length; }
  async install(selectedDefinitions, {signal} = {}) {
    aborted(signal);
    const plan = installationPlan(selectedDefinitions, this.processingAssets);
    if (plan.length === 0) return {installed: [], processingFingerprint: null};
    return this.storage.withLock(async () => {
      aborted(signal);
      const processing = plan.filter((a) => a.purpose === 'processing');
      const definitions = plan.filter((a) => a.purpose === 'definitions');
      const installed = [], receipts = [];
      const ensure = async (asset) => {
        aborted(signal);
        this.report({phase: 'installing', assetID: asset.id, label: asset.label,
          purpose: asset.purpose, completed: installed.length, total: plan.length});
        const receipt = verifiedReceipt(await this.storage.ensure(asset, {signal}), asset);
        aborted(signal); installed.push(asset.id); return receipt;
      };
      try {
        for (const asset of processing) receipts.push(await ensure(asset));
        const fingerprint = await processingSetFingerprint(receipts);
        aborted(signal);
        if (fingerprint !== null) {
          await this.storage.activateProcessingSet({schema: 1, fingerprint, resources: receipts}, {signal});
          aborted(signal);
          // Missing one file on readback is not a ready analysis generation.
          // The adapter must reopen/verify the indexed artifact set, not merely
          // return a persisted 'installed=true' boolean.
          const active = await this.storage.readProcessingSet({signal});
          aborted(signal);
          if (active?.fingerprint !== fingerprint || await processingSetFingerprint(active.resources) !== fingerprint) {
            throw new Error('Processing dictionary activation failed verification');
          }
        }
        for (const asset of definitions) await ensure(asset);
        aborted(signal);
        this.report({phase: 'complete', completed: installed.length, total: plan.length});
        return {installed, processingFingerprint: fingerprint};
      } catch (error) {
        this.report({phase: signal?.aborted ? 'canceled' : 'failed', completed: installed.length, total: plan.length});
        throw error;
      }
    }, {signal});
  }
}
