#!/usr/bin/env python3
"""Read-only evidence inventory for the eight existing, untransferred Issue claims.

This is not a lock coordinator, owner identity check, patch-equivalence proof,
handoff approval, or release authorization. No API write methods are used.
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

REPO = "devin930906/userscript-auto-healer"
ISSUES = (215, 440, 480, 486, 487, 488, 489, 510)
BASE_URL = "https://api.github.com/repos/" + REPO


def api(path, missing_ok=False):
    token = os.environ["GH_TOKEN"]
    request = Request(
        BASE_URL + path,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "governance-legacy-claim-audit",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code == 404 and missing_ok:
            return None
        raise RuntimeError("GitHub read failed: HTTP " + str(error.code)) from error
    except URLError as error:
        raise RuntimeError("GitHub read unavailable: " + str(error.reason)) from error


def ref_sha(branch):
    name = "refs/heads/" + branch
    result = api("/git/ref/heads/" + quote(branch, safe="/"), missing_ok=True)
    if result is None:
        return None
    if result.get("ref") != name or result.get("object", {}).get("type") != "commit":
        raise RuntimeError("Unexpected Git reference object for " + branch)
    return result["object"]["sha"]


def path_sha(path, commit):
    result = api(
        "/contents/" + quote(path, safe="/") + "?" + urlencode({"ref": commit}),
        missing_ok=True,
    )
    if result is None:
        return None
    if not isinstance(result, dict) or result.get("type") != "file":
        return "NON_FILE"
    return result.get("sha")


def branch_prs(branch):
    matches = []
    for page in range(1, 11):
        query = urlencode({
            "state": "all", "per_page": 100, "page": page,
            "head": "devin930906:" + branch,
        })
        batch = api("/pulls?" + query)
        for item in batch:
            if item.get("head", {}).get("ref") != branch:
                continue
            matches.append({
                "number": item["number"], "state": item["state"],
                "merged_at": item.get("merged_at"), "draft": item.get("draft"),
                "head_sha": item.get("head", {}).get("sha"),
                "url": item["html_url"],
            })
        if len(batch) < 100:
            return matches, False
    return matches, True


def classify(main_blob, branch_blob, renamed=False):
    if renamed or main_blob == "NON_FILE" or branch_blob == "NON_FILE":
        return "manual_review"
    if main_blob is None and branch_blob is None:
        return "both_missing"
    if main_blob is None:
        return "missing_on_main"
    if branch_blob is None:
        return "missing_on_branch"
    return "identical_snapshot_blob" if main_blob == branch_blob else "different_snapshot_blob"


def self_test():
    assert classify("a", "a") == "identical_snapshot_blob"
    assert classify("a", "b") == "different_snapshot_blob"
    assert classify(None, "b") == "missing_on_main"
    assert classify("a", None) == "missing_on_branch"
    assert classify(None, None) == "both_missing"
    assert classify("a", "a", renamed=True) == "manual_review"
    assert classify("NON_FILE", "a") == "manual_review"
    assert len(ISSUES) == len(set(ISSUES)) == 8
    print("PASS: local fail-closed classification tests")


def inventory():
    if os.environ.get("GITHUB_REPOSITORY") != REPO:
        raise RuntimeError("Wrong repository, refusing audit")
    if os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise RuntimeError("Read-only inventory must run from main")
    main_sha = ref_sha("main")
    if not main_sha:
        raise RuntimeError("main ref missing")
    result = {
        "repository": REPO, "main_sha": main_sha,
        "audit_utc": datetime.now(timezone.utc).isoformat(),
        "read_only": True, "can_release_any_claim": False,
        "owner_authenticated": False, "patch_equivalence_proven": False,
        "workflow_run_id": os.environ.get("GITHUB_RUN_ID"),
        "issues": [],
    }
    for number in ISSUES:
        branch = "work/issue-" + str(number)
        branch_sha = ref_sha(branch)
        entry = {
            "issue": number, "branch": branch, "branch_sha": branch_sha,
            "owner_status": "unverified", "handoff": "BLOCKED",
            "prs_from_exact_head_only": [], "prs_pagination_incomplete": False,
            "compare_incomplete": False, "files": [],
        }
        if branch_sha:
            compare = api("/compare/" + main_sha + "..." + branch_sha + "?per_page=100")
            entry.update({
                "ahead_by": compare.get("ahead_by"),
                "behind_by": compare.get("behind_by"),
                "compare_status": compare.get("status"),
            })
            changed = compare.get("files", [])
            if len(changed) >= 300:
                entry["compare_incomplete"] = True
            for item in changed:
                path = item["filename"]
                branch_blob = path_sha(path, branch_sha)
                main_blob = path_sha(path, main_sha)
                entry["files"].append({
                    "path": path, "compare_status": item.get("status"),
                    "previous_filename": item.get("previous_filename"),
                    "main_blob": main_blob, "branch_blob": branch_blob,
                    "snapshot_classification": classify(
                        main_blob, branch_blob, item.get("status") == "renamed"
                    ),
                })
            entry["prs_from_exact_head_only"], entry["prs_pagination_incomplete"] = branch_prs(branch)
            entry["branch_changed_during_audit"] = ref_sha(branch) != branch_sha
        else:
            entry["compare_status"] = "missing_branch"
            entry["branch_changed_during_audit"] = ref_sha(branch) is not None
        result["issues"].append(entry)
    result["main_changed_during_audit"] = ref_sha("main") != main_sha
    result["snapshot_consistent"] = (
        not result["main_changed_during_audit"]
        and all(not item["branch_changed_during_audit"] for item in result["issues"])
    )
    out = Path("legacy-claims-audit.json")
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    lines = [
        "# Read-only legacy Issue claim inventory",
        "",
        "Source: " + REPO + " at " + main_sha,
        "",
        "**No owner or round authenticated; no handoff authorized; never auto-release a ref.**",
        "Snapshot content equality is not proof of historical patch equivalence.",
        "PR list searches only PRs whose exact head is the legacy work branch.",
        "",
        "| Issue | Ahead/behind | Snapshot files (identical/different/other) | Exact-head PRs | Handoff |",
        "| --- | --- | --- | --- | --- |",
    ]
    for item in result["issues"]:
        classes = [f["snapshot_classification"] for f in item["files"]]
        same = classes.count("identical_snapshot_blob")
        different = classes.count("different_snapshot_blob")
        other = len(classes) - same - different
        ratio = str(item.get("ahead_by", "?")) + "/" + str(item.get("behind_by", "?"))
        lines.append(
            "| #" + str(item["issue"]) + " | " + ratio + " | "
            + str(same) + "/" + str(different) + "/" + str(other)
            + " | " + str(len(item["prs_from_exact_head_only"]))
            + " | BLOCKED |"
        )
    lines.extend([
        "", "Snapshot consistent: **" + str(result["snapshot_consistent"]) + "**",
        "See legacy-claims-audit.json for exact immutable refs, file blob IDs and limitations.",
    ])
    Path("legacy-claims-audit.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    if not result["snapshot_consistent"]:
        raise RuntimeError("Repository refs moved during audit; fail closed and rerun")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif not sys.argv[1:]:
            inventory()
        else:
            raise RuntimeError("Unexpected arguments")
    except (RuntimeError, KeyError, ValueError) as error:
        print("::error::" + str(error), file=sys.stderr)
        sys.exit(1)
