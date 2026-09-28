# Gallery reveal lifetime QA

## Finding and repair

PR #84's retained Chromium Appearance capture shows two decoded image thumbnails,
but image 2 is hidden again after an explicit reveal and immediate gallery reopen.
This is not evidence that the raster itself failed to load.

The original gallery helper replaces a previously queued hidden observation with
`true`. It does not distinguish user intent from a later hidden observation. A
font-settlement/content-change callback rebinds the reader's image listeners;
those listeners observe their still-hidden inline DOM and enqueue `false` again.
The route's 250 ms queue can then hide the already revealed gallery image.

The existing transient picture snapshot now carries an explicit reveal marker.
The observation boundary consults that snapshot before queuing hidden state.
Normal visible loader defaults do not count as explicit reveals. There is no
new global registry, timer, storage or persistent model. Snapshot replacement
on a new load discards the intent. Other images remain hidden.

Keyboard activation has a second hazard: revealing the current image removes
the focused reveal button. Move focus to the existing viewer synchronously
before that removal, leaving keyboard paging available. No delayed handoff is
introduced; existing gallery teardown/navigation guards remain.

## Qualification

Nine added helper cases plus the four existing reveal cases pass locally under
Node 22.16.0. Strict standalone TypeScript checking of the helper also passes.
These are helper tests, not a complete Svelte or browser qualification.

Five independent built-app methods cover phone reveal/reopen, keyboard
reveal/focus/paging, real late-font settlement, new-book isolation and reload
without a changed book identity. The previous Rhea spoiler keyboard test runs
unchanged alongside them. The focused workflow runs both Chromium and WebKit
and preserves exact source/tree, logs, viewport captures, HTML and traces.

The late-font test delays one real bundled-font request, selects that font through
actual Reader settings, reveals an image, and then continues the real request.
A native MutationObserver establishes that reader rebinding occurred; the
negative assertion outlives the existing observation queue. It does not mock
font bytes, search results, storage or the rendering implementation.

Keep the PR draft until its actual-browser results and images are inspected.
Local browser navigation was unavailable in the preceding QA session; local
helper execution and direct inspection of CI captures are not physical Safari,
iOS, screen-reader or operating-system input acceptance. No award-level product
qualification is inferred from passing counts.

## Boundaries

No original files, account/source authority, database/schema, persistent
preferences, dependency pins, image decoding or paginator changes. The explicit
marker represents this gallery session's intent only; it does not introduce
persistent per-image spoiler settings or automatically reveal inline book images.
The search candidate in #84 remains an independent actively changing PR.
