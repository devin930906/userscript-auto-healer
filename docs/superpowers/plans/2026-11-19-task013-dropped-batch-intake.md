# TASK-013 Dropped Batch Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Route renderer file-picker and drag/drop inputs through one main-process-owned, bounded per-script batch and one read-only AST queue invocation.

**Architecture:** Keep the batch lifecycle in Electron main: it creates an opaque one-use batch ID, accepts one file payload per IPC call, accumulates validated scripts and per-file errors, then finalizes once through the existing `summarizeResult` path. The renderer never supplies filesystem paths, and the change does not grant browser, Tampermonkey, script-write, repair, AI, or business-verification authority.

**Tech Stack:** Electron 44, TypeScript 5.9, Node.js built-ins, existing Node test runner.

**Spec:** GitHub Issue #857; `docs/02-requirements.md` REQ-022; `docs/04-architecture.md`; `docs/05-experience.md`; `docs/07-testing.md`; `docs/10-traceability.md`.

## Global Constraints

- Maximum 1,000 selected files, 8 MiB per script, and 128 MiB per batch.
- Imported source bytes remain read-only and are never executed.
- Renderer IPC accepts only filenames and byte payloads; never accept a renderer path or URL.
- Cancellation preserves already accepted imports and leaves all verification and write-authority flags false.
- Keep the legacy single-file IPC for existing shell checks; route the product file-picker/drop loop through the new batch lifecycle.
- Preserve per-file failures and duplicate reporting while continuing independent valid files.

## Review Focus

- Proxy, non-byte, and malformed payloads must fail as a per-file error without invoking attacker-controlled getters; test in Task 1.
- One invalid filename or encoding must not discard neighboring valid files; test in Task 1.
- Duplicate content must be counted once by SHA-256 while preserving the batch result; test in Task 1.
- File-count, per-file-byte, and aggregate-byte boundaries must reject excess work before unbounded accumulation; test in Task 1.
- Cancellation, duplicate finalization, stale IDs, renderer reload, and renderer crash must not lose accepted imports or strand the app-wide busy lock; test in Task 1.

---

### Task 1: Main-owned dropped-file batch lifecycle

**Files:**
- Modify: `src/import/import-service.ts`
- Test: `tests/import/import-service.test.ts`
- Modify: `app/main/index.ts`
- Modify: `app/preload/index.ts`
- Modify: `app/ui/index.ts`
- Modify: `tests/security/desktop-boundary.test.ts`
- Modify: `docs/09-development-plan.md`
- Modify: `docs/10-traceability.md`
- Modify: `docs/12-handoff.md`
- Modify: `docs/14-stable-work-register.md`

**Interfaces:**
- Import service produces `DroppedImportBatch.add(name: unknown, bytes: unknown): { ok: boolean; processed: number; code?: string }` and one-shot `DroppedImportBatch.finish(): ImportOutcome | null`.
- Main IPC produces `beginDroppedImportBatch()`, `addDroppedImportBatch(batchId, name, bytes)`, and `finishDroppedImportBatch(batchId)`; only the main process creates batch IDs and owns its abort controller.
- Renderer uses the existing `ImportResponse` shape after finalization and never receives source bytes, paths, hashes, or manager evidence.

- [x] **Step 1: Write failing tests** in `tests/import/import-service.test.ts` with these observable assertions: `TASK-013/TEST-022: dropped batch keeps valid neighbors around one invalid file` yields 2 scripts and 1 `NOT_USER_SCRIPT` error; `TASK-013/TEST-022: dropped batch counts duplicate bytes once` yields 1 script and `duplicates === 1`; `TASK-013/TEST-026: dropped batch rejects malformed bytes without invoking a Proxy getter` yields `INVALID_DRAG_DATA` and leaves the getter-call count at 0; `TASK-013/TEST-022: dropped batch enforces file and aggregate byte limits` refuses item 1001 and the first item that exceeds 128 MiB with `SCAN_LIMIT`; `TASK-013/TEST-022: dropped batch can be finalized once` returns the staged result once and rejects later additions.
- [x] **Step 2: Run the focused test to verify the expected failures.** `npm run build` failed with TS2305 for the missing `DroppedImportBatch` export, as expected.
- [x] **Step 3: Implement the bounded `DroppedImportBatch`** in `src/import/import-service.ts`; use the existing safe byte importer and SHA identity, count bytes before retaining data, and return previous valid scripts/errors exactly once from `finish()`.
- [x] **Step 4: Run the focused tests to verify they pass.** Six new TASK-013 tests passed; the full import-service file had 35 passes and one existing Windows symlink test failed with sandbox `EPERM`.
- [x] **Step 5: Write failing desktop-boundary and shell-smoke checks** in `tests/security/desktop-boundary.test.ts` and the existing `--uahtest-shell-only` path in `app/main/index.ts`. Assert the exact three channel names are registered and preloaded, an arbitrary renderer path is absent from each signature, the renderer file-picker smoke retains one accepted script beside one per-file failure through the batch route, and main-frame reload/renderer exit releases an abandoned session.
- [x] **Step 6: Run the boundary test to verify it fails for the missing batch path.** The focused tests failed first for the missing main-owned IPC and later for missing renderer-teardown cleanup; implementation is now covered by the added regression assertion.
- [x] **Step 7: Add the main/preload batch lifecycle** with main-owned opaque IDs, active-window binding, the existing dropped-import busy/cancel guard, finalization through `summarizeResult`, and teardown on main-frame navigation/renderer-process loss; preserve the legacy single-file endpoint.
- [x] **Step 8: Route file-picker and drag/drop through one session** in `app/ui/index.ts`; retain renderer-side 1,000-file/128 MiB prechecks and per-file read failures, then call finalization once and display its aggregated result.
- [ ] **Step 9: Run verification.** Local build/typecheck, desktop-boundary 75/75, predevelopment 28/21/11, and diff check passed after the latest smoke diagnostic update. Latest local suite: 1,228 total / 1,215 pass / 1 fail / 12 skipped; sole TEST-003 symlink creation failed with Windows sandbox `EPERM`. PR #925 old-head Application Skeleton and Candidate runs both failed in staged Electron smoke at `SHELL_SMOKE_SECURITY_FAILED`; Candidate Node tests themselves had 1,225 pass / 0 fail / 3 skips. The new smoke now runs after existing renderer assertions and reports behavior-probe vs preload-key failures separately. New-head Windows CI must verify the smoke fix before this step is complete.
- [x] **Step 10: Commit the independently verified product increment** on `feat/task013-dropped-batch-20261119` to establish its exact source SHA before writing traceability records. Initial intake: `9156b96e2c9070eadbfef1fd87b3089da8e58453`; lifecycle follow-up: `1ed27890b02d13b266a9285c5bd264fcbe4d1a0c`; smoke isolation/diagnostic fix: `4b081a6d0883c6772a489df2d8b90fe483a7a8d9`.
- [x] **Step 11: Update TASK-013 progress** in `docs/09-development-plan.md`, `docs/10-traceability.md`, `docs/12-handoff.md`, and `docs/14-stable-work-register.md` with the exact local source SHA and remaining full-pipeline acceptance; do not close #857 or claim Stable completion.
- [ ] **Step 12: Commit and sync the latest traceability updates to PR #925, then verify Required Checks** on the final remote head before any merge decision. The PR is open; the new source commit object is created remotely with a matching tree, but its branch ref still points to the previous head. Sync the source ref and docs update together, then review the final Actions run.
