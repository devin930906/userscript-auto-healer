#!/usr/bin/env python3
"""Fail-closed, READ-ONLY guard for the one-time owner-authorized #565 repair PR.

This does not claim, release, transfer, or authenticate an Issue owner.
It cannot replace required GitHub server-enforced branch/merge policies.
"""
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = "devin930906/userscript-auto-healer"
BRANCH = "repair/governance-565-bootstrap-20261101"
ALLOWED = frozenset({
    "AGENTS.md",
    "docs/16-cross-session-issue-claims.md",
    "docs/17-owner-authorized-governance-recovery.md",
    ".github/scripts/verify-governance-recovery.py",
    ".github/workflows/governance-recovery-guard.yml",
})
# Pin the immutable recovery starting inventory; fail if any historical ref moves.
EXPECTED_REFS = {
    215: "05210b7b03819fff01baf1c8fb9b86b8f98100ac",
    440: "c47ac7354a57033fb6ba3b6bc5bc5dd85e06a359",
    480: "f26aad0ca5dc900bb5d51fef2bc8adbbfaef7207",
    486: "171aca86f58d5d21bb98e8dcbde070d79b495298",
    487: "0e4410494d260f20d4a8883efb16dfd03ee87658",
    488: "ee0f007631aedf5f0a392a6f03ed211117a79e45",
    489: "a046b5766b9efa06790ae9acedc4c23f4f302dfd",
    510: "6d99c808d70dd6f7d4221e272d81a7b412cb081f",
    565: "ced1316eacf7fc9aee76a27d8fa1debdacb34248",
}


def api(path):
    request = Request(
        "https://api.github.com/repos/" + REPO + path,
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "issue-565-readonly-recovery-guard",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=25) as response:
            return json.load(response)
    except (HTTPError, URLError) as error:
        raise RuntimeError("GitHub GET unavailable (fail closed): " + str(error)) from error


def validate_pr(pr, expected_head):
    if pr.get("state") != "open":
        raise RuntimeError("Repair PR is not open")
    if pr.get("base", {}).get("ref") != "main":
        raise RuntimeError("Repair PR base must be main")
    if pr.get("head", {}).get("ref") != BRANCH:
        raise RuntimeError("Unexpected recovery branch")
    if pr.get("head", {}).get("repo", {}).get("full_name") != REPO:
        raise RuntimeError("Repair branch must belong to the original repository")
    if pr.get("head", {}).get("sha") != expected_head:
        raise RuntimeError("PR head moved since this check was queued")
    return True


def validate_paths(paths):
    if not paths or not set(paths).issubset(ALLOWED):
        raise RuntimeError("Unexpected or empty change scope; product code cannot enter repair PR")
    if "docs/17-owner-authorized-governance-recovery.md" not in paths:
        raise RuntimeError("Recovery decision record missing")
    if ".github/workflows/governance-recovery-guard.yml" not in paths:
        raise RuntimeError("Recovery guard itself missing")
    return True


def validate_refs(observed):
    if set(observed) != set(EXPECTED_REFS):
        raise RuntimeError("Incomplete historical claim ref inventory")
    for number, expected in EXPECTED_REFS.items():
        if observed[number] != expected:
            raise RuntimeError("Historical claim moved or disappeared: Issue #" + str(number))
    return True


def self_test():
    sample = {
        "state": "open",
        "base": {"ref": "main"},
        "head": {"ref": BRANCH, "repo": {"full_name": REPO}, "sha": "abc"},
    }
    assert validate_pr(sample, "abc")
    assert validate_paths({
        "docs/17-owner-authorized-governance-recovery.md",
        ".github/workflows/governance-recovery-guard.yml",
    })
    assert validate_refs(dict(EXPECTED_REFS))
    for broken in (
        {"state": "closed", **{k: v for k, v in sample.items() if k != "state"}},
        {**sample, "head": {**sample["head"], "sha": "other"}},
        {**sample, "head": {**sample["head"], "ref": "work/issue-565"}},
    ):
        try:
            validate_pr(broken, "abc")
        except RuntimeError:
            pass
        else:
            raise AssertionError("Unsafe PR accepted")
    for badpaths in (set(), {"src/main.ts"}, {"AGENTS.md"}):
        try:
            validate_paths(badpaths)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Unsafe paths accepted")
    tampered = dict(EXPECTED_REFS)
    tampered[565] = "0" * 40
    try:
        validate_refs(tampered)
    except RuntimeError:
        pass
    else:
        raise AssertionError("Moved claim accepted")
    print("PASS: recovery guard rejects non-scope, stale PR and moved claims")


def check_live():
    if os.environ.get("GITHUB_REPOSITORY") != REPO:
        raise RuntimeError("Wrong repository")
    if os.environ.get("GITHUB_EVENT_NAME") != "pull_request":
        raise RuntimeError("Only PR events are allowed")
    number = int(os.environ["RECOVERY_PR_NUMBER"])
    expected_head = os.environ["RECOVERY_PR_HEAD_SHA"]
    pr = api("/pulls/" + str(number))
    validate_pr(pr, expected_head)
    paths = []
    for page in range(1, 11):
        batch = api("/pulls/" + str(number) + "/files?per_page=100&page=" + str(page))
        paths.extend(item["filename"] for item in batch)
        if len(batch) < 100:
            break
    else:
        raise RuntimeError("PR file list exceeds pagination safety bound")
    validate_paths(set(paths))
    if len(paths) != len(set(paths)):
        raise RuntimeError("Duplicate file records")
    other_open = api("/pulls?state=open&per_page=100")
    if len(other_open) >= 100:
        raise RuntimeError("Open PR list might be incomplete")
    if {p["number"] for p in other_open} != {number}:
        raise RuntimeError("Another open PR exists: single-writer recovery not established")
    observed = {}
    for issue in EXPECTED_REFS:
        ref = "work/issue-" + str(issue)
        result = api("/git/ref/heads/" + quote(ref, safe="/"))
        if result.get("ref") != "refs/heads/" + ref or result.get("object", {}).get("type") != "commit":
            raise RuntimeError("Unexpected historical claim object")
        observed[issue] = result["object"]["sha"]
    validate_refs(observed)
    # TOCTOU detection: repeat refs and PR head after other reads.
    if api("/pulls/" + str(number))["head"]["sha"] != expected_head:
        raise RuntimeError("PR head changed during check")
    for issue, expected in EXPECTED_REFS.items():
        ref = "work/issue-" + str(issue)
        if api("/git/ref/heads/" + quote(ref, safe="/"))["object"]["sha"] != expected:
            raise RuntimeError("Claim ref changed during check")
    print("PASS: limited scope recovery PR; legacy refs unchanged; no competing open PR")
    print("NOT VERIFIED: previous owners exited, mandatory branch protection, production handoff")
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### #565 bootstrap recovery guard\n\n")
            f.write("PASS: limited recovery scope and unchanged historical refs.\n\n")
            f.write("**Not** production claim/release, branch protection, or Stable acceptance.\n")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif not sys.argv[1:]:
            check_live()
        else:
            raise RuntimeError("Only --self-test or no arguments supported")
    except (RuntimeError, KeyError, ValueError, AssertionError) as exc:
        print("::error::" + str(exc), file=sys.stderr)
        sys.exit(1)
