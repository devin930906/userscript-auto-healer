#!/usr/bin/env python3
"""Verify per-round Ed25519 possession without publishing private keys.

TEST-ONLY authentication layer. Does not write GitHub refs or hand off legacy owners.
Signed requests bind repo, issue, coordination ref, exact head SHA, round and action.
"""
import base64
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = "devin930906/userscript-auto-healer"
SPKI_ED25519 = bytes.fromhex("302a300506032b6570032100")
ISSUES = {215, 440, 480, 486, 487, 488, 489, 510, 565}

class Rejected(Exception):
    pass

def encode(request):
    if not isinstance(request, dict) or set(request) != {
        "version", "repository", "issue", "ref", "head", "round", "action", "public_key", "nonce"
    }:
        raise Rejected("Invalid signed request fields")
    if request["version"] != 2 or request["repository"] != REPO:
        raise Rejected("Wrong version or repository")
    if type(request["issue"]) is not int or request["issue"] not in ISSUES:
        raise Rejected("Unknown Issue")
    if not isinstance(request["ref"], str) or not re.fullmatch(
        r"refs/heads/(coord/issue-[0-9]+|test/coord-round-[0-9]+-[0-9]+)", request["ref"]
    ):
        raise Rejected("Ref not in coordination namespace")
    if not isinstance(request["head"], str) or not re.fullmatch("[0-9a-f]{40}", request["head"]):
        raise Rejected("Missing pinned ref head")
    if type(request["round"]) is not int or request["round"] < 0:
        raise Rejected("Invalid previous round")
    if request["action"] not in ("acquire", "release"):
        raise Rejected("Invalid action")
    if request["ref"].startswith("refs/heads/coord/") and request["ref"] != (
        "refs/heads/coord/issue-" + str(request["issue"])
    ):
        raise Rejected("Issue/ref mismatch")
    if not isinstance(request["nonce"], str) or not re.fullmatch("[a-zA-Z0-9_-]{16,128}", request["nonce"]):
        raise Rejected("Nonce is not a suitable unique request token")
    if request["action"] == "release" and request["public_key"] is not None:
        raise Rejected("Release must use stored public key")
    if request["action"] == "acquire" and not isinstance(request["public_key"], str):
        raise Rejected("Acquire must provide own public key")
    return json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()

def public_der(encoded):
    if not isinstance(encoded, str) or len(encoded) > 120:
        raise Rejected("Invalid encoded public key")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise Rejected("Invalid public key encoding") from exc
    if len(raw) != 44 or not raw.startswith(SPKI_ED25519):
        raise Rejected("Public key is not canonical Ed25519 SPKI")
    return raw

