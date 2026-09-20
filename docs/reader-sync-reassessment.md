# Reader integration reassessment

## Scope decision

Do not add automatic reuse of existing TTU cloud libraries or broaden Google /
Microsoft scopes for that purpose. TTU compatibility is a one-time migration
proposal, separate from the ordinary Manabi cloud/local storage path. This change
does not alter naming or remove existing compatibility features/data.

Proposed migration: export a library backup in TTU, then choose **Import from TTU**
in Manabi. Accept the exported ZIP first; an optional locally selected downloaded
TTU folder can use the same read-only importer. Preview supported books, bookmarks,
and day statistics. Reuse the bounded archive reader, sanitize imported content,
remap browser-local IDs, and retain the decoded book package instead of claiming
to reconstruct its original EPUB. Select a Manabi destination after import. Do
not import cloud credentials or copy TTU source bindings. Keep a migration receipt
keyed by a canonical source-book/content digest so repeating an import is a no-op,
not another statistics contribution. Different content with the same title must
be a separate book or an explicit conflict, not an overwrite. Preserve the source
and give a per-book completion/error summary. Native and Web should consume the
same migrated representation; this is not a promise of continuing TTU sync.

## Confirmed defects and fixes

### Missing remote state is not a reset

Previously `value: null` from an absent state file was changed into an empty state,
then merged with the previously synchronized baseline. If local data had not
changed, this deleted local bookmarks and statistics. A temporarily missing
cloud-synced file and deliberate reset are not equivalent.

A missing remote file with history in the last acknowledged baseline now leaves
local history and that baseline intact and offers explicit restoration from this
device. The existing conflict UI is reused: an empty available-remote-versions
list correctly offers no remote copy to select. First-time writing with an empty
baseline still works. An actual remote empty document remains a valid reset. An
explicit local reset followed by recovery writes an empty document rather than
pretending an absent file was successfully saved. No new ledger or schema is
introduced.

### Delayed errors must respect account generation

The HTTP client already checked account generation after success bodies, but not
after reading an error body. A delayed 401/account-changed response could clear a
newer account that signed in after the headers arrived. Recheck generation after
the asynchronous error-body read and before invalidating account state. This does
not retry failed writes or broaden auth permissions. The server companion tests
this with a genuine Django rejection streamed in two parts, not a mocked fetch.

## Review conclusions and launch boundaries

Keep the static frontend, optional account use, same-origin CSRF/session checks,
server-side credential encryption, one-use OAuth state, bounded provider adapters,
conditional cloud writes and append-only local revisions. These are useful
boundaries, not reasons to add another authority/coordinator layer.

Continue testing the composed production artifact with real Django/PostgreSQL and
a stateful fake provider. Vendor-format HTTP tests prove adapter behavior under
that model, not real-provider scope approval or final upload-session semantics.
Native OS chooser dialogs and OS-cloud propagation remain separate live checks.

The 64 KiB per-book state-document limit and retained local-revision cap still
bound long reading histories. They fail closed rather than truncating history,
but a long-history storage design and measured acceptance tests are needed before
advertising unlimited history sync. Native Manabi account/source integration is
also not completed merely by changing Web or upgrading the older TTU connector.
No existing production activation, native app branch, provider scope, or naming
configuration changes in this PR.
