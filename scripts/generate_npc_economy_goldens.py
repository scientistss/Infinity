#!/usr/bin/env python3
"""Independent, exact-arithmetic fixtures for the proposed NPC economy.

Only Python's standard library is used. No production implementation is read,
imported, executed, or used to derive expected values. This script is deliberately
separate from the application tree and has no schema or integration side effects.
"""

from __future__ import annotations

import argparse
from decimal import Decimal, localcontext
from fractions import Fraction
import hashlib
import json
from pathlib import Path


MODEL = "fixed-production-v1"
MAX_AGE = Fraction(11900)
BASE_COMMIT = "52e7ed83a24f96dbdd240b4e0e4216c63fd90d55"
SOURCES = {
    "NPC_ECONOMY.md": "5c3564988b036255c40ecebb6c475fbe8f18c3cecfa23b724c5e9e0f27e65128",
    "NPC_ECONOMY_ACCEPTANCE.md": "ee8b1a564231f49ce4cdd45cbae31546d0cc7c7a460bdd0a147023556ca3bb15",
}
# (genesis stock, resource units per adopted game second, independent capacity)
PARAMETERS = {
    "metal": (Fraction(500), Fraction(5), Fraction(50000)),
    "crystal": (Fraction(250), Fraction(5, 2), Fraction(30000)),
    "deuterium": (Fraction(0), Fraction(1), Fraction(10000)),
}
NONFINITE_NUMBERS = {"NaN", "+Infinity", "-Infinity"}


def decimal_text(value: Fraction) -> str:
    """Serialize a terminating rational exactly, without binary-float arithmetic."""
    denominator = value.denominator
    for factor in (2, 5):
        while denominator % factor == 0:
            denominator //= factor
    if denominator != 1:
        raise ValueError("Fixture value does not have a terminating decimal")
    with localcontext() as context:
        context.prec = 100
        result = format(Decimal(value.numerator) / Decimal(value.denominator), "f")
    if "." in result:
        result = result.rstrip("0").rstrip(".")
    return result


def json_number(value: Fraction) -> int | float:
    """Input-only JSON transport; require an exact binary64 representation."""
    if value.denominator == 1:
        if abs(value.numerator) > 2**53 - 1:
            raise ValueError("Fixture integer would not be exact in binary64")
        return value.numerator
    transported = float(value)
    if Fraction.from_float(transported) != value:
        raise ValueError("Fixture input would be rounded by binary64 transport")
    return transported


def fraction_from_number(value: object) -> Fraction:
    # bool is explicitly excluded even though Python makes it an int subclass.
    if type(value) not in (int, float, Decimal, Fraction):
        raise ValueError("Expected a numeric value")
    if type(value) is float:
        decimal = Decimal(str(value))
        if not decimal.is_finite():
            raise ValueError("Expected a finite number")
        return Fraction.from_float(value)
    if type(value) is Decimal and not value.is_finite():
        raise ValueError("Expected a finite number")
    return Fraction(value)


def validate_age(value: object) -> Fraction:
    age = fraction_from_number(value)
    if age < 0 or age > MAX_AGE:
        raise ValueError("Age is outside the closed interval [0, 11900]")
    return age


def validate_state(value: object) -> Fraction:
    """A reference validator for the spec's JSON-data contract, not JS objects."""
    if type(value) is not dict or set(value) != {"model", "elapsedSeconds"}:
        raise ValueError("Expected exactly model and elapsedSeconds")
    if value["model"] != MODEL:
        raise ValueError("Unknown model")
    return validate_age(value["elapsedSeconds"])


def advance_age(age: Fraction, step: object) -> Fraction:
    age = validate_age(age)
    try:
        adopted_step = fraction_from_number(step)
    except ValueError:
        return age
    if adopted_step <= 0:
        return age
    return min(MAX_AGE, age + adopted_step)


