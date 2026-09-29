<script lang="ts">
  import { goto } from '$app/navigation';
  import { pagePath } from '$lib/data/env';
  import { database } from '$lib/data/store';
  import { formatPageTitle } from '$lib/functions/format-page-title';
  import { observe } from '$lib/functions/rxjs/use-observable';
  import { readableToObservable } from '$lib/functions/rxjs/readable-to-observable';
  import { account } from '$lib/manabi/client';
  import {
    EMPTY,
    catchError,
    combineLatest,
    distinctUntilChanged,
    filter,
    from,
    map,
    of,
    switchMap,
    tap
  } from 'rxjs';

  const autoNavigate$ = combineLatest([
    database.lastItem$,
    readableToObservable(account)
  ]).pipe(
    // An unresolved login must not be mistaken for an anonymous profile.
    filter(([, state]) => state.status !== 'loading'),
    switchMap(([lastItem]) => {
      if (!lastItem) return of(`${pagePath}/manage`);
      return from(database.getAccessibleLastItem()).pipe(
        map((accessible) =>
          accessible?.dataId === lastItem.dataId
            ? `${pagePath}/b?id=${lastItem.dataId}`
            : `${pagePath}/manage`
        ),
        // Account/profile revocation emits another outer value. Do not let the
        // stale in-flight ownership read terminate the navigation stream.
        catchError(() => EMPTY)
      );
    }),
    distinctUntilChanged(),
    tap(goto)
  );
</script>

<svelte:head>
  <title>{formatPageTitle('Home')}</title>
</svelte:head>

<div use:observe={autoNavigate$}></div>
