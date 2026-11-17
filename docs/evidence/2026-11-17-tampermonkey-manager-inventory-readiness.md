# TASK-007 / REQ-017/018: Tampermonkey manager inventory readiness

**Status:** merged in [PR #901](https://github.com/devin930906/userscript-auto-healer/pull/901) as main commit 4129a966a2917801fe71f49d7d357f54404b8a77; live post-fix browser verification remains outstanding. Issue #486 stays open.

## User observation

The user supplied a screenshot of the Tampermonkey options page showing version 5.5.1, while UAH's Browser Environment page reported that the official Tampermonkey card was not found. The screenshot is user-provided and does not independently bind that page to the Chrome Profile launched by UAH. No screenshot or unrelated userscript inventory was copied into this repository.

## Diagnosis

The installation probe navigated to chrome://extensions/, waited for Page.loadEventFired, then immediately searched extensions-item cards. Chromium initializes the extensions manager asynchronously: ready() waits for getExtensionsInfo() before calling page initialization. A zero-card result before initialization is therefore not proof that the extension is absent.

Chromium source references:

- [manager.js: manager readiness and initialization](https://chromium.googlesource.com/chromium/src/+/86bff8b8d1c502460f6b2364489c0015c8d8796a/chrome/browser/resources/md_extensions/manager.js)
- [manager.html: extensions list hidden until initialization](https://chromium.googlesource.com/chromium/src/+/4c400b5eade7/chrome/browser/resources/extensions/manager.html)

## Correction

- The fixed, read-only manager expression returns inventoryReady: false until extensions-manager.didInitPage_ is true.
- The parser accepts NOT_INSTALLED only from a completed inventory.
- Pending inventory is retried with a monotonic four-second total budget. Each CDP evaluation receives a timeout no greater than the remaining budget or the normal five-second command cap; waits are capped at 250 ms.
- Expiry or unavailable inventory returns INSPECTION_UNAVAILABLE, preserving fail-closed behavior.
- The probe still reads only the Chrome management page's Tampermonkey metadata and does not read or modify userscripts, extension settings, or permissions.

## Verification

- Regression tests cover an empty uninitialized inventory, pending-to-ready discovery, and deadline expiry with fail-closed output.
- Focused manager suite: 10 passed, 0 failed.
- Full npm test: 1,146 tests, 1,134 passed, 0 failed, 12 conditional skips.
- npm run build and git diff --check passed.

## Limits

The readiness signal didInitPage_ is a Chromium implementation detail rather than a public extension API. If it changes or is unavailable, the probe will fail closed as unavailable. This change has not been verified in a post-fix live browser session. The screenshot's Profile identity, Store provenance, userscript injection, GM API behavior, business recovery, backup, and rollback remain unverified. Issue #486 remains open; TEST-017/018 and GATE-004/005 are not passed. This work does not establish Stable readiness.
