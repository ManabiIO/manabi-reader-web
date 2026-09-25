/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { cloudSource, type CloudManifest, type ByteSource } from './sources.js';
import { matchSidecar } from './captions.js';
import type { SyncTransport } from './sync.js';
import {
  cloudRequest,
  connectionsFrom,
  listCloudFolder,
  type CloudConnection
} from './cloud-listing.js';

/** Only uses existing Manabi sessions and selected roots; never asks for provider tokens. */
export function chooseCloudVideo(
  transport: SyncTransport,
  open: (source: ByteSource, subtitles: File[]) => Promise<void>,
  lifetime?: AbortSignal
): Promise<void> {
  lifetime?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'media-cloud-dialog';
    const title = document.createElement('h2');
    title.id = 'media-cloud-title';
    title.textContent = 'Cloud videos';
    dialog.setAttribute('aria-labelledby', title.id);
    const notice = document.createElement('p');
    notice.textContent =
      'Video playback starts without transcription. Opening also reads the file in bounded ranges to establish portable progress identity. Existing provider grants remain unchanged.';
    const rows = document.createElement('div'),
      status = document.createElement('p');
    status.setAttribute('role', 'status');
    const controller = new AbortController();
    let listing: AbortController | undefined,
      generation = 0,
      opening = false,
      handedOff = false;
    const closeForLifetime = () => {
      controller.abort();
      listing?.abort();
      dialog.close();
    };
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener(
      'close',
      () => {
        controller.abort();
        listing?.abort();
        generation++;
        dialog.remove();
        lifetime?.removeEventListener('abort', closeForLifetime);
        if (!handedOff) resolve();
      },
      { once: true }
    );
    const request = <T>(path: string) => cloudRequest<T>(transport, path, controller.signal);
    const button = (name: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.addEventListener('click', () => {
        if (!opening) fn();
      });
      return b;
    };
    const showError = (e: unknown) => {
      if (!controller.signal.aborted && transport.isCurrent())
        status.textContent = e instanceof Error ? e.message : String(e);
    };
    const busy = (value: boolean) => {
      opening = value;
      for (const row of rows.querySelectorAll('button')) row.disabled = value;
    };
    const browse = async (
      connection: CloudConnection,
      root: string,
      parent: string,
      parents: { id: string; name: string }[]
    ) => {
      const serial = ++generation;
      listing?.abort();
      listing = new AbortController();
      status.textContent = 'Loading…';
      rows.replaceChildren();
      const currentListing = listing;
      const stop = () => currentListing.abort();
      controller.signal.addEventListener('abort', stop, { once: true });
      try {
        const items = await listCloudFolder(
          transport,
          connection,
          root,
          parent,
          currentListing.signal
        );
        if (serial !== generation || controller.signal.aborted) return;
        status.textContent = `${connection.provider} · ${parents.at(-1)?.name ?? 'Selected folder'}`;
        rows.append(button('Connections', () => void roots().catch(showError)));
        if (parents.length)
          rows.append(
            button('Back', () => {
              void browse(connection, root, parents.at(-1)!.id, parents.slice(0, -1)).catch(
                showError
              );
            })
          );
        const manifest = (id: string) =>
          request<CloudManifest>(
            `connections/${encodeURIComponent(connection.id)}/media-info/?${new URLSearchParams({ root, id })}`
          );
        for (const entry of items.filter(
          (e) => e.kind === 'folder' || !/\.(srt|vtt)$/i.test(e.name)
        )) {
          rows.append(
            button((entry.kind === 'folder' ? 'Folder: ' : '') + entry.name, () => {
              if (entry.kind === 'folder') {
                void browse(connection, root, entry.id, [
                  ...parents,
                  { id: parent, name: entry.name }
                ]).catch(showError);
                return;
              }
              busy(true);
              status.textContent = 'Opening…';
              void (async () => {
                const source = cloudSource(
                  await manifest(entry.id),
                  transport.userId,
                  transport.isCurrent
                );
                const subtitles: File[] = [];
                for (const sibling of items.filter(
                  (e) => e.kind === 'file' && matchSidecar(entry.name, e.name)
                )) {
                  const sub = cloudSource(
                    await manifest(sibling.id),
                    transport.userId,
                    transport.isCurrent
                  );
                  if (sub.size > 5 * 1024 * 1024) continue;
                  const parts: ArrayBuffer[] = [];
                  for (let at = 0; at < sub.size; at += 1024 * 1024) {
                    const bytes = await sub.read(
                      at,
                      Math.min(sub.size, at + 1024 * 1024),
                      controller.signal
                    );
                    parts.push(Uint8Array.from(bytes).buffer);
                  }
                  subtitles.push(new File(parts, sibling.name));
                }
                controller.signal.throwIfAborted();
                if (!transport.isCurrent()) throw new Error('Account changed');
                handedOff = true;
                dialog.close();
                // The workspace owns its own post-handoff lifetime. No dialog signal is reused.
                await open(source, subtitles);
                resolve();
              })().catch((e) => {
                busy(false);
                if (handedOff) reject(e);
                else showError(e);
              });
            })
          );
        }
      } catch (e) {
        if (!currentListing.signal.aborted && serial === generation) throw e;
      } finally {
        controller.signal.removeEventListener('abort', stop);
      }
    };
    const roots = async () => {
      const serial = ++generation;
      listing?.abort();
      rows.replaceChildren();
      status.textContent = 'Loading connections…';
      const connections = connectionsFrom(await request('connections/'));
      if (serial !== generation || controller.signal.aborted) return;
      status.textContent = 'Choose a connected folder';
      let count = 0;
      for (const connection of connections)
        for (const root of connection.roots) {
          const b = button(
            `${connection.provider} · ${root}`,
            () => void browse(connection, root, root, []).catch(showError)
          );
          b.disabled = connection.needs_reconnect;
          if (connection.needs_reconnect) b.title = 'Reconnect this provider in Connections';
          rows.append(b);
          count++;
        }
      if (!count) status.textContent = 'No selected cloud folders. Add one in Connections first.';
    };
    dialog.append(title, notice, status, rows, close);
    document.body.append(dialog);
    try {
      dialog.showModal();
      lifetime?.addEventListener('abort', closeForLifetime, { once: true });
      if (lifetime?.aborted) closeForLifetime();
      else void roots().catch(showError);
    } catch (e) {
      dialog.remove();
      reject(e);
    }
  });
}
