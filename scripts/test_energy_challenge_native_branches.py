#!/usr/bin/env python3
"""Independent checker tests, not native or natural-route acceptance evidence."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

SPEC = importlib.util.spec_from_file_location('branches', Path(__file__).with_name('check-energy-challenge-native-branches.py'))
M = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(M)


def boundary():
    return {'activePlanetId': 'homeworld', 'planets': [{'id': 'homeworld', 'resources': {'metal': '500', 'crystal': '500', 'deuterium': '0'},
            'buildings': {'solar_plant': 0, 'metal_mine': 0, 'crystal_mine': 0, 'deuterium_synth': 0, 'robotics_factory': 0, 'nanite_factory': 0},
            'buildQueue': [], 'shipyardQueue': [], 'coordinates': {'galaxy': 1, 'system': 50, 'position': 8},
            'productionPct': {'solar_plant': 100, 'metal_mine': 100}, 'units': {'solar_satellite': 0},
            'name': '母星', 'tempMax': 40, 'fieldsMax': 163, 'terraformerFields': {'base': 163, 'grantedLevels': 0},
            'npcResourceRemainder': dict.fromkeys(M.RES, '0'), 'demolition': None}],
            'orders': {'nextJobId': 37, 'untouched': ['sentinel']}, 'stats': {'manualActions': 2, 'buildsCompleted': 9, 'seenQueueIdle': False, 'launches': 1},
            'darkMatter': '5000', 'totalTime': '102', 'warpCores': '1', 'terraformerGrantJobFloor': 37,
            'universe': {'seed': 20261013, 'layout': 'ring-v1'}, 'arcade': {'seed': 20261013, 'untouched': {'value': 9}},
            'deepSpace': {'seed': 20261013 ^ 0x9e3779b9, 'offers': []},
            'protocols': {'slots': [{'card': None, 'elapsed': 0, 'lamp': 'gray', 'reason': '空槽位'} for _ in range(12)], 'accumulator': 0},
            'research': {'queue': [], 'levels': {'computer_tech': 2}}, 'unlockedCards': ['auto_build'],
            'lifetime': {'metal': '1000000', 'crystal': '0', 'deuterium': '0'}, 'curvature': {'score_boost': 0, 'slot_plus': 0},
            'energyChallenge': {'model': 'energy-tightening-v1', 'nextAttemptId': 2, 'completion': None, 'active': {
                'attemptId': 1, 'universeSeed': 20261013, 'homeworldId': 'homeworld', 'entryJobFloor': 37,
                'enteredAt': '102', 'scoreUnits': '123', 'proofs': dict.fromkeys(M.PROOFS)}},
            'unrelated': {'nested': [None, True, 'full-state-preservation']}}


def ordinary(before):
    result = deepcopy(before)
    result['warpCores'] = M.amount(M.Decimal(before['warpCores']) + 1)
    result['stats']['launches'] += 1
    result['protocols']['accumulator'] = 0
    return result


def configured_case(ident):
    original = boundary(); initial = deepcopy(original)
    initial['protocols']['slots'] = M.configured_slots(original, ident == 'auto-card-disable-config')
    initial['unlockedCards'] += ['auto_collect', 'auto_prestige']
    return original, initial, {'id': ident, 'setup': [
        {'path': ['protocols', 'slots'], 'before': original['protocols']['slots'], 'after': initial['protocols']['slots'], 'reason': 'Explicit synthetic configuration'},
        {'path': ['unlockedCards'], 'before': original['unlockedCards'], 'after': initial['unlockedCards'], 'reason': 'Explicit synthetic configuration'}]}


def paid_case(root):
    """Test-only declared fixture; never natural/native acceptance evidence."""
    def write(name, value):
        path = Path(root) / name; raw = (json.dumps(value, sort_keys=True) + '\n').encode(); path.write_bytes(raw)
        return {'file': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    initial = boundary(); paid = M.paid_expected(initial); cancelled = M.cancelled_expected(paid)
    source = write('source.json', {'version': 9, 'revision': 16, 'savedAt': 1000, 'lastTickAt': 1000, 'state': initial})
    first, second, third = [write(name, value) for name, value in [('initial.json', initial), ('paid.json', paid), ('cancelled.json', cancelled)]]
    return {'id': 'paid-job-cancel', 'epoch': 1000, 'classification': 'explicit-synthetic-boundary',
            'source': {'checkpoint': 'entered', 'policy': 'solar', 'original': source}, 'input': source, 'setup': [],
            'initialExpected': first, 'finalExpected': third, 'strictRead': {'ready': True, 'appliedSeconds': 0, 'storageWrites': 0},
            'domainActions': [{'api': 'enqueue', 'request': {'id': 'solar_plant', 'source': 'manual'}, 'before': first, 'after': second},
                              {'api': 'cancel', 'request': {'index': 0}, 'before': second, 'after': third}],
            'steps': [{'kind': 'build', 'id': 'solar_plant', 'expected': second}, {'kind': 'cancel-build', 'index': 0, 'expected': third}],
            'actualPaidJob': paid['planets'][0]['buildQueue'][0]}, write


class IndependentBoundaryGoldens(unittest.TestCase):
    def test_actual_paid_identity_catalog_wallet_and_complete_state(self):
        before = boundary(); original = deepcopy(before); after = M.paid_expected(before)
        self.assertEqual(before, original)
        self.assertEqual(after['orders']['nextJobId'], 38)
        self.assertEqual(after['planets'][0]['resources'], {'metal': '425', 'crystal': '470', 'deuterium': '0'})
        self.assertEqual(after['planets'][0]['buildQueue'][0]['jobId'], 37)
        self.assertEqual(after['planets'][0]['buildQueue'][0]['paid'], {'metal': '75', 'crystal': '30', 'deuterium': '0'})
        self.assertEqual(after['energyChallenge'], before['energyChallenge'])
        self.assertEqual(after['unrelated'], before['unrelated'])
        self.assertEqual(after['stats']['manualActions'], 3)

    def test_cancel_restores_wallet_without_proof_or_id_rewind(self):
        original = boundary(); paid = M.paid_expected(original); cancelled = M.cancelled_expected(paid)
        expected = deepcopy(original); expected['orders']['nextJobId'] += 1; expected['stats']['manualActions'] += 1
        self.assertEqual(cancelled, expected)
        self.assertIsNone(cancelled['energyChallenge']['active']['proofs']['solar_plant'])

    def test_acceleration_charges_exactly_once_and_records_consumed_paid_job(self):
        paid = M.paid_expected(boundary()); paid_original = deepcopy(paid); after = M.accelerated_expected(paid)
        self.assertEqual(paid, paid_original)
        self.assertEqual(after['darkMatter'], '4250')
        self.assertEqual(after['planets'][0]['buildings']['solar_plant'], 1)
        self.assertEqual(after['planets'][0]['buildQueue'], [])
        self.assertEqual(after['stats']['buildsCompleted'], paid['stats']['buildsCompleted'] + 1)
        self.assertEqual(after['energyChallenge']['active']['proofs']['solar_plant'], {
            'jobId': 37, 'targetLevel': 1, 'source': 'manual', 'taskId': None,
            'paid': {'metal': '75', 'crystal': '30', 'deuterium': '0'}})
        self.assertEqual(after['energyChallenge']['active']['scoreUnits'], '123')
        self.assertEqual(after['totalTime'], paid['totalTime'])
        with self.assertRaises(AssertionError):
            M.accelerated_expected(after)

    def test_no_manufactured_paid_or_unfunded_acceleration(self):
        paid = M.paid_expected(boundary())
        for mutate in (lambda p: p.update(darkMatter='749'),
                       lambda p: p['planets'][0]['buildQueue'][0].update(jobId=36),
                       lambda p: p['planets'][0]['buildQueue'][0].update(remainingSeconds=0),
                       lambda p: p['energyChallenge']['active']['proofs'].update(solar_plant={'old': True})):
            bad = deepcopy(paid); mutate(bad)
            with self.assertRaises(AssertionError):
                M.accelerated_expected(bad)

    def test_abandon_changes_only_attempt_even_with_unrelated_full_state(self):
        original = boundary(); expected = deepcopy(original); expected['energyChallenge']['active'] = None
        self.assertEqual(M.challenge_expected(original, 'abandon'), expected)

    def test_reset_parameters_cover_only_derived_seed_fields(self):
        template = boundary(); template['energyChallenge'] = deepcopy(M.EMPTY_CHALLENGE); template['totalTime'] = '0'
        original = deepcopy(template)
        for seed in (0, 1, 20261013, 0xffffffff):
            expected = M.pristine_reset_expected(template, seed)
            self.assertEqual(expected['universe']['seed'], seed)
            self.assertEqual(expected['arcade']['seed'], seed)
            self.assertEqual(expected['deepSpace']['seed'], seed ^ 0x9e3779b9)
            self.assertEqual(expected['energyChallenge'], M.EMPTY_CHALLENGE)
            self.assertEqual(expected['unrelated'], template['unrelated'])
            self.assertEqual(expected['arcade']['untouched'], template['arcade']['untouched'])
            self.assertTrue(40 <= expected['planets'][0]['coordinates']['system'] <= 60)
            self.assertTrue(4 <= expected['planets'][0]['coordinates']['position'] <= 12)
            # Replacing only seed-derived fields restores the entire fixed template.
            expected['universe']['seed'] = template['universe']['seed']
            expected['arcade']['seed'] = template['arcade']['seed']
            expected['deepSpace']['seed'] = template['deepSpace']['seed']
            expected['planets'][0]['coordinates'] = deepcopy(template['planets'][0]['coordinates'])
            self.assertEqual(expected, template)
        self.assertEqual(template, original)
        for seed in (True, -1, 2**32, 1.5, '1', None):
            with self.assertRaises(AssertionError):
                M.pristine_reset_expected(template, seed)
        with self.assertRaises(AssertionError):
            M.pristine_reset_expected(boundary(), 1)

    def test_undeclared_setup_cannot_change_any_economic_field(self):
        original = boundary(); case = {'id': 'paid-job-cancel', 'setup': []}
        M.validate_setup(case, original, original)
        bad = deepcopy(original); bad['darkMatter'] = '1000000'
        with self.assertRaises(AssertionError):
            M.validate_setup(case, original, bad)
        case['setup'] = [{'path': ['darkMatter'], 'before': '5000', 'after': '1000000', 'reason': 'synthetic'}]
        with self.assertRaises(AssertionError):
            M.validate_setup(case, original, bad)

    def test_synthetic_eligibility_must_not_rewrite_completed_receipt(self):
        original = boundary(); original['lifetime'] = {'metal': '0', 'crystal': '0', 'deuterium': '0'}
        after = deepcopy(original); after['lifetime'] = {'metal': '100000000', 'crystal': '0', 'deuterium': '0'}
        case = {'id': 'receipt-ordinary-curvature', 'setup': [{'path': ['lifetime'], 'before': original['lifetime'], 'after': after['lifetime'], 'reason': 'Explicit synthetic eligibility'}]}
        M.validate_setup(case, original, after)
        after['energyChallenge']['nextAttemptId'] += 1
        with self.assertRaises(AssertionError):
            M.validate_setup(case, original, after)

    def test_reset_coordinate_goldens_are_fixed(self):
        # Frozen independently calculated coordinate-hash vectors; no production import.
        self.assertEqual([M.coordinate_random(20261013, 1, 50, 8, salt) for salt in (20, 21)], [373855188, 3202686156])

    def test_fixed_protocol_configuration_rejects_unrelated_slot_and_catalog_edits(self):
        for ident in ('auto-card-disable-config', 'active-auto-guard'):
            original, initial, case = configured_case(ident)
            M.validate_setup(case, original, initial)
            for kind in ('other-slot', 'extra-catalog', 'trigger', 'locked-slot-enabled'):
                altered, row = deepcopy(initial), deepcopy(case)
                if kind == 'extra-catalog':
                    altered['unlockedCards'].append('unrelated-card')
                elif kind == 'other-slot':
                    altered['protocols']['slots'][5]['elapsed'] = 55
                elif kind == 'trigger':
                    altered['protocols']['slots'][0]['card']['trigger']['seconds'] = 18
                else:
                    altered['protocols']['slots'][11]['card']['enabled'] = not altered['protocols']['slots'][11]['card']['enabled']
                row['setup'][0]['after'] = altered['protocols']['slots']; row['setup'][1]['after'] = altered['unlockedCards']
                with self.subTest(ident=ident, mutation=kind), self.assertRaises(AssertionError):
                    M.validate_setup(row, original, altered)

    def test_full_empty_aba_colony_rejects_hidden_economy_and_receipt_grants(self):
        original = boundary(); initial = deepcopy(original)
        initial['planets'].append(M.empty_aba_colony(original))
        case = {'id': 'enter-active-planet-aba', 'setup': [{'path': ['planets'], 'before': original['planets'], 'after': initial['planets'], 'reason': 'Explicit synthetic ABA colony'}]}
        M.validate_setup(case, original, initial)
        for mutate in (lambda p: p['units'].update(solar_satellite=1),
                       lambda p: p['npcResourceRemainder'].update(metal='1'),
                       lambda p: p['terraformerFields'].update(grantedLevels=1),
                       lambda p: p.update(fieldsMax=999),
                       lambda p: p['productionPct'].update(metal_mine=90),
                       lambda p: p['coordinates'].update(position=12)):
            bad, row = deepcopy(initial), deepcopy(case); mutate(bad['planets'][1]); row['setup'][0]['after'] = bad['planets']
            with self.assertRaises(AssertionError):
                M.validate_setup(row, original, bad)

    def test_entry_disables_all_and_only_prestige_cards_with_full_configuration_preserved(self):
        _, before, _ = configured_case('auto-card-disable-config'); before['energyChallenge'] = deepcopy(M.EMPTY_CHALLENGE)
        baseline = ordinary(before); result = M.challenge_expected(before, 'enter', baseline, {'gain': '1', 'disabledPrestigeSlots': [0, 11]})
        expected_slots = deepcopy(before['protocols']['slots'])
        for index in (0, 11): expected_slots[index]['card']['enabled'] = False
        self.assertEqual(result['protocols']['slots'], expected_slots)
        self.assertTrue(result['protocols']['slots'][1]['card']['enabled'])
        self.assertEqual(result['energyChallenge']['active']['entryJobFloor'], before['orders']['nextJobId'])
        self.assertEqual(result['energyChallenge']['active']['scoreUnits'], '0')
        self.assertEqual(M.challenge_expected(result, 'abandon')['protocols'], result['protocols'])
        with self.assertRaises(AssertionError):
            M.challenge_expected(before, 'enter', baseline, {'gain': '1', 'disabledPrestigeSlots': [0]})

    def test_independent_curvature_gain_rejects_inflated_baseline_reward(self):
        before = boundary(); result = ordinary(before); M.ordinary_baseline_checks(before, result, '1')
        result['warpCores'] = '11'
        with self.assertRaises(AssertionError): M.ordinary_baseline_checks(before, result, '10')
        result = ordinary(before); result['protocols']['slots'][0]['elapsed'] = 1
        with self.assertRaises(AssertionError): M.ordinary_baseline_checks(before, result, '1')

    def test_complete_paid_case_and_fixed_typed_native_plan(self):
        with TemporaryDirectory() as root:
            case, _ = paid_case(root)
            self.assertEqual(M.validate_case(case, root), {'id': 'paid-job-cancel', 'actualDomainActions': 2, 'syntheticSetups': 0})
            for mutate in (lambda row: row['domainActions'].pop(),
                           lambda row: row['domainActions'].reverse(),
                           lambda row: row['domainActions'][1]['request'].update(index=1),
                           lambda row: row['steps'].pop(),
                           lambda row: row['steps'].reverse(),
                           lambda row: row['steps'][0].update(js='alert(1)'),
                           lambda row: row['source'].update(checkpoint='initial'),
                           lambda row: row.update(finalExpected=row['initialExpected'])):
                row = deepcopy(case); mutate(row)
                with self.assertRaises(AssertionError): M.validate_case_contract(row)

    def test_complete_paid_case_rejects_full_state_tampering_even_with_rehashed_artifact(self):
        with TemporaryDirectory() as root:
            case, write = paid_case(root)
            altered = M.cancelled_expected(M.paid_expected(boundary())); altered['unrelated']['nested'].append('hidden mutation')
            case['domainActions'][1]['after'] = write('tampered.json', altered)
            case['finalExpected'] = case['steps'][1]['expected'] = case['domainActions'][1]['after']
            with self.assertRaisesRegex(AssertionError, 'full state differs'):
                M.validate_case(case, root)

    def test_source_inventory_rejects_duplicate_traversal_and_current_source_changes(self):
        with TemporaryDirectory() as root:
            path = Path(root) / 'source.ts'; path.write_text('original source')
            records = [{'path': 'source.ts', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}]
            M.source_map(records, root)
            with self.assertRaises(AssertionError): M.source_map(records * 2, root)
            with self.assertRaises(AssertionError): M.source_map([{'path': '../source.ts', 'sha256': records[0]['sha256']}], root)
            path.write_text('changed source')
            with self.assertRaisesRegex(AssertionError, 'Stale boundary source'): M.source_map(records, root)

    def test_original_artifact_identity_rejects_rewrite_and_bool_size(self):
        with TemporaryDirectory() as root:
            case, _ = paid_case(root); ref = case['input']; M.read_ref(ref, root)
            bad = deepcopy(ref); bad['bytes'] = True
            with self.assertRaises(AssertionError): M.read_ref(bad, root)
            (Path(root) / ref['file']).write_text('{}')
            with self.assertRaisesRegex(AssertionError, 'Artifact identity mismatch'): M.read_ref(ref, root)


if __name__ == '__main__':
    unittest.main()
