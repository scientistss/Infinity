#!/usr/bin/env python3
"""Independent exact-arithmetic design oracle for the optional NPC growth annex.

This is a proposal fixture, not production code or a persistence schema.
The main economic oracle uses Fraction/integer arithmetic, independently of any
JavaScript simulator or repository code. A separate, clearly labeled binary64
compatibility probe uses Python float and Fraction.from_float to record actual
represented values without ideal-number correction. Running this file replaces only adjacent golden.json. --check verifies the
committed bytes without writing. No candidate domain functions are imported.

`spent` is the cumulative actual annex debit, not a virtual progress counter.
Snapshots are post-growth and post-event at a checkpoint. Event observations
are separate, so a scout can observe an earlier state at the same timestamp.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from fractions import Fraction as Q
import json
import argparse
import hashlib
import math
from pathlib import Path
from typing import Any

PASS = 60
CAPS = (Q(50000), Q(30000), Q(10000))
INITIAL = (Q(500), Q(250), Q(0))
BASE_RATES = (Q(5), Q(5, 2), Q(1))
COMPLETED_RATES = (Q(6), Q(5, 2), Q(1))
COST = (Q(2000), Q(1000), Q(0))
THRESHOLD = (Q(4000), Q(2000))


def number(value: Q) -> int | float:
    """Export exact integers and binary-exact halves only; reject other values."""
    if value.denominator == 1:
        return value.numerator
    if value.denominator == 2:
        return value.numerator / 2
    raise AssertionError(f"Unexpected non-half fraction {value}")


def vector(values: tuple[Q, ...] | list[Q]) -> list[int | float]:
    return [number(value) for value in values]


def exact(values: tuple[Q, ...] | list[Q]) -> list[str]:
    return [str(value) for value in values]


@dataclass
class Actor:
    stock: list[Q] = field(default_factory=lambda: list(INITIAL))
    at: int = 0
    phase: str = "saving"
    spent: list[Q] = field(default_factory=lambda: [Q(0)] * 3)
    overflow: list[Q] = field(default_factory=lambda: [Q(0)] * 3)
    garrison: int = 0
    payments: list[int] = field(default_factory=list)
    gross: list[Q] = field(default_factory=lambda: [Q(0)] * 3)
    raid_loss: list[Q] = field(default_factory=lambda: [Q(0)] * 3)

    @property
    def rates(self) -> tuple[Q, Q, Q]:
        return COMPLETED_RATES if self.phase == "complete" else BASE_RATES

    def snapshot(self) -> dict[str, Any]:
        return {
            "at": self.at,
            "phase": self.phase,
            "stock": vector(self.stock),
            "spent": vector(self.spent),
            "stockExact": exact(self.stock),
            "rates": vector(self.rates),
            "overflow": vector(self.overflow),
            "grossProduction": vector(self.gross),
            "raidLoss": vector(self.raid_loss),
            "garrison": self.garrison,
        }

    def produce_until(self, at: int) -> list[Q]:
        assert at >= self.at
        dt = Q(at - self.at)
        production = [rate * dt for rate in self.rates]
        for index, addition in enumerate(production):
            self.gross[index] += addition
            uncapped = self.stock[index] + addition
            self.overflow[index] += max(Q(0), uncapped - CAPS[index])
            self.stock[index] = min(uncapped, CAPS[index])
        self.at = at
        return production

    def grow(self) -> dict[str, Any]:
        assert self.at > 0 and self.at % PASS == 0
        before = self.snapshot()
        debit = [Q(0)] * 3
        if self.phase == "saving":
            if self.stock[0] >= THRESHOLD[0] and self.stock[1] >= THRESHOLD[1]:
                debit = list(COST)
                self.stock = [amount - cost for amount, cost in zip(self.stock, COST)]
                self.spent = [amount + cost for amount, cost in zip(self.spent, COST)]
                self.phase = "building-2"
                self.payments.append(self.at)
        elif self.phase == "building-2":
            self.phase = "building-1"
        elif self.phase == "building-1":
            self.phase = "complete"
        elif self.phase != "complete":
            raise AssertionError(f"Unknown phase {self.phase}")
        return {
            "at": self.at,
            "kind": "growth-pass",
            "beforePhase": before["phase"],
            "beforeStock": before["stock"],
            "debit": vector(debit),
            "afterPhase": self.phase,
            "afterStock": vector(self.stock),
        }

    def event(self, kind: str, fleet_id: int) -> dict[str, Any]:
        before = vector(self.stock)
        if kind == "scout":
            return {
                "at": self.at,
                "kind": kind,
                "fleetId": fleet_id,
                "stock": before,
                "phase": self.phase,
                "garrison": self.garrison,
            }
        assert kind == "attack"
        # Fraction floor division is exact, including noninteger stock.
        loot = [Q(amount // 2) for amount in self.stock]
        self.stock = [amount - taken for amount, taken in zip(self.stock, loot)]
        self.raid_loss = [amount + taken for amount, taken in zip(self.raid_loss, loot)]
        self.garrison = 0
        return {
            "at": self.at,
            "kind": kind,
            "fleetId": fleet_id,
            "beforeStock": before,
            "loot": vector(loot),
            "afterStock": vector(self.stock),
            "phase": self.phase,
            "garrison": self.garrison,
        }


def simulate(
    initial: tuple[Q, Q, Q],
    checkpoints: list[int],
    events: list[tuple[int, str, int]] | None = None,
    actor: Actor | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Actor]:
    state = deepcopy(actor) if actor is not None else Actor(stock=list(initial))
    events = events or []
    end = max(checkpoints)
    start = state.at
    assert all(at >= start for at in checkpoints)
    assert all(start < at <= end for at, _, _ in events)
    times = set(checkpoints)
    times.update(range((start // PASS + 1) * PASS, end + 1, PASS))
    times.update(at for at, _, _ in events)
    snapshots = []
    observations = []
    for at in sorted(times):
        if at > start:
            production = state.produce_until(at)
            observations.append({
                "at": at,
                "kind": "production",
                "grossProduction": vector(production),
                "stock": vector(state.stock),
                "overflowTotal": vector(state.overflow),
            })
            if at % PASS == 0:
                observations.append(state.grow())
        # Each type sorts by its own fleet IDs. Scouts always precede attacks,
        # even when every attack ID is lower than every scout ID.
        due = [(kind, fleet_id) for due_at, kind, fleet_id in events if due_at == at]
        for kind, fleet_id in sorted(due, key=lambda event: (0 if event[0] == "scout" else 1, event[1])):
            observations.append(state.event(kind, fleet_id))
        if at in checkpoints:
            snapshots.append(state.snapshot())
    return snapshots, observations, state



def binary64_relocation_probe() -> dict[str, Any]:
    """Current wallet arithmetic counterexample, intentionally not idealized.

    Contract supplied by the task owner: now adopts each binary64 segment
    delta. At an adopted endpoint >= 12000, stock is settled at that endpoint,
    then both now and mark reset to zero. Otherwise the wallet remains lazy.
    Python float supplies the same binary64 arithmetic for these operations.
    Fractions only describe represented inputs/results; they do not repair them.
    """
    initial_stock = [0.0, 0.0, 1.799999999999636]
    initial_now = 11999.9
    initial_mark = 11999.9
    rates = [5.0, 2.5, 1.0]
    caps = [50000.0, 30000.0, 10000.0]

    def represented(value: float) -> dict[str, Any]:
        return {"number": value, "repr": repr(value), "exact": str(Q.from_float(value))}

    def path(deltas: list[float]) -> dict[str, Any]:
        stock = initial_stock[:]
        now = initial_now
        mark = initial_mark
        segments = []
        final_projection = stock[:]
        for delta in deltas:
            now = now + delta
            endpoint = now
            elapsed = now - mark
            projection = [min(cap, stored + rate * elapsed)
                          for stored, rate, cap in zip(stock, rates, caps)]
            relocated = endpoint >= 12000.0
            if relocated:
                stock = projection[:]
                now = 0.0
                mark = 0.0
            final_projection = [min(cap, stored + rate * (now - mark))
                                for stored, rate, cap in zip(stock, rates, caps)]
            segments.append({
                "delta": represented(delta),
                "adoptedEndpointBeforeRelocation": represented(endpoint),
                "elapsedBeforeRelocation": represented(elapsed),
                "projectionBeforeRelocation": [represented(value) for value in projection],
                "relocated": relocated,
                "nowAfter": represented(now),
                "markAfter": represented(mark),
                "storedStockAfter": [represented(value) for value in stock],
                "projectedStockAfter": [represented(value) for value in final_projection],
                "floorHalfDeuteriumAfter": int(final_projection[2] // 2.0),
            })
        return {
            "deltas": deltas,
            "segments": segments,
            "finalProjectedStock": final_projection,
            "finalProjectedStockExact": [str(Q.from_float(value)) for value in final_projection],
            "floorHalfDeuterium": int(final_projection[2] // 2.0),
        }

    small = path([0.1, 0.1])
    large = path([0.2])
    assert small["finalProjectedStock"][2] == 1.9999999999999998
    assert large["finalProjectedStock"][2] == 2.0000000000003633
    assert small["floorHalfDeuterium"] == 0
    assert large["floorHalfDeuterium"] == 1
    assert small["segments"][0]["nowAfter"]["number"] == 0.0
    assert small["segments"][1]["nowAfter"]["number"] == 0.1
    assert large["segments"][0]["nowAfter"]["number"] == 0.0
    return {
        "name": "binary64-endpoint-relocation-authority-counterexample",
        "expectedDivergence": True,
        "result": "Different partitions produce different authoritative binary64 wallet projections and different floor(D/2). This is an expected counterexample, not a test failure.",
        "initial": {
            "phase": "saving",
            "stock": [represented(value) for value in initial_stock],
            "now": represented(initial_now),
            "mark": represented(initial_mark),
        },
        "contract": "At each adopted segment endpoint, project stock using stored + rate * (now - mark), capped. Only when endpoint >= 12000, settle that projection and reset both now and mark to 0. Do not retain absolute now after relocation.",
        "smallSegments": small,
        "largeSegment": large,
        "noUniversalPartitionEqualityClaim": True,
    }


def build_exact_golden() -> dict[str, Any]:
    definitions = {
        "fresh": (INITIAL, [720, 780, 840, 900], []),
        "zero": ((Q(0), Q(0), Q(0)), [780, 840, 900, 960, 1020], []),
        "full": (CAPS, [60, 120, 180, 240], []),
        "raidBefore": (INITIAL, [660, 720, 840, 1080, 1140, 1200, 1260], [(660, "attack", 41)]),
        "coincident": (INITIAL, [720, 780, 840, 900], [(720, "attack", 2), (720, "scout", 91)]),
    }
    scenarios = {}
    observations = {}
    finals = {}
    for name, (initial, checkpoints, events) in definitions.items():
        states, all_observations, final = simulate(initial, checkpoints, events)
        scenarios[name] = states
        # Include all growth transitions; production observations need only
        # accompany requested checkpoints. This preserves relevant before/pay.
        observations[name] = [
            item for item in all_observations
            if item["at"] in checkpoints
            or (item["kind"] == "growth-pass" and item["beforePhase"] != item["afterPhase"])
        ]
        finals[name] = final

    # A completed baseline is copied at time 900. Time 900 is a checkpoint,
    # not a historical growth tick to execute again for the new live object.
    baseline = finals["fresh"]
    late, late_observations, late_final = simulate(INITIAL, [900, 960], actor=baseline)
    scenarios["lateMaterialization"] = late
    observations["lateMaterialization"] = late_observations

    # Independent ordering probe with multiple fleets deliberately unsorted.
    ordering_states, ordering_observations, _ = simulate(
        INITIAL,
        [720],
        [(720, "attack", 14), (720, "scout", 19),
         (720, "attack", 5), (720, "scout", 3)],
    )
    ordering_events = [item for item in ordering_observations if item["kind"] in ("scout", "attack")]

    # A fractional-stock check ensures floor-half attacks do not silently round.
    half_states, half_observations, _ = simulate(INITIAL, [1], [(1, "attack", 1)])
    half_attack = next(item for item in half_observations if item["kind"] == "attack")

    expected = {
        "fresh": [
            (720, "building-2", [2100, 1050, 720]),
            (780, "building-1", [2400, 1200, 780]),
            (840, "complete", [2700, 1350, 840]),
            (900, "complete", [3060, 1500, 900]),
        ],
        "zero": [
            (780, "saving", [3900, 1950, 780]),
            (840, "building-2", [2200, 1100, 840]),
            (900, "building-1", [2500, 1250, 900]),
            (960, "complete", [2800, 1400, 960]),
            (1020, "complete", [3160, 1550, 1020]),
        ],
        "full": [
            (60, "building-2", [48000, 29000, 10000]),
            (120, "building-1", [48300, 29150, 10000]),
            (180, "complete", [48600, 29300, 10000]),
            (240, "complete", [48960, 29450, 10000]),
        ],
        "raidBefore": [
            (660, "saving", [1900, 950, 330]),
            (720, "saving", [2200, 1100, 390]),
            (840, "saving", [2800, 1400, 510]),
            (1080, "building-2", [2000, 1000, 750]),
            (1140, "building-1", [2300, 1150, 810]),
            (1200, "complete", [2600, 1300, 870]),
            (1260, "complete", [2960, 1450, 930]),
        ],
        "coincident": [
            (720, "building-2", [1050, 525, 360]),
            (780, "building-1", [1350, 675, 420]),
            (840, "complete", [1650, 825, 480]),
            (900, "complete", [2010, 975, 540]),
        ],
        "lateMaterialization": [
            (900, "complete", [3060, 1500, 900]),
            (960, "complete", [3420, 1650, 960]),
        ],
    }
    for name, expected_rows in expected.items():
        assert [(row["at"], row["phase"], row["stock"]) for row in scenarios[name]] == expected_rows
        assert all(row["garrison"] == 0 for row in scenarios[name])
        for row in scenarios[name]:
            assert row["spent"] == ([0, 0, 0] if row["phase"] == "saving" else [2000, 1000, 0])
    assert finals["fresh"].payments == [720]
    assert finals["zero"].payments == [840]
    assert finals["full"].payments == [60]
    assert finals["raidBefore"].payments == [1080]
    assert finals["coincident"].payments == [720]
    assert baseline.payments == late_final.payments == [720]
    assert not any(item["kind"] == "growth-pass" and any(item["debit"]) for item in late_observations)
    assert scenarios["full"][0]["overflow"] == [300, 150, 60]
    assert scenarios["full"][-1]["overflow"] == [300, 150, 240]
    scout = next(item for item in observations["coincident"] if item["kind"] == "scout")
    assert scout["stock"] == [2100, 1050, 720]
    assert [(item["kind"], item["fleetId"]) for item in ordering_events] == [
        ("scout", 3), ("scout", 19), ("attack", 5), ("attack", 14)
    ]
    assert ordering_states[0]["stock"] == [525, 263, 180]
    assert half_attack["beforeStock"] == [505, 252.5, 1]
    assert half_attack["loot"] == [252, 126, 0]
    assert half_states[0]["stock"] == [253, 126.5, 1]

    # Terminal-state and cap behavior checked at a much later adopted time.
    long_states, _, long_actor = simulate(INITIAL, [100000])
    assert long_actor.payments == [720]
    assert long_states[0]["stock"] == [50000, 30000, 10000]
    assert long_states[0]["spent"] == [2000, 1000, 0]
    assert long_states[0]["garrison"] == 0

    return {
        "scenarios": scenarios,
        "observations": observations,
        "definition": {
            "scope": "Optional NPC-only single-annex design experiment; not production code or persistence schema.",
            "arithmetic": "Python Fraction and integer floor; exported half values are exactly representable JSON numbers.",
            "stockOrder": ["metal", "crystal", "deuterium"],
            "initialStock": vector(INITIAL),
            "fixedCaps": vector(CAPS),
            "baseRates": vector(BASE_RATES),
            "completedRates": vector(COMPLETED_RATES),
            "globalPassSeconds": PASS,
            "firstPass": PASS,
            "startThreshold": [4000, 2000],
            "actualCost": vector(COST),
            "phaseOrder": ["saving", "building-2", "building-1", "complete"],
            "sameTimeOrder": ["production", "growth-pass", "scouts by fleet ID", "attacks by fleet ID"],
            "stockCheckpointSemantics": "Post-production, post-growth, and post-event state at checkpoint time.",
            "spentSemantics": "Cumulative annex debit represented in the actor history. Late baseline copy preserves this history without re-debiting stock.",
            "garrison": "Initially zero and remains zero; no ships or regeneration.",
        },
        "purchaseTimes": {name: actor.payments for name, actor in finals.items()},
        "lateMaterialization": {
            "at": 900,
            "sourceScenario": "fresh",
            "copiedStock": [3060, 1500, 900],
            "copiedPhase": "complete",
            "sourceHistoricalSpent": [2000, 1000, 0],
            "newSpendOnMaterialization": [0, 0, 0],
            "newSpendThrough960": [0, 0, 0],
            "historicalPassesReplayed": 0,
        },
        "orderingProbe": {"events": ordering_events, "finalState": ordering_states[0]},
        "fractionalFloorProbe": {"event": half_attack, "finalState": half_states[0]},
        "terminalProbe": long_states[0],
        "binary64AuthorityCounterexample": binary64_relocation_probe(),
        "assertionsPassed": True,
    }


def binary64_economy(max_step=math.inf, flight=720.0, duration=900.0,
                     initial=(500.0, 250.0, 0.0)):
    """Independent actual-float scheduler and lazy anchor accounting.

    Only actual Number-like float operands choose endpoints. Fractions are not
    used here. This is separate from the exact economic rows above.
    """
    actors = [{"stock": list(initial), "mark": 0.0, "phase": "saving", "garrison": 4}
              for _ in range(2)]
    now = total = 0.0
    remaining, growth = float(duration), 60.0
    fleet = {"scout": float(flight), "attack": float(flight)}
    trace, pass_count, steps = [], 0, 0

    def project(actor):
        rates = (6.0, 2.5, 1.0) if actor["phase"] == "complete" else (5.0, 2.5, 1.0)
        return [min(float(cap), amount + rate * (now - actor["mark"]))
                for cap, amount, rate in zip(CAPS, actor["stock"], rates)]

    while remaining > 0.0:
        step = min(remaining, max_step, growth, min(fleet.values(), default=math.inf))
        assert step > 0.0
        now = now + step
        total = total + step
        remaining = remaining - step
        growth = growth - step
        fleet = {kind: value - step for kind, value in fleet.items()}
        steps += 1
        if now >= 12000.0:
            for actor in actors:
                actor["stock"] = project(actor)
                actor["mark"] = 0.0
            now = 0.0
        if growth == 0.0:
            pass_count += 1
            trace.append({"kind": "growth", "at": total, "pass": pass_count})
            for label, actor in zip(("baseline", "site"), actors):
                if actor["phase"] == "saving":
                    before = project(actor)
                    if before[0] >= 4000.0 and before[1] >= 2000.0:
                        after = [amount - float(cost) for amount, cost in zip(before, COST)]
                        assert all(a + float(c) == b for a, c, b in zip(after, COST, before))
                        actor.update(stock=after, mark=now, phase="building-2")
                        trace.append({"kind": "pay", "at": total, "actor": label,
                                      "before": before, "after": after, "paid": vector(COST)})
                elif actor["phase"] == "building-2":
                    actor["phase"] = "building-1"
                elif actor["phase"] == "building-1":
                    actor.update(stock=project(actor), mark=now, phase="complete")
            growth = 60.0
        for kind in ("scout", "attack"):
            if kind in fleet and fleet[kind] == 0.0:
                actor = actors[1]
                stock = project(actor)
                record = {"kind": kind, "at": total, "stock": stock,
                          "phase": actor["phase"], "growthPasses": pass_count}
                if kind == "attack":
                    loot = [math.floor(amount / 2.0) for amount in stock]
                    after = [amount - taken for amount, taken in zip(stock, loot)]
                    assert all(a + l == b for a, l, b in zip(after, loot, stock))
                    actor.update(stock=after, mark=now, garrison=0)
                    record.update(loot=loot, after=after)
                trace.append(record)
                del fleet[kind]
    assert not fleet
    return {"maxStep": "Infinity" if math.isinf(max_step) else max_step,
            "flightRemainingInitially": flight, "duration": duration,
            "stepCount": steps, "passCount": pass_count, "total": total,
            "growthRemaining": growth, "now": now,
            "actors": [{"stock": project(actor), "phase": actor["phase"],
                        "spent": vector(COST) if actor["phase"] != "saving" else [0, 0, 0],
                        "garrison": actor["garrison"]} for actor in actors],
            "trace": trace}


def coordinate_fixture(count=513):
    """Frozen public-coordinate formula, integer arithmetic only, setup only."""
    seed, mask = 20261010, (1 << 32) - 1
    def random(c, salt=0):
        g, s, p = c
        x = (seed ^ ((g * 73856093) & mask) ^ ((s * 19349663) & mask)
             ^ ((p * 83492791) & mask) ^ ((salt * 2654435761) & mask)) & mask
        x ^= x >> 16
        x = (x * 0x7feb352d) & mask
        x ^= x >> 15
        x = (x * 0x846ca68b) & mask
        x ^= x >> 16
        return Q(x & mask, 1 << 32)
    home = (1, 40 + int(random((1, 50, 8), 20) * 21),
            4 + int(random((1, 50, 8), 21) * 9))
    rows, examined = [], 0
    for g in range(1, 6):
        for s in range(1, 101):
            for p in range(1, 16):
                examined += 1
                c = (g, s, p)
                if c != home and random(c) < Q(1, 4):
                    rows.append({"key": f"{g}:{s}:{p}",
                                 "coordinate": {"galaxy": g, "system": s, "position": p},
                                 "garrison": {"light_fighter": 4 if random(c, 101) < Q(3, 4) else 8,
                                              "heavy_fighter": 0 if random(c, 101) < Q(3, 4) else 1}})
                    if len(rows) == count:
                        return {"seed": seed, "home": list(home), "candidatesExamined": examined,
                                "coordinates": rows, "setupOnly": True}
    raise AssertionError("insufficient fixture coordinates")


def build_golden():
    golden = build_exact_golden()
    # Conservation is asserted against independently tracked gross production,
    # overflow, investment spending and raids; overflow is never an asset.
    for name, rows in golden["scenarios"].items():
        initial = [0, 0, 0] if name == "zero" else vector(CAPS) if name == "full" else vector(INITIAL)
        for row in rows:
            assert [i + gross - overflow - paid - lost
                    for i, gross, overflow, paid, lost in
                    zip(initial, row["grossProduction"], row["overflow"], row["spent"], row["raidLoss"])] == row["stock"]
    exact = binary64_economy()
    integer = binary64_economy(1.0)
    tenth = binary64_economy(0.1)
    assert exact["actors"] == integer["actors"]
    assert exact["actors"][1]["phase"] == "complete"
    assert tenth["actors"][1]["phase"] == "saving"
    assert tenth["actors"][1]["spent"] == [0, 0, 0]
    assert exact["passCount"] == 15 and tenth["passCount"] == 14
    tenth_growth = next(e for e in tenth["trace"] if e["kind"] == "growth" and e["pass"] == 12)
    tenth_flight = next(e for e in tenth["trace"] if e["kind"] == "attack")
    assert tenth_flight["at"] == 720.0
    assert tenth_growth["at"] == 720.0000000000881
    neighbors = {name: binary64_economy(flight=flight, duration=61.0, initial=(4000.0, 2000.0, 0.0))
                 for name, flight in (("before", math.nextafter(60.0, -math.inf)),
                                      ("equal", 60.0), ("after", math.nextafter(60.0, math.inf)))}
    assert neighbors["before"]["actors"][1]["phase"] == "saving"
    assert neighbors["equal"]["actors"][1]["phase"] == "building-2"
    assert neighbors["after"]["actors"][1]["phase"] == "building-2"
    golden["binary64Schedules"] = {"eventBoundary": exact, "integer": integer, "tenth": tenth}
    golden["binary64Neighbors"] = neighbors
    golden["coordinateFixture"] = coordinate_fixture()
    golden["boundedPermanentSites"] = {"capacity": 512, "actorsPerPass": 513,
        "eightHourPasses": 480, "eightHourActorVisits": 246240,
        "refusalAtomic": True, "damagedGarrisonRestored": False,
        "materializationIsHostAuthorizedPreparationOnly": True}
    golden["scope"] = "Dormant pure preparation domain and independent arithmetic evidence. No production imports, runtime integration, save schema, browser/UI, paid-route or migration acceptance."
    golden["originalPartitionEqualityFailure"] = {
        "status": "FAILED, preserved",
        "failedClaim": "Arbitrary binary64 partitions must give the same purchased phase at nominal t900",
        "reason": "Repeated growth resets and one flight countdown have different actual float endpoints; no epsilon merging is allowed.",
        "originalFailedSourceSha256": "4f51778ac5c9e1dbce0e9406218d2623036afd0ecbcaccb7e488c700eeebbdf5",
        "originalFailedResultSha256": "12387e4ee34b92525e32d8b5e2e96c94f86007bcaf334b8ae09be134b8ac9b38",
        "oracleSourceSha256": "7b13f95309733c58efe4f2671689e6d12a99c880df611281bba72d017b711804",
        "specSourceSha256": "e1de7250c23871e3a366732a8b4e904771d3ab5a4ed70a607b882332a706fe03",
        "independentBinary64ProbeSourceSha256": "5accbe8127d91d1372ace6e85b00e51d486208cb787f3c0dfef18fcdf4c2a2fc"}
    return golden


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    output = Path(__file__).with_name("golden.json")
    encoded = (json.dumps(build_golden(), indent=2, allow_nan=False) + "\n").encode()
    if args.check:
        if not output.is_file() or output.read_bytes() != encoded:
            raise SystemExit("Golden check FAILED: missing or different bytes; no files changed")
    else:
        output.write_bytes(encoded)
    print(json.dumps({"goldenCheck": "passed" if args.check else "written",
                      "sha256": hashlib.sha256(encoded).hexdigest(),
                      "originalUniversalPartitionAssertion": "FAILED (preserved)",
                      "scope": "Independent arithmetic preparation only"}))


if __name__ == "__main__":
    main()
