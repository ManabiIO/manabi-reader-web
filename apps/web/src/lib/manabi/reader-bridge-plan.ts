/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/** Executable design for the external-reader bridge. No storage, network, timers,
 * or production activation. Adapters must validate/decode wire data before here.
 * Each digest covers one semantic resume position or one complete daily total;
 * timestamps, filenames and local database IDs are not conflict resolution. */
export interface ReaderBridgeSnapshot {
  binding: string;
  generation: string;
  profile: 'ttu-1-6' | 'ttu-1-7' | 'ttu-1-8' | 'yatsu-1-11';
  fingerprint: string;
  revision: string;
  records: Readonly<Record<string, string>>;
}
export type ReaderBridgeRemote =
  | { state: 'available'; snapshot: ReaderBridgeSnapshot }
  | { state: 'missing' | 'unreadable' | 'unsupported' | 'unstable' };
export interface ReaderBridgeInput {
  local: ReaderBridgeSnapshot;
  remote: ReaderBridgeRemote;
  /** Last durably acknowledged projections, not an import timestamp. */
  baseline?: { local: ReaderBridgeSnapshot; remote: ReaderBridgeSnapshot };
  direction: 'receive' | 'both';
  /** Set only by a qualified adapter, never inferred from a successful GET. */
  writeCapability?: 'conditional-recoverable';
  /** A request whose outcome is unknown must be reconciled before another write. */
  uncertainWrite?: boolean;
}
export interface ReaderBridgePlan {
  state: 'ready' | 'review' | 'paused';
  reason?: string;
  pull: string[];
  push: string[];
  acknowledge: string[];
  pending: string[];
  conflicts: { key: string; reason: 'initial-difference' | 'both-changed' | 'removed' }[];
  precondition?: { binding: string; generation: string; local: string; remote: string };
}
const digestPattern = /^[a-f0-9]{64}$/;
const profiles = new Set(['ttu-1-6', 'ttu-1-7', 'ttu-1-8', 'yatsu-1-11']);
function recordKey(key: string) {
  if (key === 'resume') return true;
  if (!/^statistics\/\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const day = key.slice('statistics/'.length);
  const parsed = new Date(day);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === day;
}
export function validReaderBridgeSnapshot(snapshot: ReaderBridgeSnapshot) {
  return (
    !!snapshot &&
    [snapshot.binding, snapshot.generation, snapshot.revision].every(
      (value) => typeof value === 'string' && value.length > 0 && value.length <= 512
    ) &&
    profiles.has(snapshot.profile) &&
    typeof snapshot.fingerprint === 'string' &&
    digestPattern.test(snapshot.fingerprint) &&
    !!snapshot.records &&
    typeof snapshot.records === 'object' &&
    (Object.getPrototypeOf(snapshot.records) === Object.prototype ||
      Object.getPrototypeOf(snapshot.records) === null) &&
    Object.keys(snapshot.records).length <= 20000 &&
    Object.entries(snapshot.records).every(
      ([key, value]) => recordKey(key) && typeof value === 'string' && digestPattern.test(value)
    )
  );
}
function sameBook(a: ReaderBridgeSnapshot, b: ReaderBridgeSnapshot) {
  return (
    a.binding === b.binding &&
    a.generation === b.generation &&
    a.profile === b.profile &&
    a.fingerprint === b.fingerprint
  );
}
function empty(state: ReaderBridgePlan['state'], reason?: string): ReaderBridgePlan {
  return { state, reason, pull: [], push: [], acknowledge: [], pending: [], conflicts: [] };
}

/** Conservative whole-book plan. A missing file/row is not a tombstone; a daily
 * aggregate is not a session delta. Any conflict pauses that book before writes.
 * Successful planning is neither a save acknowledgement nor authority to write. */
export function planReaderBridge(input: ReaderBridgeInput): ReaderBridgePlan {
  if (input.direction !== 'receive' && input.direction !== 'both')
    return empty('paused', 'invalid-direction');
  if (!validReaderBridgeSnapshot(input.local)) return empty('paused', 'invalid-local-snapshot');
  if (input.remote.state !== 'available') return empty('paused', `remote-${input.remote.state}`);
  const local = input.local;
  const remote = input.remote.snapshot;
  if (!validReaderBridgeSnapshot(remote)) return empty('paused', 'invalid-remote-snapshot');
  if (!sameBook(local, remote)) return empty('paused', 'binding-or-content-changed');
  const baseline = input.baseline;
  if (
    baseline &&
    (!validReaderBridgeSnapshot(baseline.local) ||
      !validReaderBridgeSnapshot(baseline.remote) ||
      !sameBook(local, baseline.local) ||
      !sameBook(local, baseline.remote))
  )
    return empty('paused', 'baseline-does-not-match');
  // A baseline is an agreed semantic state. Receive-only pending changes must
  // retain their last agreed digest, not be stored as two divergent baselines.
  if (baseline) {
    const keys = new Set([
      ...Object.keys(baseline.local.records),
      ...Object.keys(baseline.remote.records)
    ]);
    if ([...keys].some((key) => baseline.local.records[key] !== baseline.remote.records[key]))
      return empty('paused', 'baseline-not-converged');
  }
  if (input.uncertainWrite) return empty('paused', 'reconcile-uncertain-write');
  const plan = empty('ready');
  plan.precondition = {
    binding: local.binding,
    generation: local.generation,
    local: local.revision,
    remote: remote.revision
  };
  const keys = new Set([
    ...Object.keys(baseline?.local.records ?? {}),
    ...Object.keys(baseline?.remote.records ?? {}),
    ...Object.keys(local.records),
    ...Object.keys(remote.records)
  ]);
  for (const key of [...keys].sort()) {
    const here = local.records[key];
    const there = remote.records[key];
    const beforeHere = baseline?.local.records[key];
    const beforeThere = baseline?.remote.records[key];
    if (
      (beforeHere !== undefined && here === undefined) ||
      (beforeThere !== undefined && there === undefined)
    ) {
      plan.conflicts.push({ key, reason: 'removed' });
    } else if (here === there) {
      plan.acknowledge.push(key);
    } else if (
      beforeHere === undefined &&
      beforeThere === undefined &&
      here !== undefined &&
      there !== undefined
    ) {
      plan.conflicts.push({ key, reason: 'initial-difference' });
    } else {
      const localChanged = here !== beforeHere;
      const remoteChanged = there !== beforeThere;
      if (localChanged && remoteChanged) {
        plan.conflicts.push({ key, reason: 'both-changed' });
      } else if (remoteChanged) {
        plan.pull.push(key);
      } else if (localChanged && input.direction === 'both') {
        plan.push.push(key);
      } else if (localChanged) {
        plan.pending.push(key);
      }
    }
  }
  if (plan.conflicts.length) return { ...empty('review'), conflicts: plan.conflicts };
  if (plan.push.length && input.writeCapability !== 'conditional-recoverable')
    return empty('paused', 'write-adapter-not-qualified');
  return plan;
}