def snapshot(age: Fraction) -> dict:
    age = validate_age(age)
    resources = {}
    for resource, (initial, rate, capacity) in PARAMETERS.items():
        stock = min(capacity, initial + rate * age)
        produced = stock - initial
        resources[resource] = {
            "stock": decimal_text(stock),
            "actualProduced": decimal_text(produced),
            "actualConsumed": "0",
            "full": stock == capacity,
        }
    return {"elapsedSeconds": decimal_text(age), "resources": resources}


def state(age: Fraction) -> dict:
    return {"model": MODEL, "elapsedSeconds": json_number(age)}


def make_case(identifier: str, age: Fraction, step: Fraction | None = None) -> dict:
    operation = "query" if step is None else "advance"
    case_input = {"operation": operation, "state": state(age)}
    if step is not None:
        case_input["stepSeconds"] = json_number(step)
        expected_age = advance_age(age, step)
    else:
        expected_age = age
    return {"id": identifier, "input": case_input, "expected": snapshot(expected_age)}


def decode_runtime_numbers(value: object) -> object:
    """Expand only fixture descriptors, never a representation valid in a save."""
    if type(value) is dict:
        if set(value) == {"$runtimeNumber"}:
            label = value["$runtimeNumber"]
            if label not in NONFINITE_NUMBERS:
                raise ValueError("Unknown runtime-number descriptor")
            return Decimal(label)
        return {key: decode_runtime_numbers(item) for key, item in value.items()}
    if type(value) is list:
        return [decode_runtime_numbers(item) for item in value]
    return value


def runtime_number(name: str) -> dict:
    return {"$runtimeNumber": name}


def make_invalid_state_cases() -> list[dict]:
    entries = [
        ("null-state", None),
        ("array-state", []),
        ("boolean-state", False),
        ("number-state", 0),
        ("string-state", "fixed-production-v1"),
        ("missing-both-fields", {}),
        ("missing-age", {"model": MODEL}),
        ("missing-model", {"elapsedSeconds": 0}),
        ("wrong-location-wrapper", {"npcEconomy": state(Fraction(0))}),
        ("unexpected-field", {**state(Fraction(0)), "stock": 500}),
    ]
    for label, value in [
        ("negative-age", -0.25),
        ("over-cap-age", 11900.25),
        ("advance-horizon-used-as-age", 28800),
        ("string-age", "0"),
        ("null-age", None),
        ("false-age", False),
        ("true-age", True),
        ("array-age", []),
        ("object-age", {}),
        ("nan-age", runtime_number("NaN")),
        ("positive-infinity-age", runtime_number("+Infinity")),
        ("negative-infinity-age", runtime_number("-Infinity")),
    ]:
        entries.append((label, {"model": MODEL, "elapsedSeconds": value}))
    for label, value in [
        ("unknown-model", "fixed-production-v2"),
        ("empty-model", ""),
        ("null-model", None),
        ("numeric-model", 1),
        ("boolean-model", True),
    ]:
        entries.append((label, {"model": value, "elapsedSeconds": 0}))
    return [
        {"id": label, "input": {"state": value}, "expected": {"accepted": False}}
        for label, value in entries
    ]


