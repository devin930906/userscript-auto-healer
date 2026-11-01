#!/usr/bin/env python3
"""Owner-authorized, monotonic Git coordination for governance #565.

Production: operator may initialize and inspect #565; recovery and acquisition
require explicit owner-authorized Actions invocation. Historical work ref stays.
No production release through workflow inputs: private owner proof is never
published in Actions logs/dispatch data.
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = "devin930906/userscript-auto-healer"
ROOT = "https://api.github.com/repos/" + REPO
OWNER = "devin930906"
ISSUE = 565
LEGACY_SHA = "ced1316eacf7fc9aee76a27d8fa1debdacb34248"
PREFIX = "coord/v2 "

class Blocked(Exception):
    pass

def require(condition, message):
    if not condition:
        raise Blocked(message)

def canonical(state):
    return json.dumps(state, separators=(",", ":"), sort_keys=True)

def api(method, path, data=None):
    body = None if data is None else canonical(data).encode("utf-8")
    req = Request(ROOT + path, data=body, method=method, headers={
        "Authorization": "Bearer " + os.environ["GH_TOKEN"],
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "issue565-owner-recovery-v2",
    })
    try:
        with urlopen(req, timeout=35) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload else {}
    except HTTPError as exc:
        return exc.code, {"message": exc.read().decode("utf-8", "replace")[:600]}
    except URLError as exc:
        raise Blocked("Uncertain GitHub result: readback required; do NOT blindly retry") from exc

def get(path):
    status, data = api("GET", path)
    require(status == 200, "GitHub GET failed for " + path + ": " + str(status))
    return data

def ref_path(name):
    require(re.fullmatch(r"(?:coord/issue-565|test/v2-565-[0-9]+-[0-9]+)", name) is not None, "Ref outside governance coordinator scope")
    return "/git/ref/heads/" + quote(name, safe="/")

def head(name):
    data = get(ref_path(name))
    require(data.get("ref") == "refs/heads/" + name and data.get("object", {}).get("type") == "commit", "Ref mismatch")
    return data["object"]["sha"]

def state_at(commit_sha):
    commit = get("/git/commits/" + commit_sha)
    message = commit.get("message", "")
    require(message.startswith(PREFIX), "Unrecognized coordinator commit")
    try:
        state = json.loads(message[len(PREFIX):])
    except ValueError as exc:
        raise Blocked("Corrupt coordinator JSON") from exc
    require(state.get("v") == 2 and state.get("repo") == REPO and state.get("issue") == ISSUE, "Wrong coordinator version or Issue")
    require(state.get("status") in ("blocked_legacy", "released", "held"), "Bad state")
    require(type(state.get("round")) is int and state["round"] >= 0, "Bad round")
    require(state.get("owner_login") in (None, OWNER), "Bad owner")
    if state["status"] == "held":
        require(state["owner_login"] == OWNER and re.fullmatch("[0-9a-f]{64}",state.get("proof_hash","")) is not None, "Invalid held owner proof")
    else:
        require(state.get("owner_login") is None and state.get("proof_hash") is None, "Unreleased owner data in free state")
    return state, commit

def new_commit(parent, state):
    parent_data = get("/git/commits/" + parent)
    code, data = api("POST", "/git/commits", {
        "message": PREFIX + canonical(state),
        "tree": parent_data["tree"]["sha"], "parents": [parent],
    })
    require(code == 201, "Could not create immutable coordinator commit: " + str(code))
    return data["sha"]

def state_step(state, op, proof_hash=None, secret=None):
    next_state = dict(state)
    if op == "recover":
        require(state["status"] == "blocked_legacy" and state["round"] == 0, "Recovery not eligible")
        next_state.update(status="released", owner_login=None, proof_hash=None,
                          recovery="2026-11-01: repository-owner-authorized governance-only recovery; historical ref retained")
    elif op == "acquire":
        require(state["status"] == "released", "Issue is occupied or blocked")
        require(isinstance(proof_hash, str) and re.fullmatch("[0-9a-f]{64}", proof_hash), "Owner proof digest missing")
        next_state.update(round=state["round"]+1,status="held",
                          owner_login=OWNER,proof_hash=proof_hash)
    elif op == "release":
        require(state["status"] == "held", "No current owner")
        require(isinstance(secret,str) and len(secret) >= 32, "Missing private owner proof")
        expected=hashlib.sha256(secret.encode("utf-8")).hexdigest()
        require(hmac.compare_digest(expected,state["proof_hash"]), "Wrong owner secret")
        next_state.update(status="released",owner_login=None,proof_hash=None)
    else:
        raise Blocked("Unsupported production transition")
    return next_state

def forward(name, expected, state):
    candidate=new_commit(expected,state)
    endpoint=ref_path(name).replace("/git/ref/", "/git/refs/",1)
    status, _=api("PATCH",endpoint,{"sha":candidate,"force":False})
    if status != 200:
        latest=head(name)
        raise Blocked("Concurrent update or rejected transition: HTTP " + str(status)
                      + "; remote currently " + latest + "; no blind retry")
    require(head(name)==candidate, "Uncertain successful update: remote SHA mismatch")
    verified,_=state_at(candidate)
    require(verified==state, "Coordinator round content mismatch")
    return candidate

def verify_owner_context():
    require(os.getenv("GITHUB_REPOSITORY")==REPO,"Wrong repository")
    require(os.getenv("GITHUB_REF")=="refs/heads/main","Only default-branch owner action")
    require(os.getenv("GITHUB_ACTOR")==OWNER,"Only authenticated repository owner can authorize recovery")
    require(os.getenv("GITHUB_EVENT_NAME")=="workflow_dispatch","Manual owner action required")
    current=head("main") if False else get("/git/ref/heads/main")["object"]["sha"]
    require(current==os.getenv("GITHUB_SHA"),"Main changed since workflow dispatch; stop")
    require(head("work/issue-565") == LEGACY_SHA if False else
            get("/git/ref/heads/work/issue-565")["object"]["sha"]==LEGACY_SHA,
            "Historical #565 claim changed: stop")
    prs=get("/pulls?state=open&per_page=100")
    require(len(prs)<100 and not prs,"Competing open PR or incomplete PR listing")

def initialize():
    verify_owner_context()
    start=os.environ["GITHUB_SHA"]
    state=dict(v=2,repo=REPO,issue=ISSUE,round=0,status="blocked_legacy",
               owner_login=None,proof_hash=None,
               legacy_ref_sha=LEGACY_SHA,bootstrap_main=start)
    commit=new_commit(start,state)
    code,data=api("POST","/git/refs",{"ref":"refs/heads/coord/issue-565","sha":commit})
    if code!=201:
        raise Blocked("Create-only coordinator ref refused: "+str(code)+
                      "; read existing ref, never overwrite")
    require(head("coord/issue-565")==commit,"Initializer readback mismatch")
    checked,_=state_at(commit)
    require(checked==state,"Initializer state mismatch")
    print("INIT_OK: held legacy claim preserved; coord/issue-565 currently BLOCKED_LEGACY; SHA="+commit)

def transition(op,proof_hash=None):
    verify_owner_context()
    name="coord/issue-565"
    old_sha=head(name)
    state,_=state_at(old_sha)
    require(state.get("legacy_ref_sha")==LEGACY_SHA,"Unexpected legacy snapshot")
    next_state=state_step(state,op,proof_hash)
    candidate=forward(name,old_sha,next_state)
    print("TRANSITION_OK:",op,"round",next_state["round"],"state",next_state["status"],"sha",candidate)
    print("No product claim was released or acquired; all work/issue-* refs unchanged")

def inspect():
    sha=head("coord/issue-565")
    state,_=state_at(sha)
    print(canonical({"ref":"refs/heads/coord/issue-565","sha":sha,"round":state["round"],
                     "status":state["status"],"owner_login":state["owner_login"],
                     "legacy_ref_sha":state.get("legacy_ref_sha")}))
    print("Not certified: per-chat identity, historical product owner handoffs or Stable")

def self_test():
    init=dict(v=2,repo=REPO,issue=ISSUE,round=0,status="blocked_legacy",
              owner_login=None,proof_hash=None,legacy_ref_sha=LEGACY_SHA)
    assert state_step(init,"recover")["status"]=="released"
    free=state_step(init,"recover")
    digest=hashlib.sha256(("x"*48).encode()).hexdigest()
    hold=state_step(free,"acquire",digest)
    assert hold["round"]==1 and hold["status"]=="held"
    done=state_step(hold,"release",secret="x"*48)
    assert done["status"]=="released" and done["round"]==1
    assert state_step(done,"acquire",hashlib.sha256(b"new-round").hexdigest())["round"]==2
    for thunk in (
        lambda:state_step(init,"acquire",digest),
        lambda:state_step(hold,"acquire",digest),
        lambda:state_step(hold,"release",secret="wrong-secret-should-not-work"),
        lambda:state_step(done,"release",secret="x"*48),
        lambda:state_step(free,"recover"),
        lambda:state_step(free,"acquire","not-a-sha"),
    ):
        try: thunk()
        except Blocked: pass
        else: raise AssertionError("Invalid owner or round transition accepted")
    print("PASS: v2 owner proof, exclusive acquisition, release/reacquire, replay/duplicate rejects")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--self-test",action="store_true")
    p.add_argument("--operation",choices=("init","recover","acquire","inspect"))
    p.add_argument("--proof-hash")
    args=p.parse_args()
    if args.self_test: self_test(); return
    if args.operation=="init": initialize()
    elif args.operation=="recover": transition("recover")
    elif args.operation=="acquire": transition("acquire",args.proof_hash)
    elif args.operation=="inspect": inspect()
    else: raise Blocked("No production release through workflow dispatch: keep secret private")

if __name__=="__main__":
    try: main()
    except (Blocked, KeyError, ValueError, TypeError, AssertionError) as err:
        print("::error::"+str(err),file=sys.stderr)
        sys.exit(1)
