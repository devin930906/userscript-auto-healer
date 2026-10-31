# Legacy → Issue-driven Stable development bridge

> Scope: governance-only migration for `devin930906/userscript-auto-healer`, based on repository `main@e3169fc982c9703e26710eb335b36a41f0812454` (2026-10-29 UTC). This is not a new predevelopment admission, a new product specification, or proof that the current HEAD passes Stable gates.

## Purpose and authority

This repository was initialized under the earlier (4) predevelopment instruction and developed under the earlier (7) Stable instruction. The updated (4) and (7) instructions add **issue-driven task execution**; they do not invalidate previous implementation, historical PRs, evidence or identifier series.

Keep original requirements and decisions authoritative: `docs/00-intake.md`, `docs/02-requirements.md`, ADRs, `docs/04-architecture.md`, `docs/06-security-risk.md`, `docs/07-testing.md`, `docs/08-release.md`, `docs/09-development-plan.md`, `docs/10-traceability.md`, `docs/11-readiness.md`, `docs/12-handoff.md`, `docs/13-predevelopment-admission.md`, `docs/14-stable-work-register.md`, and `AGENTS.md`. In conflicts, verify the actual latest approved decision, git state and test evidence; do not treat this bridge as overriding any approved feature, security boundary, admission condition or GATE.

## Roles and ID mapping

- `REQ-### / NFR-###`: requirements and quality constraints; `ADR-###`: approved engineering decisions; `RISK-###`: risk; `TEST-###`: verification; `GATE-###`: Stable release gate.
- `TASK-###`: **stable engineering plan identifier**, not a GitHub issue number. Keep existing TASK identifiers; never renumber old work to match GitHub issue numbers.
- `#N` / GitHub Issue: track an actionable, bounded task, defect, acceptance gap or blocking evidence. Existing TASK can be linked to multiple Issues; an Issue can cover related tasks only when scope/acceptance make sense.
- Pull request `#N`: code/document change integration and review. One Issue may require several PRs; one PR may serve multiple Issues. Evidence-only verification work need not create a PR.
- Milestone/Projects/sub-issues: organizational views when supported, useful and authorized; not substitutes for authoritative TASK specifications and test evidence. No automatic bulk creation.

## Verified open defects at the snapshot

