#!/usr/bin/env python3
"""Read-only PR integration fence for round-coordinated product work.

Do not mistake a green check for enforced policy: GitHub must mark this check
required and protect coordination refs before production handoffs can begin.
"""
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = "devin930906/userscript-auto-healer"
ROOT = "https://api.github.com/repos/" + REPO
GOVERNANCE_ONLY = frozenset({
    "AGENTS.md",
    "docs/16-cross-session-issue-claims.md",
    "docs/18-production-coordination-gates.md",
    ".github/scripts/issue-merge-fence.py",
    ".github/workflows/governance-issue-merge-fence.yml",
})
IMPLEMENTATION_BRANCH = re.compile(r"^impl/issue-([1-9][0-9]*)-r([1-9][0-9]*)$")
COORD_MESSAGE = "coord/v2 "
LEGACY_ISSUES = frozenset({215, 440, 480, 486, 487, 488, 489, 510})

class Blocked(Exception):
    pass

def api(endpoint):
    req = Request(ROOT + endpoint, method="GET", headers={
        "Authorization": "Bearer " + os.environ["GH_TOKEN"],
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "issue-565-pr-fence",
    })
    try:
        with urlopen(req, timeout=30) as response:
            return json.load(response)
    except (HTTPError, URLError) as exc:
        raise Blocked("GitHub API unavailable; deny integration: " + str(exc)) from exc

def require(condition, message):
    if not condition:
        raise Blocked(message)

def paginate(endpoint, limit=300):
    items = []
    for page in range(1, 5):
        suffix = ("&" if "?" in endpoint else "?") + "per_page=100&page=" + str(page)
        batch = api(endpoint + suffix)
        require(isinstance(batch, list), "Unexpected API list result")
        items.extend(batch)
        require(len(items) <= limit, "GitHub pagination limit reached")
        if len(batch) < 100:
            return items
    raise Blocked("Incomplete GitHub paginated listing")

def validate_coord(state, number, round_id, actor, sha):
    require(state.get("v") == 2 and state.get("repo") == REPO, "Unrecognized production coordination version")
    require(state.get("issue") == number and state.get("round") == round_id, "Stale Issue round")
    require(state.get("status") == "held", "Issue has no current holder")
    require(state.get("owner_login") == actor, "PR author is not coordination owner")
    require(state.get("sha") in (None, sha), "Coordination state refers to another commit")
    require(re.fullmatch("[0-9a-f]{64}", state.get("proof_hash", "")) is not None, "Missing owner proof digest")
    return True

def classify(pr, paths, coord_sha=None, coord_state=None, ancestry=None):
    require(pr.get("state") == "open", "PR is not open")
    require(pr.get("base", {}).get("ref") == "main", "Unexpected base branch")
    require(pr.get("head", {}).get("repo", {}).get("full_name") == REPO, "No cross-repo head allowed")
    require(pr.get("head", {}).get("sha"), "No PR head SHA")
    require(bool(paths) and len(paths) == len(set(paths)), "Missing or duplicate file listing")
    branch = pr["head"]["ref"]
    if branch.startswith("repair/issue565-production-pr-fence-"):
        require(set(paths).issubset(GOVERNANCE_ONLY), "Governance PR changes files outside fixed allowlist")
        return "governance_only"
    m = IMPLEMENTATION_BRANCH.fullmatch(branch)
    require(m is not None, "Uncoordinated branch cannot enter main (including legacy work/issue-N)")
    number, round_id = map(int, m.groups())
    require(number in LEGACY_ISSUES, "Issue outside explicitly reviewed coordination scope")
    require(isinstance(coord_sha, str) and re.fullmatch("[0-9a-f]{40}", coord_sha), "Missing current coordination head")
    require(isinstance(coord_state, dict), "Missing coordination state")
    require(pr.get("user", {}).get("login"), "Missing PR author")
    validate_coord(coord_state, number, round_id, pr["user"]["login"], coord_sha)
    require(ancestry == coord_sha, "Implementation head is not descendant of current coordination round")
    return "coordinated_product"

def parse_commit(message):
    require(message.startswith(COORD_MESSAGE), "Coordination commit format invalid")
    try:
        state = json.loads(message[len(COORD_MESSAGE):])
    except json.JSONDecodeError as exc:
        raise Blocked("Invalid coordination JSON") from exc
    require(isinstance(state, dict), "Coordination state must be object")
    return state

