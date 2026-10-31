# Cross-session Issue claim and parallel integration protocol

> Status: governance migration for Issue #547, prepared from the verified `main@0ad14ef92b37d15c846fbff3dbecdfdc0fc3f3e3` baseline on 2026-10-31 UTC. It does not change approved REQ/NFR/TASK/TEST/GATE, historical admissions, source-code permissions or Stable acceptance. **Documented process and a single observed branch creation are not proof that concurrent actors or every client enforce the process.**

## Authority and scope

Use the approved requirements, architecture, TASK dependencies, TEST/GATE, `AGENTS.md`, `docs/09-development-plan.md`, `docs/10-traceability.md`, `docs/12-handoff.md`, `docs/14-stable-work-register.md` and the original 2026-10-29 bridge in `docs/15-issue-driven-stable-bridge.md`. This file is an operational coordination procedure, not a second product specification. The `TASK-001..021` sequence and existing issue numbers are unchanged.

## What constitutes an Issue claim

For an eligible **GitHub Issue number N**, the canonical exclusive claim is the server-created branch `refs/heads/work/issue-N` in this repository. The branch serves as the sole implementation working branch, not merely a claim marker. The **first creation** is the acquisition event; subsequent writes may update this branch using normal controlled development, but **no actor may create, reset or force-update it to steal an existing claim**. Use a GitHub API/tool that genuinely invokes *create-only* Git ref/branch semantics and fails when the ref already exists. A tool with undocumented upsert behavior, ordinary Issue assignment, labels, comments, Projects fields, or a check-then-update is **not** an atomic claim.

Before assuming this mechanism is available in any later tool session, check that the selected GitHub interface is authorized and actually provides create-only semantics, that branch rules permit `work/issue-N`, and that existing related branches/PRs have been reconciled. If the tool could overwrite an existing branch or duplicate behavior cannot be established, set **CLAIM_BLOCKED**: audit or plan only; do not perform competing product writes.

## Acquire and confirm (every new development conversation)

1. Read the latest default branch SHA, all paginated Open Issues in Stable scope, Open/Draft PRs, corresponding work branches, target commit, existing claim refs, approved TASK dependencies and active file/interface scopes. Include newly created Issues and defects, not just the seven Issues in the dated bridge.
2. For each proposed Issue, derive `TASK ↔ REQ/NFR ↔ TEST/GATE ↔ Issue ↔ PR/commit/CI`. Skip work already completed, blocked by dependencies or permissions, an existing claim, an active PR owned by another execution context, or an unreconciled legacy branch. A vacant Assignee field does **not** mean vacant.
3. Write the expected module/file scope, shared interface/configuration, target integration branch, automated verification, dependencies, and a human-readable context identifier to a proposed plan **before claiming**. If this conflicts with another active task, skip even when the Issue is different.
4. Attempt **once** to create `refs/heads/work/issue-N` from the currently checked base SHA through a verified creation-only API operation. Do **not** use `git push --force`, reset the ref, choose `work/issue-N-2`, or retry an ambiguous failed creation without reading the remote ref.
5. On success, fetch the branch from GitHub and confirm its name, SHA, repository and relationship to the chosen Issue/base. Re-fetch the Issue, open PRs, dependency/claim state and overlapping active work. Only then may the current context write *within this claim's approved scope*. If the ref exists, the create fails with conflict, or the outcome is unknown, **do not claim ownership**: re-query and move to the next eligible Issue.
6. Optionally record Issue number, branch, original base SHA, context marker, tentative file scope, status and PR URL in Issue comments/body or PR. These are useful durable coordination records but **not the mutex**. Never publish credentials or personal conversation identifiers.
7. Before each substantial write or PR integration, re-read the target branch SHA, Issue state and open PRs. Use expected SHA/optimistic concurrency where available; reject and reconcile remote divergence rather than silently overwrite it.

**Observed one-time migration check:** On 2026-10-31 UTC, creation of `work/issue-547` returned success and a later GitHub branch read showed `0ad14ef92b37d15c846fbff3dbecdfdc0fc3f3e3`. This is a **single successful creation/readback**, not an observed simultaneous-collision stress test or a warranty that every connected tool exposes create-only behavior.

## Collisions, Next and legacy work