| Issue | Existing TASK / tests | Real outstanding concern | Closure prerequisite |
| --- | --- | --- | --- |
| [#480](https://github.com/devin930906/userscript-auto-healer/issues/480) | TASK-008 / TEST-013 | Intermittent Chrome owned main-frame confirmation on Windows candidate | Reproduce/isolate root cause with bounded diagnostics; prove a targeted fix and relevant Windows regression; a single green rerun is insufficient |
| [#440](https://github.com/devin930906/userscript-auto-healer/issues/440) | TASK-013 / TEST-004/011/022 / NFR-009 | Intermittent isolated AST worker failure | Verify failure mechanism from actual run logs, produce minimally justified regression fix and validate on corrected commit |
| [#215](https://github.com/devin930906/userscript-auto-healer/issues/215) | TASK-020 / TEST-028 / REQ-028 | Intermittent Win32=5 directory rename denial after extracted Electron smoke | Confirm failure cause, preserve atomic rename and owned-process boundaries, verify relevant Windows tests |

These are **three open defect Issues**, not the full count of incomplete Stable work. Many existing TASKs are tracked in plan/registry and in historical merged PRs without a dedicated Issue; do not create one per historical PR merely to inflate issue counts. As of the snapshot, latest observed `main` merge is [PR #484](https://github.com/devin930906/userscript-auto-healer/pull/484), which explicitly does **not** certify issue #480's intermittent root cause or Stable release readiness. Always refresh before future changes.

## Continuation procedure for updated (7)

1. Re-read current `main` SHA, open PRs and Issues, relevant historical merged/closed PRs, `AGENTS.md`, `docs/09-development-plan.md`, `docs/10-traceability.md`, `docs/11-readiness.md`, `docs/12-handoff.md`, `docs/14-stable-work-register.md`, CI checks and gate evidence. Treat dated statements as historical, not live facts.
2. Establish each candidate task's `TASK ↔ REQ/NFR ↔ TEST/GATE ↔ Issue(s) ↔ PR/commit/CI` relationship. Where no Issue exists but work is already complete, retain evidence; **do not open retroactive Issues**. Where an uncompleted actionable task genuinely needs tracking, search duplicates, create one bounded Issue only if authorized and supported, and link the formal TASK and acceptance tests.
3. Prioritize unresolved safety blockers, dependency blockers, remaining approved functionality, actual integration/Windows tests and release gates; use the approved plan dependencies, not issue number order or issue quantity.
4. For code changes, check existing related PR, choose the current authorized integration base, implement minimal work, run checks on exact code SHA, and create/update a PR with `TASK`, Issue, `REQ/NFR`, `TEST`, evidence and blocked/remaining acceptance.
5. Only use `Fixes #N`/`Closes #N` when the **whole** Issue is actually resolved and GitHub auto-close target-branch semantics are understood; otherwise use `Refs #N` or plain links. Merging a PR alone does not prove Issue verification or Stable GATE closure.
6. When a task is validated, refresh state and record actual merged SHA, tests, relevant issue status and remaining gaps in the existing authoritative plan/register/handoff. Never mark a milestone or Stable finished merely because every Issue is closed.
7. For new unrelated defects, first search existing Issues and TASKs; preserve historical identifiers and add the smallest necessary new record. Do not merge independent intermittent failures into one Issue.
8. Do not change repo permissions, secrets, branch protections, user Chrome profiles, existing userscripts or public Release as part of this governance migration.

## Required issue body for new actionable work

```md
## Engineering identity
TASK: TASK-###
REQ/NFR:
TEST/GATE:
Priority / dependency:
## Observed gap and evidence
Exact current SHA, run, log, reproduction or verified product requirement.
## Bounded work
In scope:
Out of scope:
## Acceptance
- [ ] Specific executable or inspectable result
- [ ] Exact verification environment and expected evidence
## Integration
Related Issues/PRs:
Status/remaining blockers:
```

## Migration acceptance and remaining work

- [x] Existing source, TASK identifiers, PR history and open Issues preserved; no reset or migration-by-reimplementation.
- [x] An explicit Issue/PR ↔ TASK handoff convention documented.
- [x] [Governance PR #485](https://github.com/devin930906/userscript-auto-healer/pull/485) was merged into `main@3e4cc736f464e58d00406377a38c8fa9af9fc2d5` on 2026-10-29 UTC, after Documentation Integrity checks succeeded for the PR head. This is a governance integration, not Stable approval.
- [x] On this governance branch, incrementally align `AGENTS.md`, `docs/09-development-plan.md`, `docs/10-traceability.md`, `docs/12-handoff.md`, and `docs/14-stable-work-register.md` with real Issue ↔ TASK mappings. These updates were subsequently **integrated into main by PR #485** after the required docs checks succeeded.
- [ ] Reconcile all remaining TASK and GATE coverage against actual HEAD, including any issue-tracking gaps. Do not infer there are only three remaining tasks.
- [ ] Verify CI and real Windows/Tampermonkey acceptance; until independently proven, no Stable product or public Release.

## 2026-10-29 migration task-registration update

Four bounded, verified-existing TASK workstreams now have newly opened GitHub Issues: [#486](https://github.com/devin930906/userscript-auto-healer/issues/486) TASK-007, [#487](https://github.com/devin930906/userscript-auto-healer/issues/487) TASK-009, [#488](https://github.com/devin930906/userscript-auto-healer/issues/488) TASK-010 and [#489](https://github.com/devin930906/userscript-auto-healer/issues/489) TASK-011. Existing independent unresolved defects [#480](https://github.com/devin930906/userscript-auto-healer/issues/480) TASK-008, [#440](https://github.com/devin930906/userscript-auto-healer/issues/440) TASK-013 and [#215](https://github.com/devin930906/userscript-auto-healer/issues/215) TASK-020 remain OPEN. As of this dated snapshot, seven known actionable Issues are registered; this is **not** the full Stable work inventory.

`AGENTS.md`, `docs/09-development-plan.md`, `docs/10-traceability.md`, `docs/12-handoff.md` and `docs/14-stable-work-register.md` now carry the matching dated governance reference. Existing TASK-001..006 stages are not re-opened; TASK-012/014/015/016/017/018/019/021 still have planned work, but no extra historical or speculative Issues are fabricated. Read `docs/09-development-plan.md` for the full 21-task index. The source code, release contract, old CI evidence and original fixed TASK/REQ/TEST/GATE tables are unmodified.

## 2026-10-29 merge receipt and transition readiness

- PR [#485](https://github.com/devin930906/userscript-auto-healer/pull/485) is **merged** with resulting main commit `3e4cc736f464e58d00406377a38c8fa9af9fc2d5`; all six governance documents are part of the default branch.
- Documentation Integrity on the PR head passed: [run 40859050222](https://github.com/devin930906/userscript-auto-healer/actions/runs/40859050222) and [run 40859045794](https://github.com/devin930906/userscript-auto-healer/actions/runs/40859045794). These are documentation checks, not product/Windows GATE tests. This final receipt edit requires its own resulting main documentation check.
- **Updated (7) continuation may now start from this existing project's real current state**, with no replay of all of updated (4). The 21 formal TASK records and seven verified open issues have mappings; other unfinished work remains in the formal plan and does not have to be materialized into speculative Issues at once.
- Full product Stable acceptance, final release authorization and the unresolved TASK/GATE work remain distinct and **not completed** by this migration.

## 2026-10-31 supplemental concurrency migration (Issue #547)

The 2026-10-29 bridge and PR #485 remain authoritative historical evidence for Issue-driven tracking. The subsequently supplied (7) instruction additionally requires server-side exclusive **per-Issue claims** and bounded parallel integration. See `docs/16-cross-session-issue-claims.md` for the operative, fail-closed create-only `work/issue-<N>` branch protocol, collision/Next handling, legacy-branch reconciliation and shared-file/CI checks. This supplement does **not** retroactively mark old feature branches claimed, change current Issue ownership, approve parallel groups, or certify Stable. Issue #547 documents this governance-only addition.