def self_test():
    pr = {
        "state":"open",
        "base":{"ref":"main"},
        "head":{"ref":"repair/issue565-production-pr-fence-20261101",
                "sha":"a"*40,"repo":{"full_name":REPO}},
        "user":{"login":"devin930906"},
    }
    assert classify(pr, ["docs/18-production-coordination-gates.md"]) == "governance_only"
    bad = dict(pr, head={**pr["head"], "ref":"work/issue-510"})
    for item in (
        lambda: classify(bad, ["src/app.ts"]),
        lambda: classify(pr, ["src/app.ts"]),
        lambda: classify(pr, []),
        lambda: classify(dict(pr,base={"ref":"elsewhere"}), ["AGENTS.md"]),
    ):
        try: item()
        except Blocked: pass
        else: raise AssertionError("Unsafe PR accepted")
    p = dict(pr, head={**pr["head"],"ref":"impl/issue-510-r2"})
    state = {"v":2,"repo":REPO,"issue":510,"round":2,"status":"held",
             "owner_login":"devin930906","proof_hash":"f"*64}
    assert classify(p, ["src/app.ts"],"b"*40,state,"b"*40) == "coordinated_product"
    for coord, owner, ancestor in (
        ("c"*40, "devin930906", "b"*40),
        ("b"*40, "other-owner", "b"*40),
        ("b"*40, "devin930906", "c"*40),
    ):
        try: classify(p, ["src/app.ts"],coord,{**state,"owner_login":owner},ancestor)
        except Blocked: pass
        else: raise AssertionError("Stale or impersonated round accepted")
    try: parse_commit("coord/v1 {}")
    except Blocked: pass
    else: raise AssertionError("Test-only coordinator format accepted as production")
    assert parse_commit(COORD_MESSAGE+json.dumps(state)) == state
    print("PASS: rejects uncoordinated, stale, wrong-owner, wrong-ancestry and off-scope PRs")

def live():
    require(os.environ.get("GITHUB_REPOSITORY") == REPO, "Wrong repository")
    require(os.environ.get("GITHUB_EVENT_NAME") == "pull_request", "Expected PR event")
    number = int(os.environ["PR_NUMBER"])
    expected_head = os.environ["EXPECTED_HEAD_SHA"]
    pr = api("/pulls/" + str(number))
    require(pr["head"]["sha"] == expected_head, "PR head has changed")
    files = paginate("/pulls/" + str(number) + "/files")
    paths = [x["filename"] for x in files]
    branch = pr["head"]["ref"]
    coord_sha = None
    coord_state = None
    ancestor = None
    match = IMPLEMENTATION_BRANCH.fullmatch(branch)
    if match:
        issue_num = int(match.group(1))
        ref = api("/git/ref/heads/" + quote("coord/issue-" + str(issue_num), safe="/"))
        require(ref.get("ref") == "refs/heads/coord/issue-" + str(issue_num), "Wrong coordinator ref")
        coord_sha = ref["object"]["sha"]
        commit = api("/git/commits/" + coord_sha)
        coord_state = parse_commit(commit.get("message", ""))
        comparison = api("/compare/" + coord_sha + "..." + expected_head)
        ancestor = comparison.get("merge_base_commit", {}).get("sha")
        require(comparison.get("status") in ("ahead", "identical"), "Implementation head diverged from current round")
        require(api("/issues/" + str(issue_num)).get("state") == "open", "Issue is no longer open")
    kind = classify(pr, paths, coord_sha, coord_state, ancestor)
    # Check TOCTOU once more. A mandatory branch policy is needed to secure the merge after this check.
    require(api("/pulls/" + str(number))["head"]["sha"] == expected_head, "Head changed during verification")
    if match:
        current_ref = api("/git/ref/heads/" + quote("coord/issue-" + match.group(1), safe="/"))
        require(current_ref["object"]["sha"] == coord_sha, "Coordination head changed during verification")
    print("PASS:", kind, "PR", number, "head", expected_head)
    print("WARNING: advisory until this check is server-required; no per-session auth asserted")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write("## Issue coordination PR fence\n\n")
            out.write("Result: PASS, mode " + kind + ".\n\n")
            out.write("**Required ruleset / coordinate ref protection not proven here.**\n")

if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif not sys.argv[1:]:
            live()
        else:
            raise Blocked("Only no args or --self-test supported")
    except (Blocked, AssertionError, KeyError, ValueError, TypeError) as exc:
        print("::error::" + str(exc), file=sys.stderr)
        sys.exit(1)
