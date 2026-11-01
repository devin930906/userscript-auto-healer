# Issue #565 — Production PR round fence bootstrap and enforcement boundary

> Status: a **read-only** PR validation gate is being introduced. It is NOT an active protected-branch rule and it does NOT transfer or release historical Issue claims.

## What the PR fence does

`.github/workflows/governance-issue-merge-fence.yml` runs on every PR targeting `main`. After its one-time, exact-base bootstrap, the workflow checks out **the event's base SHA**, not PR-authored code, and executes `.github/scripts/issue-merge-fence.py` from the trusted baseline. This prevents an untrusted PR from editing its own guard to manufacture a passing result.

For proposed *product* changes, the implementation branch must be `impl/issue-<N>-r<R>`, and the current separate coordinator ref `refs/heads/coord/issue-<N>` must hold a valid, current `coord/v2` commit state for the Issue/round, owner login and proof hash. The proposed code HEAD must be a descendant of the current coordination commit. The guard refuses a stale round, released state, wrong repo, mismatched actor, missing ref, old `work/issue-N` claim branch and any unrecognized branch. It checks that the Issue remains Open and re-reads PR/head/coord state to catch observed movement. Allowed product Issues are #215/#440/#480/#486/#487/#488/#489/#510.

**Crucial:** This introduces a **`coord/v2` integration contract**, not a `coord/v2` writer. The existing `.github/scripts/issue-round-coordinator.py` implements only `coord/v1` **test-only** transitions on `test/coord-round-*` and is deliberately not accepted as production. Until `coord/v2` production writer, authenticated owner secret custody and server-side controls are implemented and verified, product PRs must fail closed rather than fabricate authorization. In particular, `proof_hash` presence is a shape check, **not** a cryptographic signature verification or proof of per-chat identity. GitHub login alone cannot distinguish two ChatGPT conversations using the same connected user.

## Governance bootstrap

The very first PR with this new workflow runs against `main@ac0819e1c2299f537a8de7e22d680a4bb105b42e`, where the guard file is not yet present. Only for the exact branch `repair/issue565-production-pr-fence-20261101`, the workflow performs a narrowly scoped, additive, exact-three-file diff check with the trusted baseline and **does not run PR-supplied code**. Every later PR whose base contains the new guard executes only the trusted baseline's Python guard and its unit tests. The bootstrap is not a reusable bypass.

A pure governance continuation PR has a small explicit allowlist: `AGENTS.md`, `docs/16-cross-session-issue-claims.md`, this document, and the gate script/workflow. Other code/workflow paths remain blocked until a legitimate coordinated product round or an separately authorized, explicitly reviewed governance migration. No bypass is implied for product changes.

## Server enforcement is mandatory

A green Action is only advisory until GitHub requires the exact check context **`Issue coordination / stale round fence`** on `main`. Configure/enforce an active repository rule requiring:
- Pull requests for changes to `main`, with no direct-push bypass.
- Required status check `Issue coordination / stale round fence`; request a fresh evaluation after *every* base change, with GitHub's strict up-to-date setting where available.
- Coordinator ref `coord/issue-*` immutability/forward-only ownership transitions and restricted creation/updating; no unauthorized writer should be able to edit or forge a current coordination state.
- Consistent PR review/approval and protection against bypass of the required status, with admins/Apps behavior verified, not assumed.
- No outdated PR can merge after a round has released or rotated (server check requirement, merge queue or equivalent mandatory evaluation). Consider check/merge TOCTOU explicitly; a simple PR job that completed before state rotation is **insufficient** if no new check is required.

The current GitHub connector's branch-protection read returned 403; repository rulesets previously returned none. This file does not claim the permissions to enable those rules, and no protection changes are made by this PR. Verify with authorized repository administration.

## History, legacy ownership and task recovery

All nine historical `work/issue-N` refs remain untouched. No old claim is automatically retired or deleted, even if its file snapshot matches `main`. Before issuing a production coordinator round for one of the eight product Issues, reconcile full patch/PR history, prior owner exit or expressly authorized recovery, CI, outstanding task acceptance and the claim ref SHA. Preserve original TASK-001..021 and REQ/NFR/TEST/GATE; do not convert this governance CI pass into Stable certification.

## Evidence and exit conditions

Acceptance needs: a genuine production v2 writer; round owner custody and safe release/reacquisition; real concurrent adversarial CI; required status check verified through the GitHub rules API or an actual denied stale PR merge; authenticated eight-claim migration with no data loss. Keep #565 OPEN until all are met.

The first live PR/CI and post-merge main verification must be recorded separately; file creation does not prove deployment.

## Security hardening after bootstrap

The initial PR #573 validation used a `pull_request` event. That can load the workflow definition from the proposed PR merge commit, so the initial check by itself is **not** tamper-resistant against a PR that rewrites its workflow. A follow-up governance-only hardening change switches the workflow to **`pull_request_target`**, whose workflow definition is read from the trusted default branch. It checks out only `github.event.pull_request.base.sha`, runs a read-only API validator from that baseline, uses minimal read permissions, and executes no proposed PR code. This closes the *PR-controlled workflow-definition* loophole for future checks, but an appropriately privileged repository administrator can still change rules, and the check still needs to become **mandatory** in GitHub protection rules.

**Remaining race:** coordinator state can change after a PR check succeeds. A static green status alone is not a merge-time authorization. Production release must prevent/invalidates obsolete PRs and the server must enforce revalidation for all integrations; #565 is not closed on the basis of this workflow.

## Mandatory post-hardening validation method

On a fresh, additive, governance-only PR against the hardened `main`, independently check the workflow run's event is `pull_request_target`, its source SHA is the trusted base, and the job `Issue coordination / stale round fence` executes the `--self-test` and live PR validation steps. Never mark the work secure from a workflow file diff or a green documentation-only job. Negative cases remain necessary; a green governance PR does not imply that a product branch or legacy owner can merge safely.

