# TASK-013 imported batch candidate export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user export an eligible imported-batch selector candidate as a separately backed-up `.user.js` after a fresh native file identity check and write confirmation.

**Architecture:** Keep candidate export context in a bounded, short-lived main-only capability store. The renderer receives only an opaque ID and a safe result summary. Main reselects and reimports the original file, verifies its name and SHA-256, then reuses the existing verified backup/checkpoint/manual-export path without changing the source.

**Tech Stack:** Electron main/preload, strict TypeScript, Node test runner, existing native import/export and candidate planner modules.

**Spec:** `docs/superpowers/specs/2026-11-22-task013-imported-candidate-export-design.md`; governing product scope: TASK-013 / Issue #857, `docs/02-requirements.md`, `docs/07-testing.md`, `docs/08-release.md`, and `docs/09-development-plan.md`.

## Global Constraints

- Keep TASK/REQ/NFR/TEST/GATE numbering unchanged; this is a TASK-013 / #857 sub-scope.
- Candidate generation remains limited to exact source identity, exact target metadata, stable read-only DOM evidence, one missing/present selector pair, and the existing AST patch rules.
- Keep candidate export context owner-bound and memory-only for no more than five minutes; cap live records at 16 per window and never store source paths in the capability record.
- Renderer IPC may pass only the opaque capability ID for export. Native dialogs own source, backup, and export paths; the final native confirmation gates all writes.
- Recheck the selected on-disk `.user.js` name and SHA-256. Never overwrite or modify it. Export and recovery receipts remain runtime-unverified; all authority flags stay false.
- Do not claim real Tampermonkey/GM/business acceptance, GATE-007, full Stable, formal Release, or user-facing GUI acceptance from unit or CI evidence.
- Keep `docs/14-stable-work-register.md` outside this code slice; prior automatic review rejected a later full-file update. Record current status in the affected plan, `docs/09-development-plan.md`, and `docs/12-handoff.md` only if those exact files pass their existing integrity checks.

## Review Focus

- The DOM counts may be reversed: the exported request must preserve the exact missing-selector direction chosen by the planner.
- A byte-identical file with a different displayed filename must not be treated as the imported original.
- A candidate ID may expire while native dialogs are open; no write may proceed after expiry.
- Parallel or replayed requests, including another BrowserWindow, must not reuse a reserved or consumed capability.
- Cancellation at each native dialog and failures after file staging must not alter the original or produce a success receipt; existing recovery files must be left for reconciliation.

---

### Task 1: Preserve exact candidate review context and its lifetime

**Files:**
- Modify: `src/repair/imported-dom-candidate.ts`
- Modify: `src/diagnostics/imported-dom-diagnostic-index.ts`
- Test: `tests/repair/imported-dom-candidate.test.ts`
- Test: `tests/diagnostics/imported-dom-diagnostic-index.test.ts`

**Interfaces:**
- Produces: `ImportedDomCandidateResult` exposes `manualExportContext: { scenario, domSamples, originalSha256, candidateSha256 }` for the exact successful `ScenarioInput` direction and its validated `DynamicObservation`; main must never include this context in IPC.
- Produces: `ImportedDomCandidateExportStore.put(owner, context, expiresAt)`, `.reserve(owner, id)`, `.release(owner, id)`, `.consume(owner, id)`, and `.clearOwner(owner)` with a 16-entry per-owner cap, expiry pruning, and single-reservation semantics.

- [x] **Step 1: Add a failing reversed-count test** proving the private export scenario puts the zero-match selector first and the positive-match selector second.
- [x] **Step 2: Run the focused candidate test and confirm the new assertion fails** for the missing export context.
- [x] **Step 3: Add candidate-store tests** for owner isolation, five-minute expiry, 16-record cap, reserve/release, one-time consume, and clear-on-window-close.
- [x] **Step 4: Run the focused store test and confirm missing behavior fails.**
- [x] **Step 5: Implement the private review context and bounded store** without returning source text, selectors, URL, or paths through renderer IPC.
- [x] **Step 6: Run both focused tests and confirm they pass**, including candidate direction and TTL/owner checks.

### Task 2: Revalidate and export a reselected source through the existing safe flow

**Files:**
- Modify: `src/repair/imported-manual-export.ts`
- Test: `tests/repair/imported-manual-export.test.ts`

**Interfaces:**
- Consumes: Task 1's main-only scenario/observation context and an `ImportedScript` created from a native reimport.
- Produces: `exportReviewedImportedCandidateOnly(imported, context, nativeOptions)` validates the reimported filename/hash and delegates to `prepareManualRepairExportOnly`; it returns the existing runtime-unverified receipt or a bounded blocked result.

