# TASK-013 imported candidate export design

## Intent

Connect the existing, strictly bounded imported DOM candidate preview to a separate, user-selected manual export. This advances Issue #857 without applying a userscript, updating Tampermonkey, or claiming manager, GM, business, or Stable verification.

## Scope and constraints

- The existing batch DOM observation remains read-only and continues to return only `UNKNOWN` evidence and an optional one-token candidate summary.
- A successful candidate may return an opaque capability ID to the renderer. Main keeps the ID's exact review context in a per-window memory store for at most five minutes, with no more than 16 live entries per window. The store holds the reviewed scenario and DOM observation, never a script path or script source.
- Export IPC accepts only the opaque ID. Main uses a native file picker to reselect the original `.user.js`, reimports it, and requires the same displayed filename and original SHA-256 before asking for backup/export directories and a final native confirmation.
- On confirmation, main consumes the capability once and reuses the existing imported manual export path to create independently named verified backup/checkpoint/export files. The source file is never overwritten. Renderer receives only bounded names, hashes, result codes, and false authority flags.
- Cancellation and source mismatch before final confirmation leave the short-lived candidate available for retry. An accepted write attempt consumes it, including a failed attempt, so the same authorization cannot replay.
- No candidate data is persisted to disk, journaled, logged, or sent to a model. Do not install or execute the exported userscript.
- Preserve current task and gate numbering. Real Tampermonkey/GM/business acceptance, failure recovery, remaining Stable gates, same-source EXE+ZIP, final human acceptance, and Release remain separate and incomplete.

## Approaches

1. Export only when the original import already has a main-owned native path. This is the smallest change, but drag/drop and folder batches cannot export their candidates.
2. Give each preview a short-lived opaque main-only capability and reselect the original file through a native dialog at export time. Rechecking the same name and SHA supports all three import entry points without trusting renderer paths. **Selected for this slice** because it covers the approved input routes while retaining the project's native write boundary.
3. Persist candidate source and DOM state for later export. This adds durable sensitive state beyond the current memory-only preview contract and is unnecessary for the current task.

## Verification and limits

Unit, IPC-boundary, and UI-boundary tests must cover owner and TTL binding, one-time use, exact source identity, selector-direction fidelity, cancellation, failed writes, and unchanged source bytes. Build, typecheck, the predevelopment verifier, diff checks, focused tests, the full suite, and PR #925's exact-head Windows checks remain required. This work proves only an independently backed-up manual export; it cannot clear #486 or GATE-007.
