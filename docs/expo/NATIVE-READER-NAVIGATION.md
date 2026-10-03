# Native reader route lifetime

The Android reader uses one persistent DOM owner. A native route transition never unmounts that owner. `RuntimeProvider.native.tsx` and `native-reader-navigation.ts` coordinate the route and the admitted DOM reading identity.

## Admission and routes

- A cold `/b?id=42` route opens the positive safe-integer book ID using the current DOM account authority. `/b?snippet=<uuid>` opens an existing, non-trashed snippet in the current profile. IDs are not URLs, filesystem paths, account credentials, or import capabilities.
- Empty, repeated/array, ambiguous book-plus-snippet, noncanonical decimal, unsafe-number, and malformed UUID parameters render an actionable error. DOM admission remains the authoritative ownership and content check.
- A Library `open` containing its selection token admits the DOM reader before pushing `/b`. The route reuses that admission. Snippets `read` actions similarly reuse their returned `readerId`; the route does not issue another read action or discard the admitted revision.
- Duplicate route effects, including React StrictMode restart, share an in-flight admission. A completed admission for the same identity and account is reused.
- A newer opening, Back, account change, or teardown invalidates older native continuations. The DOM independently fences async loads before installing them. Native coalescing does not replace DOM content/profile validation.

## Leaving the reader

- Close requests do not expire while a person is considering a confirmation dialog. Provider teardown or accepted ownership retirement rejects pending replies with an unknown-outcome reconciliation error; commands are never replayed. Other bridge methods retain their bounded acknowledgement timeouts.
- Android hardware Back and Expo Router's `usePreventRemove` both use the same coalesced close operation. Repeated input does not dispatch duplicate navigation actions. The route guard uses the pinned SDK's public `expo-router/react-navigation` export and re-dispatches the original action after approval.
- Native pushes, URL/deep-link changes, and replace/reset observations also pass through close. The existing reader performs confirmation, bookmark/tracker saving, snippet-position flushing, and synchronization before approving exit. The DOM stays visible while this is pending, even when another native route is underneath it.
- A cancelled or failed close retains the old reader and restores its route; the target is not forwarded to the virtual DOM page. Switching to another reader follows the same close path before admitting the replacement.
- DOM toolbar/router navigation must call `onNavigate` only after its own close succeeds. That callback is an acknowledgement, so native clears its admission without issuing a second close.
- Successful non-reader route changes continue to update the DOM's virtual page through the bounded `route` command. Native `/b` activation never overwrites the DOM reader's own book/snippet query.

## Ownership and teardown

A session/account-epoch change revokes native admission and exits to Library or Snippets. The old URL is not replayed into the new account during the intermediate render. Snapshot revisions and epochs cannot move backward; a bounded lifetime set rejects snapshots from already-retired sessions rather than allowing an old host to reclaim ownership. If that bound is exceeded, the provider fails closed and asks for an app restart.

StrictMode's effect restart preserves the bridge and reader admission. Actual unmount invalidates navigation continuations, removes native listeners, and disposes pending bridge work.

## Executable evidence

Run with the project's pinned Node 24.21 runtime:

- `node --test test/expo/native-route.test.mjs`: real navigation service tests with delayed command promises, cancellation/failure, duplicate input, reordered completions, and account changes
- `node --test test/expo/native-route-lifecycle.test.mjs`: mounted React provider and reader route under StrictMode, using the real bridge client and narrowly mocked native/Expo host seams
- `node test/expo/native-route-typecheck.mjs`: scoped semantic checking under the actual strict Expo TypeScript configuration, including SDK hook types

These tests exercise service and React lifecycle behavior. They do not claim Android device qualification for physical Back gestures, OS deep-link delivery, process death, WebView persistence, or bookmark/tracker storage. Those still require the supported Android/WebView acceptance matrix. Android and web remain the only Expo targets.