- [x] **Step 1: Add a failing success test** using a planner-produced two-selector candidate context; verify candidate and original recovery export use the same direction, the source bytes remain unchanged, and all authority flags stay false.
- [x] **Step 2: Run that focused test and confirm the new function is missing.**
- [x] **Step 3: Add failing no-write tests** for changed source bytes, wrong filename, malformed context, and mismatched source hash.
- [x] **Step 4: Implement the typed bridge by reusing existing imported-byte validation and manual backup/checkpoint/export flow.**
- [x] **Step 5: Run `node --test dist/tests/repair/imported-manual-export.test.js` after build and confirm the new tests pass.**

### Task 3: Add a native-only export IPC capability flow

**Files:**
- Modify: `app/main/index.ts`
- Modify: `app/preload/index.ts`
- Modify: `tests/security/desktop-boundary.test.ts`

**Interfaces:**
- Consumes: Task 1's candidate store and Task 2's export adapter.
- Produces: `window.healer.exportImportedDomCandidate(candidateId)` where main accepts only a validated opaque ID; no renderer-supplied source, path, scenario, URL, selector, or approval boolean.

- [x] **Step 1: Add failing desktop-boundary assertions** for the new preload method, sender authorization, capability lookup, native source/directory selection, exact filename/hash check, final native confirmation, and one-time consume before writes.
- [x] **Step 2: Run the focused desktop-boundary test and confirm these assertions fail.**
- [x] **Step 3: Add the per-window native handler**; preserve a capability on cancel or source mismatch, reserve it against concurrent use, and consume it only after final confirmation immediately before the write path.
- [x] **Step 4: Reuse `importApprovedPaths` and the existing export adapter.** Return only bounded result codes, filenames, hashes, byte length, and false authority flags.
- [x] **Step 5: Run the focused desktop-boundary test plus imported export tests and confirm they pass.**

### Task 4: Expose an accessible export action beside each eligible preview

**Files:**
- Modify: `app/ui/index.ts`
- Modify: `app/ui/index.html`
- Modify: `tests/security/desktop-boundary.test.ts`

**Interfaces:**
- Consumes: Task 3's opaque candidate ID and bounded export receipt.
- Produces: A per-item native export button for eligible candidates, with disabled/loading/success/blocked states and copy that distinguishes file export from installation or verification.

- [x] **Step 1: Add failing UI-boundary tests** for one export action per eligible item, no source/path/URL passed to IPC, double-click prevention, stale reply fencing, and runtime-unverified receipt wording.
- [x] **Step 2: Run the focused UI-boundary tests and confirm they fail.**
- [x] **Step 3: Add the button and localized Chinese status copy** in the existing ordinary DOM result row; preserve keyboard access, `role=status` announcement, and the existing candidate safety explanation.
- [x] **Step 4: Run the focused desktop-boundary tests and verify the source review statically.**

### Task 5: Verify the slice, update traceability, and sync PR #925

**Files:**
- Modify: `docs/09-development-plan.md`
- Modify: `docs/12-handoff.md`
- Modify: this plan's execution record

- [x] **Step 1: Run** `npm run build`, `npm run typecheck`, focused candidate/store/export/security tests, `.github/scripts/verify-predevelopment.py`, and `git diff --check`; record exact outputs.
- [x] **Step 2: Run the full `npm test` suite** and compare against the fresh baseline of 1,251 total / 1,196 passed / 43 failed / 12 skipped; report any changed failure set rather than claiming the suite passed.
- [x] **Step 3: Update only evidence-backed TASK-013 status** in `docs/09-development-plan.md` and `docs/12-handoff.md`; retain #857 and #925 as Open and list genuine remaining work.
- [x] **Step 4: Re-run relevant checks after documentation edits, inspect the full diff and working tree, and create a local commit.**
- [x] **Step 5: Push the existing PR #925 branch and verify the exact new SHA, required check status, and Windows candidate/shell-smoke jobs through GitHub.** Do not merge the PR or create a Release.

**Execution receipt (2026-11-22, final current-head check):** PR #925 remains open and unmerged at exact head `51c12933e5ac3203682e0e2c07b0c65703171cd4`, based on `main@146f9a987e7e633496d723e7f517c68282e1fe07`. GitHub reports 30 check runs: 28 successful, 2 optional diagnostic jobs skipped, and 0 failures. Application Skeleton Checks run `45017092193`, Windows Candidate EXE and ZIP run `45017092162` at attempt 2, Documentation Integrity, Issue Coordination, and the complete isolated Tampermonkey matrix all passed at this exact head. The first Candidate attempt recorded `SHELL_SMOKE_DROPPED_FIRST_READ_NOT_STARTED`; after reading the failed job log, only the failed job was rerun and the second attempt passed. This rerun is not evidence that the smoke ordering, early source-identity validation, or expired-candidate recovery copy issues identified by read-only review are fixed. The PR was not merged, no Issue was closed, and no Release was created. The next continuation starts from `51c1293` with those three fixes still pending.
