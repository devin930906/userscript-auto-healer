#!/usr/bin/env python3
"""Trusted-base, read-only GitHub PR integration safety gate.

The *required status context* deliberately retains the historical
"Issue coordination / stale round fence" name because Ruleset #26307718
requires that exact context. As of 2026-11-02, the current (4)/(7)
instructions REMOVE exclusive Issue claiming. This gate does not grant
ownership, lock Issues, authenticate different chat sessions, or prove
that a green check will prevent every merge-time race.
"""
import os
import re
import sys
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REPO = "devin930906/userscript-auto-healer"
ROOT = "https://api.github.com/repos/" + REPO
LEGACY_WORK = re.compile(r"^work/issue-[0-9]+$")
LEGACY_COORD = re.compile(r"^coord/issue-[0-9]+$")

class Blocked(Exception):
    pass

def require(ok, message):
    if not ok:
        raise Blocked(message)

def api(endpoint):
    req = Request(ROOT + endpoint, method="GET", headers={
        "Authorization": "Bearer " + os.environ["GH_TOKEN"],
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "stable-pr-concurrency-safety",
    })
    try:
        with urlopen(req, timeout=30) as response:
            return json.load(response)
    except (HTTPError, URLError) as exc:
        raise Blocked("GitHub remote state unavailable; deny integration: " + str(exc)) from exc

def paginate(endpoint, limit=300):
    rows = []
    for page in range(1, 5):
        sep = "&" if "?" in endpoint else "?"
        batch = api(endpoint + sep + "per_page=100&page=" + str(page))
        require(isinstance(batch, list), "Unexpected GitHub list response")
        rows.extend(batch)
        require(len(rows) <= limit, "GitHub list exceeds safely checked bound")
        if len(batch) < 100:
            return rows
    raise Blocked("GitHub list not exhaustively checked")

def classify(pr, files, peer_files=None):
    """No claims: block unsafe refs and conflicting *paths*, not shared Issue numbers."""
    require(pr.get("state") == "open", "PR is not open")
    require(pr.get("base", {}).get("ref") == "main", "Expected main target")
    head = pr.get("head", {})
    require(head.get("repo", {}).get("full_name") == REPO, "Cross-repo PR not reviewed under this gate")
    branch = head.get("ref", "")
    require(bool(branch) and branch != "main", "Missing isolated change branch")
    require(not LEGACY_WORK.fullmatch(branch), "Preserved historical work/issue ref is read-only")
    require(not LEGACY_COORD.fullmatch(branch), "Coordinator ref is historical, not a code branch")
    require(re.fullmatch(r"[0-9a-f]{40}", head.get("sha", "")) is not None, "Invalid PR head SHA")
    require(pr.get("user", {}).get("login"), "Missing PR author")
    require(bool(files) and len(files) == len(set(files)), "Missing or duplicate changed-file manifest")
    require(len(files) <= 300, "Unbounded PR diff")
    for peer_number, paths in (peer_files or {}).items():
        duplicate = sorted(set(files).intersection(paths))
        require(not duplicate, "Concurrent open PR #" + str(peer_number) +
                " edits overlapping files: " + ", ".join(duplicate[:10]))
    return "isolated_pr_validated"

def self_test():
    pr = {"state": "open", "base": {"ref": "main"},
          "head": {"ref": "feat/task-009-part-a", "sha": "a"*40,
                   "repo": {"full_name": REPO}}, "user": {"login": "devin930906"}}
    assert classify(pr, ["src/repair/a.ts"], {2: ["src/version/b.ts"]}) == "isolated_pr_validated"
    # Two PRs on the same Issue MAY proceed if they edit different paths.
    assert classify({**pr, "head": {**pr["head"], "ref": "feat/task-009-part-b"}},
                    ["tests/repair/a.test.ts"], {2: ["src/repair/a.ts"]}) == "isolated_pr_validated"
    rejected = [
        (pr, ["src/repair/a.ts"], {2: ["src/repair/a.ts"]}),
        ({**pr, "head": {**pr["head"], "ref": "work/issue-510"}}, ["src/a.ts"], {}),
        ({**pr, "head": {**pr["head"], "ref": "coord/issue-510"}}, ["src/a.ts"], {}),
        ({**pr, "base": {"ref": "other"}}, ["src/a.ts"], {}),
        ({**pr, "head": {**pr["head"], "repo": {"full_name": "other/repo"}}}, ["src/a.ts"], {}),
        (pr, [], {}),
        (pr, ["src/a.ts", "src/a.ts"], {}),
    ]
    for candidate, paths, peers in rejected:
        try:
            classify(candidate, paths, peers)
        except Blocked:
            continue
        raise AssertionError("Unsafe PR accepted")
    print("PASS: independent PRs allowed; duplicate paths, legacy refs, forks and invalid PRs rejected")

def live():
    require(os.environ.get("GITHUB_REPOSITORY") == REPO, "Wrong repository")
    require(os.environ.get("GITHUB_EVENT_NAME") == "pull_request_target", "Requires trusted-base PR event")
    number = int(os.environ["PR_NUMBER"])
    expected_head = os.environ["EXPECTED_HEAD_SHA"]
    require(re.fullmatch(r"[0-9a-f]{40}", expected_head) is not None, "Invalid expected head SHA")
    pr = api("/pulls/" + str(number))
    require(pr["head"]["sha"] == expected_head, "PR head moved since event")
    require(pr["base"]["sha"] == api("/branches/main")["commit"]["sha"],
            "PR base differs from current main")
    files = [row["filename"] for row in paginate("/pulls/" + str(number) + "/files")]
    peers = {}
    for other in paginate("/pulls?state=open&base=main"):
        if other["number"] == number:
            continue
        peers[other["number"]] = [row["filename"] for row in
                                  paginate("/pulls/" + str(other["number"]) + "/files")]
    kind = classify(pr, files, peers)
    # Repeat snapshots at the end; new concurrent activity afterward still needs
    # strict Required Checks, review and explicit merge-time revalidation.
    fresh = api("/pulls/" + str(number))
    require(fresh["head"]["sha"] == expected_head, "PR head changed during validation")
    require(fresh["base"]["sha"] == api("/branches/main")["commit"]["sha"],
            "Main changed during validation")
    require(set(files) == set(row["filename"] for row in
                            paginate("/pulls/" + str(number) + "/files")),
            "File manifest changed during validation")
    print("PASS:", kind, "PR", number, "head", expected_head)
    print("NOTE: Legacy check context retained for Ruleset #26307718; no Issue ownership asserted")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write("## PR integration safety (no Issue claim)\n\n")
            out.write("PASS: checked main/head SHA and open PR file-path overlap.\n\n")
            out.write("Historical status-check name retained for ruleset compatibility.\n")

if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif not sys.argv[1:]:
            live()
        else:
            raise Blocked("Only --self-test or no arguments accepted")
    except (Blocked, AssertionError, KeyError, ValueError, TypeError) as exc:
        print("::error::" + str(exc), file=sys.stderr)
        sys.exit(1)
