"""Offline observation contracts only. No Node, JavaScript or browser execution.

Run: python3 -m unittest discover -s scripts -p 'test_migration_quota_progress.py' -v
"""
import ast
import copy
import json
from pathlib import Path
import re
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('browser-r9-migration-quota.py')
TREE = ast.parse(SCRIPT.read_text(encoding='utf-8'))
HELPERS = {'paid_identity', 'paid_queue_targets', 'paid_countdown_seconds',
           'paid_progress_percent', 'paid_queue_progress', 'observe_paid_queue_progress'}


class Clock:
    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def time(self):
        return 1800000000 + self.now

    def sleep(self, seconds):
        self.now += seconds


def helpers(clock=None):
    nodes = [node for node in TREE.body if
             isinstance(node, ast.FunctionDef) and node.name in HELPERS or
             isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and
                 target.id in {'PAID_PROGRESS_TIMEOUT_MS', 'PAID_QUEUE_OBSERVATION'} for target in node.targets)]
    namespace = {'re': re, 'time': clock or Clock()}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), namespace)
    return namespace


def row(kind='building', job='257', **changes):
    return {'key': f'homeworld:{job}', 'paidKind': kind, 'paidPlanet': 'homeworld', 'paidJob': job,
            'active': True, 'label': '金属仓库 → 等级 9', 'detail': '剩余 2 分 3 秒 / 共 2 分 3 秒',
            'progress': '0%', 'cancelDisabled': False, 'rowVisibility': {'visible': True},
            'detailVisibility': {'visible': True}, 'barVisibility': {'visible': True},
            'fillVisible': True, **changes}


def observation():
    return {'queues': {'queue': [row(), row(job='258', active=False,
                       detail='等待中 · 已付款 · 预计 3 分 5 秒')],
                       'rqueue': [row('research', '1441')], 'squeue': [row('shipyard', '259')]},
            'visibilityState': 'visible', 'overviewVisibility': {'visible': True},
            'monotonicMs': 100, 'wallMs': 1800000000000,
            'hostMonotonicStart': 0, 'hostMonotonicEnd': 0}


