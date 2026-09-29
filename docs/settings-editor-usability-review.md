# Settings editor and compact workspace review

Base: `2c4900c24c25803d3c27d7bf2d96000d75b09a3b`, after merged #72.
This follow-up retains the Apple.com action hierarchy and App Store Connect-style
workspace navigation. It does not reopen #72, change source/account authority,
or modify database schemas, encryption algorithms, sync policy or statistics.

## Reproduced in the current application evidence

Main Appearance run 36500184358 was cancelled before completing its full matrix.
Its saved Chromium logs nevertheless identify two concrete production failures:

- Opening the advanced storage editor throws Svelte `props_invalid_value`.
  The shared Input has a nullable bindable reference default; the editor supplied
  undefined element references. Initialize these references to null. Passwords
  are now bound private draft values rather than imperatively refilled whenever
  a field mounts, preserving them when the local/remote controls are recreated.
- The tracking cleanup row extends to x=448 in a 320px viewport at 200% text.
  Its switch and destructive action now wrap with a real gap instead of sharing
  an unwrappable row plus a leading margin.

The 320px/200% Settings screenshot also shows three stacked header rows. The
compact header now reserves separate 44px Back and Navigate targets around the
full-size title. On wider screens Back text and full primary navigation remain.
The navigation control retains its existing accessible name, sheet side, routes,
focus restoration and active-page semantics. This is a contextual opt-in, not
another global button-shape change.

## Form behavior

The editor has one native form and one scroll owner (the existing dialog). Enter
submits using the same validation/save path as Save; IME confirmation does not
submit. Editing a field clears stale custom validity and the current error.
During save, a guard rejects duplicate submissions, the native fieldset disables
editing, and Cancel/Save are disabled. The parent already disallows X, outside
and Escape dismissal for this resolver-backed editor. Failed persistence restores
the editable draft and surfaces an error; it is not converted to success. A
removed component cannot dispatch a late close into a newer dialog.

The directory picker keeps its user-gesture invocation. Its controls are disabled
while selection resolves, and cancelling the picker retains the existing choice.
No claim is made to roll back an already committed save or filesystem creation.

## Tests and qualification boundary

Five new built-app cases cover repeated opening/cancellation, native required and
password-match validation, field recreation, duplicate submission during an
actual held IndexedDB write, duplicate-name failure/correction, compact/desktop
header geometry and navigation, and cleanup reflow without changing history.
The test OAuth strings are inert fixture values. No live provider is contacted.
The duplicate-submit case observes the native add method without replacing it.

Existing Settings regression selectors now target actual category links, not the
old button role. The gallery
setup uses the existing keyboard reveal helper rather than clicking intentionally
idle-hidden reader chrome. Gallery focus restoration now targets the stable reader control rather than its
state-dependent Show/Hide label. Existing gesture and focus assertions are retained.

The dedicated Settings editor workflow checks the actual Svelte components,
builds `/reader-web`, and runs the five new cases plus the existing six Settings
control and three gallery cases in Chromium and WebKit. This avoids losing focused evidence when
the larger inherited Appearance matrix exceeds its own time budget. That matrix
and all existing suites remain enabled. The storage editor is newly included in
explicit component lint. Results are recorded on the PR; authored tests and
baseline passes are not new-head execution evidence. Physical Safari/iOS remains
separate from automated WebKit.


## Protected-source unlock follow-up

The older protected-source prompt bypassed the shared Settings form controls and
had a correctness problem: successful decryption called its close path and then
fell through to the no-secret continuation close. Promise resolution masks most
double-resolution effects, but the component could still dispatch two closes.

The unlock prompt now has one native form, one in-flight operation, shared
Input/Button controls and the same settle-once destruction contract used by the
other resolver-backed dialogs. An unresolved removal resolves cancellation.
Wrong-password errors remain editable and are announced with `role="alert"`;
the previous shake animation is removed. Popup-blocker continuation still works
without a password and returns the existing empty-client continuation sentinel.

Focused unit cases cover successful and no-secret settlement, retry after decrypt
failure, duplicate-submit fencing, destruction cancellation and reader-shortcut
suppression lifetime. The built Settings suite creates a real encrypted source,
reopens it at 320px/200% text, exercises wrong/correct passwords and verifies the
single edit dialog after successful unlock.
