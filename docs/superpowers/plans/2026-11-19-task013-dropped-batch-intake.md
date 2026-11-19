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
- Cancellation, duplicate finalization, and stale batch IDs must not lose accepted imports or cross batch ownership; test in Task 1.

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
- [x] **Step 5: Write failing desktop-boundary and shell-smoke checks** in `tests/security/desktop-boundary.test.ts` and the existing `--uahtest-shell-only` path in `app/main/index.ts`. Assert the exact three channel names are registered and preloaded, an arbitrary renderer path is absent from each signature, and the renderer file-picker smoke retains one accepted script beside one per-file failure through the batch route.
- [x] **Step 6: Run the boundary test to verify it fails for the missing batch path.** The focused test failed with `batch start must authorize the main frame`; after implementation the full desktop-boundary suite passed 74/74.
- [x] **Step 7: Add the main/preload batch lifecycle** with main-owned opaque IDs, active-window binding, the existing dropped-import busy/cancel guard, and finalization through `summarizeResult`; preserve the legacy single-file endpoint.
- [x] **Step 8: Route file-picker and drag/drop through one session** in `app/ui/index.ts`; retain renderer-side 1,000-file/128 MiB prechecks and per-file read failures, then call finalization once and display its aggregated result.
- [ ] **Step 9: Run verification.** Run `npm run typecheck`, focused import/desktop-boundary/imported-analysis tests, the repo's existing Windows Electron shell-smoke workflow, `python .github/scripts/verify-predevelopment.py`, and `git diff --check`. Expected: all focused checks pass; unrelated full-suite environment failures are reported by name and are not attributed to this change.
- [ ] **Step 10: Update TASK-013 progress in `docs/09-development-plan.md`, `docs/10-traceability.md`, `docs/12-handoff.md`, and `docs/14-stable-work-register.md` with the exact source SHA and remaining full-pipeline acceptance; do not close #857 or claim Stable completion.
- [ ] **Step 11: Commit the independently verified increment** on `feat/task013-dropped-batch-20261119`, push a matching GitHub branch, open/update its PR, and verify required Actions before any merge decision.
