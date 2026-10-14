"""Independent fail-closed structural tests. Tiny inline values are checker unit inputs,
not prepared route/native evidence and are never sent to a candidate application.
"""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('solar_oracle_checker', Path(__file__).with_name('check-energy-challenge-solar-oracle.py'))
checker = importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)


def state():
    return {'planets': [{'id': 'homeworld', 'resources': {'metal': '500', 'crystal': '500', 'deuterium': '0'},
                         'buildings': {'fusion_reactor': 0}, 'productionPct': {}, 'units': {'solar_satellite': 0}, 'buildQueue': [], 'shipyardQueue': []}],
            'activePlanetId': 'homeworld', 'totalTime': '0', 'lifetime': {}, 'stats': {'launches': 0, 'automatedLaunches': 0},
            'warpCores': '0', 'orders': {'nextJobId': 1}, 'energyChallenge': {'active': None, 'completion': None, 'attemptCounter': 0},
            'research': {'levels': {}, 'queue': []}, 'manualClicks': 0, 'universe': {'seed': checker.SEED}, 'arcade': {'seed': checker.SEED},
            'fleets': [], 'protocols': {'slots': [{'card': None}]}, 'unprojectedRights': {'mustRemain': True}}


def summary(s):
    p = s['planets'][0]
    return {'logicalSeconds': 0, 'totalTime': s['totalTime'], 'wallets': {'homeworld': p['resources']}, 'lifetime': s['lifetime'],
            'launches': s['stats']['launches'], 'warpCores': s['warpCores'], 'nextJobId': s['orders']['nextJobId'], 'challenge': s['energyChallenge'],
            'buildings': p['buildings'], 'productionPct': p['productionPct'], 'satellites': p['units']['solar_satellite'],
            'researchLevels': s['research']['levels'], 'buildingQueue': p['buildQueue'], 'researchQueue': s['research']['queue'],
            'shipyardQueue': p['shipyardQueue'], 'buildingCapacity': 3 if s['energyChallenge']['completion'] else 2,
            'researchCapacity': 3 if s['energyChallenge']['completion'] else 2}


