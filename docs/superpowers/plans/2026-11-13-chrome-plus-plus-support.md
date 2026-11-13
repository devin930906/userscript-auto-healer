# Chrome++ (version.dll / chrome++.ini) Architecture Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide first-class Windows support for portable Chrome distributions using the Chrome++ (`version.dll` and `chrome++.ini`) launcher architecture in both "Connect to Existing Chrome" (`browser:connect-existing`) and "Launch Isolated Chrome" (`browser:start`) modes.

**Architecture:**
1. Add Chrome++ profile resolution and detection in `src/browser/chrome-plus-plus.ts`, parsing `chrome++.ini` when present to resolve `data_dir` (handling `%app%` expansion and relative paths).
2. Enhance `chromeProcessMatches` in `src/browser/existing-chrome.ts` to allow matching running Chrome++ processes that omit `--user-data-dir` on their command line when `chrome++.ini` dictates the matching profile.
3. Enhance `launchApprovedIsolatedChrome` in `src/browser/owned-chrome.ts` to handle trampoline process architectures (where the initial launcher exits with code 0 after spawning the real browser process), verify loopback listener ownership by inspecting the spawned child process tree, and track the active browser PID for lifecycle and shutdown.
4. Add comprehensive unit tests in `tests/browser/chrome-plus-plus.test.ts`, `tests/browser/existing-chrome.test.ts`, and `tests/browser/owned-chrome.test.ts`.

**Tech Stack:** Node.js 22, TypeScript, Electron, Windows Win32_Process via PowerShell/CIM, Chrome DevTools Protocol (CDP).

**Spec:** DevinOoi's core requirement: Userscript Auto Healer must fully support Chrome++ portable distributions (`version.dll` / `chrome++.ini`), preventing `LAUNCH_FAILED` when launching isolated Chrome and `PROCESS_IDENTITY_MISMATCH` when connecting to running Chrome.

## Global Constraints

- Never mutate, touch, or terminate user's personal browsers (e.g. `D:\浏览器配置\【凌嗷】`).
- Retain Fail-Closed security: Authenticode verification (`Google LLC`), port range checks, and loopback verification are strictly preserved.
- Pass all 1,083 existing tests and the Electron isolated renderer smoke test (`--uahtest-shell-only`).

## Review Focus

1. Trampoline launcher exits with code 0 while child browser takes up to 3 seconds to bind CDP port: ensure timeout is respected and clean exit 0 does not trigger `LAUNCH_FAILED`.
2. Process tree ownership: ensure listener PID is strictly verified as either matching `child.pid` or having `ParentProcessId === child.pid` and matching executable and profile.
3. `chrome++.ini` path resolution: ensure `%app%` case-insensitivity, Windows path delimiters, and directory traversal restrictions are properly handled.
4. Process termination: when `stop()` is called on an owned Chrome++ session, the real effective browser PID and any matching child processes are reliably killed.
5. `isLiveApprovedChromeSession`: accurately reports session liveness using the effective browser PID even after the trampoline launcher has exited with code 0.

---

### Task 1: Chrome++ Configuration & INI Parser Helper

**Files:**
- Create: `src/browser/chrome-plus-plus.ts`
- Create: `tests/browser/chrome-plus-plus.test.ts`

- [ ] Write unit tests in `tests/browser/chrome-plus-plus.test.ts` for `parseChromePlusPlusIni` and `resolveChromePlusPlusDataDir`:
  - Test `%app%\..\Data` expansion relative to `App\chrome.exe`.
  - Test absolute `data_dir` paths.
  - Test fallback when `chrome++.ini` or `data_dir` is missing.
  - Test malicious or invalid paths (contain invalid characters or traverse out of bound).
- [ ] Implement `src/browser/chrome-plus-plus.ts`:
  - `isChromePlusPlus(executablePath: string): boolean` (checks for `version.dll` or `chrome++.ini` in the executable directory).
  - `getChromePlusPlusConfiguredDataDir(executablePath: string): string | null` (reads `chrome++.ini`, extracts `data_dir` in `[general]` section, replaces `%app%` with executable directory, normalizes).
