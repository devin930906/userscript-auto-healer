#!/usr/bin/env python3
"""TEST-ONLY immutable Git coordination. No production branch touches."""
import json
import os
import re
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import quote

REPO = "devin930906/userscript-auto-healer"
ROOT = "https://api.github.com/repos/" + REPO
PREFIX = "test/coord-round-"
OWNER_A = "owner-marker-a-0001"
OWNER_B = "owner-marker-b-0002"

class Blocked(Exception):
    pass

def step(state, command, marker, round_id):
    if state.get("v") != 1 or state.get("issue") != 565 or state.get("status") not in ("released", "held"):
        raise Blocked("invalid state")
    if type(round_id) is not int or state.get("round") != round_id:
        raise Blocked("stale round")
    if not re.fullmatch("[a-z0-9-]{12,80}", marker):
        raise Blocked("invalid marker")
    if command == "acquire":
        if state["status"] != "released":
            raise Blocked("claim occupied")
        return dict(v=1, issue=565, round=round_id+1, status="held", marker=marker)
    if command == "release":
        if state["status"] != "held" or state.get("marker") != marker:
            raise Blocked("not current owner")
        return dict(v=1, issue=565, round=round_id, status="released", marker=None)
    raise Blocked("unsupported operation")

def reject(fn):
    try:
        fn()
    except Blocked:
        return
    raise AssertionError("invalid state transition accepted")

def self_test():
    free = dict(v=1, issue=565, round=0, status="released", marker=None)
    a = step(free, "acquire", OWNER_A, 0)
    reject(lambda: step(a, "acquire", OWNER_B, 1))
    reject(lambda: step(a, "release", OWNER_B, 1))
    reject(lambda: step(a, "release", OWNER_A, 0))
    free1 = step(a, "release", OWNER_A, 1)
    b = step(free1, "acquire", OWNER_B, 1)
    reject(lambda: step(b, "release", OWNER_A, 1))
    reject(lambda: step(b, "release", OWNER_B, 1))
    assert step(b, "release", OWNER_B, 2)["status"] == "released"
    assert path("test/coord-round-1-1") == "/git/ref/heads/test/coord-round-1-1"
    assert path("test/coord-round-1-1").replace("/git/ref/", "/git/refs/", 1) == "/git/refs/heads/test/coord-round-1-1"
    print("PASS: local stale round/duplicate acquire/wrong owner rejects")

def api(method, endpoint, value=None):
    raw = None if value is None else json.dumps(value, separators=(",", ":")).encode("utf-8")
    req = Request(ROOT + endpoint, data=raw, method=method, headers={
        "Authorization": "Bearer " + os.environ["GH_TOKEN"],
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "test-coordination-rounds",
    })
    try:
        with urlopen(req, timeout=35) as response:
            body = response.read()
            return response.status, json.loads(body) if body else {}
    except HTTPError as exc:
        return exc.code, {"error": exc.read().decode("utf-8", "replace")[:500]}
    except URLError as exc:
        raise Blocked("unknown operation result: read back, do not retry") from exc

def expect(code, actual, context):
    if actual != code:
        raise Blocked(context + ": HTTP " + str(actual))

def path(name):
    if not re.fullmatch("test/coord-round-[0-9]+-[0-9]+", name):
        raise Blocked("never touch real Issue refs")
    return "/git/ref/heads/" + quote(name, safe="/")

def head(name):
    code, data = api("GET", path(name))
    expect(200, code, "get ref")
    if data.get("ref") != "refs/heads/" + name:
        raise Blocked("ref name mismatch")
    return data["object"]["sha"]

def new_commit(parent, state):
    code, prev = api("GET", "/git/commits/" + parent)
    expect(200, code, "parent")
    code, data = api("POST", "/git/commits", {
        "message": "coord/v1 " + json.dumps(state, sort_keys=True, separators=(",", ":")),
        "tree": prev["tree"]["sha"], "parents": [parent],
    })
    expect(201, code, "create immutable commit")
    return data["sha"]

