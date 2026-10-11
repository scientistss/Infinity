"""Stdlib-only preparation contracts. These tests are not native/browser evidence."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('browser-npc-pressure.py')
SPEC = importlib.util.spec_from_file_location('npc_pressure', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SHA = 'a' * 40


def test_state(pressure=False):
    return {'ordinary': {'wallet': '1e+30', 'fraction': 0.12345678901234566}, 'nextFleetId': 65 if pressure else 1,
            'arcade': {'autoBatch': None}, 'messages': ['synthetic'] if pressure else [],
            'npcEconomy': {'sites': {f'3:1:{i}': {} for i in range(512)} if pressure else {}},
            'fleets': [{'id': i, 'mission': 'attack', 'remaining': 326.17658005205266, 'originId': 'home',
                        'target': {'galaxy': 3, 'system': i, 'position': 1},
                        'npcAttack': {'seed': i, 'phase': {'kind': 'outbound'}}} for i in range(64)] if pressure else [],
            'npcBattles': {'reports': [{'fleetId': 1000+i, 'delivery': 'delivered', 'seed': i, 'at': '0',
                                       'target': {'galaxy': 1, 'system': i, 'position': 1}} for i in range(60)] if pressure else []}}


def fixture_double():
    fixture = {'schemaVersion': 1, 'synthetic': True, 'key': 'infinity.original-p4.save.v1', 'sourceSha': SHA,
               'sourceTreeSha': 'b' * 40, 'expected': dict(MODULE.COUNTS), 'hashes': {},
               'minimumRemainingSeconds': 326.17658005205266}
    for variant in ('control', 'pressure'):
        state = test_state(variant == 'pressure')
        raw = json.dumps({'schema': 'test double', 'version': 9, 'revision': 13, 'savedAt': 1700000000000,
                          'lastTickAt': 1700000000000, 'state': state}, ensure_ascii=False, indent=2)
        fixture[variant], fixture[variant + 'Raw'] = raw, state
        fixture['hashes'][variant + 'Save'] = MODULE.sha(raw)
    return fixture


class FixturePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / 'fixtures.json'
        self.fixture = fixture_double()

    def load(self, expected_sha=SHA):
        data = json.dumps(self.fixture).encode()
        self.path.write_bytes(data)
        return MODULE.load_fixture(self.path, expected_sha, MODULE.sha(data))

    def mutate_state(self, variant, operation):
        envelope = json.loads(self.fixture[variant])
        operation(envelope['state'])
        self.fixture[variant] = json.dumps(envelope)
        self.fixture[variant + 'Raw'] = envelope['state']
        self.fixture['hashes'][variant + 'Save'] = MODULE.sha(self.fixture[variant])

    def test_full_pressure_and_sparse_same_engine_control(self):
        _, envelopes = self.load()
        self.assertEqual(MODULE.state_counts(envelopes['pressure']['state']),
                         {**MODULE.COUNTS, 'outboundAttackCount': 64, 'fleetCount': 64})
        self.assertEqual(len(envelopes['control']['state']['fleets']), 0)

    def test_independent_complete_fixture_digest_required(self):
        self.load()
        with self.assertRaisesRegex(AssertionError, 'Complete fixture SHA'):
            MODULE.load_fixture(self.path, SHA, 'f' * 64)

    def test_wrong_source_commit_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'source commit'):
            self.load('c' * 40)

    def test_fixture_must_be_explicitly_synthetic(self):
        self.fixture['synthetic'] = False
        with self.assertRaisesRegex(AssertionError, 'synthetic'):
            self.load()

    def test_save_byte_pin_and_raw_shape_are_separate_checks(self):
        self.fixture['pressure'] += ' '
        with self.assertRaisesRegex(AssertionError, 'complete save bytes'):
            self.load()
        self.fixture['hashes']['pressureSave'] = MODULE.sha(self.fixture['pressure'])
        self.fixture['pressureRaw']['ordinary']['wallet'] = 'changed'
        with self.assertRaisesRegex(AssertionError, 'raw/envelope'):
            self.load()

    def test_missing_site_fleet_or_terminal_report_rejected(self):
        for operation in (lambda state: state['npcEconomy']['sites'].pop('3:1:0'),
                          lambda state: state['fleets'].pop(), lambda state: state['npcBattles']['reports'].pop()):
            self.fixture = fixture_double(); self.mutate_state('pressure', operation)
            with self.subTest(operation=operation), self.assertRaisesRegex(AssertionError, 'exact pressure counts'):
                self.load()

    def test_returning_or_pinned_workload_is_not_outbound_terminal_pair(self):
        self.mutate_state('pressure', lambda state: state['fleets'][0]['npcAttack'].update(phase={'kind': 'returning'}))
        with self.assertRaisesRegex(AssertionError, 'outbound'):
            self.load()
        self.fixture = fixture_double()
        self.mutate_state('pressure', lambda state: state['npcBattles']['reports'][0].update(delivery='returning'))
        with self.assertRaisesRegex(AssertionError, 'exact pressure counts'):
            self.load()

    def test_ordinary_state_must_match_without_normalization(self):
        self.mutate_state('control', lambda state: state['ordinary'].update(wallet='2e+30'))
        with self.assertRaisesRegex(AssertionError, 'Ordinary same-engine'):
            self.load()

    def test_clock_lifetime_covers_whole_budget_and_no_armed_ring(self):
        self.mutate_state('pressure', lambda state: state['fleets'][0].update(remaining=230))
        self.fixture['minimumRemainingSeconds'] = 230
        with self.assertRaisesRegex(AssertionError, 'lifetime'):
            self.load()
        self.fixture = fixture_double()
        self.mutate_state('control', lambda state: state['arcade'].update(autoBatch={'armed': True}))
        with self.assertRaisesRegex(AssertionError, 'Auto reveal'):
            self.load()

    def test_only_two_watermark_tokens_change_all_state_bytes_exact(self):
        raw = self.fixture['pressure'].replace('0.12345678901234566', '1.2345678901234566e-1') + '\n'
        seeded = MODULE.seed_now(raw, 1791745200000)
        before, after = MODULE.envelope_spans(raw), MODULE.envelope_spans(seeded)
        self.assertEqual(raw[slice(*before['state'])], seeded[slice(*after['state'])])
        for key in before:
            if key not in ('savedAt', 'lastTickAt'):
                self.assertEqual(raw[slice(*before[key])], seeded[slice(*after[key])])
        expected = json.loads(raw)
        expected.update(savedAt=1791745200000, lastTickAt=1791745200000)
        self.assertEqual(json.loads(seeded), expected)
        self.assertTrue(seeded.endswith('\n'))

    def test_duplicate_top_level_keys_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'Duplicate'):
            MODULE.envelope_spans('{"state":{},"state":{}}')

    def test_stable_identity_allows_real_time_and_wallet_progress(self):
        state = test_state(True); after = copy.deepcopy(state)
        after['fleets'][0]['remaining'] -= 15
        after['ordinary']['wallet'] = '2e+30'
        self.assertEqual(MODULE.stable_identity(state), MODULE.stable_identity(after))
        after['fleets'][0]['npcAttack']['phase']['kind'] = 'returning'
        self.assertNotEqual(MODULE.stable_identity(state), MODULE.stable_identity(after))

    def test_source_worktree_checks_exact_head_src_tree_and_clean_production(self):
        expected = [SHA + '\n', 'b' * 40 + '\n', '']
        with patch.object(MODULE.subprocess, 'check_output', side_effect=expected):
            self.assertEqual(MODULE.source_identity('.', SHA, self.fixture)['gitHead'], SHA)
        for outputs, error in ((['c' * 40, 'b' * 40, ''], 'commit/tree'),
                               ([SHA, 'b' * 40, ' M src/main.ts'], 'must be clean')):
            with patch.object(MODULE.subprocess, 'check_output', side_effect=outputs), self.assertRaisesRegex(AssertionError, error):
                MODULE.source_identity('.', SHA, self.fixture)


class MeasurementPreparationTests(unittest.TestCase):
    def test_native_guard_runs_before_import_or_fixture_read(self):
        environment = {key: value for key, value in os.environ.items() if key not in ('CI', 'GITHUB_ACTIONS')}
        result = subprocess.run([sys.executable, str(SCRIPT), '--fixture', '/does-not-exist', '--source-root', '.',
                                 '--expected-sha', SHA, '--expected-fixture-sha256', 'b' * 64],
                                env=environment, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('GitHub-CI-only', result.stderr)
        self.assertNotIn('FileNotFoundError', result.stderr)

    def test_cpu_deltas_are_real_metric_units(self):
        before = {key: 1 for key in ('ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration')}
        after = {key: 1.025 for key in before}
        for value in MODULE.metric_delta(before, after).values():
            self.assertAlmostEqual(value, 25)

    def test_paired_summary_keeps_all_three_raw_differences(self):
        runs = [{'variant': variant, 'repetition': repetition,
                 'samples': [{'stage': stage, 'cpuMs': {'ScriptDuration': 10 + (4 if variant == 'pressure' else 0),
                                                       'TaskDuration': 20 + (8 if variant == 'pressure' else 0)}}
                             for stage in MODULE.STAGES]}
                for repetition in range(3) for variant in ('control', 'pressure')]
        for stage in MODULE.paired_summary(runs):
            self.assertEqual(len(stage['pairedRawDifferences']), 3)
            self.assertEqual(stage['pairedDifferenceSummaryMs']['ScriptDuration']['median'], 4)
            self.assertEqual(stage['pairedDifferenceSummaryMs']['TaskDuration']['median'], 8)

    def test_observers_do_not_replace_browser_primitives_or_game_state(self):
        for forbidden in ('Date.now=', 'performance.now=', 'window.requestAnimationFrame=', 'Storage.prototype.setItem=',
                          'document.hidden=', 'dispatchEvent(', '.click(', 'window.state', 'Math.random='):
            self.assertNotIn(forbidden, MODULE.PROBE)
        self.assertIn('event.isTrusted', MODULE.PROBE)
        self.assertIn('requestAnimationFrame(frame)', MODULE.PROBE)
        self.assertNotIn('Profiler.', SCRIPT.read_text())
        self.assertNotIn('Emulation.set', SCRIPT.read_text())

    def test_native_budgets_remain_three_five_second_pairs_under_four_minutes(self):
        self.assertEqual(MODULE.REPETITIONS, 3)
        self.assertEqual(MODULE.SAMPLE_MS, 5000)
        self.assertLess(MODULE.WHOLE_SECONDS, 240)
        self.assertEqual(MODULE.ACTION_MS, 10000)
        self.assertEqual(len(MODULE.STAGES), 3)

    def test_no_top_level_playwright_import(self):
        tree = ast.parse(SCRIPT.read_text())
        imports = [node.module for node in tree.body if isinstance(node, ast.ImportFrom)]
        self.assertFalse(any(name and name.startswith('playwright') for name in imports))


class ClickObserverPreparationTests(unittest.TestCase):
    """Explicit observation doubles, never substitutes for the next native CI."""
    def setUp(self):
        self.selector = '[data-tab="fleet"]'
        self.row = {'trusted': True, 'enabled': True, 'selector': self.selector,
                    'eventTimestamp': 99, 'captureStartAt': 100, 'postDispatchTaskAt': 104,
                    'firstRafFrameTimestamp': 112, 'secondRafFrameTimestamp': 128,
                    'firstRafCallbackAt': 113, 'secondRafCallbackAt': 129}

    def test_real_navigation_may_stop_bubbling_but_later_task_is_required(self):
        self.assertEqual(MODULE.qualify_click([self.row], self.selector), self.row)
        self.row.pop('postDispatchTaskAt')
        with self.assertRaisesRegex(AssertionError, 'subsequent native task'):
            MODULE.qualify_click([self.row], self.selector)

    def test_save_import_still_requires_same_dispatch_storage_witness(self):
        with self.assertRaisesRegex(AssertionError, 'synchronous document-bubble'):
            MODULE.qualify_click([self.row], self.selector, storage=True)
        self.row.update(documentBubbleAt=102, beforeRaw='{"value":1}', afterRaw='{"value":1}')
        self.assertEqual(MODULE.qualify_click([self.row], self.selector, storage=True), self.row)
        for key in ('documentBubbleAt', 'beforeRaw', 'afterRaw'):
            broken = {name: value for name, value in self.row.items() if name != key}
            with self.subTest(key=key), self.assertRaisesRegex(AssertionError, 'synchronous document-bubble'):
                MODULE.qualify_click([broken], self.selector, storage=True)

    def test_native_trust_enabled_selector_and_single_event_are_not_relaxed(self):
        for key, value in (('trusted', False), ('enabled', False), ('selector', '[data-tab="other"]')):
            with self.subTest(key=key), self.assertRaisesRegex(AssertionError, 'trusted enabled'):
                MODULE.qualify_click([{**self.row, key: value}], self.selector)
        for rows in ([], [self.row, self.row]):
            with self.subTest(count=len(rows)), self.assertRaisesRegex(AssertionError, 'exactly one'):
                MODULE.qualify_click(rows, self.selector)

    def test_both_native_raf_observations_still_required(self):
        for key, value in (('firstRafFrameTimestamp', None), ('secondRafFrameTimestamp', None),
                           ('secondRafFrameTimestamp', 100), ('firstRafCallbackAt', None),
                           ('secondRafCallbackAt', None), ('firstRafCallbackAt', 99), ('secondRafCallbackAt', 112)):
            with self.subTest(key=key, value=value), self.assertRaisesRegex(AssertionError, 'two native RAF'):
                MODULE.qualify_click([{**self.row, key: value}], self.selector)

    def test_frame_start_before_event_is_not_callback_entry_or_full_response(self):
        # Golden double: the old event-to-second-frame value is only 45 ms,
        # less than the 57.1 ms synchronous boundary, while actual entry is later.
        row = {**self.row, 'eventTimestamp': 100, 'captureStartAt': 101, 'documentBubbleAt': 158.1,
               'postDispatchTaskAt': 160, 'firstRafFrameTimestamp': 90, 'secondRafFrameTimestamp': 145,
               'firstRafCallbackAt': 159, 'secondRafCallbackAt': 170,
               'beforeRaw': '{ "value": 1 }\n', 'afterRaw': '{ "value": 2 }\n'}
        self.assertIs(MODULE.qualify_click([row], self.selector, storage=True), row)
        timing = MODULE.click_timing(row, browser_observed_at=172, host_elapsed_ms=85)
        self.assertAlmostEqual(timing['captureToDocumentBubbleMs'], 57.1)
        self.assertEqual(timing['eventToCaptureStartMs'], 1)
        self.assertEqual(timing['eventToPostDispatchTaskMs'], 60)
        self.assertEqual(timing['eventToFirstRafCallbackMs'], 59)
        self.assertEqual(timing['eventToSecondRafCallbackMs'], 70)
        self.assertEqual(timing['rafFrameTimestampIntervalMs'], 55)
        self.assertEqual(timing['browserObservationAt'], 172)
        self.assertEqual(timing['hostToRequiredWitnessObservationMs'], 85)
        self.assertLess(row['secondRafFrameTimestamp'] - row['eventTimestamp'], timing['captureToDocumentBubbleMs'])
        self.assertGreater(timing['eventToSecondRafCallbackMs'], timing['captureToDocumentBubbleMs'])
        self.assertEqual(row['beforeRaw'], '{ "value": 1 }\n')
        self.assertEqual(row['afterRaw'], '{ "value": 2 }\n')
        self.assertNotIn('eventToSecondRafMs', timing)
        self.assertNotIn('hostToSecondRafObservationMs', timing)
        # Valid RAF arguments cannot excuse actual callback entry before the handler boundary.
        with self.assertRaisesRegex(AssertionError, 'document-bubble boundary'):
            MODULE.qualify_click([{**row, 'firstRafCallbackAt': 157}], self.selector, storage=True)

    def test_timer_may_follow_either_raf_without_fabricating_a_bubble_boundary(self):
        for timer in (104, 120, 135):
            row = {**self.row, 'postDispatchTaskAt': timer}
            with self.subTest(timer=timer):
                MODULE.qualify_click([row], self.selector)
                timing = MODULE.click_timing(row, browser_observed_at=140, host_elapsed_ms=50)
                self.assertIsNone(timing['captureToDocumentBubbleMs'])
                self.assertNotIn('documentBubbleAt', row)

    def test_all_browser_timestamps_require_finite_nonnegative_numbers(self):
        row = {**self.row, 'documentBubbleAt': 102}
        for key in ('eventTimestamp', 'captureStartAt', 'postDispatchTaskAt', 'documentBubbleAt',
                    'firstRafFrameTimestamp', 'secondRafFrameTimestamp', 'firstRafCallbackAt', 'secondRafCallbackAt'):
            for value in (None, True, '100', -1, float('nan'), float('inf'), float('-inf')):
                with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                    MODULE.qualify_click([{**row, key: value}], self.selector)

    def test_capture_bubble_task_and_callback_order_cannot_be_inverted(self):
        for update in ({'eventTimestamp': 101}, {'postDispatchTaskAt': 99},
                       {'documentBubbleAt': 99}, {'documentBubbleAt': 105},
                       {'documentBubbleAt': 114, 'postDispatchTaskAt': 120},
                       {'firstRafFrameTimestamp': 114}, {'secondRafFrameTimestamp': 130}):
            with self.subTest(update=update), self.assertRaises(AssertionError):
                MODULE.qualify_click([{**self.row, **update}], self.selector)

    def test_host_and_browser_observations_are_validated_in_separate_clocks(self):
        for value in (None, False, '140', -1, float('nan'), float('inf'), float('-inf')):
            with self.subTest(browser_observed_at=value), self.assertRaisesRegex(AssertionError, 'Browser observation'):
                MODULE.click_timing(self.row, browser_observed_at=value, host_elapsed_ms=50)
            with self.subTest(host_elapsed_ms=value), self.assertRaisesRegex(AssertionError, 'host observation'):
                MODULE.click_timing(self.row, browser_observed_at=140, host_elapsed_ms=value)
        for row, observed in ((self.row, 128), ({**self.row, 'postDispatchTaskAt': 135}, 130)):
            with self.subTest(row=row, observed=observed), self.assertRaisesRegex(AssertionError, 'Browser observation'):
                MODULE.click_timing(row, browser_observed_at=observed, host_elapsed_ms=50)

    def test_native_probe_samples_now_inside_each_callback_before_frame_argument(self):
        self.assertIn('requestAnimationFrame(first=>{row.firstRafCallbackAt=performance.now();row.firstRafFrameTimestamp=first;', MODULE.PROBE)
        self.assertIn('requestAnimationFrame(second=>{row.secondRafCallbackAt=performance.now();row.secondRafFrameTimestamp=second;', MODULE.PROBE)
        self.assertIn('const captureStartAt=performance.now();', MODULE.PROBE)
        self.assertIn('row.documentBubbleAt=performance.now();', MODULE.PROBE)
        source = SCRIPT.read_text()
        self.assertIn('rows.at(-1).secondRafCallbackAt!==null', source)
        self.assertNotIn("row['eventToSecondRafMs']", source)
        self.assertIn("row['eventToSecondRafCallbackMs'] > ACTION_MS", source)
        self.assertIn('None measures complete response or proves a completed paint.', source)

    def test_report_distinguishes_flagged_cpu_windows_from_all_long_tasks_and_fixture_bytes(self):
        source = SCRIPT.read_text()
        self.assertIn('Long tasks overlapping CPU windows are flagged', source)
        self.assertIn("run['allLongTasks'] = final['longTasks']", source)
        self.assertIn('fixtureSha256 pins the original input fixture bytes.', source)
        self.assertNotIn('All long tasks and actions', source)

    def test_runtime_evidence_written_before_click_gate_even_for_timeout(self):
        tree = ast.parse(SCRIPT.read_text())
        worker = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'native_worker')
        click = next(node for node in worker.body if isinstance(node, ast.FunctionDef) and node.name == 'click')
        calls = [(node.lineno, node.func.id) for node in ast.walk(click)
                 if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                 and node.func.id in ('atomic_json', 'qualify_click', 'click_timing', 'flush')]
        position = {name: line for line, name in calls}
        self.assertLess(position['atomic_json'], position['qualify_click'])
        self.assertLess(position['flush'], position['qualify_click'])
        self.assertLess(position['atomic_json'], position['click_timing'])
        self.assertIn('action_error = error', ast.unparse(click))
        self.assertIn('observedClicks=rows', ast.unparse(click))

    def test_exact_production_navigation_stops_document_bubble(self):
        source = (SCRIPT.parent.parent / 'src/ui/space-panel.ts').read_text()
        self.assertIn('if(b.dataset.spaceTab){event.stopImmediatePropagation();choose(b.dataset.spaceTab);return;}', source)
        self.assertIn('const eventRows=new WeakMap();', MODULE.PROBE)
        self.assertIn("document.addEventListener('click',event=>{const row=eventRows.get(event)", MODULE.PROBE)
        self.assertIn('setTimeout(()=>{row.postDispatchTaskAt=performance.now();},0)', MODULE.PROBE)
        # Completion observer cannot change production propagation to make a test pass.
        self.assertNotIn('stopPropagation', MODULE.PROBE)
        self.assertNotIn('stopImmediatePropagation', MODULE.PROBE)


if __name__ == '__main__':
    unittest.main()
