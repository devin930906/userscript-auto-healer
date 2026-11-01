#!/usr/bin/env python3
"""Owner-authorized, monotonic coordination for eight legacy product Issues and #565.

Production: operator may initialize and inspect #565; recovery and acquisition
require explicit owner-authorized Actions invocation. Historical work ref stays.
Private release uses an Ed25519 signature on round/head only; the signing key
is NEVER passed through Actions, logs or dispatch data.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = "devin930906/userscript-auto-healer"
ROOT = "https://api.github.com/repos/" + REPO
OWNER = "devin930906"
LEGACY_SHAS = {
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
ISSUE = int(os.environ.get("COORD_ISSUE_NUMBER", "565"))
LEGACY_SHA = LEGACY_SHAS.get(ISSUE)
PREFIX = "coord/v2 "
MAIN_ONLY_DIFF = {215: {"scripts/test-windows-portable-relocation.ps1": (
    "e71b350b6385f421b0cc9723ed35b55488c1c49c",
    "1365588f8b91e755c9989bb1a9bad686cf19a868")}}


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
    require(name == "coord/issue-" + str(ISSUE), "Ref outside selected Issue coordinator scope")
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
        public_key = state.get("owner_pubkey", "")
        require(state["owner_login"] == OWNER
                and isinstance(public_key, str)
                and re.fullmatch(r"[0-9a-f]{64}", public_key) is not None,
                "Invalid held Ed25519 public key")
        require(hmac.compare_digest(
            hashlib.sha256(bytes.fromhex(public_key)).hexdigest(),
            state.get("proof_hash", "")), "Owner public key digest mismatch")
    else:
        require(state.get("owner_login") is None
                and state.get("proof_hash") is None
                and state.get("owner_pubkey") is None,
                "Unreleased owner data in free state")
    return state, commit

def new_commit(parent, state):
    parent_data = get("/git/commits/" + parent)
    code, data = api("POST", "/git/commits", {
        "message": PREFIX + canonical(state),
        "tree": parent_data["tree"]["sha"], "parents": [parent],
    })
    require(code == 201, "Could not create immutable coordinator commit: " + str(code))
    return data["sha"]

def release_payload(state, expected_head_sha):
    """Signed message binds this specific repository/Issue/round/ref head."""
    require(isinstance(expected_head_sha, str) and
            re.fullmatch(r"[0-9a-f]{40}", expected_head_sha) is not None,
            "Expected coordinator commit SHA missing")
    return ("coord-release/v2\n" + REPO + "\n" + str(ISSUE) + "\n"
            + str(state["round"]) + "\n" + expected_head_sha + "\n").encode("utf-8")


def verify_release_signature(state, expected_head_sha, signature_hex):
    """Verify Ed25519 without ever sending the private key to GitHub Actions."""
    pubkey = state.get("owner_pubkey", "")
    require(isinstance(pubkey, str) and re.fullmatch(r"[0-9a-f]{64}", pubkey) is not None,
            "Invalid release public key")
    require(isinstance(signature_hex, str)
            and re.fullmatch(r"[0-9a-f]{128}", signature_hex) is not None,
            "Malformed Ed25519 signature")
    # RFC 8410 SubjectPublicKeyInfo prefix for the 32-byte Ed25519 public key.
    der = bytes.fromhex("302a300506032b6570032100" + pubkey)
    pem = (b"-----BEGIN PUBLIC KEY-----\n" +
           base64.encodebytes(der).replace(b"\n", b"") + b"\n-----END PUBLIC KEY-----\n")
    with tempfile.TemporaryDirectory(prefix="coord-owner-verify-") as directory:
        root = Path(directory)
        (root / "pub.pem").write_bytes(pem)
        (root / "signature.bin").write_bytes(bytes.fromhex(signature_hex))
        (root / "message.bin").write_bytes(release_payload(state, expected_head_sha))
        try:
            outcome = subprocess.run([
                "openssl", "pkeyutl", "-verify", "-pubin",
                "-inkey", str(root / "pub.pem"), "-sigfile",
                str(root / "signature.bin"), "-rawin", "-in",
                str(root / "message.bin")
            ], capture_output=True, timeout=12, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise Blocked("Ed25519 verification unavailable; fail closed") from exc
    require(outcome.returncode == 0, "Ed25519 release signature rejected")


def state_step(state, op, proof_hash=None, public_key_hex=None,
               signature_hex=None, expected_head_sha=None):
    next_state = dict(state)
    if op == "recover":
        require(state["status"] == "blocked_legacy" and state["round"] == 0, "Recovery not eligible")
        next_state.update(status="released", owner_login=None, proof_hash=None,
                          recovery=("2026-11-01 repository-owner-authorized Issue #"
                                    + str(ISSUE) + " recovery; historical ref retained"))
    elif op == "acquire":
        require(state["status"] == "released", "Issue is occupied or blocked")
        require(isinstance(public_key_hex, str)
                and re.fullmatch(r"[0-9a-f]{64}", public_key_hex) is not None,
                "Ed25519 public key missing")
        require(isinstance(proof_hash, str)
                and re.fullmatch(r"[0-9a-f]{64}", proof_hash) is not None
                and hmac.compare_digest(
                    hashlib.sha256(bytes.fromhex(public_key_hex)).hexdigest(), proof_hash),
                "Owner public key digest mismatch")
        next_state.update(round=state["round"]+1, status="held", owner_login=OWNER,
                          proof_hash=proof_hash, owner_pubkey=public_key_hex)
    elif op == "release":
        require(state["status"] == "held", "No current owner")
        verify_release_signature(state, expected_head_sha, signature_hex)
        next_state.update(status="released", owner_login=None,
                          proof_hash=None, owner_pubkey=None)
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
    current=get("/git/ref/heads/main")["object"]["sha"]
    require(current==os.getenv("GITHUB_SHA"),"Main changed since workflow dispatch; stop")
    require(ISSUE in LEGACY_SHAS and LEGACY_SHA is not None,
            "Issue outside approved legacy recovery scope")
    require(get("/git/ref/heads/work/issue-" + str(ISSUE))["object"]["sha"] == LEGACY_SHA,
            "Historical Issue claim changed: stop")
    prs=get("/pulls?state=open&per_page=100")
    require(len(prs)<100 and not prs,"Competing open PR or incomplete PR listing")

def initialize():
    verify_owner_context()
    start=os.environ["GITHUB_SHA"]
    state=dict(v=2,repo=REPO,issue=ISSUE,round=0,status="blocked_legacy",
               owner_login=None,proof_hash=None,
               legacy_ref_sha=LEGACY_SHA,bootstrap_main=start)
    commit=new_commit(start,state)
    code,data=api("POST","/git/refs",{"ref":"refs/heads/coord/issue-" + str(ISSUE),"sha":commit})
    if code!=201:
        raise Blocked("Create-only coordinator ref refused: "+str(code)+
                      "; read existing ref, never overwrite")
    require(head("coord/issue-" + str(ISSUE))==commit,"Initializer readback mismatch")
    checked,_=state_at(commit)
    require(checked==state,"Initializer state mismatch")
    print("INIT_OK: held legacy claim preserved; coord/issue-565 currently BLOCKED_LEGACY; SHA="+commit)

def transition(op, proof_hash=None, public_key_hex=None,
               signature_hex=None, expected_head_sha=None):
    verify_owner_context()
    name="coord/issue-" + str(ISSUE)
    old_sha=head(name)
    state,_=state_at(old_sha)
    require(state.get("legacy_ref_sha")==LEGACY_SHA,"Unexpected legacy snapshot")
    if op == "release":
        require(old_sha == expected_head_sha, "Coordinator moved since release was signed")
    next_state=state_step(state, op, proof_hash=proof_hash,
                          public_key_hex=public_key_hex,
                          signature_hex=signature_hex,
                          expected_head_sha=expected_head_sha)
    candidate=forward(name,old_sha,next_state)
    print("TRANSITION_OK:",op,"round",next_state["round"],"state",next_state["status"],"sha",candidate)
    print("Historical work/issue-" + str(ISSUE)
          + " preserved; only its separate coordination reference was changed")

def inspect():
    sha=head("coord/issue-" + str(ISSUE))
    state,_=state_at(sha)
    print(canonical({"ref":"refs/heads/coord/issue-" + str(ISSUE),"sha":sha,"round":state["round"],
                     "status":state["status"],"owner_login":state["owner_login"],
                     "legacy_ref_sha":state.get("legacy_ref_sha")}))
    print("Inspect only: do not claim product acceptance or Stable")

def self_test():
    init=dict(v=2,repo=REPO,issue=ISSUE,round=0,status="blocked_legacy",
              owner_login=None,proof_hash=None,legacy_ref_sha=LEGACY_SHA)
    free=state_step(init,"recover")
    assert free["status"]=="released"
    with tempfile.TemporaryDirectory(prefix="coord-owner-selftest-") as directory:
        root=Path(directory)
        private_key=root/"private.pem"
        pub_der=root/"public.der"
        subprocess.run(["openssl","genpkey","-algorithm","ED25519",
                        "-out",str(private_key)],check=True,capture_output=True)
        subprocess.run(["openssl","pkey","-in",str(private_key),
                        "-pubout","-outform","DER","-out",str(pub_der)],
                        check=True,capture_output=True)
        key=pub_der.read_bytes()
        assert key.startswith(bytes.fromhex("302a300506032b6570032100"))
        public_key_hex=key[-32:].hex()
        digest=hashlib.sha256(key[-32:]).hexdigest()
        held=state_step(free,"acquire",digest,public_key_hex)
        assert held["round"]==1 and held["status"]=="held"
        held_head="a"*40
        payload=release_payload(held,held_head)
        (root/"message.bin").write_bytes(payload)
        signature=root/"signature.bin"
        subprocess.run(["openssl","pkeyutl","-sign","-inkey",str(private_key),
                        "-rawin","-in",str(root/"message.bin"),"-out",str(signature)],
                        check=True,capture_output=True)
        sig_hex=signature.read_bytes().hex()
        done=state_step(held,"release",signature_hex=sig_hex,
                        expected_head_sha=held_head)
        assert done["status"]=="released" and done["round"]==1
        assert done["owner_pubkey"] is None
        assert state_step(done,"acquire",digest,public_key_hex)["round"]==2
        for thunk in (
            lambda: state_step(init,"acquire",digest,public_key_hex),
            lambda: state_step(held,"acquire",digest,public_key_hex),
            lambda: state_step(held,"release",signature_hex="0"*128,
                               expected_head_sha=held_head),
            lambda: state_step(held,"release",signature_hex=sig_hex,
                               expected_head_sha="b"*40),
            lambda: state_step(done,"release",signature_hex=sig_hex,
                               expected_head_sha=held_head),
            lambda: state_step(free,"recover"),
            lambda: state_step(free,"acquire","not-a-digest",public_key_hex),
            lambda: state_step(free,"acquire",digest,"a"*64),
            lambda: verify_release_signature(held,"bad-sha",sig_hex),
        ):
            try: thunk()
            except Blocked: pass
            else: raise AssertionError("Invalid owner, stale round or signature accepted")
    print("PASS: Ed25519 owner proof, signed release, anti-replay, duplicate and stale-round rejects")


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--self-test",action="store_true")
    p.add_argument("--operation",choices=("init","recover","acquire","inspect","release"))
    p.add_argument("--proof-hash")
    p.add_argument("--public-key-hex")
    p.add_argument("--signature-hex")
    p.add_argument("--expected-coord-sha")
    args=p.parse_args()
    if args.self_test: self_test(); return
    if ISSUE not in LEGACY_SHAS:
        raise Blocked("Issue not on the approved legacy recovery list")
    if args.operation=="init": initialize()
    elif args.operation=="recover": transition("recover")
    elif args.operation=="acquire":
        transition("acquire",proof_hash=args.proof_hash,public_key_hex=args.public_key_hex)
    elif args.operation=="release":
        transition("release",signature_hex=args.signature_hex,
                   expected_head_sha=args.expected_coord_sha)
    elif args.operation=="inspect": inspect()
    else: raise Blocked("Unsupported operation")

if __name__=="__main__":
    try: main()
    except (Blocked, KeyError, ValueError, TypeError, AssertionError) as err:
        print("::error::"+str(err),file=sys.stderr)
        sys.exit(1)
