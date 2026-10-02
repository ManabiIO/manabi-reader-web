# Shared Android/web UI convergence

The target is **one nonreader screen composition, interaction model and branded
style vocabulary** for Android and web. Android-specific controls and system
adapters are justified by actual UX or platform capabilities, not by separate
page implementations. The released Svelte application's resulting design and
functionality are the acceptance criteria. Retaining shadcn is not a requirement.
The reader and Yomitan remain the explicitly web-rendered surface. Expo still
admits Android and web only; Apple applications remain separate.

## Current checkpoint is not the target

At `1de0a54608086bc4fcae448cf59501f6381bfa56`, ten nonreader route names (including
the index redirect) have twenty platform-specific entry files. None select the
same shared screen composition. The substantial Library, Settings, Snippets and
Statistics presentations are duplicated. Native account/status is limited;
TTU/shared-library/video routes still contain explicit capability gaps.

Only four source modules import `@expo/ui`, all in the native graph. The shared
Expo Router shell, domain algorithms, persistent DOM owner and typed bridge are
real reuse, but do **not** establish shared screen UI or full web/native parity.
The parallel presentations are migration reference, not the final architecture.

## Component policy

Use owned RN/RNW layout, text, surfaces and branded interactions with the existing
semantic theme, typography, spacing, radius and state colors. Use SDK 57 Expo UI
universal controls where their actual API satisfies the required behavior.
Universal controls share an API across Android Compose and web DOM/RNW; that is
not a promise of identical default geometry or styling. Inspect the installed
version and qualify both outputs. [Expo UI universal](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/)

Keep `Host`/`RNHostView` boundaries explicit. An RN container inside an Expo UI host
changes the rendering boundary; nested universal controls need their own host.
Do not force the entire branded page into Compose or rely on native-only
modifiers to reproduce web design. [Universal Host](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/host/)

A small owned primitive layer supplies actions, fields, choices, navigation,
modal/sheet/popover behavior, semantic headings and layout. A web leaf may retain
an actual anchor/form/dialog/table or CSS-grid/focus behavior where RNW cannot
represent its contract. Android Back, keyboard, picker, sheet, touch-target,
clipboard and file-chooser behavior may have corresponding bounded adapters.
These leaves must not own feature queries, history, export decisions or a second
screen state machine. No wholesale third-party UI framework is required.

## First complete route: Statistics

Both route entries now select
`features/statistics/StatisticsScreen.tsx` and its common controller. Typed ports
supply complete data and capabilities: the web port calls the existing DOM-owned
domain in-process; Android uses the existing account/epoch-fenced bridge. Ports
return data/outcomes, never old whole-page JSX.

The shared source uses actual SDK 57 universal Checkbox, Switch, Picker and
Android Icon controls within small `Host` boundaries. Branded layout, toolbar,
summary, filters, settings, calendar and interaction state are common RN/RNW.
Web form, focus, grid, link and nonmodal-popover semantics live in bounded leaves,
not a second page. Android icon XML is an asset type in the installed Metro
configuration; production export and packaged rendering still need qualification.

Preserve the full web inventory:

- All ten measurement sources, three aggregation modes, date/week-start/title
  and identity filters, sorting, pagination and details
- Summary and heatmap views, goals, day/week keyboard navigation, selection and
  nonmodal day details
- Row creation/edit/reset/delete and range/book history confirmation, with
  current account/identity/revision checks at the existing transaction boundary
- Clipboard logs, selected/all TTU exports with ambiguous identity refusal, and
  raw recovery JSON
- Responsive geometry, light/dark appearance, enlarged text, focus return,
  keyboard behavior, cancellation, errors and durable operation ownership

The earlier native projection's 200-book/10,000-row limits must not become
product-wide web limits. Native transport uses bounded, ordered, expiring
continuations tied to the original scope/query/projection. Missing or stale
pages are not complete results. Continuations cannot repeat migrations or
mutations. Any internal full-history read or memory limit must be documented
rather than described as fully streaming. Native capability gaps, including
ownerless goals/global recovery, remain explicit within the shared composition;
the web adapter retains its existing supported workflows.

The reviewed Library-to-Statistics handoff remains canonical-key scoped,
including issued legacy UUIDs. Identity validation occurs inside the existing
migration transaction before history/receipt writes; uppercase valid hashes use
the shared normalized comparison. Shared UI must not remove these guards.

## Qualification, then remaining routes

Replace tests that enforce opposite presentation-directory bans with positive
assertions that Android and web execute the same Statistics screen/controller.
Continue to forbid browser storage/renderers in the native shell and native
system/owner adapters in the web route. Pure algorithms can be shared regardless
of their historical directory name.

Retain the aggregation oracle, domain/mutation tests and existing behavioral
assertions. Exercise the actual production shared controller and ports under
StrictMode, account ABA, route replacement and pending confirmations. Add actual
RNW/universal primitive semantics and complete exported-app browser checks;
shims alone do not qualify the installed renderer. Preserve the existing
keyboard, role, form, geometry and focus assertions. Packaged Android controls
remain a separate runtime gate.

After Statistics, converge Settings without reducing it to scalar fields, then
Library/shared shell, Snippets and account/import/shared-library flows. The
snippet rich-content editing surface may be a bounded DOM/Tiptap adapter for
selection/ruby/IME, with shared workspace, toolbar, destination and recovery
composition around it. Optional video requires domain/view separation before
its route is counted as shared. File/auth/storage capability differences are
explicit ports, not alternate complete pages.

All work remains in the same unmerged draft PR. Reuse the existing three-job
standard-runner [zero-remote-storage CI plan](CI-COVERAGE.md), with no new artifact
uploads/cache writes or paid resources. A successful export or source test is
not full UI parity; report evidence for the exact source head.