def build_goldens() -> dict:
    spec = [
        make_case("spec-age-0", Fraction(0)),
        make_case("spec-age-0_25", Fraction(1, 4)),
        make_case("spec-age-60", Fraction(60)),
        make_case("spec-age-7200", Fraction(7200)),
        make_case("spec-age-9900", Fraction(9900)),
        make_case("spec-age-10000", Fraction(10000)),
        make_case("spec-age-11900", MAX_AGE),
        make_case("spec-advance-28800", Fraction(0), Fraction(28800)),
    ]
    boundaries = []
    for resource, (initial, rate, capacity) in PARAMETERS.items():
        threshold = (capacity - initial) / rate
        start = threshold - Fraction(1, 4)
        for label, step in (("before", Fraction(0)), ("at", Fraction(1, 4)), ("after", Fraction(1, 2))):
            case = make_case(f"{resource}-full-{label}", start, step)
            case["targetResource"] = resource
            case["requestedAgeSeconds"] = decimal_text(start + step)
            boundaries.append(case)
    noops = []
    for label, step in [
        ("zero", 0), ("negative", -0.25),
        ("nan", runtime_number("NaN")),
        ("positive-infinity", runtime_number("+Infinity")),
        ("negative-infinity", runtime_number("-Infinity")),
        ("string", "1"), ("null", None), ("boolean", True),
        ("array", []), ("object", {}),
    ]:
        noops.append({
            "id": f"step-noop-{label}",
            "input": {"operation": "advance", "state": state(Fraction(60)), "stepSeconds": step},
            "expected": snapshot(Fraction(60)),
        })
    partitions = []
    for identifier, initial_age, steps in [
        ("quarter-once", Fraction(0), [Fraction(1, 4)]),
        ("quarter-two-eighths", Fraction(0), [Fraction(1, 8)] * 2),
        ("minute-once", Fraction(0), [Fraction(60)]),
        ("minute-quarter-steps", Fraction(0), [Fraction(1, 4)] * 240),
        ("cross-metal-cap", Fraction(9899, 1) + Fraction(3, 4), [Fraction(1, 8)] * 4),
        ("cross-deuterium-cap", Fraction(9999, 1) + Fraction(3, 4), [Fraction(1, 8)] * 4),
        ("cross-crystal-cap", Fraction(11899, 1) + Fraction(3, 4), [Fraction(1, 8)] * 4),
        ("full-then-more-time", MAX_AGE, [Fraction(1, 4), Fraction(7200), Fraction(28800)]),
    ]:
        age = initial_age
        for step in steps:
            age = advance_age(age, step)
        partitions.append({
            "id": identifier,
            "input": {"operation": "advanceSequence", "state": state(initial_age), "stepsSeconds": [json_number(step) for step in steps]},
            "expected": snapshot(age),
        })
    signed_zeros = [{
        "id": "query-negative-zero",
        "input": {"operation": "query", "state": {"model": MODEL, "elapsedSeconds": -0.0}},
        "expected": snapshot(Fraction(0)),
        "inputMustRemainUnmodified": True,
        "zeroComparison": "Numeric equality, not sign-bit or decimal-string equality",
    }]
    for label, step in [("zero", 0), ("negative-zero", -0.0), ("negative", -1), ("nan", runtime_number("NaN")), ("positive", 0.25)]:
        signed_zeros.append({
            "id": f"advance-negative-zero-with-{label}-step",
            "input": {"operation": "advance", "state": {"model": MODEL, "elapsedSeconds": -0.0}, "stepSeconds": step},
            "expected": snapshot(Fraction(1, 4) if label == "positive" else Fraction(0)),
            "inputMustRemainUnmodified": True,
            "zeroComparison": "Numeric equality, not sign-bit or decimal-string equality",
            "expectedSameInputStateForNoop": label != "positive",
        })
    return {
        "fixtureFormat": "independent-npc-economy-goldens-v1",
        "status": "Independent preparation only; no application integration, save revision change, or deployment.",
        "provenance": {
            "underlyingSourceCommit": BASE_COMMIT,
            "specificationStatus": "The two proposed specification documents were untracked additions on this base commit when frozen; they are identified by byte hashes, not claimed to exist in that commit.",
            "specifications": [{"file": f"docs/{name}", "sha256": digest} for name, digest in SOURCES.items()],
            "derivation": "Python standard-library Fraction arithmetic from the frozen prose parameters, with independent Decimal step-integration verification.",
            "productionCodeReadOrExecuted": False,
        },
        "contract": {
            "model": MODEL,
            "minimumElapsedSeconds": "0",
            "maximumElapsedSeconds": decimal_text(MAX_AGE),
            "inputTransport": "Ordinary case inputs are JSON numbers exactly representable in binary64. $runtimeNumber descriptors explicitly represent otherwise non-JSON runtime inputs for validation tests only.",
            "expectedTransport": "All expected numeric values are exact base-10 strings; booleans remain booleans. Do not infer expected values from production outputs or formatted reports.",
            "actualConsumed": "Always zero in this proposed model; an oracle conservation assertion, not a requirement to add a production API or save field.",
            "invalidStates": "Reject rather than clamp, coerce, or initialize. This file does not select an exception class or error text.",
            "invalidSteps": "Zero, negative, non-finite and non-numeric steps do not advance a valid age; no production API object-identity assertion is made.",
            "negativeZero": "Negative zero is numerically zero and is accepted in the specified non-negative range. Query must not modify its input. No-op steps preserve the input state, including its sign bit; expected snapshot ages compare numerically to zero. JSON text byte or sign-bit equality is not an economic invariant.",
            "precision": "Every ordinary numeric case is binary-exact. No epsilon or decimal-display rounding is needed or authorized by these cases; arbitrary non-binary frame-time tolerance remains outside this fixture.",
        },
        "parameters": {
            resource: {
                "initialStock": decimal_text(initial),
                "productionPerSecond": decimal_text(rate),
                "capacity": decimal_text(capacity),
                "fullAtSeconds": decimal_text((capacity - initial) / rate),
            }
            for resource, (initial, rate, capacity) in PARAMETERS.items()
        },
        "specGoldens": spec,
        "capacityBoundaries": boundaries,
        "stepNoops": noops,
        "partitionGoldens": partitions,
        "signedZeroGoldens": signed_zeros,
        "invalidStates": make_invalid_state_cases(),
    }


