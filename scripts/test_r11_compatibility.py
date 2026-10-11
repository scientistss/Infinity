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


class R12CompatibilityTests(unittest.TestCase):
    def setUp(self):
        import r12_compatibility
        self.oracle = r12_compatibility
        self.source = oracle.lift_r10_state_to_r11(EVIDENCE['rows'][2]['oldReaderOutput']['state'])

    def test_frozen_r11_helpers_remain_byte_identical(self):
        for path, digest in (
            ('scripts/r11_compatibility.py', '3113b688e216c4362dfd2bfec94049e80c8ae45859d552c2e1c8e756687cabe0'),
            ('scripts/r11-compatibility.mjs', '467c89f474be57446addcb89079701c8c4504cd28cc9358bc702d27ce7d7066e'),
        ):
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest)

    def test_pure_migration_adds_exact_first_zero_age_field_and_preserves_every_prior_value(self):
        for row in EVIDENCE['rows']:
            with self.subTest(row=row['id']):
                old = row['oldReaderOutput']['state']
                source = oracle.lift_r10_state_to_r11(old)
                actual = self.oracle.lift_r11_state_to_r12(source)
                self.assertEqual(list(actual), ['npcEconomy', *source])
                self.assertEqual(actual['npcEconomy'], {'model': 'fixed-production-v1', 'elapsedSeconds': 0})
                self.assertTrue(oracle.exact_json(self.oracle.project_verified_npc_metadata(actual, npc_elapsed=0), source))
                self.assertTrue(oracle.exact_json(actual, self.oracle.lift_r10_state_to_r12(old)))

    def test_genuine_ca5_r11_sources_keep_paid_demolition_grants_and_all_old_values(self):
        evidence = json.loads((ROOT / 'tests/fixtures/npc-economy-r11.json').read_text())
        self.assertEqual(evidence['sourceSha'], 'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b')
        self.assertEqual(evidence['sourceRevision'], 11)
        self.assertEqual(evidence['schema'], 'infinity-npc-r11-source-fixtures-v1')
        self.assertGreaterEqual(len(evidence['rows']), 4)
        paid = False
        for row in evidence['rows']:
            with self.subTest(row=row['id']):
                self.assertEqual(hashlib.sha256(row['raw'].encode()).hexdigest(), row['rawSha256'])
                self.assertEqual(hashlib.sha256(row['oldReaderRaw'].encode()).hexdigest(), row['oldReaderSha256'])
                self.assertTrue(oracle.exact_json(json.loads(row['oldReaderRaw']), row['oldReaderOutput']))
                original = row['oldReaderOutput']
                self.assertEqual(original['revision'], 11)
                source = original['state']; frozen = copy.deepcopy(source)
                current = self.oracle.lift_r11_state_to_r12(source)
                self.assertTrue(oracle.exact_json(self.oracle.project_verified_npc_metadata(current,npc_elapsed=0),source))
                self.assertEqual(source,frozen)
                self.assertEqual(current['npcEconomy'],{'model':'fixed-production-v1','elapsedSeconds':0})
                if any(planet['demolition'] is not None for planet in source['planets']):
                    paid = True
                    self.assertGreater(sum(planet['terraformerFields']['grantedLevels'] for planet in source['planets']),0)
                    self.assertEqual(current['planets'],source['planets'])
                    self.assertEqual(current['orders'],source['orders'])
                    self.assertNotEqual(source['totalTime'],'0')
        self.assertTrue(paid,'True old paid partial demolition plus earned grants must be covered')

    def test_adopted_age_is_mandatory_for_projection_and_exact_for_nonzero_samples(self):
        for age in (0, 0.125, 1, 61, 7200, 11899.999, 11900):
            with self.subTest(age=age):
                current = self.oracle.lift_r11_state_to_r12(self.source, npc_elapsed=age)
                self.assertTrue(oracle.exact_json(self.oracle.project_verified_npc_metadata(current, npc_elapsed=age), self.source))
                with self.assertRaises(TypeError):
                    self.oracle.project_verified_npc_metadata(current)
                if age:
                    with self.assertRaises(AssertionError):
                        self.oracle.project_verified_npc_metadata(current, npc_elapsed=0)

    def test_missing_extra_wrong_model_nonfinite_nonnumeric_and_wrong_age_are_rejected(self):
        values = [None, [], {}, False, 0, '0',
                  {'model': 'fixed-production-v1'},
                  {'model': 'fixed-production-v1', 'elapsedSeconds': 0, 'extra': False},
                  {'model': 'wrong', 'elapsedSeconds': 0}]
        values += [{'model': 'fixed-production-v1', 'elapsedSeconds': age}
                   for age in (None, False, True, '0', -1, 0.000000000000001, 11901, float('nan'), float('inf'))]
        for npc in values:
            current = self.oracle.lift_r11_state_to_r12(self.source)
            current['npcEconomy'] = npc
            with self.subTest(npc=npc), self.assertRaises(AssertionError):
                self.oracle.project_verified_npc_metadata(current, npc_elapsed=0)
        with self.assertRaises(AssertionError):
            self.oracle.project_verified_npc_metadata(self.source, npc_elapsed=0)

    def test_old_state_changes_and_unknown_fields_cannot_be_projected_away(self):
        current = self.oracle.lift_r11_state_to_r12(self.source)
        current['planets'][0]['resources']['metal'] = 'forged'
        current['unrelated'] = [False, 'must remain']
        projected = self.oracle.project_verified_npc_metadata(current, npc_elapsed=0)
        self.assertEqual(projected['planets'][0]['resources']['metal'], 'forged')
        self.assertEqual(projected['unrelated'], [False, 'must remain'])
        self.assertFalse(oracle.exact_json(projected, self.source))
        self.assertNotEqual(current['planets'][0]['resources'], self.source['planets'][0]['resources'])

    def test_old_shape_cannot_already_contain_npc_and_expected_age_must_be_bounded_number(self):
        for npc in (None, {}, {'model': 'fixed-production-v1', 'elapsedSeconds': 0}):
            with self.subTest(npc=npc), self.assertRaises(AssertionError):
                self.oracle.lift_r11_state_to_r12({**self.source, 'npcEconomy': npc})
        for age in (False, True, None, '0', -1, 11901, float('nan'), float('inf')):
            with self.subTest(age=age), self.assertRaises(AssertionError):
                self.oracle.lift_r11_state_to_r12(self.source, npc_elapsed=age)


    def test_witnessed_segment_fold_is_ordered_exact_bounded_and_accepts_noop_zero(self):
        self.assertEqual(self.oracle.npc_elapsed_from_segments([]), 0)
        self.assertEqual(self.oracle.npc_elapsed_from_segments([0, 0.125, 0]), 0.125)
        self.assertEqual(self.oracle.npc_elapsed_from_segments([0.1, 0.2]), 0.30000000000000004)
        self.assertNotEqual(self.oracle.npc_elapsed_from_segments([0.1, 0.2]), 0.3)
        self.assertEqual(self.oracle.npc_elapsed_from_segments([7200, 10000, 1]), 11900)
        for invalid in (None, (), {}, [False], [True], ['0'], [-1], [float('nan')], [float('inf')]):
            with self.subTest(invalid=invalid), self.assertRaises(AssertionError):
                self.oracle.npc_elapsed_from_segments(invalid)

    def test_render_witness_uses_fixed_old_source_and_never_reads_candidate_age(self):
        import ast
        script = ROOT / 'scripts/browser-render-scheduling.py'
        tree = ast.parse(script.read_text())
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'expected_npc_elapsed')
        fixtures = {'expected': {'base.initial': {}, 'fractional': {}}, 'npcAdoptedTime': {
            'sourceSha': '4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b',
            'observation': 'old-totalTime-add; full unobserved old-state equivalence verified',
            'traces': {
                'base.initial': {'adoptedSegmentsSeconds': [], 'npcElapsedSeconds': 0, 'oldObservedAndUnobservedStateEqual': True},
                'fractional': {'adoptedSegmentsSeconds': [0.1, 0.2], 'npcElapsedSeconds': 0.30000000000000004, 'oldObservedAndUnobservedStateEqual': True},
            }}}
        ns = {'fixtures': fixtures, 'npc_elapsed_from_segments': self.oracle.npc_elapsed_from_segments}
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(script),'exec'),ns)
        self.assertEqual(ns['expected_npc_elapsed']('base.initial'), 0)
        self.assertEqual(ns['expected_npc_elapsed']('fractional'), 0.30000000000000004)
        for mutate in (
            lambda f: f['npcAdoptedTime'].update(sourceSha='candidate'),
            lambda f: f['npcAdoptedTime'].update(observation='candidate NPC age'),
            lambda f: f['npcAdoptedTime']['traces']['fractional'].update(npcElapsedSeconds=0.3),
            lambda f: f['npcAdoptedTime']['traces']['fractional'].update(oldObservedAndUnobservedStateEqual=False),
            lambda f: f['npcAdoptedTime']['traces']['fractional'].update(adoptedSegmentsSeconds=[-1]),
            lambda f: f['npcAdoptedTime']['traces'].pop('base.initial'),
        ):
            changed = copy.deepcopy(fixtures); mutate(changed); ns['fixtures'] = changed
            with self.assertRaises(AssertionError):
                ns['expected_npc_elapsed']('fractional')
        ns['fixtures'] = copy.deepcopy(fixtures)
        ns['fixtures']['npcAdoptedTime']['traces']['base.initial'].update(adoptedSegmentsSeconds=[1],npcElapsedSeconds=1)
        with self.assertRaises(AssertionError):
            ns['expected_npc_elapsed']('base.initial')

    def test_r8_r9_projection_composes_without_loosening_prior_floor_and_slot_proofs(self):
        source9 = json.loads(EVIDENCE['legacyInputs'][0]['raw'])['state']
        for revision in (8, 9):
            source = copy.deepcopy(source9)
            if revision == 8:
                del source['buildingTemplates']
            floor = source['orders']['nextJobId']
            actual = self.oracle.lift_legacy_state_to_r12(source, source_revision=revision, grant_job_floor=floor)
            projected = self.oracle.project_verified_r12_metadata(actual, source, grant_job_floor=floor, npc_elapsed=0)
            expected = source if revision == 9 else {'buildingTemplates': {'nextTemplateId': 1, 'templates': []}, **source}
            self.assertTrue(oracle.exact_json(projected, expected))
            for mutate in (lambda s: s.update(terraformerGrantJobFloor=floor+1),
                           lambda s: s['planets'][0].update(demolition={}),
                           lambda s: s['npcEconomy'].update(elapsedSeconds=1)):
                bad = copy.deepcopy(actual); mutate(bad)
                with self.assertRaises(AssertionError):
                    self.oracle.project_verified_r12_metadata(bad, source, grant_job_floor=floor, npc_elapsed=0)


if __name__ == '__main__':
    unittest.main()