- A canonical claim already present means **occupied** regardless of its last activity date, comments, assignee or apparent lack of commits. Never automatically steal an old ref or infer abandonment from inactivity.
- The pre-migration task branches (`feat/task...`, `fix/task...`, `diagnostic/task...`) are **not** automatically transformed into claims. Inspect their commit ancestry, existing PR links and latest related issue activity before any new claim. If unresolved ownership/active work exists, mark the candidate **LEGACY_WORK_UNRESOLVED** and skip.
- After an occupied or failed claim, re-fetch remote state and choose the next eligible, dependency-safe, disjoint Issue. The next number is not necessarily N+1; do not invent tasks or jump across unresolved prerequisites. If none qualifies, return **NO_SAFE_TASK** and stop code writes.
- An interrupted session does not release a claim. For apparent abandoned work, first check branch commits, open/merged PRs, issue links, handoff notes and source integrity. Release or reassign only with reliable documented owner handoff or explicit authorized recovery procedure; never delete a ref merely because it looks old.
- After all authorized work is integrated and verified, mark the Issue's *actual* acceptance status, not simply the PR state. Preserve the branch/ref as a traceable historical claim unless an approved, documented, non-racy cleanup/transfer explicitly permits release. A reopened Issue requires explicit recovery/handoff, **not** a silent new suffix branch.
- An existing claim does not make an Issue's entire acceptance criteria complete. Closed/merged PRs may leave GATE or human verification open; use `Refs #N` instead of `Fixes #N` until full closure is justified.

## Parallel execution admission (separate from exclusive claiming)

Different Issue numbers **do not** automatically imply safe parallel development. Before parallelizing, check all six conditions: (a) prerequisites met; (b) disjoint source and test files or explicit file ownership; (c) stable agreed shared API/types; (d) no shared state, schema, runner resource or lockfile conflict; (e) isolated work branches; (f) PR integration CI after *all* merged changes.

| Current Issue / formal TASK | Initial workstream to inspect (not a file-ownership grant) | Parallel caution |
| --- | --- | --- |
| #510 / TASK-005 and #480 / TASK-008 | Chrome startup, owned CDP session and main-frame evidence | Both touch browser/session semantics; assume overlapping until actual diffs and dependencies prove otherwise |
| #486 / TASK-007 and #488 / TASK-010 | Real Tampermonkey manager evidence and acceptance-gate semantics | Shared product trust contract; do not independently redefine evidence or acceptance |
| #487 / TASK-009 and #489 / TASK-011 | Reviewable repair candidate and version/restore transaction | Restore/apply safety depends on approved candidate and acceptance; parallelize only disjoint proven units |
| #440 / TASK-013 | Isolated AST worker and batch orchestration | Shared execution lifecycle and tests may overlap other tasks |
| #215 / TASK-020 | Windows portable relocation and extracted Electron smoke | Candidate packaging workflows and browser/Electron jobs are shared integration resources |

These are investigation starting points only, not preapproved groups. Check `docs/09-development-plan.md` and the actual diff for each selected task; no documented parallel-safe pair was independently verified by this migration. Public types, lockfiles, CI workflows, product manifests and cross-module contracts get **one responsible writer or serial integration**.

For each PR: link actual Issue, TASK, REQ/NFR, TEST/GATE, claim branch, expected base and head SHAs, changed file scope, interface impact, exact CI runs and remaining blockers. Before merging, re-check latest base and required checks/review state. PRs may run independent CI concurrently; merge into shared `main` in a controlled order and run fresh appropriate combined checks after integration. Green checks on unrelated SHAs cannot be added together to certify integration.

## Recovery and acceptance

- **CLAIMED:** create-only branch creation succeeded, same repo/ref and original SHA read back, relevant Issue and overlap state rechecked.
- **OCCUPIED:** existing canonical claim or unreconciled active legacy implementation; choose Next, no write.
- **CLAIM_BLOCKED:** unsupported/unknown creation-only semantics, insufficient permission, contradictory state or branch policy. Audit only.
- **REVIEW_PENDING:** branch and PR exist; checks/reviews/combined integrations not confirmed. Do not report merged or Stable.
- **INTEGRATED:** real PR merge receipt and expected base checked, Issue status evaluated separately.
- **STABLE_BLOCKED:** outstanding TEST/GATE/real device verification, even with a successful governance PR.

For Issue #547 the migration gate is: preserve historical work, document and link this protocol, verify a real isolated branch/PR, observe documentation CI against the resulting SHA, and ensure `main` was not directly modified by this migration. This procedure does not create a GitHub server-side queue, enforce branch protection, distribute file locks, provide subagents, or prove zero collisions. Any direct writer that ignores this protocol can still conflict.