def prove(key_b64, signature_b64, message):
    pub = public_der(key_b64)
    if not isinstance(signature_b64, str) or len(signature_b64) > 120:
        raise Rejected("Invalid signature")
    try:
        sig = base64.b64decode(signature_b64, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise Rejected("Invalid signature encoding") from exc
    if len(sig) != 64:
        raise Rejected("Ed25519 signature must be 64 bytes")
    with tempfile.TemporaryDirectory(prefix="claim-proof-") as tmp:
        root = Path(tmp)
        (root / "pub.der").write_bytes(pub)
        (root / "message").write_bytes(message)
        (root / "sig").write_bytes(sig)
        run = subprocess.run([
            "openssl", "pkeyutl", "-verify", "-pubin", "-keyform", "DER",
            "-inkey", str(root / "pub.der"), "-rawin", "-in", str(root / "message"),
            "-sigfile", str(root / "sig")
        ], capture_output=True, timeout=15, check=False)
    if run.returncode != 0:
        raise Rejected("Signature is not from current round owner")

def apply(state, request, signature, current_head):
    msg = encode(request)
    if not isinstance(state, dict) or state.get("version") != 2:
        raise Rejected("State version is not supported")
    if state.get("issue") != request["issue"]:
        raise Rejected("Cross-Issue transition")
    if request["head"] != current_head or request["round"] != state.get("round"):
        raise Rejected("Stale ref or round")
    if request["action"] == "acquire":
        if state.get("status") != "released":
            raise Rejected("Existing owner still active")
        key = request["public_key"]
        prove(key, signature, msg)
        return {"version": 2, "issue": state["issue"], "round": state["round"] + 1,
                "status": "active", "public_key": key,
                "owner_fingerprint": hashlib.sha256(public_der(key)).hexdigest(),
                "request_nonce": request["nonce"]}
    if state.get("status") != "active":
        raise Rejected("Cannot release a free claim")
    key = state.get("public_key")
    prove(key, signature, msg)
    return {"version": 2, "issue": state["issue"], "round": state["round"],
            "status": "released", "public_key": None, "owner_fingerprint": None,
            "request_nonce": request["nonce"]}

def keypair(root, who):
    priv = root / (who + ".pem")
    pub = root / (who + ".der")
    subprocess.run(["openssl", "genpkey", "-algorithm", "ED25519", "-out", str(priv)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["openssl", "pkey", "-in", str(priv), "-pubout", "-outform", "DER",
                    "-out", str(pub)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return priv, base64.b64encode(pub.read_bytes()).decode()

def sign(root, priv, payload):
    (root / "message").write_bytes(encode(payload))
    signature = root / "signature"
    subprocess.run(["openssl", "pkeyutl", "-sign", "-inkey", str(priv),
                    "-rawin", "-in", str(root / "message"), "-out", str(signature)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return base64.b64encode(signature.read_bytes()).decode()

def must_reject(fn):
    try:
        fn()
    except Rejected:
        return
    raise AssertionError("Unauthorized operation succeeded")

def self_test():
    with tempfile.TemporaryDirectory(prefix="claim-identity-tests-") as directory:
        root = Path(directory)
        a_priv, a_key = keypair(root, "a")
        b_priv, b_key = keypair(root, "b")
        sha = "1" * 40
        request = {"version": 2, "repository": REPO, "issue": 565,
                   "ref": "refs/heads/test/coord-round-100-1", "head": sha, "round": 0,
                   "action": "acquire", "public_key": a_key, "nonce": "nonce-claim-a-00001"}
        free = {"version": 2, "issue": 565, "round": 0, "status": "released",
                "public_key": None, "owner_fingerprint": None, "request_nonce": None}
        signature = sign(root, a_priv, request)
        held = apply(free, request, signature, sha)
        assert held["round"] == 1 and held["public_key"] == a_key
        must_reject(lambda: apply(free, request, signature, "2" * 40))
        must_reject(lambda: apply(held, request, signature, sha))
        wrong_sig = sign(root, b_priv, request)
        must_reject(lambda: apply(free, request, wrong_sig, sha))
        release = {**request, "action": "release", "public_key": None,
                   "round": 1, "head": "2" * 40, "nonce": "nonce-release-a-0001"}
        must_reject(lambda: apply(held, release, sign(root, b_priv, release), "2" * 40))
        good_release = sign(root, a_priv, release)
        now_free = apply(held, release, good_release, "2" * 40)
        assert now_free["status"] == "released" and now_free["round"] == 1
        new_req = {**request, "round": 1, "head": "3" * 40, "public_key": b_key,
                   "nonce": "nonce-claim-b-00002"}
        next_held = apply(now_free, new_req, sign(root, b_priv, new_req), "3" * 40)
        assert next_held["round"] == 2
        must_reject(lambda: apply(next_held, release, good_release, "2" * 40))
        wrong_ref = {**new_req, "ref": "refs/heads/coord/issue-215"}
        must_reject(lambda: apply(now_free, wrong_ref, sign(root, b_priv, new_req), "3" * 40))
    print("PASS: Ed25519 round owner proof, foreign key and stale signature rejected")
    print("No private keys published; no production Git refs accessed")

if __name__ == "__main__":
    try:
        if sys.argv[1:] != ["--self-test"]:
            raise Rejected("Only local self-tests allowed until mandatory protection deployed")
        self_test()
    except (Rejected, AssertionError, subprocess.SubprocessError) as exc:
        print("::error::" + str(exc), file=sys.stderr)
        sys.exit(1)
