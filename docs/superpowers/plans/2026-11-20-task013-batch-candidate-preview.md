# TASK-013 batch candidate preview plan

## Goal

After the ordinary imported-script DOM observation, produce a **review-only in-memory selector candidate** only when the source and the measured page provide one narrow, unambiguous pair of literal selectors. This advances #857 from diagnosis toward rule-based repair without writing files, executing a userscript, installing anything, or claiming manager, GM, login, or business success.

## Strict candidate eligibility

- The native DOM observation consent must have succeeded before candidate planning starts.
- Source text is eligible only when the current import is strict UTF-8 without a BOM, no more than 256 KiB, and its UTF-8 hash equals the imported SHA-256.
- Keep that source in the main process only, for at most five minutes, with a 16 MiB per-window cap. Clear all retained candidate sources after a DOM batch settles or the window closes. Do not add source text to IPC replies, logs, journals, files, the plan index, or PR comments.
- Reparse the source and require exactly two distinct, top-level literal `querySelector` / `querySelectorAll` sites without fallback or dynamic sites. Anything else reports a bounded reason and creates no proposal.
- Reuse `proposeFromReadOnlyDomDiagnostic` and `proposeLiteralSelectorPatch`. The existing planner remains authoritative for exact `@match`, minimal grants, unsupported directives, native Document binding, exact AST offset, selector syntax, source hash, stable repeated DOM evidence, and iframe/shadow coverage.
- The two candidate directions are tried only to identify the single selector with zero matches and the other with positive matches. At most one candidate result is allowed per script.
- Return only hashes, a bounded one-token before/after change, candidate status/reason, and flags fixed false. Keep full candidate source inside main and discard it after shaping the summary. Never export, stage, apply, or update a manager in this increment.

## TDD steps

1. Add failing tests for one eligible missing/present pair, both reversed directions, stale source identity, unsupported metadata, three-selector ambiguity, unstable DOM samples, and incomplete frame/shadow coverage.
2. Implement the strict main-only candidate planner and pass the pure tests.
3. Add expiring/capped source retention to the main-only imported diagnostic index; verify sources never appear in plans or serialized replies and are cleared/expire safely.
4. Reuse one sampled `DynamicObservation` in the main batch handler, attach only the bounded candidate summary, and clear candidate source memory in every success/cancel/failure path.
5. Update the existing ordinary UI result to show an optional candidate summary and the `CANDIDATE_ONLY` / no-write / unverified limits; do not add selector entry fields.
6. Run build, typecheck, candidate/index/imported-DOM/security tests, predevelopment verification, and diff checks. Push the independently verified unit to PR #925 and inspect the new head's Windows checks.

## Remaining after this increment

#857 remains open. Actual backup/versions, user-selected export, optional AI, same-session Tampermonkey installation/injection, GM round-trip, business positive/negative assertions, failure recovery, and Stable GATE/EXE+ZIP/final user acceptance remain required.

## Execution record

- Implemented the main-only UTF-8 source sidecar (256 KiB per source, 16 MiB per window, five-minute TTL, batch/window cleanup), strict top-level AST eligibility, one-sample-series reuse, a 16-item preview ceiling, and a renderer-safe one-literal summary.
- TDD failures observed: nested selector source incorrectly returned `CANDIDATE_ONLY`; after the top-level-only guard the candidate suite passed. BOM/malformed UTF-8 input returned a generic selector result; explicit strict decoding now returns `INVALID_UTF8_SOURCE`.
- Local checks passed: build, typecheck, diff check, 88/88 focused tests, and 28 REQ/TEST + 21 TASK + 11 GATE predevelopment verification.
- Full `npm test`: 1,232 total / 1,177 pass / 43 fail / 12 skipped. Failures are in the existing TASK-011 restore-path group, TEST-003 symlink permission case, and TASK-018 E2E case; the suite is not green.
- Manual TASK-005 Windows Profile comparison on baseline SHA `de09c313efe0c354e6a6e9a92a29238d664d31d0`, run [#44763006479](https://github.com/devin930906/userscript-auto-healer/actions/runs/44763006479): cold and preinitialized Profiles both passed the unchanged 20-second owned-Chrome, PID, and WebSocket checks. This single comparison does not explain the prior timeout.
- PR #925 at pre-push head `de09c313efe0c354e6a6e9a92a29238d664d31d0` still had a boundary `CDP_TIMEOUT` failure and a Candidate registered-regression failure; later Windows checks must be read at the new exact head.
- Independent review findings were reproduced and fixed before push: (1) branch/conditional selector sites were marked top-level, (2) replacement sites were not required to target native `document` with exactly one argument, (3) source retention pruned only on later lookups, (4) a delayed import could write into a replacement window index, and (5) invalid-target/no-browser returns skipped cleanup while imports could add sources during an active DOM batch.
- Follow-up regression coverage now rejects conditional, branch, non-Document and extra-argument alternatives; verifies eager expiry and owner identity; verifies batch early-return cleanup and blocks import entry points during DOM observation. The full registered `npm test` command now includes the imported DOM index and candidate planner suites.
- Final focused verification after the review fix: build, typecheck, predevelopment verifier and diff check passed; selector/analyzer, candidate, index lifecycle, desktop boundary and test-registration coverage passed 96/96.
- Final registered `npm test`: 1,247 total / 1,192 pass / 43 fail / 12 skipped. The same 43 existing TASK-011 restore-path, TEST-003 symlink-permission and TASK-018 E2E failures remain; the full suite is not green.
- Follow-up PR-head audit at `5a0480055bb515f587176fece14ac54cc2f61a50`: Windows `windows-shell-smoke` failed `DROPPED_BATCH_RELOAD_SETUP_FAILED`; Candidate Windows packaging failed `SHELL_SMOKE_DROPPED_BATCH_CHECKPOINT_NOT_VISIBLE`. Boundary, portable Chrome, docs, Issue coordination and the listed isolated Tampermonkey matrix jobs completed successfully; those successes do not replace the failed Electron smoke jobs or prove real user acceptance.
- Follow-up TDD for smoke identity/settlement: the new `desktop-boundary` assertion first failed because the checkpoint smoke matched only generic status text and did not wait for renderer import controls to return idle. It now waits for idle before dispatch, requires the unique `checkpoint-smoke.user.js` result plus the checkpoint message and idle state after dispatch, and returns bounded failure-stage codes. Build and desktop-boundary 79/79 pass; `git diff --check` passes.
- Follow-up full local `npm test`: 1,248 total / 1,193 pass / 43 fail / 12 skipped. The same 43 previously recorded TASK-011 restore-path, TEST-003 symlink-permission and TASK-018 E2E failure categories remain.
- Local Electron 44.9.1 `--uahtest-shell-only` reproduction with isolated temporary app-data paths exited `-1073741819` (`0xC0000005`) without a receipt. The user supplied a matching `electron.exe` access-violation screenshot and reported earlier repeated failures. Current sandbox Application Event ID 1000 lookup had no matching Electron entry, so the native fault module/root cause is unknown; this is not a smoke pass and no further local Electron reproduction was run.
- Task 6 remains in progress pending local commit/GitHub synchronization and Windows verification at the exact new PR head.
