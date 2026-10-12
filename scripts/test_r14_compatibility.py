"""Offline independent null-slot contracts; no current production imports."""
import copy
import unittest
import r13_compatibility as frozen
from r14_compatibility import *


class R14Contracts(unittest.TestCase):
    def setUp(self):
        self.old = {
            'messages': [{'id': 'scout-7', 'text': '历史库存 501 / 250 / 0', 'at': .1 + .2},
                         {'id': 'return-8', 'at': 1e12, 'text': '原始文本'}],
            'totalTime': '1e400', 'nextFleetId': 12,
            'orders': {'nextJobId': 9, 'tasks': [{'id': 2, 'remaining': .1 + .2}]},
            'fleets': [{'id': 7, 'mission': 'scout', 'leg': 'return', 'fuel': '19.001'}],
            'npcEconomy': {'model': 'npc-wallet-garrison-v1', 'now': .1 + .2,
                           'baseline': {'stock': [501.5, 250.75, .1 + .2], 'mark': 0},
                           'sites': {'1:2:3': {'stock': [0, .5, 1], 'mark': .1, 'garrison': {'light_fighter': 1, 'heavy_fighter': 0}}}},
            'npcBattles': {'model': 'npc-battle-receipts-v1', 'reports': [{'id': 8}]},
            'planets': [{'id': 'home', 'npcResourceRemainder': {'metal': '0.0001', 'crystal': '0', 'deuterium': '0'},
                         'resources': {'metal': '500.001'}, 'demolition': {'jobId': 3}, 'terraformerFields': {'base': 100, 'grantedLevels': 2}}],
        }

    def test_r13_only_adds_null_and_preserves_complete_paid_world_and_clock(self):
        before = copy.deepcopy(self.old)
        current = lift_r13_state_to_r14(self.old)
        self.assertTrue(exact_json(project_verified_r14_scout_metadata(current), before))
        self.assertEqual(self.old, before)
        self.assertEqual(CURRENT_REVISION, 14)
        for old, new in zip(before['messages'], current['messages']):
            self.assertEqual(list(new), [*old, 'npcScoutSnapshot'])
            self.assertIsNone(new['npcScoutSnapshot'])
        current['npcEconomy']['sites']['1:2:3']['stock'][1] = 99
        self.assertEqual(self.old, before)

    def test_missing_nonnull_extra_and_misplaced_fields_never_project_away(self):
        good = lift_r13_state_to_r14(self.old)
        mutations = [lambda s: s['messages'][0].pop('npcScoutSnapshot'),
                     lambda s: s['messages'][0].update(npcScoutSnapshot={}),
                     lambda s: s['messages'][0].update(npcScoutSnapshot=False),
                     lambda s: s['messages'][0].update(extra=None),
                     lambda s: s.update(npcScoutSnapshot=None),
                     lambda s: s['planets'][0].update(npcScoutSnapshot=None),
                     lambda s: s['orders']['tasks'].append({'model': SNAPSHOT_MODEL})]
        for mutate in mutations:
            bad = copy.deepcopy(good); mutate(bad)
            with self.subTest(mutate=mutate), self.assertRaises(AssertionError):
                project_verified_r14_scout_metadata(bad)

    def test_old_reserved_markers_fail_before_any_historical_normalization(self):
        for attach in (lambda s: s['messages'][0].update(npcScoutSnapshot=None),
                       lambda s: s['orders']['tasks'].append({'npcScoutSnapshot': None}),
                       lambda s: s.update(hidden=[{'model': SNAPSHOT_MODEL}])):
            bad = copy.deepcopy(self.old); attach(bad)
            with self.assertRaises(AssertionError): lift_r13_state_to_r14(bad)
        legacy = {'messages': [], 'planets': [], 'hidden': {'npcScoutSnapshot': None}}
        for lift in (lift_r10_state_to_r14, lift_r11_state_to_r14, lift_r12_state_to_r14):
            with self.subTest(lift=lift.__name__), self.assertRaises(AssertionError): lift(legacy)

    def test_projection_preserves_every_old_mutation_for_exact_comparison(self):
        current = lift_r13_state_to_r14(self.old)
        for path, value in [(('totalTime',), '0'), (('orders', 'nextJobId'), 10),
                            (('orders', 'tasks', 0, 'remaining'), .3),
                            (('npcEconomy', 'now'), 0),
                            (('planets', 0, 'resources', 'metal'), '500.00100000001'),
                            (('messages', 0, 'at'), .3), (('messages', 0, 'text'), 'changed')]:
            bad = copy.deepcopy(current); node = bad
            for key in path[:-1]: node = node[key]
            node[path[-1]] = value
            with self.subTest(path=path):
                self.assertFalse(exact_json(project_verified_r14_scout_metadata(bad), self.old))

    def test_plain_dense_data_message_limits_and_scalar_types_fail_closed(self):
        class HiddenList(list): pass
        class HiddenDict(dict): pass
        mutations = [lambda s: s.pop('messages'), lambda s: s.update(messages={}),
                     lambda s: s.update(messages=HiddenList(s['messages'])),
                     lambda s: s['messages'].__setitem__(0, HiddenDict(s['messages'][0])),
                     lambda s: s['messages'].__setitem__(0, None),
                     lambda s: s['messages'][0].update(at=True),
                     lambda s: s['messages'][0].update(at=float('nan')),
                     lambda s: s['messages'][0].update(at=-1),
                     lambda s: s['messages'][0].update(at=1e12 + 1),
                     lambda s: s['messages'][0].update(text='😀' * 501),
                     lambda s: s['messages'][0].update(id='😀' * 51),
                     lambda s: s['messages'][1].update(id=s['messages'][0]['id']),
                     lambda s: s['messages'].extend({'id':str(n),'at':0,'text':''} for n in range(149)),
                     lambda s: s.update(hidden=(1, 2)), lambda s: s.update(hidden={1: None}),
                     lambda s: s.update(hidden=s)]
        for mutate in mutations:
            bad = copy.deepcopy(self.old); mutate(bad)
            with self.subTest(mutate=mutate), self.assertRaises(AssertionError): lift_r13_state_to_r14(bad)

    def test_empty_and_full_150_lists_lift_without_new_history_or_archive(self):
        for count in (0, 150):
            old = copy.deepcopy(self.old)
            old['messages'] = [{'id': str(n), 'at': n, 'text': ''} for n in range(count)]
            current = lift_r13_state_to_r14(old)
            self.assertEqual(len(current['messages']), count)
            self.assertTrue(exact_json(project_verified_r14_scout_metadata(current), old))

    def test_older_migrations_still_equal_frozen_reader_results_plus_null_slots(self):
        old = {'messages': copy.deepcopy(self.old['messages']), 'totalTime': '0', 'planets': [{'id': 'home', 'buildQueue': []}]}
        wallet = expected_npc_economy([.1, .2])
        for lift, previous in ((lift_r10_state_to_r14, frozen.lift_r10_state_to_r13),
                               (lift_r11_state_to_r14, frozen.lift_r11_state_to_r13)):
            expected = previous(old, npc_wallet=wallet)
            self.assertTrue(exact_json(project_verified_r14_scout_metadata(lift(old, npc_wallet=wallet)), expected))
        old['npcEconomy'] = {'model': 'fixed-production-v1', 'elapsedSeconds': .1 + .2}
        expected = frozen.lift_r12_state_to_r13(old)
        self.assertTrue(exact_json(project_verified_r14_scout_metadata(lift_r12_state_to_r14(old)), expected))
        self.assertEqual(expected['npcEconomy']['baseline']['stock'], [501.5, 250.75, .1 + .2])


if __name__ == '__main__': unittest.main()
