/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * React/controller port of lib/search/dictionary-search.svelte; transactions retain their original guards.
 */

import { queryTask, type SearchState } from '$lib/search/query-task.mjs';
import {
  dictionaryLease,
  type DictionaryResult,
  type DictionaryRuntime,
  type DictionaryStatus,
  type RecommendedDictionary
} from '$lib/search/dictionary-runtime';
import { ObservableController } from './observable-controller';
export class DictionaryController extends ObservableController {
  query = '';
  full = false;
  expand: () => void = () => {};
  onquery: (query: string) => void = () => {};
  mounted = false;
  signature = '';
  attempt = 0;
  installing = false;
  retryableError = false;
  statusSignature = '';
  statusAttempt = 0;
  statusLoading = false;
  statusError = '';
  managing = '';
  pendingDelete = '';
  setupOpen = false;
  recommendationsLoading = false;
  recommendationsError = '';
  message = '';
  state: SearchState<DictionaryResult> = { state: 'idle' };
  dictionaryStatus!: DictionaryStatus | undefined;
  recommendations!: RecommendedDictionary[] | undefined;
  runtime!: DictionaryRuntime | undefined;
  lease!: ReturnType<typeof dictionaryLease>;
  installController!: AbortController | undefined;
  statusController!: AbortController | undefined;
  manageController!: AbortController | undefined;
  recommendationsController!: AbortController | undefined;
  task = queryTask<DictionaryResult>((next) => {
    this.state = next;
    if (next.state === 'error') this.retryableError = true;
    if (this.full && next.state === 'ready' && next.value?.dictionaryCount === 0)
      this.setupOpen = true;
  });
  get nextSignature() {
    return JSON.stringify([this.query, this.full, this.attempt, this.installing]);
  }
  get nextStatusSignature() {
    return JSON.stringify([this.full, this.statusAttempt]);
  }
  get disabledTitles() {
    return new Set(this.dictionaryStatus?.preferences.disabled ?? []);
  }
  search() {
    this.task.stop();
    this.state = { state: 'idle' };
    this.retryableError = false;
    if (!this.query.trim() || this.installing) return;
    if ([...this.query].length > 256) {
      this.state = {
        state: 'error',
        error:
          'Use a dictionary query of 256 characters or fewer. Titles and content can use longer queries.'
      };
      return;
    }
    const needle = this.query,
      detailed = this.full;
    this.task.start(async (signal, publish) => {
      const opened = await this.lease.get();
      signal.throwIfAborted();
      this.runtime = opened;
      const value = await opened.client.search(needle, detailed, { signal });
      signal.throwIfAborted();
      if (value.version !== 1 || value.query !== needle.trim() || typeof value.prefix !== 'boolean')
        throw new Error('The dictionary returned a mismatched search response.');
      publish({ state: 'ready', value });
    });
  }
  reopenRuntime() {
    this.task.stop();
    this.statusController?.abort();
    this.statusController = undefined;
    this.statusLoading = false;
    this.lease.release();
    this.lease = dictionaryLease();
    this.runtime = undefined;
    this.attempt++;
    this.statusAttempt++;
  }
  retry() {
    this.reopenRuntime();
  }
  async refreshStatus() {
    this.statusController?.abort();
    const controller = (this.statusController = new AbortController());
    this.statusLoading = true;
    this.statusError = '';
    try {
      const opened = await this.lease.get();
      controller.signal.throwIfAborted();
      const next = await opened.client.status({ signal: controller.signal });
      controller.signal.throwIfAborted();
      if (this.mounted && this.full) this.dictionaryStatus = next;
    } catch (error) {
      if (!controller.signal.aborted && this.mounted && this.full)
        this.statusError =
          error instanceof Error ? error.message : 'Installed dictionaries could not be loaded.';
    } finally {
      if (this.statusController === controller) {
        this.statusController = undefined;
        if (this.mounted) this.statusLoading = false;
      }
    }
  }
  async toggleDictionary(title: string, enabled: boolean) {
    if (this.managing || this.installing || this.statusLoading) return;
    this.managing = title;
    this.pendingDelete = '';
    this.message = enabled ? `Enabling ${title}…` : `Disabling ${title}…`;
    this.task.stop();
    try {
      const opened = await this.lease.get();
      const next = await opened.client.setEnabled(title, enabled);
      if (!this.mounted) return;
      this.dictionaryStatus = next;
      this.message = `${enabled ? 'Enabled' : 'Disabled'} ${title}.`;
      this.reopenRuntime();
    } catch (error) {
      if (this.mounted)
        this.message =
          error instanceof Error ? error.message : 'Dictionary settings could not be saved.';
    } finally {
      if (this.mounted) this.managing = '';
    }
  }
  async deleteDictionary(title: string) {
    if (this.managing || this.installing || this.statusLoading || this.pendingDelete !== title)
      return;
    this.managing = title;
    this.message = `Deleting ${title}…`;
    this.task.stop();
    const controller = (this.manageController = new AbortController());
    try {
      const opened = await this.lease.get();
      controller.signal.throwIfAborted();
      const next = await opened.client.deleteDictionary(title, { signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!this.mounted) return;
      this.dictionaryStatus = next;
      this.pendingDelete = '';
      this.message = `Deleted ${title}.`;
      this.reopenRuntime();
    } catch (error) {
      if (!controller.signal.aborted && this.mounted)
        this.message = error instanceof Error ? error.message : 'Dictionary could not be deleted.';
    } finally {
      if (this.manageController === controller) this.manageController = undefined;
      if (this.mounted) this.managing = '';
    }
  }
  definitions(node: HTMLElement, value: DictionaryResult) {
    const dispose =
      this.runtime && value.lookup
        ? this.runtime.render(node, value.lookup, this.runtime.client, this.onquery)
        : undefined;
    return {
      destroy() {
        dispose?.();
      }
    };
  }
  async install(file?: File) {
    if (this.installing || this.managing) return;
    this.installing = true;
    this.message = 'Preparing dictionary…';
    const controller = (this.installController = new AbortController());
    let imported = false;
    try {
      const opened = await this.lease.get();
      controller.signal.throwIfAborted();
      const blob =
        file ??
        (await opened.installDefault({
          signal: controller.signal,
          onProgress: (loaded, total) => {
            if (this.mounted)
              this.message = `Downloading dictionary… ${Math.floor((loaded / total) * 100)}%`;
          }
        }));
      if (blob.size > 256 * 1024 * 1024 || !blob.size)
        throw new Error('Choose a dictionary ZIP between 1 byte and 256 MiB.');
      this.message = 'Importing dictionary…';
      const result = await opened.client.importDictionary(blob, {
        signal: controller.signal,
        onProgress: () => {}
      });
      imported = true;
      if (!file) await opened.client.setDefault('installed', result.summary.title);
      if (this.mounted) this.setupOpen = false;
      if (this.mounted)
        this.message = result.cancelledAfterCommit
          ? 'The dictionary finished installing before cancellation.'
          : `Installed ${result.summary.title}.${result.warnings.length ? ' Some entries could not be imported.' : ''}`;
    } catch (error) {
      if (this.mounted)
        this.message = error instanceof Error ? error.message : 'Dictionary installation failed.';
    } finally {
      if (this.mounted) {
        if (imported) {
          // The current translator can retain stale headword fields after a
          // commit. Reopen against the durable dictionary before searching.
          this.reopenRuntime();
        }
        this.installing = false;
        if (!imported) {
          this.attempt++;
          this.statusAttempt++;
        }
      }
      if (this.installController === controller) this.installController = undefined;
    }
  }
  chooseArchive(event: { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.install(file);
  }
  async loadRecommendations() {
    if (this.recommendations || this.recommendationsLoading) return;
    this.recommendationsController?.abort();
    const controller = (this.recommendationsController = new AbortController());
    this.recommendationsLoading = true;
    this.recommendationsError = '';
    try {
      const opened = await this.lease.get();
      const items = await opened.recommendations({ signal: controller.signal });
      controller.signal.throwIfAborted();
      if (this.mounted) this.recommendations = items;
    } catch (error) {
      if (!controller.signal.aborted && this.mounted)
        this.recommendationsError =
          error instanceof Error ? error.message : 'Recommended dictionaries could not be loaded.';
    } finally {
      if (this.recommendationsController === controller) {
        this.recommendationsController = undefined;
        if (this.mounted) this.recommendationsLoading = false;
      }
    }
  }
  recommendationToggle(event: { currentTarget: HTMLDetailsElement }) {
    const details = event.currentTarget;
    if (details instanceof HTMLDetailsElement && details.open) void this.loadRecommendations();
  }
  reconcile() {
    if (this.mounted && this.signature !== this.nextSignature) {
      this.signature = this.nextSignature;
      this.search();
    }
    if (this.mounted && this.statusSignature !== this.nextStatusSignature) {
      this.statusSignature = this.nextStatusSignature;
      if (this.full) void this.refreshStatus();
      else {
        this.statusController?.abort();
        this.statusError = '';
        this.pendingDelete = '';
      }
    }
  }
  start() {
    this.watch();
    return (() => {
      this.lease = dictionaryLease();
      this.signature = '';
      this.statusSignature = '';
      this.mounted = true;
      return () => {
        this.mounted = false;
        this.task.stop();
        this.installController?.abort();
        this.statusController?.abort();
        this.manageController?.abort();
        this.recommendationsController?.abort();
        this.lease.release();
      };
    })();
  }
}
