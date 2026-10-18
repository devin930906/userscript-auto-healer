#!/usr/bin/env python3
"""Read-only predevelopment traceability and handoff integrity checks.

This validates Markdown source consistency, not runtime product functionality.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def rows(path, prefix):
    pattern = re.compile(r"^\|\s*(" + prefix + r"-\d{3})\s*\|")
    return [(m.group(1), line) for line in read(path).splitlines()
            if (m := pattern.match(line))]


def check_numbered(path, prefix, count):
    ids = [identity for identity, _ in rows(path, prefix)]
    expected = [f"{prefix}-{n:03d}" for n in range(1, count + 1)]
    assert ids == expected, f"{path}: ordered {prefix} records are missing, extra or duplicated"
    return set(ids)


def references_exist():
    missing = []
    pat = re.compile(r"(?<![A-Za-z0-9_./])(docs/(?:adr/)?[A-Za-z0-9._-]+\.md)\b")
    for source in [*DOCS.rglob("*.md"), ROOT / "README.md", ROOT / "AGENTS.md"]:
        content = source.read_text(encoding="utf-8")
        for target in sorted(set(pat.findall(content))):
            if not (ROOT / target).is_file():
                missing.append((str(source.relative_to(ROOT)), target))
    assert not missing, f"Unknown local document references: {missing}"


def check_traceability(req_ids, test_ids, task_ids, gate_ids):
    expected = [f"REQ-{i:03d}" for i in range(1, 29)]
    actual = {}
    for line in read("docs/10-traceability.md").splitlines():
        if not re.match(r"^\|\s*I-\d{3}\s*\|\s*REQ-\d{3}\s*\|", line):
            continue
        fields = [x.strip() for x in line.strip("|").split("|")]
        assert len(fields) == 6, f"Traceability column mismatch: {line}"
        source, req, module, tasks, tests, gates = fields
        assert req not in actual, f"Duplicate traceability row for {req}"
        assert req in req_ids and tests == "TEST-" + req[-3:], f"{req}: bad REQ/TEST link"
        linked_tasks = set(re.findall(r"\bTASK-\d{3}\b", tasks))
        assert linked_tasks, f"{req}: missing task"
        assert linked_tasks <= task_ids, f"{req}: unknown task(s) {linked_tasks-task_ids}"
        gate_tokens = set(re.findall(r"\bGATE-\d{3}\b", gates))
        for start, end in re.findall(r"\bGATE-(\d{3})\.\.(\d{3})\b", gates):
            lo, hi = int(start), int(end)
            assert lo <= hi and 1 <= lo <= hi <= 11, f"{req}: invalid gate range"
            gate_tokens |= {f"GATE-{i:03d}" for i in range(lo, hi+1)}
        assert gate_tokens and gate_tokens <= gate_ids, f"{req}: bad gate reference"
        actual[req] = (source, module)
    assert list(actual) == expected, f"Traceability must map all 28 REQ in order; got {list(actual)}"
    assert test_ids == {"TEST-"+req[-3:] for req in req_ids}


def check_stage_contract():
    required = {
        "docs/13-predevelopment-admission.md": [
            "POC-04A", "POC-04B", "broken", "fixed", "TASK-001",
            "Tampermonkey", "RAR5", "Stable",
        ],
        "docs/11-readiness.md": [
            "有限工程准入", "TASK-001", "全部开发前置仍未完成",
            "Stable 发布门槛尚未达到",
        ],
        "docs/12-handoff.md": [
            "仅对 TASK-001 开放有条件工程入口",
            "docs/13-predevelopment-admission.md",
        ],
        "docs/adr/ADR-001-application-baseline.md": [
            "有条件工程决策", "TASK-001", "Electron", "TypeScript",
        ],
    }
    for path, markers in required.items():
        content = read(path)
        for marker in markers:
            assert marker in content, f"{path}: stage/handoff marker missing: {marker}"
    handoff = read("docs/12-handoff.md")
    assert "仍是候选技术基线，不是实测最终决定" not in handoff, (
        "Handoff incorrectly contradicts conditional ADR-001 decision"
    )
    assert "尚未开发正式产品功能" in read("docs/13-predevelopment-admission.md") or (
        "没有正式产品" in read("README.md")
    ), "Do not turn predevelopment proof into a product-completed claim"


def main():
    required = [
        "docs/13-predevelopment-admission.md",
        "docs/adr/ADR-001-application-baseline.md",
        "docs/adr/ADR-002-real-userscript-acceptance.md",
        "docs/adr/ADR-003-windows-dual-package.md",
    ]
    for item in required:
        assert (ROOT / item).is_file(), f"Missing required authority: {item}"
    req_ids = check_numbered("docs/02-requirements.md","REQ",28)
    check_numbered("docs/02-requirements.md","NFR",12)
    check_numbered("docs/06-security-risk.md","RISK",13)
    test_ids = check_numbered("docs/07-testing.md","TEST",28)
    task_ids = check_numbered("docs/09-development-plan.md","TASK",21)
    gate_ids = check_numbered("docs/08-release.md","GATE",11)
    references_exist()
    check_traceability(req_ids, test_ids, task_ids, gate_ids)
    check_stage_contract()
    print("PASS: 28 REQ/TEST traceability rows, 21 tasks, 11 gates, local documentation links and staged admission contract")


if __name__ == "__main__":
    main()