class PredicateTests(unittest.TestCase):
    def setUp(self):
        self.ns = helpers()
        self.before = observation()
        self.after = copy.deepcopy(self.before)
        self.after.update(monotonicMs=300, hostMonotonicStart=.2, hostMonotonicEnd=.2)

    def witnesses(self):
        return self.ns['paid_queue_progress'](self.before, self.after)

    def test_countdown_decrease_and_width_increase_each_pass(self):
        for kind in ('queue', 'rqueue'):
            for field, value in (('detail', '剩余 2 分 2 秒 / 共 2 分 3 秒'), ('progress', '0.1%')):
                with self.subTest(kind=kind, field=field):
                    candidate = copy.deepcopy(self.after)
                    candidate['queues'][kind][0][field] = value
                    witness = self.ns['paid_queue_progress'](self.before, candidate)
                    self.assertEqual(len(witness), 1)
                    self.assertEqual(witness[0]['kind'], kind)

    def test_squeue_label_disabled_and_waiting_estimate_do_not_release_wait(self):
        self.after['queues']['squeue'][0].update(detail='changed', progress='90%')
        for kind in ('queue', 'rqueue'):
            self.after['queues'][kind][0].update(label='changed', cancelDisabled=True)
        self.after['queues']['queue'][1].update(detail='等待中 · 已付款 · 预计 2 分 1 秒', progress='10%')
        self.assertEqual(self.witnesses(), [])

    def test_only_countdown_prefix_counts_not_total_or_safety_suffix(self):
        for detail in ('剩余 2 分 3 秒 / 共 5 分 0 秒',
                       '剩余 2 分 3 秒 / 共 2 分 3 秒 · 安全停止：changed',
                       '等待中 · 已付款 · 预计 2 分 2 秒', 'changed', None):
            with self.subTest(detail=detail):
                self.after['queues']['queue'][0]['detail'] = detail
                self.assertEqual(self.witnesses(), [])

    def test_regression_in_time_or_progress_does_not_count_as_advancing(self):
        self.before['queues']['queue'][0]['progress'] = '5%'
        self.after['queues']['queue'][0].update(progress='4.9%', detail='剩余 2 分 4 秒 / 共 2 分 3 秒')
        self.assertEqual(self.witnesses(), [])

    def test_same_logical_job_remount_and_reorder_are_allowed(self):
        self.after['queues']['queue'][0]['progress'] = '1%'
        self.after['queues']['queue'].reverse()
        witness = self.witnesses()
        self.assertEqual(witness[0]['identity'], ('building', 'homeworld', '257'))

    def test_replaced_or_removed_head_cannot_borrow_next_job_progress(self):
        self.after['queues']['queue'] = [row(job='258', progress='1%')]
        self.assertEqual(self.witnesses(), [])

    def test_identity_fields_and_active_state_must_match(self):
        mutations = [('key', 'homeworld:258'), ('paidJob', '258'), ('paidPlanet', 'colony-1'),
                     ('paidKind', 'research'), ('active', False), ('paidJob', None)]
        for field, value in mutations:
            with self.subTest(field=field):
                candidate = copy.deepcopy(self.after)
                candidate['queues']['queue'][0].update(progress='1%', **{field: value})
                self.assertEqual(self.ns['paid_queue_progress'](self.before, candidate), [])

    def test_ambiguous_duplicate_identity_or_key_is_rejected(self):
        for target in ('before', 'after'):
            for corrupt_identity in (False, True):
                before, after = copy.deepcopy(self.before), copy.deepcopy(self.after)
                after['queues']['queue'][0]['progress'] = '1%'
                rows = (before if target == 'before' else after)['queues']['queue']
                duplicate = copy.deepcopy(rows[0])
                if corrupt_identity:
                    duplicate['paidJob'] = '999'
                rows.append(duplicate)
                with self.subTest(target=target, corrupt_identity=corrupt_identity):
                    self.assertEqual(self.ns['paid_queue_progress'](before, after), [])

    def test_hidden_document_panel_row_or_changed_field_cannot_pass(self):
        for target in ('before', 'after'):
            for hidden in ('document', 'panel', 'rowVisibility', 'detailVisibility', 'barVisibility', 'fillVisible'):
                before, after = copy.deepcopy(self.before), copy.deepcopy(self.after)
                snap = before if target == 'before' else after
                changed = after['queues']['queue'][0]
                if hidden in ('barVisibility', 'fillVisible'):
                    changed['progress'] = '1%'
                else:
                    changed['detail'] = '剩余 2 分 2 秒 / 共 2 分 3 秒'
                if hidden == 'document':
                    snap['visibilityState'] = 'hidden'
                elif hidden == 'panel':
                    snap['overviewVisibility']['visible'] = False
                elif hidden == 'fillVisible':
                    snap['queues']['queue'][0][hidden] = False
                else:
                    snap['queues']['queue'][0][hidden]['visible'] = False
                with self.subTest(target=target, hidden=hidden):
                    self.assertEqual(self.ns['paid_queue_progress'](before, after), [])

    def test_page_and_host_six_second_bounds_are_both_required(self):
        self.after['queues']['queue'][0]['progress'] = '1%'
        for page_ms, host_end in ((0, 1), (6000.001, 1), (100, 6.001), (100, -1)):
            self.after.update(monotonicMs=self.before['monotonicMs'] + page_ms, hostMonotonicEnd=host_end)
            with self.subTest(page_ms=page_ms, host_end=host_end):
                self.assertEqual(self.witnesses(), [])
        self.after.update(monotonicMs=6100, hostMonotonicEnd=6)
        self.assertTrue(self.witnesses())

    def test_original_targets_need_both_valid_unique_active_heads(self):
        self.assertEqual(set(self.ns['paid_queue_targets'](self.before)), {'queue', 'rqueue'})
        self.before['queues']['queue'].reverse()
        self.assertEqual(set(self.ns['paid_queue_targets'](self.before)), {'rqueue'})
        for job in ('', '0', '-1', '01', '1.0', '9007199254740992', '１２', None):
            with self.subTest(job=job):
                self.assertIsNone(self.ns['paid_identity'](row(job=job), 'queue'))

    def test_duration_projection_and_invalid_width_values(self):
        for duration, seconds in (('1 天 2 小时', 93600), ('2 小时 3 分', 7380), ('2 分 3 秒', 123), ('3 秒', 3)):
            self.assertEqual(self.ns['paid_countdown_seconds'](f'剩余 {duration} / 共 9 天 0 小时'), seconds)
        for value in ('', None, 'NaN%', 'Infinity%', '101%', '-1%', '1px'):
            self.assertIsNone(self.ns['paid_progress_percent'](value))


