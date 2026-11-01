# Issue #565 — append-only GitHub coordination progress

## 2026-11-01 actual implementation

The new script `.github/scripts/issue-round-coordinator.py` implements a deterministic round transition state machine using an immutable Git commit as the persistent coordination record. A fixed test ref is advanced only by GitHub API `PATCH git/refs` with `force:false`. Two sibling commits based on the same previous state cannot both advance: GitHub rejects the stale non-fast-forward update. No ref deletion or force update is needed.

The file is **deliberately test-only** and enforces `test/coord-round-<run_id>-<attempt>` for every write. The new manual-only Actions workflow exercises acquire/release/reacquire, wrong-owner and stale-round rejection, stale sibling and replay denial, and response-loss reconciliation by reading the exact remote commit. Existing `work/issue-*` branches and product code remain untouched.

## Security boundary

The marker currently represents an asserted execution context, **not cryptographic proof of a distinct ChatGPT chat**. Never label product-owner authentication complete on the basis of these tests. A public value appearing in a GitHub commit is not an authentication secret. A green voluntary CI job cannot block stale PR merges without an appropriate required branch policy.

## Pending production tasks

1. Bind owner to authenticated per-round proof (e.g., a per-session public key and Ed25519 signature over the exact operation and current immutable coordination head), with explicit authenticated release and owner-authorized recovery. Prove lost responses, replay and simultaneous contenders.
2. Deploy a mandatory GitHub **server-enforced** stale writer/merge check and verify it cannot be bypassed in the intended environment. The current API returned no repository rulesets and 403 when reading classic branch protection; do not claim the setting exists.
3. Individually reconcile the eight historical Issue work refs and legitimate exit/handoff evidence before a production reassignment.
4. Link real Actions run IDs and merge SHA to Issue #565 only after those runs pass. Keep Stable blocked until product TEST/GATE and Windows acceptance complete.

This new test workflow is independent of the earlier test-only claim lifecycle proof and the merged owner-authorized recovery PR #570. Neither test alone licenses product claim transfer.
