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
from types import SimpleNamespace

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


class ExactSourceComparisonTests(unittest.TestCase):
    """Comparison preparation doubles, never measured browser evidence."""
    def sources(self, directory):
        result = []
        for name, commit in (('old', MODULE.OLD_SOURCE_SHA), ('new', MODULE.NEW_SOURCE_SHA)):
            root = Path(directory) / name
            root.mkdir()
            fixture = fixture_double()
            fixture.update(sourceSha=commit, sourceTreeSha=MODULE.SOURCE_TREES[commit],
                           generatorSourceSha=commit, generatorSourceTreeSha=MODULE.SOURCE_TREES[commit])
            fixture['hashes']['fixtureSource'] = 'c' * 64
            for variant, basename in (('control', 'control0'), ('pressure', 'max512')):
                raw = json.dumps(fixture[variant + 'Raw']).encode()
                fixture['hashes'][variant + 'Raw'] = MODULE.sha(raw)
                (root / (basename + '.raw.json')).write_bytes(raw)
                (root / (basename + '.save.txt')).write_bytes(fixture[variant].encode())
            path = root / 'fixtures.json'
            path.write_text(json.dumps(fixture))
            result.append({'sha': commit, 'root': str(root), 'url': 'http://127.0.0.1:' + ('4180' if name == 'old' else '4181') + '/Infinity/',
                           'path': str(path), 'fixture': fixture})
        return result

    def runs(self):
        result = []
        for row in MODULE.run_schedule(True):
            source, variant, repetition = row['source'], row['variant'], row['repetition']
            # Source, workload and stage effects are separable known doubles.
            offset = (7 if source == 'new' else 0) + (4 if variant == 'pressure' else 0)
            result.append({**row, 'id': f'{source}-{repetition}-{variant}', 'completed': True,
                'context': {'ordinal': len(result) + 1, 'independent': True, 'closed': True},
                'samples': [{'stage': stage, 'cpuMs': {'ScriptDuration': 10 + offset + index, 'TaskDuration': 20 + offset * 2 + index * 2}} for index, stage in enumerate(MODULE.STAGES)],
                'actions': [{'selector': selector, 'eventToSecondRafCallbackMs': 12 + offset} for selector in MODULE.ACTION_SELECTORS]})
        return result

    def test_compare_arguments_are_an_indivisible_optional_group(self):
        self.assertFalse(MODULE.compare_enabled(SimpleNamespace()))
        for missing in MODULE.COMPARE_ARGUMENTS:
            args = {name: 'specified' for name in MODULE.COMPARE_ARGUMENTS if name != missing}
            with self.subTest(missing=missing), self.assertRaisesRegex(AssertionError, 'All five'):
                MODULE.compare_enabled(SimpleNamespace(**args))
        self.assertTrue(MODULE.compare_enabled(SimpleNamespace(**dict.fromkeys(MODULE.COMPARE_ARGUMENTS, 'specified'))))

    def test_partial_cli_group_fails_before_reading_missing_fixture(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--preflight', '--fixture', '/does-not-exist', '--source-root', '.',
                                 '--expected-sha', SHA, '--expected-fixture-sha256', 'b' * 64, '--compare-url', 'http://127.0.0.1:4181/Infinity/'], capture_output=True, text=True, timeout=5)
        self.assertIn('All five', result.stderr)
        self.assertNotIn('FileNotFoundError', result.stderr)

    def test_fixed_order_preserves_each_source_alternation_and_adjacent_loads(self):
        schedule = MODULE.run_schedule(True)
        expected_even = [('old', 'control'), ('new', 'control'), ('new', 'pressure'), ('old', 'pressure')]
        expected_odd = [('new', 'pressure'), ('old', 'pressure'), ('old', 'control'), ('new', 'control')]
        self.assertEqual(len(schedule), 12)
        for repetition, expected in enumerate((expected_even, expected_odd, expected_even)):
            self.assertEqual([(row['source'], row['variant']) for row in schedule if row['repetition'] == repetition], expected)
        for source in ('old', 'new'):
            self.assertEqual([row['variant'] for row in schedule if row['source'] == source], ['control', 'pressure', 'pressure', 'control', 'control', 'pressure'])
        self.assertEqual(len(MODULE.run_schedule(False)), 6)
        self.assertEqual(MODULE.WHOLE_SECONDS, 230)
        self.assertEqual(MODULE.COMPARE_SECONDS, 300)

    def test_source_whitelist_is_exact_commit_tree_and_path(self):
        with tempfile.TemporaryDirectory() as directory:
            old, new = self.sources(directory)
            changed = 'src/ui/npc-attack-controls.ts\ntests/npc-attack-ui.test.ts\n'
            with patch.object(MODULE.subprocess, 'check_output', return_value=changed):
                self.assertEqual(MODULE.comparison_source_identity(old, new)['productionChangedPaths'], ['src/ui/npc-attack-controls.ts'])
                for key, value, error in (('sha', SHA, 'commits'), ('root', old['root'], 'independent'), ('url', old['url'], 'distinct')):
                    with self.subTest(key=key), self.assertRaisesRegex(AssertionError, error):
                        MODULE.comparison_source_identity(old, {**new, key: value})
                wrong = copy.deepcopy(new); wrong['fixture']['sourceTreeSha'] = 'f' * 40
                with self.assertRaisesRegex(AssertionError, 'source tree'):
                    MODULE.comparison_source_identity(old, wrong)
            for extra in ('src/ui/other.ts', 'src/game/fleet.ts', 'public/art.svg', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'scripts/write-release.mjs'):
                with self.subTest(path=extra), patch.object(MODULE.subprocess, 'check_output', return_value=changed + extra + '\n'), self.assertRaisesRegex(AssertionError, 'exact observer production path'):
                    MODULE.comparison_source_identity(old, new)
            with patch.object(MODULE.subprocess, 'check_output', return_value=''), self.assertRaisesRegex(AssertionError, 'exact observer production path'):
                MODULE.comparison_source_identity(old, new)

    def test_wrong_actual_worktree_tree_is_rejected(self):
        with patch.object(MODULE.subprocess, 'check_output', side_effect=[SHA, 'c' * 40, '']), self.assertRaisesRegex(AssertionError, 'commit/tree'):
            MODULE.source_identity('.', SHA, fixture_double())

    def test_complete_save_raw_and_original_state_text_match(self):
        with tempfile.TemporaryDirectory() as directory:
            old, new = self.sources(directory)
            evidence = MODULE.compare_fixture_bytes(old, new)
            for variant in ('control', 'pressure'):
                self.assertTrue(evidence[variant]['save.txt']['equal'])
                self.assertTrue(evidence[variant]['raw.json']['equal'])
                self.assertEqual(len(evidence[variant]['stateTextSha256']), 64)

    def test_even_one_byte_difference_in_save_or_raw_fails(self):
        for basename in ('control0.save.txt', 'max512.save.txt', 'control0.raw.json', 'max512.raw.json'):
            with self.subTest(file=basename), tempfile.TemporaryDirectory() as directory:
                old, new = self.sources(directory)
                path = Path(new['path']).parent / basename
                path.write_bytes(path.read_bytes() + b' ')
                with self.assertRaisesRegex(AssertionError, 'bytes differ'):
                    MODULE.compare_fixture_bytes(old, new)

    def test_fixture_generator_and_non_source_metadata_cannot_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            old, new = self.sources(directory)
            new['fixture']['extraChangedToolOption'] = True
            with self.assertRaisesRegex(AssertionError, 'metadata differs'):
                MODULE.compare_fixture_bytes(old, new)
            del new['fixture']['extraChangedToolOption']
            new['fixture']['hashes']['fixtureSource'] = 'd' * 64
            with self.assertRaisesRegex(AssertionError, 'metadata differs'):
                MODULE.compare_fixture_bytes(old, new)

    def test_300_second_lifetime_is_checked_without_altering_flights(self):
        with tempfile.TemporaryDirectory() as directory:
            old, _ = self.sources(directory)
            path = Path(old['path']); data = path.read_bytes()
            MODULE.load_fixture(path, old['sha'], MODULE.sha(data), MODULE.COMPARE_SECONDS)
            fixture = old['fixture']
            state = fixture['pressureRaw']; state['fleets'][0]['remaining'] = 309
            envelope = json.loads(fixture['pressure']); envelope['state'] = state
            fixture['pressure'] = json.dumps(envelope)
            fixture['hashes']['pressureSave'] = MODULE.sha(fixture['pressure'])
            fixture['minimumRemainingSeconds'] = 309
            data = json.dumps(fixture).encode(); path.write_bytes(data)
            with self.assertRaisesRegex(AssertionError, 'lifetime'):
                MODULE.load_fixture(path, old['sha'], MODULE.sha(data), MODULE.COMPARE_SECONDS)
            # The original single-source 230-second budget remains independent.
            MODULE.load_fixture(path, old['sha'], MODULE.sha(data), MODULE.WHOLE_SECONDS)

    def test_exact_complete_grid_and_duplicate_missing_or_reordered_runs(self):
        runs = self.runs()
        self.assertEqual(MODULE.validate_comparison_runs(runs), {'uniqueRuns': 12, 'windows': 36, 'actions': 60, 'completeCrossSourcePairs': 6})
        for broken in (runs + [runs[0]], runs[:-1], [runs[1], runs[0], *runs[2:]]):
            with self.subTest(count=len(broken)), self.assertRaises(AssertionError):
                MODULE.validate_comparison_runs(broken)
        for operation in (lambda row: row.update(completed=False), lambda row: row['samples'].pop(), lambda row: row['actions'].pop(),
                          lambda row: row['context'].update(closed=False), lambda row: row['actions'][0].update(selector='other')):
            broken = copy.deepcopy(runs); operation(broken[0])
            with self.subTest(operation=operation), self.assertRaises(AssertionError):
                MODULE.validate_comparison_runs(broken)

    def test_same_source_summary_cannot_overwrite_other_source(self):
        result = MODULE.paired_summary(self.runs())
        self.assertEqual(len(result), 6)
        self.assertEqual({row['source'] for row in result}, {'old', 'new'})
        self.assertTrue(all(row['pairedDifferenceSummaryMs']['ScriptDuration']['n'] == 3 for row in result))
        with self.assertRaisesRegex(AssertionError, 'Duplicate'):
            MODULE.paired_summary(self.runs() + [self.runs()[0]])

    def test_four_cells_new_minus_old_difference_in_differences_and_hidden_change(self):
        result = MODULE.comparative_summary(self.runs())
        for stage in result['stages']:
            self.assertEqual(stage['newMinusOldSummaryMs']['pressure']['ScriptDuration'], {'raw': [7, 7, 7], 'n': 3, 'median': 7, 'min': 7, 'max': 7})
            self.assertEqual(stage['pressureMinusControlSummaryMs']['new']['TaskDuration']['raw'], [8, 8, 8])
            self.assertEqual(stage['differenceInDifferencesSummaryMs']['ScriptDuration']['raw'], [0, 0, 0])
        for row in result['hiddenAfterMinusBefore']:
            self.assertEqual(row['sourceSummaryMs']['old']['ScriptDuration']['raw'], [2, 2, 2])
            self.assertEqual(row['newMinusOldChangeSummaryMs']['TaskDuration']['raw'], [0, 0, 0])
        self.assertEqual(len(result['actions']), 10)
        for action in result['actions']:
            self.assertEqual(action['newMinusOldSummaryMs']['eventToSecondRafCallbackMs']['raw'], [7, 7, 7])
            self.assertIsNone(action['newMinusOldSummaryMs']['captureToDocumentBubbleMs'])

    def test_timeout_or_post_success_supervisor_failure_invalidates_all_comparison_pairs(self):
        for failure in ('timeout', 'worker-exit', 'live-process', 'late-error'):
            report = {'completed': True, 'comparison': {'enabled': True}, 'runs': self.runs(), 'errors': []}
            MODULE.finalize_comparison(report, True)
            self.assertTrue(report['comparativeCompleted'])
            self.assertEqual(report['availableCompleteComparisonPairs'], 6)
            if failure == 'late-error':
                report['errors'].append('failure after runs')
            MODULE.finalize_comparison(report, failure == 'late-error')
            with self.subTest(failure=failure):
                self.assertFalse(report['comparativeCompleted'])
                self.assertEqual(report['availableCompleteComparisonPairs'], 0)
                self.assertNotIn('comparativeSummary', report)
                self.assertEqual(report['pairedSummary'], [])
                self.assertEqual(len(report['runs']), 12)

    def test_missing_run_prevents_comparative_success_after_worker_success(self):
        report = {'completed': True, 'comparison': {'enabled': True}, 'runs': self.runs()[:-1], 'errors': []}
        MODULE.finalize_comparison(report, True)
        self.assertFalse(report['completed'])
        self.assertFalse(report['comparativeCompleted'])
        self.assertEqual(report['availableCompleteComparisonPairs'], 0)
        self.assertTrue(report['errors'])

    def test_internal_summary_failure_publishes_no_partial_completed_summary(self):
        report = {'completed': True, 'comparison': {'enabled': True}, 'runs': self.runs(), 'errors': []}
        report['runs'][0]['actions'][0]['eventToSecondRafCallbackMs'] = float('inf')
        original_runs = report['runs']
        MODULE.finalize_comparison(report, True)
        self.assertFalse(report['completed'])
        self.assertFalse(report['comparativeCompleted'])
        self.assertEqual(report['availableCompleteComparisonPairs'], 0)
        self.assertNotIn('comparisonCounts', report)
        self.assertNotIn('comparativeSummary', report)
        self.assertEqual(report['pairedSummary'], [])
        self.assertIs(report['runs'], original_runs)
        self.assertEqual(len(report['runs']), 12)
        self.assertTrue(report['errors'])

    def test_real_supervisor_finalization_revokes_worker_success_on_timeout_exit_or_residual(self):
        runs = self.runs()
        for failure in ('timeout', 'exit', 'residual', 'none'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                args = SimpleNamespace(output=str(Path(directory) / 'evidence'), **dict.fromkeys(MODULE.COMPARE_ARGUMENTS, 'specified'))
                class WorkerDouble:
                    pid = 99999999
                    returncode = 2 if failure == 'exit' else 0
                    def __init__(self, *unused, **keywords):
                        MODULE.atomic_json(Path(args.output) / MODULE.REPORT, {
                            'completed': True, 'comparison': {'enabled': True}, 'runs': runs, 'errors': [],
                            'comparativeCompleted': True, 'availableCompleteComparisonPairs': 6,
                            'comparativeSummary': {'mustDisappearOnFailure': True}})
                    def poll(self):
                        return None if failure == 'timeout' else self.returncode
                    def wait(self, **keywords):
                        return self.returncode
                alive = {'pid': WorkerDouble.pid, 'birth': 'test', 'state': 'S'} if failure == 'residual' else None
                clock = iter([0, 301, 302] if failure == 'timeout' else [0, 1])
                with patch.object(MODULE.subprocess, 'Popen', WorkerDouble), patch.object(MODULE, 'process_info', return_value=alive), \
                     patch.object(MODULE.time, 'monotonic', side_effect=lambda: next(clock)), patch.object(MODULE.os, 'kill'):
                    status = MODULE.supervise(args)
                report = json.loads((Path(args.output) / MODULE.REPORT).read_text())
                self.assertEqual(report['supervisor']['wholeBudgetSeconds'], 300)
                self.assertEqual(report['comparativeCompleted'], failure == 'none')
                self.assertEqual(status, 0 if failure == 'none' else 1)
                if failure != 'none':
                    self.assertEqual(report['availableCompleteComparisonPairs'], 0)
                    self.assertNotIn('comparativeSummary', report)
                    self.assertNotIn('comparisonCounts', report)
                    self.assertEqual(len(report['runs']), 12)

    def test_workflow_builds_clean_sources_before_overlay_and_cleans_both_previews(self):
        workflow = (SCRIPT.parent.parent / '.github/workflows/npc-pressure-verify.yml').read_text()
        self.assertIn('timeout-minutes: 15', workflow)
        self.assertIn(MODULE.OLD_SOURCE_SHA, workflow)
        self.assertIn(MODULE.NEW_SOURCE_SHA, workflow)
        self.assertLess(workflow.index('npm run build'), workflow.index('cp scripts/npc-pressure-fixture.ts'))
        self.assertIn('trap cleanup EXIT', workflow)
        self.assertIn('for PID in "$OLD_PID" "$NEW_PID"', workflow)
        self.assertEqual(workflow.count('--strictPort'), 2)
        self.assertEqual(SCRIPT.read_text().count('playwright.chromium.launch('), 1)


if __name__ == '__main__':
    unittest.main()