- [ ] Run `npm run build && node --test dist/tests/browser/chrome-plus-plus.test.js` to ensure tests pass.
- [ ] Commit task changes.

### Task 2: Enhance Existing Chrome Matching for Chrome++

**Files:**
- Modify: `src/browser/existing-chrome.ts:79-101`
- Modify: `tests/browser/existing-chrome.test.ts`

- [ ] Write unit tests in `tests/browser/existing-chrome.test.ts` for `chromeProcessMatches` with Chrome++ command line:
  - Command line has NO `--user-data-dir`, but `chrome++.ini` in executable directory points to `expectedProfile` -> return `true`.
  - Command line has NO `--user-data-dir` and `chrome++.ini` points elsewhere -> return `false`.
  - Command line has explicit `--user-data-dir` (standard behavior) -> return `true` if matched, `false` if not.
- [ ] Modify `src/browser/existing-chrome.ts`:
  - Import `getChromePlusPlusConfiguredDataDir` from `./chrome-plus-plus`.
  - In `chromeProcessMatches`: if `values.length === 0`, check if `getChromePlusPlusConfiguredDataDir(actualExe)` matches `wantedProfile`.
- [ ] Run `npm run build && node --test dist/tests/browser/existing-chrome.test.js` to verify.
- [ ] Commit task changes.

### Task 3: Support Trampoline Launching & Descendant Listener in Owned Chrome

**Files:**
- Modify: `src/browser/owned-chrome.ts:370-525`
- Modify: `tests/browser/owned-chrome.test.ts`

- [ ] Write tests in `tests/browser/owned-chrome.test.ts` simulating a trampoline launcher:
  - Mock `spawn` where child emits `exit` with code 0 after 50ms, while a descendant process (mocked listener) opens the CDP port.
  - Assert that launch succeeds with `OWNED_CDP_BROWSER_VERIFIED`.
  - Assert that child exiting with non-zero code (e.g. 1) still fails with `LAUNCH_FAILED`.
  - Assert that child exiting with 0 but no descendant listening within timeout fails with `CDP_TIMEOUT`.
- [ ] Modify `src/browser/owned-chrome.ts`:
  - Allow `child` exit with `code === 0` without immediately triggering `LAUNCH_FAILED`. Set `trampolineExited = true`.
  - If `child` exits with non-zero or error, set `errored = true` and fail as `LAUNCH_FAILED`.
  - In listener verification: if listening PID does not equal `child.pid`, verify whether the listener has `ParentProcessId === child.pid` or matches `chromeProcessMatches` with same binary and data directory.
  - Store the effective listening PID in the verified session.
  - Update `stop()` to terminate the effective PID and child process.
  - Update `isLiveApprovedChromeSession` to verify liveness of the effective PID if trampoline exited.
- [ ] Run `npm run build && node --test dist/tests/browser/owned-chrome.test.js` to verify.
- [ ] Commit task changes.

### Task 4: Full Regression & Smoke Verification

**Files:**
- Verify: `app/main/index.ts`
- Run: `npm test`
- Run: `$env:GITHUB_ACTIONS = 'true'; & .\node_modules\.bin\electron.cmd . --uahtest-shell-only`

- [ ] Run typecheck: `npm run typecheck`.
- [ ] Run full test suite: `npm test` (all 1,083+ tests).
- [ ] Run Electron isolated smoke test with `$env:GITHUB_ACTIONS = 'true'` to verify 0 regressions in real renderer.
- [ ] Verify local portable installation at `E:\【Devin】\【Devin超级笔记】\99【草稿文件夹】\6\Userscript-Auto-Healer-v1.1.0-a7cf693acc61-CANDIDATE-Portable`.
- [ ] Commit and merge via PR into `main`.
- [ ] Release new version `v1.1.2` on GitHub and publish assets.
