# TASK-013 Automatic Read-Only DOM Diagnosis Plan

## Product intent

Connect the current AST import result to an ordinary per-script DOM observation path. The user supplies one exact HTTP(S) target URL and gives fresh native consent. Main uses bounded literal `querySelector` / `querySelectorAll` sites already found by the isolated AST Worker; the renderer never supplies selectors, source bytes, file paths, hashes, browser endpoints, or approval flags. Eligible independent scripts are checked in sequence in the application-owned Chrome. Missing AST, unsupported metadata scope, URL mismatch, missing browser ownership, cancellation, and per-script CDP errors remain explicit blocked/unknown outcomes while later scripts continue where safe.

All observations remain `LIMITED_DOM_SIGNAL_ONLY`. They do not attest to userscript injection, Tampermonkey, GM APIs, business assertions, or repair. No source is executed, changed, installed, overwritten, or exported by this increment. Existing advanced manual scenarios remain available as tools, not prerequisites.

## Technical boundaries

- Keep selector strings in the main-process memory sidecar only. Sanitize every reply before renderer IPC; never add raw selectors or source contents to the journal or health archive.
- Accept only bounded, independently validated Worker output. Only unique literal querySelector/querySelectorAll sites without fallback ancestry are eligible.
- Require user-provided exact URL plus a native confirmation that names it. Parse URL strictly and require each script's complete declared `@match` scope to be compatible with the target; unknown include/exclusion rules fail closed.
- Use the already-owned Chrome instance and existing limited DOM observer. No ordinary Chrome connection, browser endpoint, path, or user-script execution enters the new IPC.
- Bound scripts, selectors, per-page sample time, total batch duration and cancellation. Report each script result separately and preserve all verification/write flags as false.

## Implementation sequence (TDD)

1. Add a failing Worker-preview test proving bounded eligible literal selector sites and match-scope metadata are returned to main, while ordinary/public summaries still omit selector values.
2. Add a failing pure batch-planning test for valid match, unknown/excluded metadata, invalid URL, zero selector evidence, bounds and per-script failure isolation.
3. Add a failing IPC boundary test for no renderer selector/hash/path/consent input and fresh native consent plus owned-browser checks.
4. Add the main-process batch runner and narrow preload method; use the existing observer, continue independent scripts after item failures, and return only bounded status/count fields.
5. Add the ordinary diagnosis-workspace URL control and live status list. Keep manual selector registration behind its existing advanced disclosure.
6. Run build, typecheck, focused analyzer/session/boundary tests, predevelopment integrity and the applicable Windows checks. Record any still-unverified real Tampermonkey/GM/business gates.
7. Update affected development/traceability/handoff records, commit the unit and sync to PR #925 after verifying its current head. Keep the latest full Stable register local if the existing automatic payload review continues to reject it.

## Acceptance for this increment

- A user can trigger read-only DOM counts for eligible imported scripts without entering CSS selectors.
- No matching metadata, supported literal selector site, exact target, owned Chrome or native approval means an explicit per-script UNKNOWN/BLOCKED result and no page visit for that script.
- One script's invalid metadata, timeout or cancellation does not mislabel later scripts or grant any verification/write authority.
- Renderer responses, persisted journals, archives, logs and candidate paths contain no raw selector values or script source.
- The result remains distinct from the full #857 / TEST-022 / GATE-007 workflow; the remaining Tampermonkey, GM, business, candidate, backup and recovery stages stay open.