class ObserverTests(unittest.TestCase):
    def run_observer(self, snapshots, evaluate_delay=0, record=None):
        clock = Clock()
        ns = helpers(clock)
        recorded = []
        class Page:
            calls = 0
            def evaluate(self, expression, probe):
                self.calls += 1
                value = snapshots[min(self.calls - 1, len(snapshots) - 1)]
                if isinstance(value, BaseException):
                    raise value
                clock.now += evaluate_delay
                snap = copy.deepcopy(value)
                snap['monotonicMs'] = 100 + clock.now * 1000
                snap['wallMs'] = clock.time() * 1000
                return snap
        page = Page()
        def save(evidence):
            recorded.append(copy.deepcopy(evidence))
            if record:
                record(evidence)
        result = ns['observe_paid_queue_progress'](page, 'raw DOM probe', save)
        return result, recorded, clock, page

    def test_unrelated_change_keeps_waiting_until_real_visible_progress(self):
        before = observation()
        unrelated = copy.deepcopy(before)
        unrelated['queues']['squeue'][0]['progress'] = '90%'
        unrelated['queues']['queue'][0]['cancelDisabled'] = True
        advanced = copy.deepcopy(unrelated)
        advanced['queues']['rqueue'][0]['progress'] = '0.1%'
        result, recorded, clock, page = self.run_observer([before, unrelated, advanced])
        self.assertEqual(result['status'], 'advanced')
        self.assertEqual(page.calls, 3)
        self.assertEqual(len(result['observations']), 3)
        self.assertEqual(result['after']['queues'], advanced['queues'])
        # Both raw snapshots were saved before the success decision was recorded.
        self.assertEqual(recorded[-2]['status'], 'observing')
        self.assertEqual(recorded[-2]['after'], result['after'])
        self.assertEqual(recorded[-1]['status'], 'advanced')

    def test_genuine_stall_still_fails_at_original_six_second_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'evidence.json'
            result, recorded, clock, page = self.run_observer(
                [observation()], record=lambda evidence: path.write_text(json.dumps(evidence)))
            saved = json.loads(path.read_text())
        self.assertEqual(result['status'], 'timeout')
        self.assertEqual(clock.now, 6)
        self.assertFalse(result['witnesses'])
        self.assertEqual(saved['before'], result['before'])
        self.assertEqual(saved['after'], result['after'])
        self.assertEqual(saved['timeoutMs'], 6000)
        self.assertGreaterEqual(saved['after']['hostMonotonicEnd'], 6)

    def test_late_progress_does_not_extend_acceptance_window(self):
        advanced = observation()
        advanced['queues']['queue'][0]['progress'] = '1%'
        result, _, _, page = self.run_observer([observation(), advanced], evaluate_delay=3.1)
        self.assertEqual(page.calls, 2)
        self.assertEqual(result['status'], 'timeout')
        self.assertFalse(result['witnesses'])

    def test_unready_before_is_saved_before_failure_without_polling(self):
        before = observation()
        before['queues']['rqueue'] = []
        result, recorded, _, page = self.run_observer([before])
        self.assertEqual(result['status'], 'unready')
        self.assertEqual(page.calls, 1)
        self.assertEqual(recorded[-1]['before'], result['before'])
        self.assertEqual(recorded[-1]['after'], result['before'])

    def test_observation_exception_is_not_masked_by_failed_diagnostics(self):
        saved = []
        original = RuntimeError('original DOM read failure')
        def record(evidence):
            saved.append(copy.deepcopy(evidence))
            if evidence['status'] == 'observation-error':
                raise ValueError('diagnostic write failure')
        with self.assertRaises(RuntimeError) as caught:
            self.run_observer([observation(), original], record=record)
        self.assertIs(caught.exception, original)
        self.assertEqual(saved[-1]['error'], repr(original))
        self.assertIsNotNone(saved[-1]['before'])
        self.assertIsNotNone(saved[-1]['after'])

    def test_wait_and_final_assertion_use_the_exact_same_predicate(self):
        observer = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == 'observe_paid_queue_progress')
        worker = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == 'worker')
        assertion = next(n for n in ast.walk(worker) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                         and n.func.id == 'check' and n.args and isinstance(n.args[0], ast.Constant)
                         and n.args[0].value == 'healthy real paid countdown or progress visibly advances on native time')
        calls = lambda node: [n for n in ast.walk(node) if isinstance(n, ast.Call)
                              and isinstance(n.func, ast.Name) and n.func.id == 'paid_queue_progress']
        self.assertEqual(len(calls(observer)), 1)
        self.assertEqual(len(calls(assertion)), 1)
        self.assertNotIn('zip(ready_queue', SCRIPT.read_text())
        self.assertNotIn('JSON.stringify(before)', SCRIPT.read_text())


if __name__ == '__main__':
    unittest.main()