## Live smoke validation after the trusted-event fix

A subsequent governance-only PR must verify that the `pull_request_target` event runs the **default branch** workflow, checks out the PR's immutable base SHA, executes `--self-test` plus the live API validation, and attaches the passing check to the proposed PR HEAD. This check is a real integration test of the advisory gate, **not** evidence of mandatory GitHub rules or production Issue handoff. Preserve any previous failed run as diagnostic evidence.

## Governance-only production coordinator V2 (Issue #565)

A separate forward-only coordination ref `coord/issue-565` is managed by `.github/scripts/issue-round-coordinator-v2.py` and a manual, authenticated `governance-production-coordinator.yml` workflow. **Only Issue #565** is admitted; all eight historical product work branches remain unchanged, and the coordinator is not a generic Issue takeover tool.

The first create-only operation stores a `coord/v2` JSON commit with `status=blocked_legacy`, `round=0` and the immutable legacy `work/issue-565` ref SHA; it does not claim that former work was released. The repository owner may perform an explicitly authorized one-time governance recovery only while default-branch SHA, the legacy ref SHA, and zero open PRs are verified. Recovery moves the same coordination ref forward to `released`. Subsequent acquisition is another non-force forward-only commit from the observed parent with `round+1`, bound to the authenticated GitHub actor and the SHA-256 digest of a private per-round owner proof. A sibling contender trying a stale parent is rejected by GitHub's fast-forward rule. The workflow never accepts the raw owner proof and does not support `release` through public dispatch inputs.

### Scoped owner-signed release transport (PR pending live verification)

The `coord/v2` **Issue #565 only** workflow now proposes an `acquire` input with a 32-byte Ed25519 **public** key (hex) and its SHA-256 digest, followed by a distinct `release` operation that accepts only the currently held coordination head SHA and a 64-byte **signature** (hex). The signing **private key is never transmitted to GitHub**, placed in dispatch inputs, Issue comments, commits or logs. The Python coordinator verifies the public key digest at acquisition and the Ed25519 signature via OpenSSL at release, before creating a forward-only Git state commit. A different head SHA, wrong key/signature, duplicate release, replay, or competing forward update must fail closed.

The signed byte payload is exactly UTF-8 `coord-release/v2\\n<repo>\\n<issue>\\n<round>\\n<40-character-current-coord-SHA>\\n` (each `\\n` is one LF byte). The correct Issue number here is `565`; the repo is `devin930906/userscript-auto-healer`. The private key holder must generate/sign this payload **outside** GitHub Actions, protect it from disclosure, and use the signature and exact current ref only for the intended release. A later round must generate a fresh keypair; the old signature is no longer valid. The signature is not a replacement for the GitHub actor permission check, required main PR fence, or ref protection.

**Important scope:** This signature-based release is implemented first for #565, not automatically for any of the eight product Issues. Ed25519 local tests and an actual live owner-signed acquire/release are separate verification steps; the latter must not be claimed before actual run IDs and readback. The current `coord/issue-565` ref is `released` at round 0, so this change does not require modifying it merely to pass CI. The eight product refs still need individually authorized recovery and protection before ordinary (7) development can safely resume.

A GitHub Actions passing self-test establishes local state-transition safety; a live owner `init/recover` run must be verified separately by its run ID, job logs, and authoritative remote ref SHA. No result of this governance-only workflow permits automatic product Issue takeover or Stable classification.

## Per-product legacy handoff through V2 (governance PR pending integration)

The V2 controller now extends its *enumerated* scope to the eight original product Issues #215/#440/#480/#486/#487/#488/#489/#510 while preserving the historical #565 governance ref. It does **not** modify or delete any historical `work/issue-N` branch. Each product Issue must be processed individually from the owner-gated manual workflow `governance-production-coordinator.yml`: `init` creates an immutable `coord/issue-N` in `blocked_legacy`, `recover` requires the explicit input `RECOVER-N-PRESERVE-HISTORY`, and `acquire` creates round 1 bound to the owner's new Ed25519 public key. `release` requires that round's private-key signature, not the private key itself.

The controller pins the nine old `work/issue-N` SHAs from the previously audited snapshot and stops if any have moved. Before product `recover`, it rechecks current `main` SHA, competing open PRs, old ref SHA, and **every** compare-listed historical changed path's exact file blob on current `main` versus the old branch; unmatched product content fails closed. The reviewed #215 main-side-only 78-line test addition is the sole explicitly pinned exception, not permission to overwrite either file. A file-snapshot match alone is not ownership proof: the owner must separately affirm that the old session is finished, review the remaining TASK/TEST/GATE, and authorize that specific recovery action. No batch auto-release exists.

GitHub coordination-ref ruleset [#26308886](https://github.com/devin930906/userscript-auto-healer/rules/26308886) was verified ACTIVE, matching `refs/heads/coord/issue-*` with `non_fast_forward`. This prevents force history rewrites; **it does not restrict all possible unauthorized forward-only state commits**. The main required PR coordination fence [#26307718](https://github.com/devin930906/userscript-auto-healer/rules/26307718) remains active. An old approved check may still race with a new coordination round unless a merge-time revalidation mechanism is verified; do not claim perfect stale-PR resistance from status checks alone.

Release evidence is not complete until a real owner-initiated `init` / reviewed `recover` / `acquire` / signed `release` / new-round `acquire` sequence produces inspectable run IDs, Git ancestor history and unchanged old refs. A live Issue recovery must never be inferred from a self-test or from the code being merged. Existing Stable GATE, Windows EXE/ZIP and genuine Tampermonkey/Windows acceptance remain separate.
