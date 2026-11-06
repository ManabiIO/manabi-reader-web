# Contributing to Manabi Reader for Web

Manabi Reader for Web is licensed under the BSD 3-Clause License. By submitting a contribution to this repository, you agree to license the copyrightable portions of the contribution that you own under BSD-3-Clause.

You also represent that you have the right to provide those portions under that license and that you have identified any third-party material the contribution contains.

Human pull requests must affirm the BSD-3-Clause contribution grant in the pull-request checklist. The `Contribution license acknowledgement / acknowledgement` check reports failure when that acknowledgement is missing; dependency/update bots are exempt. Repository administrators must configure that check as required on every branch that accepts contributions. Without a required-check branch rule, the workflow records the failure but GitHub may still permit a merge. Because the gate uses `pull_request_target`, repository/organization Actions policy must also permit that event; the workflow deliberately performs no checkout and executes no pull-request code.

This policy is a copyright-license grant. BSD-3-Clause does not contain an express patent grant. If Reader later needs an explicit contributor patent grant or a broader contributor agreement for proprietary distribution, establish that separately with qualified counsel rather than assuming this policy supplies it.

## GPL dictionary-runtime boundary

Reader currently interoperates with a separately licensed Manabitan runtime. Manabitan is derived from Yomitan/Yomichan and is GPL-3.0-or-later. The GPL implementation belongs in the Manabitan repository, not in Reader's BSD source.

Keep this boundary strict:

- Do not copy, adapt, translate, transcribe, or mechanically rewrite Manabitan, Yomitan, Yomichan, or other GPL implementation code into this repository.
- Do not use GPL implementation files as donor code for a Reader-owned implementation. Implement Reader code from Reader requirements, documented interfaces, testable behavior, and independently authored designs.
- Do not cherry-pick Manabitan/Yomitan commits or apply their patches into Reader merely because a contributor also granted BSD rights to their own additions. A commit can still contain GPL-owned context, structure, or other authors' work. Reusable generic work should preferably originate in a separately permissive component; otherwise reimplement it independently from a Reader-owned specification.
- Changes to Manabitan's engine, importer, renderer, storage, scanner, or other GPL implementation belong in the Manabitan repository and should be reviewed there separately.
- Reader-side dictionary work must target the Reader-owned contract in `apps/web/src/lib/search/dictionary-provider.ts`. Runtime-specific loading belongs only in `apps/web/src/lib/search/dictionary-providers/` and the runtime provider-selection module. Provider-specific checkout/build/licensing logic belongs only in `scripts/dictionary-providers/` and the build provider-selection module.
- Do not vendor Manabitan source into this repository. The build downloads an exact pinned revision into an isolated, ignored cache and distributes the generated runtime with its own GPL notice and corresponding source.
- Do not commit generated Manabitan runtime files or dictionary archives under `apps/web/static/`.
- If a change is based on third-party code under a permissive license, identify the source and license in the pull request and retain required notices.

The automated dictionary-boundary check enforces mechanical parts of this rule. It cannot determine copyright provenance, so reviewers and contributors remain responsible for the origin of submitted code. For replacement work, follow `docs/architecture/dictionary-provider-acceptance.md`; the current separation's donor-file record is in `docs/architecture/dictionary-boundary-provenance.md`.

A future non-GPL dictionary implementation should be written independently against the Reader-owned provider contract. Replacing the current provider should not require porting implementation from Manabitan.

## Pull requests

Keep changes focused and explain their provenance. For dictionary-related changes, state which repository owns each part of the work. If a feature requires changes in both Reader and Manabitan, use separate pull requests and connect them through the documented provider contract rather than sharing implementation.

Before submitting, run the checks relevant to the change. At minimum for normal Reader changes:

```sh
pnpm test:dictionary-boundary
pnpm eslint .
pnpm --dir apps/web check
```

The production build prepares the pinned dictionary runtime and may require network access to the pinned sources:

```sh
pnpm build
```

Documentation lives in `site-docs/` and builds with Zensical:

```sh
python3 -m pip install -r requirements-docs.txt
bash scripts/build-docs
```
