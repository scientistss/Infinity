"""Independent current-state extension tests; no engine, Node or browser launch."""
import copy
import json
import unittest
import r14_compatibility as frozen
from r16_compatibility import *


class R16Contracts(unittest.TestCase):
    def setUp(self):
        self.old = {'messages': [{'id': 'scout-7', 'at': .1 + .2, 'text': 'old', 'npcScoutSnapshot': None}],
                    'orders': {'nextJobId': 99, 'tasks': [{'id': 7, 'remaining': .1 + .2}]},
                    'planets': [{'id': 'home', 'resources': {'metal': '500.001'},
                                 'npcResourceRemainder': {'metal': '0.25', 'crystal': '0', 'deuterium': '0'}}],
                    'npcEconomy': {'sites': {'1:2:3': {'stock': [0, .5, 1], 'mark': .1}}},
                    'npcBattles': {'reports': [{'id': 23}]}, 'totalTime': '1e400',
                    'untouched': [False, None, {'id': 123, 'amount': '0.000000000001'}]}

    def test_plain_message_model_text_is_preserved_but_typed_authority_is_rejected(self):
        self.old['messages'][0]['text'] = ENERGY_MODEL
        current = lift_r14_state_to_r16(self.old)
        self.assertEqual(current['messages'][0]['text'], ENERGY_MODEL)
        self.assertTrue(exact_json(project_verified_inactive_energy_challenge(current), self.old))
        for candidate in (self.old, current):
            candidate['messages'][0]['model'] = ENERGY_MODEL
            with self.assertRaises(AssertionError):
                (project_verified_inactive_energy_challenge if 'energyChallenge' in candidate else lift_r14_state_to_r16)(candidate)

    def test_lift_preserves_every_prior_value_and_detaches_nested_data(self):
        before = copy.deepcopy(self.old)
        current = lift_r14_state_to_r16(self.old)
        self.assertEqual(CURRENT_REVISION, 16)
        self.assertTrue(exact_json(project_verified_inactive_energy_challenge(current), before))
        self.assertEqual(current['energyChallenge'], expected_inactive_energy_challenge())
        self.assertEqual(next(iter(current)), 'energyChallenge')
        current['orders']['tasks'][0]['remaining'] = 0
        self.assertEqual(self.old, before)

    def test_full_envelope_changes_only_revision_and_exact_added_default(self):
        old = {'schema': 'infinity-original-p4', 'revision': 14, 'version': 9,
               'savedAt': 1250.125, 'lastTickAt': 1234.25, 'state': self.old}
        current = lift_r14_envelope_to_r16(old)
        self.assertEqual(current['revision'], 16)
        previous = copy.deepcopy(current); previous['revision'] = 14
        previous['state'] = project_verified_inactive_energy_challenge(current['state'])
        self.assertTrue(exact_json(previous, old))
        for revision in (2, 13, 15, 16, 999, True):
            with self.subTest(revision=revision), self.assertRaises(AssertionError):
                lift_r14_envelope_to_r16({**old, 'revision': revision})

    def test_missing_active_completed_noncanonical_and_extra_fields_fail_closed(self):
        good = lift_r14_state_to_r16(self.old)
        mutations = [lambda s: s.pop('energyChallenge'), lambda s: s.update(energyChallenge=None),
                     lambda s: s['energyChallenge'].update(extra=None),
                     lambda s: s['energyChallenge'].pop('active'),
                     lambda s: s['energyChallenge'].update(active={}),
                     lambda s: s['energyChallenge'].update(completion=True),
                     lambda s: s['energyChallenge'].update(nextAttemptId=True),
                     lambda s: s['energyChallenge'].update(nextAttemptId=1.0),
                     lambda s: s['energyChallenge'].update(nextAttemptId=2),
                     lambda s: s['energyChallenge'].update(model='other')]
        for mutate in mutations:
            state = copy.deepcopy(good); mutate(state)
            with self.subTest(mutate=mutate), self.assertRaises(AssertionError):
                project_verified_inactive_energy_challenge(state)

    def test_prior_changes_are_never_hidden_by_projection(self):
        for path, value in [(('totalTime',), '0'), (('orders', 'nextJobId'), 100),
                            (('orders', 'tasks', 0, 'remaining'), .3),
                            (('planets', 0, 'resources', 'metal'), '500.002'),
                            (('npcEconomy', 'sites', '1:2:3', 'stock', 1), .50001),
                            (('npcBattles', 'reports', 0, 'id'), 24),
                            (('messages', 0, 'text'), 'changed')]:
            state = lift_r14_state_to_r16(self.old); target = state
            for part in path[:-1]: target = target[part]
            target[path[-1]] = value
            with self.subTest(path=path):
                self.assertFalse(exact_json(project_verified_inactive_energy_challenge(state), self.old))

    def test_historical_and_misplaced_authority_and_non_json_values_are_rejected(self):
        class HiddenDict(dict): pass
        cycle = {}; cycle['cycle'] = cycle
        for extra in [{'energyChallenge': None}, {'nested': {'energyChallenge': None}},
                      {'nested': [{'model': ENERGY_MODEL}]}, {'bad': float('nan')},
                      {'bad': HiddenDict(x=1)}, {'bad': (1, 2)}, {'bad': {1: 'wrong key'}}, cycle]:
            with self.subTest(extra=str(type(extra))), self.assertRaises(AssertionError):
                lift_r14_state_to_r16({**self.old, **extra})
        for extra in [{'energyChallenge': None}, {'model': ENERGY_MODEL}]:
            current = lift_r14_state_to_r16(self.old); current['untouched'].append(extra)
            with self.assertRaises(AssertionError): project_verified_inactive_energy_challenge(current)

    def test_frozen_historical_composition_keeps_exact_old_semantics(self):
        old = {'messages': [], 'planets': [{'id': 'home', 'buildQueue': [], 'resources': {'metal': '500'}}], 'orders': {'nextJobId': 7}}
        wallet = expected_npc_economy([.1, .2])
        for lift, historical in [(lift_r10_state_to_r16, frozen.lift_r10_state_to_r14),
                                 (lift_r11_state_to_r16, frozen.lift_r11_state_to_r14)]:
            actual = lift(old, npc_wallet=wallet)
            self.assertTrue(exact_json(project_verified_inactive_energy_challenge(actual), historical(old, npc_wallet=wallet)))
        r13 = frozen._r13.lift_r11_state_to_r13(old, npc_wallet=wallet)
        self.assertTrue(exact_json(project_verified_inactive_energy_challenge(lift_r13_state_to_r16(r13)), frozen.lift_r13_state_to_r14(r13)))


if __name__ == '__main__': unittest.main()
