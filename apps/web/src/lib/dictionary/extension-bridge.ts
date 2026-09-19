/* SPDX-License-Identifier: GPL-3.0-or-later */
/** Optional document-scoped bridge. A timeout means unknown, never extension absent. */
const channel = 'manabitan-reader-bridge';
interface Reply { channel: string; version: number; direction: string; id: string; operation: string; extension: string; ok?: boolean; capabilities?: string[] }
export class ExtensionBridge {
  private readonly owner = crypto.randomUUID();
  private suspended = false;
  constructor(private readonly changed: (message: string) => void) {}
  private request(operation: 'probe' | 'suspend' | 'resume', signal?: AbortSignal): Promise<Reply | undefined> {
    const id = crypto.randomUUID();
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const finish = (value?: Reply, error?: unknown) => {
        clearTimeout(timer); window.removeEventListener('message', onMessage);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value);
      };
      const onMessage = (event: MessageEvent) => {
        const d: unknown = event.data;
        if (event.source !== window || event.origin !== location.origin || !d || typeof d !== 'object') return;
        const r = d as Reply;
        if (r.channel !== channel || r.version !== 1 || r.direction !== 'extension' || r.id !== id || r.operation !== operation || r.extension !== 'ManabiTan') return;
        finish(r);
      };
      const onAbort = () => finish(undefined, signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
      const timer = setTimeout(() => finish(), operation === 'probe' ? 600 : 2000);
      window.addEventListener('message', onMessage); signal?.addEventListener('abort', onAbort, { once: true });
      window.postMessage({ channel, version: 1, direction: 'reader', id, owner: this.owner, operation }, location.origin);
    });
  }
  async suspend(signal: AbortSignal) {
    const reply = await this.request('probe', signal);
    if (!reply) {
      this.changed('Extension compatibility is unknown. To avoid double popups, disable Yomitan/ManabiTan scanning for this site when using the built-in dictionary.');
      return false;
    }
    if (!Array.isArray(reply.capabilities) || !reply.capabilities.includes('document-scanner')) throw new Error('This ManabiTan extension cannot suspend its scanner. Choose extension mode or disable it for this site.');
    // Remember possible suspension before awaiting acknowledgement so an aborted
    // transition still releases this exact document owner.
    this.suspended = true;
    const ack = await this.request('suspend', signal);
    if (!ack?.ok) throw new Error('The extension did not acknowledge scanner suspension. Built-in scanning remains stopped.');
    this.changed('ManabiTan acknowledged scanner suspension for this document.');
    return true;
  }
  async release() {
    if (!this.suspended) return;
    const ack = await this.request('resume');
    if (!ack?.ok) throw new Error('Extension scanner resumption was not acknowledged. Reload this document before changing providers again.');
    this.suspended = false;
  }
}
