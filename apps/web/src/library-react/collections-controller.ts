/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

/**
 * React/controller port of lib/library/collections-sheet.svelte; transactions retain their original guards.
 */

import {
  organization,
  createCollection,
  renameCollection,
  removeCollection,
  type Collection
} from '$lib/library/organization';
import { isFinished } from '$lib/library/completion';
import type { ShelfBook } from '$lib/library/view-model';
import { WANT_TO_READ_ID, wantToReadCollection } from '$lib/library/want-to-read';
import { ObservableController, readStore } from './observable-controller';
export class CollectionsController extends ObservableController {
  open = false;
  books: ShelfBook[] = [];
  active = 'books';
  onchoose!: (id: string) => void;
  editButton: HTMLElement | null = null;
  editing = false;
  dialogOpen = false;
  target!: Collection | undefined;
  deleting = false;
  name = '';
  error = '';
  busy = false;
  get wantToRead() {
    return wantToReadCollection(readStore(organization));
  }
  get customCollections() {
    return readStore(organization).collections.filter(
      (collection) => collection.id !== WANT_TO_READ_ID
    );
  }
  get finished() {
    return this.books.filter(isFinished).length;
  }
  choose(id: string) {
    this.onchoose(id);
    this.open = false;
  }
  edit(collection?: Collection, remove = false) {
    this.target = collection;
    this.deleting = remove;
    this.name = collection?.name || '';
    this.error = '';
    this.dialogOpen = true;
  }
  async submit() {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    try {
      if (this.deleting && this.target) {
        await removeCollection(this.target.id);
        if (this.active === this.target.id) this.choose('books');
      } else if (this.target) await renameCollection(this.target.id, this.name);
      else await createCollection(this.name);
      this.dialogOpen = false;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not update the collection.';
    } finally {
      this.busy = false;
    }
  }
  reconcile() {
    if (!this.open) this.editing = false;
  }
  start() {
    this.watch(organization);
  }
}
