/** @license BSD-3-Clause */
import { useEffect } from 'react';
import { EMPTY, catchError, combineLatest, distinctUntilChanged, filter, from, map, of, switchMap } from 'rxjs';
import { account } from '$lib/manabi/client';
import { database } from '$lib/data/store';
import { readableToObservable } from '$lib/functions/rxjs/readable-to-observable';
import { goto } from '$runtime/navigation';
import { base } from '$runtime/paths';
export default function Home() {
  useEffect(() => {
    const subscription = combineLatest([database.lastItem$, readableToObservable(account)]).pipe(
      filter(([, state]) => state.status !== 'loading'),
      switchMap(([last]) => last ? from(database.getAccessibleLastItem()).pipe(map(accessible => accessible?.dataId === last.dataId ? `${base}/b?id=${last.dataId}` : `${base}/manage`), catchError(() => EMPTY)) : of(`${base}/manage`)),
      distinctUntilChanged()
    ).subscribe(path => { void goto(path, { replaceState: true }); });
    return () => subscription.unsubscribe();
  }, []);
  return <p role="status">Opening Library…</p>;
}
