/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import { page } from '$app/stores';
import { snippetItems, scope } from '../lib/snippets/service';
import { fold, snippetKey, snippetSearchTooLong, type SnippetHit } from '../lib/snippets/document';
import { searchBodies } from '../lib/snippets/search';

import type { SnippetSummary } from '../lib/snippets/summary';
import { ReaderController, type StoreValue } from '../reader-react/controller';

export interface ShelfProps {
  query?: string;
  members?: string[] | undefined;
  returnTo?: string | undefined;
  showEmpty?: boolean;
  source?: string;
  trashed?: boolean;
  layout?: 'list' | 'grid';
  sort?: 'edited' | 'read' | 'created' | 'title';
  selecting?: boolean;
  selected?: ReadonlySet<string>;
  onselect?: (ids: string[]) => void;
  onvisible?: (ids: string[]) => void;
  onchoose?: ((item: SnippetSummary) => void) | undefined;
}

export function createShelf(
  props: ShelfProps,
  _emit: (name: string, detail?: unknown) => void = () => {}
) {
  const __readerController = new ReaderController();
  let eligible: SnippetSummary[];
  let needle: string;
  let nextSignature: string;
  let visible: SnippetSummary[];
  let nextVisibleSignature: string;
  let $snippetItems: StoreValue<typeof snippetItems> = __readerController.read(snippetItems);
  let $page: StoreValue<typeof page> = __readerController.read(page);
  let query = props.query !== undefined ? props.query : '';
  let members: string[] | undefined = props.members !== undefined ? props.members : undefined;
  let returnTo: string | undefined = props.returnTo !== undefined ? props.returnTo : undefined;
  let showEmpty = props.showEmpty !== undefined ? props.showEmpty : true;
  let source = props.source !== undefined ? props.source : '';
  let trashed = props.trashed !== undefined ? props.trashed : false;
  let layout: 'list' | 'grid' = props.layout !== undefined ? props.layout : 'list';
  let sort: 'edited' | 'read' | 'created' | 'title' =
    props.sort !== undefined ? props.sort : 'edited';
  let selecting = props.selecting !== undefined ? props.selecting : false;
  let selected: ReadonlySet<string> = props.selected !== undefined ? props.selected : new Set();
  let onselect: (ids: string[]) => void =
    props.onselect !== undefined ? props.onselect : () => undefined;
  let onvisible: (ids: string[]) => void =
    props.onvisible !== undefined ? props.onvisible : () => undefined;
  let onchoose: ((item: SnippetSummary) => void) | undefined =
    props.onchoose !== undefined ? props.onchoose : undefined;
  let mounted = false,
    signature = '',
    visibleSignature = '',
    limit = 60,
    anchor = '';
  let stop: () => void = () => undefined;
  let hits = new Map<string, SnippetHit[]>(),
    searching = false,
    failed = 0,
    truncated = false;
  const sourceIdentity = (item: SnippetSummary) =>
    item.destination
      ? JSON.stringify([
          item.destination.source.owner,
          item.destination.source.id,
          item.destination.source.root
        ])
      : 'device';
  __readerController.effect(
    () => [$snippetItems, trashed, members, source, sourceIdentity],
    () => {
      __readerController.changed(
        (eligible = $snippetItems.filter(
          (item) =>
            !!item.trashedAt === trashed &&
            (!members || members.includes(snippetKey(item.id))) &&
            (!source || sourceIdentity(item) === source)
        ))
      );
    }
  );
  __readerController.effect(
    () => [query],
    () => {
      __readerController.changed((needle = fold(query.trim())));
    }
  );
  __readerController.effect(
    () => [query, trashed, eligible],
    () => {
      __readerController.changed(
        (nextSignature = JSON.stringify([
          query,
          trashed,
          eligible.map((item) => [item.key, item.revision])
        ]))
      );
    }
  );
  __readerController.effect(
    () => [mounted, nextSignature],
    () => {
      if (mounted && signature !== nextSignature) {
        __readerController.changed((signature = nextSignature));
        start();
      }
    }
  );
  __readerController.effect(
    () => [eligible, needle, hits, sort],
    () => {
      __readerController.changed(
        (visible = eligible
          .filter((item) => !needle || fold(item.title).includes(needle) || hits.has(item.id))
          .sort((a, b) =>
            sort === 'title'
              ? a.title.localeCompare(b.title, 'ja')
              : sort === 'read'
                ? (b.readAt ?? 0) - (a.readAt ?? 0)
                : sort === 'created'
                  ? b.createdAt - a.createdAt
                  : b.modifiedAt - a.modifiedAt
          ))
      );
    }
  );
  __readerController.effect(
    () => [visible],
    () => {
      __readerController.changed(
        (nextVisibleSignature = JSON.stringify(visible.map((item) => item.id)))
      );
    }
  );
  __readerController.effect(
    () => [nextVisibleSignature, onvisible, visible],
    () => {
      if (nextVisibleSignature !== visibleSignature) {
        __readerController.changed((visibleSignature = nextVisibleSignature));
        onvisible(visible.map((item) => item.id));
      }
    }
  );
  __readerController.effect(
    () => [selecting],
    () => {
      if (!selecting && anchor) __readerController.changed((anchor = ''));
    }
  );
  function start() {
    stop();
    __readerController.changed((hits = new Map()));
    __readerController.changed((failed = 0));
    __readerController.changed((truncated = false));
    __readerController.changed((limit = 60));
    __readerController.changed((searching = false));
    if (!query.trim() || snippetSearchTooLong(query)) return;
    try {
      __readerController.changed(
        (stop = searchBodies(
          query,
          eligible.map((item) => item.id),
          scope(),
          (state) => {
            __readerController.changed((hits = state.hits));
            __readerController.changed((searching = state.busy));
            __readerController.changed((failed = state.failed));
            __readerController.changed((truncated = state.truncated));
          }
        ))
      );
    } catch {
      __readerController.changed((failed = 1));
    }
  }
  function url(item: SnippetSummary, hit?: SnippetHit) {
    const q = new URLSearchParams({
      id: item.id,
      returnTo: returnTo ?? $page.url.pathname + $page.url.search
    });
    if (hit) q.set('locator', JSON.stringify(hit.locator));
    return `/snippets?${q}` as const;
  }
  function choose(event: MouseEvent, item: SnippetSummary) {
    if (!selecting && !event.shiftKey && !event.metaKey && !event.ctrlKey && !onchoose) return;
    event.preventDefault();
    if (onchoose) {
      onchoose(item);
      return;
    }
    const next = new Set(selected);
    if (event.shiftKey && anchor) {
      const a = visible.findIndex((i) => i.id === anchor),
        b = visible.findIndex((i) => i.id === item.id);
      if (a >= 0 && b >= 0) {
        for (const entry of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(entry.id);
      } else {
        next.add(item.id);
        __readerController.changed((anchor = item.id));
      }
    } else {
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      __readerController.changed((anchor = item.id));
    }
    onselect([...next]);
  }
  __readerController.onMount(() => {
    __readerController.changed((mounted = true));
    return () => {
      __readerController.changed((mounted = false));
      stop();
    };
  });
  __readerController.observeSource(
    () => snippetItems,
    (value) => {
      $snippetItems = value;
    }
  );
  __readerController.observeSource(
    () => page,
    (value) => {
      $page = value;
    }
  );
  const api = {
    controller: __readerController,
    start,
    url,
    choose,
    get query() {
      return query;
    },
    set query(nextValue: typeof query) {
      if (Object.is(query, nextValue)) return;
      query = nextValue;
      __readerController.invalidate();
    },
    get members() {
      return members;
    },
    set members(nextValue: typeof members) {
      if (Object.is(members, nextValue)) return;
      members = nextValue;
      __readerController.invalidate();
    },
    get returnTo() {
      return returnTo;
    },
    set returnTo(nextValue: typeof returnTo) {
      if (Object.is(returnTo, nextValue)) return;
      returnTo = nextValue;
      __readerController.invalidate();
    },
    get showEmpty() {
      return showEmpty;
    },
    set showEmpty(nextValue: typeof showEmpty) {
      if (Object.is(showEmpty, nextValue)) return;
      showEmpty = nextValue;
      __readerController.invalidate();
    },
    get source() {
      return source;
    },
    set source(nextValue: typeof source) {
      if (Object.is(source, nextValue)) return;
      source = nextValue;
      __readerController.invalidate();
    },
    get trashed() {
      return trashed;
    },
    set trashed(nextValue: typeof trashed) {
      if (Object.is(trashed, nextValue)) return;
      trashed = nextValue;
      __readerController.invalidate();
    },
    get layout() {
      return layout;
    },
    set layout(nextValue: typeof layout) {
      if (Object.is(layout, nextValue)) return;
      layout = nextValue;
      __readerController.invalidate();
    },
    get sort() {
      return sort;
    },
    set sort(nextValue: typeof sort) {
      if (Object.is(sort, nextValue)) return;
      sort = nextValue;
      __readerController.invalidate();
    },
    get selecting() {
      return selecting;
    },
    set selecting(nextValue: typeof selecting) {
      if (Object.is(selecting, nextValue)) return;
      selecting = nextValue;
      __readerController.invalidate();
    },
    get selected() {
      return selected;
    },
    set selected(nextValue: typeof selected) {
      if (Object.is(selected, nextValue)) return;
      selected = nextValue;
      __readerController.invalidate();
    },
    get onselect() {
      return onselect;
    },
    set onselect(nextValue: typeof onselect) {
      if (Object.is(onselect, nextValue)) return;
      onselect = nextValue;
      __readerController.invalidate();
    },
    get onvisible() {
      return onvisible;
    },
    set onvisible(nextValue: typeof onvisible) {
      if (Object.is(onvisible, nextValue)) return;
      onvisible = nextValue;
      __readerController.invalidate();
    },
    get onchoose() {
      return onchoose;
    },
    set onchoose(nextValue: typeof onchoose) {
      if (Object.is(onchoose, nextValue)) return;
      onchoose = nextValue;
      __readerController.invalidate();
    },
    get mounted() {
      return mounted;
    },
    set mounted(nextValue: typeof mounted) {
      if (Object.is(mounted, nextValue)) return;
      mounted = nextValue;
      __readerController.invalidate();
    },
    get signature() {
      return signature;
    },
    set signature(nextValue: typeof signature) {
      if (Object.is(signature, nextValue)) return;
      signature = nextValue;
      __readerController.invalidate();
    },
    get visibleSignature() {
      return visibleSignature;
    },
    set visibleSignature(nextValue: typeof visibleSignature) {
      if (Object.is(visibleSignature, nextValue)) return;
      visibleSignature = nextValue;
      __readerController.invalidate();
    },
    get limit() {
      return limit;
    },
    set limit(nextValue: typeof limit) {
      if (Object.is(limit, nextValue)) return;
      limit = nextValue;
      __readerController.invalidate();
    },
    get anchor() {
      return anchor;
    },
    set anchor(nextValue: typeof anchor) {
      if (Object.is(anchor, nextValue)) return;
      anchor = nextValue;
      __readerController.invalidate();
    },
    get stop() {
      return stop;
    },
    set stop(nextValue: typeof stop) {
      if (Object.is(stop, nextValue)) return;
      stop = nextValue;
      __readerController.invalidate();
    },
    get hits() {
      return hits;
    },
    set hits(nextValue: typeof hits) {
      if (Object.is(hits, nextValue)) return;
      hits = nextValue;
      __readerController.invalidate();
    },
    get searching() {
      return searching;
    },
    set searching(nextValue: typeof searching) {
      if (Object.is(searching, nextValue)) return;
      searching = nextValue;
      __readerController.invalidate();
    },
    get failed() {
      return failed;
    },
    set failed(nextValue: typeof failed) {
      if (Object.is(failed, nextValue)) return;
      failed = nextValue;
      __readerController.invalidate();
    },
    get truncated() {
      return truncated;
    },
    set truncated(nextValue: typeof truncated) {
      if (Object.is(truncated, nextValue)) return;
      truncated = nextValue;
      __readerController.invalidate();
    },
    get sourceIdentity() {
      return sourceIdentity;
    },
    get eligible() {
      return eligible;
    },
    set eligible(nextValue: typeof eligible) {
      if (Object.is(eligible, nextValue)) return;
      eligible = nextValue;
      __readerController.invalidate();
    },
    get needle() {
      return needle;
    },
    set needle(nextValue: typeof needle) {
      if (Object.is(needle, nextValue)) return;
      needle = nextValue;
      __readerController.invalidate();
    },
    get nextSignature() {
      return nextSignature;
    },
    set nextSignature(nextValue: typeof nextSignature) {
      if (Object.is(nextSignature, nextValue)) return;
      nextSignature = nextValue;
      __readerController.invalidate();
    },
    get visible() {
      return visible;
    },
    set visible(nextValue: typeof visible) {
      if (Object.is(visible, nextValue)) return;
      visible = nextValue;
      __readerController.invalidate();
    },
    get nextVisibleSignature() {
      return nextVisibleSignature;
    },
    set nextVisibleSignature(nextValue: typeof nextVisibleSignature) {
      if (Object.is(nextVisibleSignature, nextValue)) return;
      nextVisibleSignature = nextValue;
      __readerController.invalidate();
    },
    get $snippetItems() {
      return $snippetItems;
    },
    get $page() {
      return $page;
    },
    updateProps(next: Record<string, unknown>) {
      if ('query' in next) api.query = (next.query === undefined ? '' : next.query) as typeof query;
      if ('members' in next)
        api.members = (next.members === undefined ? undefined : next.members) as typeof members;
      if ('returnTo' in next)
        api.returnTo = (next.returnTo === undefined ? undefined : next.returnTo) as typeof returnTo;
      if ('showEmpty' in next)
        api.showEmpty = (next.showEmpty === undefined ? true : next.showEmpty) as typeof showEmpty;
      if ('source' in next)
        api.source = (next.source === undefined ? '' : next.source) as typeof source;
      if ('trashed' in next)
        api.trashed = (next.trashed === undefined ? false : next.trashed) as typeof trashed;
      if ('layout' in next)
        api.layout = (next.layout === undefined ? 'list' : next.layout) as typeof layout;
      if ('sort' in next)
        api.sort = (next.sort === undefined ? 'edited' : next.sort) as typeof sort;
      if ('selecting' in next)
        api.selecting = (next.selecting === undefined ? false : next.selecting) as typeof selecting;
      if ('selected' in next)
        api.selected = (next.selected === undefined ? new Set() : next.selected) as typeof selected;
      if ('onselect' in next)
        api.onselect = (
          next.onselect === undefined ? () => undefined : next.onselect
        ) as typeof onselect;
      if ('onvisible' in next)
        api.onvisible = (
          next.onvisible === undefined ? () => undefined : next.onvisible
        ) as typeof onvisible;
      if ('onchoose' in next)
        api.onchoose = (next.onchoose === undefined ? undefined : next.onchoose) as typeof onchoose;
    }
  };
  return api;
}