def verify_sources(directory: Path) -> None:
    for name, digest in SOURCES.items():
        actual = hashlib.sha256((directory / name).read_bytes()).hexdigest()
        if actual != digest:
            raise ValueError(f"Frozen specification hash changed: {name}")


def self_test(goldens: dict) -> dict:
    # These literal values are copied from the frozen acceptance table, not
    # generated by the snapshot implementation above.
    literal_spec_stocks = [
        ("500", "250", "0"),
        ("501.25", "250.625", "0.25"),
        ("800", "400", "60"),
        ("36500", "18250", "7200"),
        ("50000", "25000", "9900"),
        ("50000", "25250", "10000"),
        ("50000", "30000", "10000"),
        ("50000", "30000", "10000"),
    ]
    for case, expected in zip(goldens["specGoldens"], literal_spec_stocks, strict=True):
        assert tuple(item["stock"] for item in case["expected"]["resources"].values()) == expected
    # Hand-auditable boundary triples, independent of the threshold-case builder.
    literal_boundaries = {
        "metal-full-before": ("49998.75", "24999.375", "9899.75"),
        "metal-full-at": ("50000", "25000", "9900"),
        "metal-full-after": ("50000", "25000.625", "9900.25"),
        "crystal-full-before": ("50000", "29999.375", "10000"),
        "crystal-full-at": ("50000", "30000", "10000"),
        "crystal-full-after": ("50000", "30000", "10000"),
        "deuterium-full-before": ("50000", "25249.375", "9999.75"),
        "deuterium-full-at": ("50000", "25250", "10000"),
        "deuterium-full-after": ("50000", "25250.625", "10000"),
    }
    for case in goldens["capacityBoundaries"]:
        assert tuple(item["stock"] for item in case["expected"]["resources"].values()) == literal_boundaries[case["id"]]

    # A second route accumulates each resource in Decimal quarter-second steps.
    # It never computes the one-shot initial + rate * age formula for its stocks.
    decimal_stock = {key: Decimal(decimal_text(values[0])) for key, values in PARAMETERS.items()}
    decimal_rates = {key: Decimal(decimal_text(values[1])) for key, values in PARAMETERS.items()}
    decimal_caps = {key: Decimal(decimal_text(values[2])) for key, values in PARAMETERS.items()}
    checked_points = 0
    for quarter in range(47601):
        age = Fraction(quarter, 4)
        result = snapshot(age)
        for resource, (initial, rate, cap) in PARAMETERS.items():
            item = result["resources"][resource]
            actual_stock = Fraction(item["stock"])
            actual_produced = Fraction(item["actualProduced"])
            assert Decimal(item["stock"]) == decimal_stock[resource]
            assert initial + actual_produced - Fraction(item["actualConsumed"]) == actual_stock
            assert 0 <= actual_produced <= cap - initial
            assert initial <= actual_stock <= cap
            assert actual_produced <= rate * age
            assert item["full"] == (actual_stock == cap)
            assert item["full"] == (age >= (cap - initial) / rate)
            decimal_stock[resource] += decimal_rates[resource] * Decimal("0.25")
            if decimal_stock[resource] > decimal_caps[resource]:
                decimal_stock[resource] = decimal_caps[resource]
        checked_points += 1

    for group in ("specGoldens", "capacityBoundaries", "stepNoops", "partitionGoldens", "signedZeroGoldens"):
        for case in goldens[group]:
            case_input = decode_runtime_numbers(case["input"])
            original_state_repr = repr(case_input["state"])
            age = validate_state(case_input["state"])
            operation = case_input["operation"]
            if operation == "advance":
                age = advance_age(age, case_input["stepSeconds"])
            elif operation == "advanceSequence":
                starting_age = age
                for step in case_input["stepsSeconds"]:
                    age = advance_age(age, step)
                total_step = sum((fraction_from_number(step) for step in case_input["stepsSeconds"]), Fraction(0))
                assert age == advance_age(starting_age, total_step)
            assert snapshot(age) == case["expected"]
            assert repr(case_input["state"]) == original_state_repr
            if group == "signedZeroGoldens":
                assert Decimal(str(case_input["state"]["elapsedSeconds"])).is_signed()

    for case in goldens["invalidStates"]:
        try:
            validate_state(decode_runtime_numbers(case["input"]["state"]))
        except ValueError:
            continue
        raise AssertionError(f"Invalid state was accepted: {case['id']}")

    return {
        "specGoldens": len(goldens["specGoldens"]),
        "capacityBoundaryGoldens": len(goldens["capacityBoundaries"]),
        "noAdvanceStepGoldens": len(goldens["stepNoops"]),
        "partitionGoldens": len(goldens["partitionGoldens"]),
        "signedZeroGoldens": len(goldens["signedZeroGoldens"]),
        "invalidStateGoldens": len(goldens["invalidStates"]),
        "independentDecimalQuarterSecondPoints": checked_points,
        "independentDecimalResourceComparisons": checked_points * len(PARAMETERS),
    }


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=here.parent / "infinity-npc-spec" / "docs")
    parser.add_argument("--output", type=Path, default=here / "npc-economy-goldens.json")
    parser.add_argument("--check", action="store_true", help="Verify exact existing fixture bytes; do not write the fixture")
    args = parser.parse_args()
    verify_sources(args.source_dir)
    goldens = build_goldens()
    checked = self_test(goldens)
    payload = (json.dumps(goldens, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    if args.check:
        if args.output.read_bytes() != payload:
            raise ValueError("Existing fixture differs from deterministic exact-arithmetic output")
    else:
        args.output.write_bytes(payload)
    report = {
        "status": "passed",
        "mode": "read-only exact-byte verification" if args.check else "generated and independently verified",
        "fixture": args.output.name,
        "fixtureSha256": hashlib.sha256(payload).hexdigest(),
        "generatorSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "sourceHashesVerified": SOURCES,
        "checks": checked,
        "notRun": ["production TypeScript", "application integration", "save migration", "browser", "deployment"],
    }
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
