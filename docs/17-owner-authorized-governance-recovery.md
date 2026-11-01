# Owner-authorized #565 governance bootstrap recovery

> Scope: narrow, one-time **governance-only** emergency repair after the repository owner's explicit 2026-11-01 request to fix the observed repeat-execution deadlock. **This is not a production Issue claim, a release authorization, or proof that former chat owners exited.**

## Problem and evidence

The current fixed-name `work/issue-N` branch records first acquisition but has no verified owner-bound release, next-round acquisition, or stale-writer/merge fence. The eight open product Issues #215, #440, #480, #486, #487, #488, #489, #510 and governance #565 retain historic claim branches. Their history must not be deleted, reset or interpreted as actively owned by a current chat merely because the ref exists. Open PRs were zero at the bootstrap readback, baseline `main@bb421c54234672f8acde3fa61e0c4bfc997546ce`. A successful experimental lifecycle test cannot certify a production handoff.

The prior execution instruction caused a circular standstill: #565 is required to implement safe claim handoff but its own previous `work/issue-565` claim is not released. Repeating read-only "Next" selection cannot resolve this.

## Explicit, constrained bootstrap exception

1. The owner's current explicit repair request authorizes **only one serial, isolated governance repair lane** on `repair/governance-565-bootstrap-20261101`, based on the reviewed main SHA. This exceptional branch is **not** the canonical product Issue claim, and must never be advertised as such. Existing `work/issue-N` and `feat/`, `fix/`, `diagnostic/` histories remain unchanged.
2. The lane may modify only `AGENTS.md`, `docs/16-cross-session-issue-claims.md`, this document, `.github/scripts/verify-governance-recovery.py`, and `.github/workflows/governance-recovery-guard.yml`. This scope protects the original product and task specifications; no product code, CI product gates, branch protection settings, secrets, Releases, or historical Issue state may be changed by this bootstrap.
3. Inspect the freshest remote main, all open PRs, the nine pinned old claim SHA values, and proposed files before changes and before integration. If a competing PR exists, any claim moves, authorization is unclear, or the intended file scope expands, stop. No blind retries, branch deletion, forced updates, historical ref release or second copy of the legacy Issue claim.
4. Use a PR targeting `main`; review the diff and read-only GitHub Actions guard. The guard compares PR head SHA, exact allowed files, the nine old ref SHAs and the open PR list, and re-reads them before reporting PASS. **Its success is advisory until the server requires the check; it is not an enforceable stale-merge gate.** Verify any existing branch-protection/classic rules independently; a failed admin-only read is not proof that no protection exists.
5. Do not squash this bootstrap into a claim completion. Keep Issue #565 open. Record the PR and test receipts, any limitations, and exactly what is still needed for production-grade release/reacquisition. Resume ordinary TASK development only after the real product coordination and mandatory merge/write controls are deployed and each legacy Issue's authorised handoff has been verified.
6. This exception is deliberately **non-transferable**: it does not authorize a second repair actor, unverified chat takeover, another arbitrary Issue branch, or the creation of a second owner for a product Issue. If independent sessions are running, stop competing work until the owner establishes a serial repair window.

## Production recovery prerequisites (not yet satisfied)

- A separate coordination ref per Issue with a forward-only, server-atomic owner/round transition; owner-authenticated release and a documented authorization/recovery path. Do not use `git push --force` or read-then-delete refs to simulate release.
- Defense against stale writes AND stale PR merges, enforced by repository policy / required status checks with verified repository administration rights. A cooperative script and green non-required CI are insufficient.
- Per-Issue handoff of all eight legacy product claims, preserving history and checking true missing patches, open PRs, prior owner exit/recovery authorization and remaining TASK/TEST/GATE.
- Actual adversarial test evidence, including stale owner with a valid fast-forward opportunity, replay, lost result, simultaneous release/reacquire, and server-side merge denial. Preserve errors and rerun after changes.
- Only then update `docs/16`, `docs/12`, `AGENTS.md` and Issue #565 with successful evidence. Do not declare Stable EXE/ZIP or any test gate complete merely because this bootstrap PR passed.

## Recovery branch and audit guard facts

The initial recovery branch was created by the connected GitHub plugin using **create-only** from `bb421c5`. The nine immutable ref values pinned in `.github/scripts/verify-governance-recovery.py` reflect the remote snapshot preceding this PR. They are intentionally one-time: if a ref moves, a new owner review is needed rather than editing the pins merely to obtain green CI. The script performs only GitHub GET operations. It cannot change any Issue or ref, and returns errors when current evidence cannot be verified.

Status at authorship: **bootstrap PR implementation pending live CI and PR integration; production handoff remains BLOCKED**.