def advance(name, sha):
    return api("PATCH", path(name).replace("/git/ref/", "/git/refs/", 1), {"sha": sha, "force": False})[0]

def check(name, sha):
    if head(name) != sha:
        raise Blocked("unexpected remote ref")
    code, data = api("GET", "/git/commits/" + sha)
    expect(200, code, "read state")
    if not data.get("message", "").startswith("coord/v1 "):
        raise Blocked("not a coordinator commit")
    return json.loads(data["message"][len("coord/v1 "):])

def live_test():
    if os.environ.get("GITHUB_REPOSITORY") != REPO or os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise Blocked("manual main-only test")
    name = PREFIX + os.environ["GITHUB_RUN_ID"] + "-" + os.environ["GITHUB_RUN_ATTEMPT"]
    start = os.environ["GITHUB_SHA"]
    code, _ = api("POST", "/git/refs", {"ref": "refs/heads/" + name, "sha": start})
    expect(201, code, "create test-only ref")
    assert head(name) == start
    free = dict(v=1, issue=565, round=0, status="released", marker=None)
    c0 = new_commit(start, free)
    expect(200, advance(name, c0), "init")
    assert check(name, c0) == free
    a = step(free, "acquire", OWNER_A, 0)
    c1 = new_commit(c0, a)
    expect(200, advance(name, c1), "round1 acquire")
    assert check(name, c1) == a
    reject(lambda: step(a, "acquire", OWNER_B, 1))
    free1 = step(a, "release", OWNER_A, 1)
    c2 = new_commit(c1, free1)
    expect(200, advance(name, c2), "round1 release")
    # Competing sibling states: ONLY one may advance on GitHub.
    a2 = step(free1, "acquire", OWNER_A, 1)
    c3a = new_commit(c2, a2)
    c3b = new_commit(c2, step(free1, "acquire", OWNER_B, 1))
    expect(200, advance(name, c3a), "round2 winner")
    loser = advance(name, c3b)
    if loser not in (409, 422):
        raise Blocked("stale sibling unexpectedly accepted: " + str(loser))
    assert check(name, c3a) == a2
    stale = new_commit(c1, step(a, "release", OWNER_A, 1))
    if advance(name, stale) not in (409, 422):
        raise Blocked("stale release unexpectedly accepted")
    assert check(name, c3a) == a2
    free2 = step(a2, "release", OWNER_A, 2)
    c4 = new_commit(c3a, free2)
    expect(200, advance(name, c4), "round2 release")
    b3 = step(free2, "acquire", OWNER_B, 2)
    c5 = new_commit(c4, b3)
    expect(200, advance(name, c5), "round3 reacquire")
    assert check(name, c5) == b3
    reject(lambda: step(b3, "release", OWNER_A, 3))
    # Simulate lost response: write succeeded, read back; do not repeat blindly.
    free3 = step(b3, "release", OWNER_B, 3)
    c6 = new_commit(c5, free3)
    expect(200, advance(name, c6), "round3 release")
    assert check(name, c6) == free3
    replay = new_commit(c4, step(free2, "acquire", OWNER_A, 2))
    if advance(name, replay) not in (409, 422):
        raise Blocked("old owner replay succeeded")
    assert check(name, c6) == free3
    print("PASS: GitHub CAS single winner, release, reacquire, stale sibling/replay rejected")
    print("TEST_ONLY_REF=" + name + " FINAL_SHA=" + c6)
    print("NOT PROVEN: session authentication, mandatory merge fencing, legacy handoffs")

if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif sys.argv[1:] == ["--live-test"]:
            self_test()
            live_test()
        else:
            raise Blocked("only test operations enabled")
    except (Blocked, AssertionError, KeyError, ValueError, TypeError) as exc:
        print("::error::" + str(exc), file=sys.stderr)
        sys.exit(1)
