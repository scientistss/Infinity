"""Independent additive-null oracle tests; no production modules or browser runs.

Run: python -m unittest discover -s scripts -p 'test_r11_compatibility.py' -v
The fixed r10 evidence includes earned grants, active paid work, exhausted IDs,
locked cards and legacy overfull worlds. Those fields must never be normalized
by the independent r11 expectation helper.
"""
import copy
import hashlib
import json
from pathlib import Path
import unittest

import r11_compatibility as oracle


ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = json.loads((ROOT / 'tests/fixtures/demolition-r10.json').read_text())


class R11CompatibilityTests(unittest.TestCase):
    def test_frozen_r10_helpers_remain_byte_identical(self):
        for path, digest in (
            ('scripts/r10_compatibility.py', 'afcd254a9ebae0d1cf1b78780010d85328ab1db0a10c54f038c3ab6c84c34aa6'),
            ('scripts/r8-compatibility.mjs', 'd5bed35437c3549f70fe19827e292d174cb38b85534f6cf16b6ad98868664645'),
        ):
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest)

    def test_every_fixed_r10_reader_state_adds_only_ordered_null_slots(self):
        self.assertEqual(EVIDENCE['sourceSha'], 'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a')
        self.assertGreaterEqual(len(EVIDENCE['rows']), 12)
        for row in EVIDENCE['rows']:
            with self.subTest(row=row['id']):
                historical = row['oldReaderOutput']['state']
                saved = copy.deepcopy(historical)
                actual = oracle.lift_r10_state_to_r11(historical)
                self.assertEqual(historical, saved)
                self.assertTrue(oracle.exact_json(oracle.assert_null_demolition_slots(actual, historical), historical))
                self.assertEqual(actual['terraformerGrantJobFloor'], historical['terraformerGrantJobFloor'])
                for prior, lifted in zip(historical['planets'], actual['planets']):
                    keys = list(prior)
                    keys.insert(keys.index('buildQueue') + 1, 'demolition')
                    self.assertEqual(list(lifted), keys)
                    self.assertIsNone(lifted['demolition'])
                    self.assertEqual(lifted['terraformerFields'], prior['terraformerFields'])
                    self.assertEqual(lifted['buildQueue'], prior['buildQueue'])
                    self.assertEqual(lifted['shipyardQueue'], prior['shipyardQueue'])

    def test_lift_cannot_change_source_through_aliases(self):
        source = copy.deepcopy(EVIDENCE['rows'][2]['oldReaderOutput']['state'])
        frozen = copy.deepcopy(source)
        lifted = oracle.lift_r10_state_to_r11(source)
        lifted['planets'][0]['resources']['metal'] = '12345'
        lifted['orders']['nextJobId'] += 1
        lifted['research']['queue'].append({'unexpected': True})
        self.assertEqual(source, frozen)

    def test_historical_slot_even_null_and_missing_queue_are_rejected(self):
        for value in (None, {}, [], False, 0, {'kind': 'demolition', 'jobId': 1}):
            source = copy.deepcopy(EVIDENCE['rows'][0]['oldReaderOutput']['state'])
            source['planets'][0]['demolition'] = value
            with self.subTest(value=value), self.assertRaises(AssertionError):
                oracle.lift_r10_state_to_r11(source)
        source = copy.deepcopy(EVIDENCE['rows'][0]['oldReaderOutput']['state'])
        del source['planets'][0]['buildQueue']
        with self.assertRaises(AssertionError):
            oracle.lift_r10_state_to_r11(source)

    def test_missing_and_every_non_null_slot_are_rejected(self):
        source = EVIDENCE['rows'][2]['oldReaderOutput']['state']
        for value in ({}, [], False, 0, '', 'null', {'kind': 'demolition', 'source': 'manual', 'jobId': 1}):
            for index in range(len(source['planets'])):
                actual = oracle.lift_r10_state_to_r11(source)
                actual['planets'][index]['demolition'] = value
                with self.subTest(value=value, index=index), self.assertRaises(AssertionError):
                    oracle.assert_null_demolition_slots(actual, source)
        actual = oracle.lift_r10_state_to_r11(source)
        del actual['planets'][0]['demolition']
        with self.assertRaises(AssertionError):
            oracle.assert_null_demolition_slots(actual, source)

    def test_planet_identity_count_and_order_cannot_be_projected_away(self):
        source = EVIDENCE['rows'][2]['oldReaderOutput']['state']
        for mutate in (
            lambda p: p.reverse(), lambda p: p.pop(), lambda p: p.append(copy.deepcopy(p[0])),
            lambda p: p[0].update(id='forged-owner'),
        ):
            actual = oracle.lift_r10_state_to_r11(source)
            mutate(actual['planets'])
            with self.assertRaises(AssertionError):
                oracle.assert_null_demolition_slots(actual, source)

    def test_old_values_and_extra_fields_are_preserved_not_hidden(self):
        source = EVIDENCE['rows'][2]['oldReaderOutput']['state']
        for mutate in (
            lambda s: s['planets'][0]['resources'].update(metal='999999999999'),
            lambda s: s['planets'][0]['terraformerFields'].update(grantedLevels=999),
            lambda s: s['orders'].update(nextJobId=s['orders']['nextJobId'] + 1),
            lambda s: s['planets'][0].update(extraOldValue={'paid': '123'}),
            lambda s: s.update(extraStateField=[True, 'unchanged']),
            lambda s: s['planets'][0]['buildQueue'].append({'forged': 'old queue field'}),
        ):
            actual = oracle.lift_r10_state_to_r11(source)
            mutate(actual)
            expected = copy.deepcopy(actual)
            for planet in expected['planets']:
                del planet['demolition']
            projected = oracle.assert_null_demolition_slots(actual, source)
            self.assertTrue(oracle.exact_json(projected, expected))
            self.assertFalse(oracle.exact_json(projected, source))

    def test_explicit_r8_r9_composition_preserves_the_original_r10_oracle(self):
        source9 = json.loads(EVIDENCE['legacyInputs'][0]['raw'])['state']
        for revision in (8, 9):
            source = copy.deepcopy(source9)
            if revision == 8:
                del source['buildingTemplates']
            floor = source['orders']['nextJobId']
            lifted = oracle.lift_legacy_state_to_r11(source, source_revision=revision, grant_job_floor=floor)
            self.assertTrue(oracle.assert_zero_grant_metadata(lifted, source, grant_job_floor=floor))
            expected = copy.deepcopy(source)
            if revision == 8:
                expected = {'buildingTemplates': {'nextTemplateId': 1, 'templates': []}, **expected}
            self.assertTrue(oracle.exact_json(oracle.project_verified_r11_metadata(lifted, source, grant_job_floor=floor), expected))
            for bad in (None, {}, {'kind': 'demolition', 'jobId': floor}):
                changed = copy.deepcopy(lifted)
                if bad is None:
                    del changed['planets'][0]['demolition']
                else:
                    changed['planets'][0]['demolition'] = bad
                with self.assertRaises(AssertionError):
                    oracle.project_verified_r11_metadata(changed, source, grant_job_floor=floor)

    def test_projection_does_not_erase_unrelated_old_values_or_move_the_floor(self):
        source = json.loads(EVIDENCE['legacyInputs'][0]['raw'])['state']
        floor = source['orders']['nextJobId']
        actual = oracle.lift_legacy_state_to_r11(source, source_revision=9, grant_job_floor=floor)
        actual['planets'][0]['resources']['metal'] = '7'
        actual['unrelatedOldField'] = ['must stay visible']
        projected = oracle.project_verified_r11_metadata(actual, source, grant_job_floor=floor)
        self.assertEqual(projected['planets'][0]['resources']['metal'], '7')
        self.assertEqual(projected['unrelatedOldField'], ['must stay visible'])
        self.assertFalse(oracle.exact_json(projected, source))
        actual['terraformerGrantJobFloor'] += 1
        with self.assertRaises(AssertionError):
            oracle.project_verified_r11_metadata(actual, source, grant_job_floor=floor)


if __name__ == '__main__':
    unittest.main()
