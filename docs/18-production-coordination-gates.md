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