class OracleCheckerTests(unittest.TestCase):
    def test_duplicate_and_nonfinite_json_rejected(self):
        for raw in [b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'{"nested":{"a":1,"a":2}}']:
            with self.subTest(raw=raw), self.assertRaises(AssertionError): checker.decode(raw)

    def test_ref_reads_exact_original_and_rejects_mutations(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); p = root / 'original.json'; p.write_bytes(b'{"original":true}\n')
            ref = {'file': p.name, 'sha256': checker.sha(p.read_bytes()), 'bytes': p.stat().st_size}
            self.assertEqual(checker.reference(root, ref), p.read_bytes())
            for key, value in [('sha256', '0' * 64), ('bytes', 1), ('file', '../original.json')]:
                changed = {**ref, key: value}
                with self.subTest(key=key), self.assertRaises(AssertionError): checker.reference(root, changed)
            p.write_bytes(b'{"original":false}\n')
            with self.assertRaises(AssertionError): checker.reference(root, ref)

    def test_symlink_is_not_an_original(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'real'; p.write_text('original'); link = Path(d) / 'link'; link.symlink_to(p)
            with self.assertRaises(AssertionError): checker.original(link)

    def test_complete_shape_rejects_missing_extra_and_wrong_type(self):
        original = state(); checker.scaffold(original, copy.deepcopy(original))
        for mutate in [lambda s: s.pop('unprojectedRights'), lambda s: s.update(extra=1),
                       lambda s: s['unprojectedRights'].update(extra=1), lambda s: s.update(planets={}),
                       lambda s: s['unprojectedRights'].update(mustRemain=1)]:
            changed = copy.deepcopy(original); mutate(changed)
            with self.assertRaises(AssertionError): checker.scaffold(original, changed)

    def test_pristine_initial_state_positive(self):
        s = state(); event = {'index': 1, 'api': 'createInitialState', 'after': summary(s)}
        self.assertEqual(checker.validate_row({'index': 1, 'state': s}, event, s, None, None, {}, 0), (s, None))

    def test_rejected_action_whole_state_not_summary_only(self):
        s = state(); changed = copy.deepcopy(s); changed['unprojectedRights']['mustRemain'] = False
        event = {'index': 2, 'api': 'reject', 'after': summary(s)}
        with self.assertRaisesRegex(AssertionError, 'every field'):
            checker.validate_row({'index': 2, 'state': changed}, event, s, s, None, {}, 0)

    def test_checkpoint_exact_bytes_clocks_and_complete_state(self):
        s = state(); raw = json.dumps({'state': s, 'savedAt': checker.EPOCH, 'lastTickAt': checker.EPOCH})
        event = {'index': 2, 'api': 'checkpoint', 'request': {'name': 'initial'}, 'after': summary(s)}
        row = {'index': 2, 'state': s, 'raw': raw}; originals = {'initial': raw.encode()}
        self.assertEqual(checker.validate_row(row, event, s, s, None, originals, 0), (s, None))
        for mutate in [lambda r: r.update(raw=r['raw'] + '\n'), lambda r: r['state']['unprojectedRights'].update(mustRemain=False),
                       lambda r: r.update(candidate=s), lambda r: r.update(index=3), lambda r: r.pop('state')]:
            changed = copy.deepcopy(row); mutate(changed)
            with self.assertRaises(AssertionError): checker.validate_row(changed, event, s, s, None, originals, 0)
        changed_raw = raw.replace(str(checker.EPOCH), str(checker.EPOCH + 1000))
        with self.assertRaisesRegex(AssertionError, 'clock'):
            checker.validate_row({**row, 'raw': changed_raw}, event, s, s, None, {'initial': changed_raw.encode()}, 0)

    def test_candidate_not_adopted_until_checkpoint(self):
        s = state(); candidate = copy.deepcopy(s); candidate['energyChallenge']['active'] = {'unitOnly': True}
        event = {'index': 2, 'api': 'challengeCandidate', 'after': summary(s), 'candidate': summary(candidate)}
        row = {'index': 2, 'state': s, 'candidate': candidate}
        self.assertEqual(checker.validate_row(row, event, s, s, None, {}, 0), (s, candidate))
        with self.assertRaises(AssertionError): checker.validate_row({**row, 'state': candidate}, event, s, s, None, {}, 0)
        with self.assertRaises(AssertionError): checker.validate_row(row, event, s, s, candidate, {}, 0)
        rejection = {'index': 3, 'api': 'reject', 'after': summary(s)}
        with self.assertRaises(AssertionError): checker.validate_row({'index': 3, 'state': s}, rejection, s, s, candidate, {}, 0)

    def test_no_unapproved_mechanisms_or_wrong_chronology(self):
        s = state(); event = {'index': 2, 'api': 'tick', 'after': summary(s)}
        for mutate in [lambda x: x.update(manualClicks=1), lambda x: x['stats'].update(automatedLaunches=1),
                       lambda x: x['arcade'].update(seed=1), lambda x: x['universe'].update(seed=1),
                       lambda x: x['planets'][0]['buildings'].update(fusion_reactor=1),
                       lambda x: x['planets'][0]['units'].update(solar_satellite=1),
                       lambda x: x['protocols']['slots'][0].update(card={}), lambda x: x['fleets'].append({})]:
            changed = copy.deepcopy(s); mutate(changed)
            with self.assertRaises(AssertionError): checker.validate_row({'index': 2, 'state': changed}, event, s, s, None, {}, 0)
        with self.assertRaisesRegex(AssertionError, 'chronology'):
            checker.validate_row({'index': 2, 'state': s}, event, s, s, None, {}, 1)


if __name__ == '__main__': unittest.main()
