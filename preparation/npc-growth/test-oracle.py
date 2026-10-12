#!/usr/bin/env python3
"""Named independent-oracle checks, without importing JavaScript or the game."""
import json
from pathlib import Path
import unittest
import oracle


class IndependentOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.golden = oracle.build_golden()

    def test_committed_bytes_are_reproducible(self):
        encoded = (json.dumps(self.golden, indent=2, allow_nan=False) + '\n').encode()
        self.assertEqual(Path(__file__).with_name('golden.json').read_bytes(), encoded)

    def test_economic_checkpoints_and_exact_conservation(self):
        for name, rows in self.golden['scenarios'].items():
            initial = [0, 0, 0] if name == 'zero' else [50000, 30000, 10000] if name == 'full' else [500, 250, 0]
            for row in rows:
                with self.subTest(scenario=name, at=row['at']):
                    actual = [i + g - o - s - r for i, g, o, s, r in zip(
                        initial, row['grossProduction'], row['overflow'], row['spent'], row['raidLoss'])]
                    self.assertEqual(actual, row['stock'])
        # These loop assertions and subtests are not independent test cases.

    def test_cost_is_paid_once_and_late_copy_never_repays(self):
        self.assertEqual(self.golden['purchaseTimes'], {
            'fresh': [720], 'zero': [840], 'full': [60], 'raidBefore': [1080], 'coincident': [720]})
        self.assertEqual(self.golden['lateMaterialization']['newSpendOnMaterialization'], [0, 0, 0])
        self.assertEqual(self.golden['lateMaterialization']['historicalPassesReplayed'], 0)
        self.assertEqual(self.golden['terminalProbe']['spent'], [2000, 1000, 0])

    def test_actual_binary64_partition_counterexample_is_preserved(self):
        schedules = self.golden['binary64Schedules']
        self.assertEqual(schedules['integer']['actors'][1]['phase'], 'complete')
        self.assertEqual(schedules['tenth']['actors'][1]['phase'], 'saving')
        trace = schedules['tenth']['trace']
        self.assertEqual(next(e['at'] for e in trace if e['kind'] == 'attack'), 720)
        self.assertEqual(next(e['at'] for e in trace if e['kind'] == 'growth' and e['pass'] == 12), 720.0000000000881)
        self.assertEqual(self.golden['originalPartitionEqualityFailure']['status'], 'FAILED, preserved')

    def test_representable_neighbors_are_distinct(self):
        neighbors = self.golden['binary64Neighbors']
        self.assertLess(neighbors['before']['flightRemainingInitially'], 60)
        self.assertEqual(neighbors['equal']['flightRemainingInitially'], 60)
        self.assertGreater(neighbors['after']['flightRemainingInitially'], 60)
        self.assertEqual([neighbors[n]['actors'][1]['phase'] for n in ['before', 'equal', 'after']],
                         ['saving', 'building-2', 'building-2'])

    def test_binary64_wallet_relocation_retains_loot_difference(self):
        probe = self.golden['binary64AuthorityCounterexample']
        self.assertEqual(probe['smallSegments']['floorHalfDeuterium'], 0)
        self.assertEqual(probe['largeSegment']['floorHalfDeuterium'], 1)

    def test_coordinate_fixture_is_finite_unique_and_excludes_home(self):
        fixture = self.golden['coordinateFixture']
        coordinates = fixture['coordinates']
        self.assertEqual(len(coordinates), 513)
        self.assertEqual(len({row['key'] for row in coordinates}), 513)
        home_key = ':'.join(map(str, fixture['home']))
        self.assertNotIn(home_key, {row['key'] for row in coordinates})
        self.assertEqual(self.golden['boundedPermanentSites']['eightHourActorVisits'], 480 * 513)


if __name__ == '__main__':
    unittest.main(verbosity=2)
