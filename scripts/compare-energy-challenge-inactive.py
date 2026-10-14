#!/usr/bin/env python3
"""Compare complete state snapshots after validating B's sole default addition."""
import copy
import hashlib
import json
import math
import pathlib
import re
import sys

BASE = "56c16a1c73e24347919141c2b789655ae59e82cb"
DEFAULT = {"model": "energy-tightening-v1", "nextAttemptId": 1, "active": None, "completion": None}



def exact_equal(left, right):
    """JSON scalar types and every existing field are part of the differential."""
    if type(left) is not type(right):
        return False
    if type(left) is dict:
        return left.keys() == right.keys() and all(exact_equal(left[key], right[key]) for key in left)
    if type(left) is list:
        return len(left) == len(right) and all(exact_equal(a, b) for a, b in zip(left, right))
    if type(left) is float:
        return math.isfinite(left) and math.isfinite(right) and left == right
    return type(left) in (str, int, bool, type(None)) and left == right


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        assert key not in result, f"Duplicate JSON field: {key}"
        result[key] = value
    return result


def check(baseline, candidate):
    for document, role in [(baseline, "baseline"), (candidate, "candidate")]:
        assert document["schema"] == "energy-challenge-inactive-diff-v1"
        assert document["role"] == role and document["base"] == BASE
        source = document["source"]
        assert source["mergeBase"] == BASE
        assert re.fullmatch(r"[0-9a-f]{40}", source["commit"])
        assert re.fullmatch(r"[0-9a-f]{64}", source["driverSha256"])
        paths = [entry["path"] for entry in source["sourceFiles"]]
        assert paths == sorted(set(paths)) and "package-lock.json" in paths and "src/game/save.ts" in paths
        assert all(re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) for entry in source["sourceFiles"])
        assert document["scenarioKind"] == "explicitly synthetic deterministic public-API differential"
    assert baseline["source"]["commit"] == BASE and baseline["source"]["dirtyTracked"] == ""
    assert baseline["source"]["extraSource"] == baseline["source"]["ignoredSource"] == ""
    assert baseline["source"]["driverSha256"] == candidate["source"]["driverSha256"]
    assert baseline["source"]["node"] == candidate["source"]["node"]
    left, right = baseline["checkpoints"], candidate["checkpoints"]
    assert len(left) == len(right) and len(left) >= 20
    names = [entry["name"] for entry in left]
    assert len(names) == len(set(names)) and names == [entry["name"] for entry in right]
    # Validate every additive field before projecting any of them away.
    for old, new in zip(left, right):
        assert "energyChallenge" not in old["state"], old["name"]
        assert exact_equal(new["state"].get("energyChallenge"), DEFAULT), new["name"]
        assert set(new["state"]["energyChallenge"]) == set(DEFAULT), new["name"]
        assert set(new["state"]) == set(old["state"]) | {"energyChallenge"}, new["name"]
    projected = copy.deepcopy(right)
    for entry in projected:
        del entry["state"]["energyChallenge"]
    assert exact_equal(left, projected), "Full state differential failed; do not weaken projections"
    return names


if __name__ == "__main__":
    assert len(sys.argv) == 3, "Expected BASE.json B.json"
    paths = [pathlib.Path(path) for path in sys.argv[1:]]
    documents = [json.loads(path.read_text(), object_pairs_hook=unique_fields) for path in paths]
    names = check(*documents)
    print(json.dumps({"ok": True, "checkpoints": len(names), "names": names,
        "sha256": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}}, indent=2))
