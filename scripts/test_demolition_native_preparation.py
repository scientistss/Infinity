"""Offline contracts for demolition evidence helpers; never launches Node/browser.

python -m unittest discover -s scripts -p 'test_demolition_native_preparation.py' -v
AST-extracted helpers and explicit doubles test orchestration, not native proof.
"""
import ast
from contextlib import contextmanager
import copy
import hashlib
import json
import os
import signal
import time as real_time
from pathlib import Path
import tempfile
import traceback
import unittest
from unittest.mock import patch
from test_terraformer_native_preparation import TargetPage as OriginalTargetPage, DiagnosticPage as OriginalDiagnosticPage

SCRIPT = Path(__file__).with_name('browser-demolition.py')
SOURCE = SCRIPT.read_text(encoding='utf-8')
TREE = ast.parse(SOURCE)
NAMES = {'exact_json', 'native_scroll_to', 'capture_failure', 'capture_live_failure', 'wallet_transfer', 'wallet_golden', 'advance', 'wait_for_scroll_settled', 'responsive', 'import_confirmation', 'verify_conflict_refusal', 'verify_recovery_storage', 'host_stage', 'diagnostic_bound', 'responsive_checkpoint', 'tab'}


def helpers():
    namespace = {'contextmanager': contextmanager, 'hashlib': hashlib, 'traceback': traceback, 'time': FakeClock(),
                 'json': json, 'os': os, 'signal': signal, 'HOST_STARTED_MONOTONIC': 0,
                 'host_stage_sequence': 0, 'responsive_diagnostic_scope': None}
    nodes = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), namespace)
    return namespace


class FakeClock:
    def __init__(self):
        self.now = 0

    def monotonic(self):
        return self.now


class TargetPage(OriginalTargetPage):
    """Explicit offline geometry/frame double; never claims native evidence."""
    clock = None

    def __init__(self, *, scrolls=None, continuous=False, rect_motion=False, missing=False,
                 stalled=False, stale_frame=False, stale_timestamp=False, clock_mutation=False, header_occlusion=False, **kwargs):
        super().__init__(**kwargs)
        self.scrolls = list(scrolls or [0])
        self.continuous, self.rect_motion, self.missing = continuous, rect_motion, missing
        self.stalled, self.stale_frame, self.stale_timestamp = stalled, stale_frame, stale_timestamp
        self.clock_mutation = clock_mutation
        self.header_occlusion = header_occlusion
        self.samples = 0

    def evaluate(self, source, options=None):
        if options is None:
            return super().evaluate(source)
        assert source == 'options=>window.__demoObserveFrame(options)'
        assert options['selector']
        assert 0 < options['timeoutMs'] <= 250
        self.clock.now += options['timeoutMs'] / 1000 if self.stalled else .001
        scroll = self.samples if self.continuous else self.scrolls[min(self.samples, len(self.scrolls) - 1)]
        self.samples += 1
        rect = dict(self.box)
        rect['y'] += self.samples if self.rect_motion else -scroll
        rect.update(right=rect['x'] + rect['width'], bottom=rect['y'] + rect['height'])
        self.reads.append(('sample', scroll, rect['y']))
        return {'nativeFrameSequence': 1 if self.stale_frame else self.samples,
                'nativeFrameTimestamp': None if self.stalled else 0 if self.stale_timestamp else self.clock.now * 1000,
                'observerTimedOut': self.stalled, 'controlledElapsed': self.samples if self.clock_mutation else 0,
                'geometry': {'scrollX': 0, 'scrollY': scroll, 'width': 1440, 'height': 1100,
                'documentWidth': 1440, 'documentHeight': 5685, 'rect': None if self.missing else rect}}

    def wait_for_timeout(self, value):
        super().wait_for_timeout(value)
        self.clock.now += value / 1000

    def current_proof(self):
        result = copy.deepcopy(self.proof)
        box = self.box
        result['targets'][0]['contained'] &= box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= self.limits['width'] and box['y'] + box['height'] <= self.limits['height']
        if self.header_occlusion and box['y'] < self.limits['headerBottom']:
            for point in result['targets'][0]['points']:
                point['unoccluded'] = False
        return result


class DiagnosticPage(OriginalDiagnosticPage):
    def evaluate(self, source, selectors=None):
        if source == 'window.__demoReadLiveness()':
            self.observe('native liveness')
            return {'nativeMonotonicMs': 123, 'phase': 'offline double'}
        if selectors is None:
            return super().evaluate(source)
        self.observe('target visibility')
        assert 'hiddenAncestor' in source and 'getBoundingClientRect' in source and 'disabled:e.disabled' in source
        return [{'selector': selector, 'hidden': selector == 'queue', 'hiddenAncestor': selector == 'queue',
                 'display': 'none' if selector == 'queue' else 'block', 'visibility': 'visible',
                 'rect': {'x': 0, 'y': 0, 'width': 0 if selector == 'queue' else 100, 'height': 0 if selector == 'queue' else 50},
                 'controls': [{'tag': 'BUTTON', 'id': '', 'disabled': True}] if selector == 'queue' else []} for selector in selectors]



class PureEvidenceTests(unittest.TestCase):
    def test_all_state_keys_values_array_order_and_boolean_types_are_exact(self):
        exact = helpers()['exact_json']
        self.assertTrue(exact({'timer': 13.5, 'id': 202}, {'id': 202.0, 'timer': 13.5}))
        for a, b in [({'a': 1}, {'a': 1, 'hidden': None}), ({'id': 202}, {'id': '202'}),
                     ({'a': False}, {'a': 0}), ({'a': [1, 2]}, {'a': [2, 1]}),
                     ({'remaining': 13.5}, {'remaining': 13.500000001})]:
            self.assertFalse(exact(a, b))

    def test_original_save_bytes_and_metadata_pin_the_green_artifact(self):
        root = SCRIPT.parent.parent / 'tests/fixtures'
        raw = (root / 'demolition-origin-r10-save.json').read_bytes()
        metadata = (root / 'demolition-origin-provenance.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), 'd456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a')
        self.assertEqual(hashlib.sha256(metadata).hexdigest(), 'a1a8ce7985030f6a8e500755eda4d908c8834b3ecfa888197d5ef5ed8ef27f69')
        meta, saved = json.loads(metadata), json.loads(raw)
        self.assertEqual(meta['sourceReport']['sha256'], '303175f79caeb3b27bdd6d03262aff5c67ced0171b2c60c07794c42dca394025')
        self.assertEqual(meta['sourceReport']['jsonPath'], '$.milestones[10].save')
        self.assertEqual(meta['sourceReport']['artifactId'], 11696494224)
        self.assertEqual(meta['sourceReport']['artifactZipSha256'], '9b77842d26331d0d99139c89bfd15010a85a7e30ebecc57573cf72a5edd49cef')
        self.assertEqual(meta['source']['sourceSha'], 'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a')
        self.assertEqual(saved['revision'], 10)
        self.assertEqual(saved['state']['totalTime'], '25810')
        self.assertTrue(all('demolition' not in planet for planet in saved['state']['planets']))
        self.assertEqual(meta['originalOutcome']['finalSnapshot']['gameSeconds'], 25811)

    def test_browser_is_ci_only_and_failure_capture_runs_before_playwright_stops(self):
        self.assertIn("os.environ.get('CI') != 'true'", SOURCE)
        self.assertIn("os.environ.get('GITHUB_ACTIONS') != 'true'", SOURCE)
        context = next(node for node in ast.walk(TREE) if isinstance(node, ast.With) and
                       any(isinstance(item.context_expr, ast.Call) and isinstance(item.context_expr.func, ast.Name) and item.context_expr.func.id == 'sync_playwright' for item in node.items))
        self.assertEqual([item.context_expr.func.id for item in context.items], ['sync_playwright', 'capture_live_failure'])
        self.assertNotIn('page.add_script_tag', SOURCE)
        self.assertNotIn('route.fulfill', SOURCE)
        self.assertNotIn('Storage.prototype.setItem=', SOURCE)
        self.assertNotIn('File.prototype.text=', SOURCE)

    def test_no_positive_clock_step_other_than_actual_one_second_can_run(self):
        function = helpers()['advance']
        for invalid in (-1000, 1, 16, 999, 2000, 10000):
            with self.assertRaises(ValueError):
                function(None, invalid)


class TargetPreparationTests(unittest.TestCase):
    def setUp(self):
        self.namespace, self.checks = helpers(), []
        TargetPage.clock = self.namespace["time"]
        def check(name, condition, detail=None):
            self.checks.append((name, condition, detail))
            if not condition:
                raise AssertionError(name)
        self.namespace.update(check=check, advance=lambda page: None, visibility=lambda page, selectors: page.current_proof())

    def test_topbar_resource_capture_uses_its_actual_unobstructed_region(self):
        page = TargetPage(in_header=True)
        self.namespace['native_scroll_to'](page, '[data-bind="res-metal"]')
        self.assertEqual(page.wheels, [])
        self.assertEqual(next(detail for name, _, detail in self.checks if name.startswith('target fits'))['limits']['top'], 0)
        self.assertIn('five unoccluded hit-tests', self.checks[-1][0])

    def test_mobile_static_header_and_desktop_sticky_header_are_distinct(self):
        mobile = TargetPage(position='static', y=700, height=1000)
        self.namespace['native_scroll_to'](mobile, '#demolition-review')
        self.assertTrue(mobile.wheels)
        desktop = TargetPage(position='sticky', y=700, height=1000)
        with self.assertRaisesRegex(AssertionError, 'fits its actual'):
            self.namespace['native_scroll_to'](desktop, '#demolition-review')

    def test_real_ci_resource_header_at10point5_is_visible_without_an_impossible_wheel(self):
        page = TargetPage(in_header=True, y=10.5, height=74.8125, stuck=True)
        self.namespace['native_scroll_to'](page, '[data-bind="res-metal"]')
        self.assertEqual(page.wheels, [])
        self.assertEqual(self.checks[-1][0], 'native target is wholly visible with five unoccluded hit-tests')

    def test_actual_viewport_edges_and_foreground_layer_do_not_inherit_artificial_insets(self):
        for y, height, in_header in ((0, 80, True), (1020, 80, True), (10.5, 74.8125, False)):
            with self.subTest(y=y, in_header=in_header):
                page = TargetPage(in_header=in_header, y=y, height=height, stuck=True)
                self.namespace['native_scroll_to'](page, 'actual-hit-testable-target')
                self.assertFalse(page.wheels)

    def test_body_really_occluded_by_sticky_header_is_repositioned_and_rehit(self):
        page = TargetPage(y=10.5, height=74.8125, header_occlusion=True)
        self.namespace['native_scroll_to'](page, 'ordinary-body-target')
        self.assertTrue(page.wheels)
        self.assertGreaterEqual(page.box['y'], page.limits['headerBottom'])
        self.assertTrue(all(point['unoccluded'] for point in self.checks[-1][2]['targets'][0]['points']))

    def test_partial_viewport_and_unmovable_occluded_targets_cannot_pass(self):
        for fault in ({'y': -.25}, {'y': 1080}, {'y': 10.5, 'occluded': True}):
            with self.subTest(fault=fault):
                page = TargetPage(in_header=True, stuck=True, **fault)
                with self.assertRaisesRegex(AssertionError, 'five unoccluded'):
                    self.namespace['native_scroll_to'](page, 'unmovable-target')
                self.assertEqual(len(page.wheels), 5)

    def test_occluded_disabled_or_missing_fifth_hit_cannot_be_passed_as_layout(self):
        for fault in ({'visible': False}, {'contained': False}, {'occluded': True}):
            with self.subTest(fault=fault):
                with self.assertRaisesRegex(AssertionError, 'five unoccluded'):
                    self.namespace['native_scroll_to'](TargetPage(in_header=True, **fault), '[data-demolition-confirm]')
        page = TargetPage(in_header=True); page.proof['targets'][0]['points'].pop()
        with self.assertRaisesRegex(AssertionError, 'five unoccluded'):
            self.namespace['native_scroll_to'](page, '[data-demolition-confirm]')


class ScrollSettlementTests(unittest.TestCase):
    def setUp(self):
        self.namespace, self.checks = helpers(), []
        TargetPage.clock = self.namespace["time"]
        def check(name, condition, detail=None):
            self.checks.append((name, condition, detail))
            if not condition:
                raise AssertionError(name)
        self.namespace.update(check=check, advance=lambda page: None, visibility=lambda page, selectors: page.current_proof())

    def test_observed_941_939_938_tail_waits_for_four_complete_identical_samples(self):
        page = TargetPage(scrolls=[941, 939, 938, 938, 938, 938])
        self.namespace['wait_for_scroll_settled'](page, '#demolition-review-title')
        self.assertEqual(page.samples, 6)
        self.assertEqual([row for row in page.reads if row[0] == 'wait'], [('wait', 50)] * 5)
        self.assertEqual(self.checks[-1][2]['stableSamples'], 4)
        self.assertEqual([row['geometry']['scrollY'] for row in self.checks[-1][2]['samples']], [941, 939, 938, 938, 938, 938])

    def test_three_equal_samples_before_new_motion_do_not_establish_readiness(self):
        page = TargetPage(scrolls=[941, 941, 941, 939, 938, 938, 938, 938])
        self.namespace['wait_for_scroll_settled'](page, '#demolition-review-title')
        self.assertEqual(page.samples, 8)

    def test_continuing_scroll_or_rect_motion_fails_within_fixed_host_bound(self):
        for fault in ({'continuous': True}, {'rect_motion': True}):
            with self.subTest(fault=fault):
                page = TargetPage(**fault)
                with self.assertRaisesRegex(AssertionError, 'within 1600 ms'):
                    self.namespace['wait_for_scroll_settled'](page, '#demolition-review-title')
                self.assertLessEqual(page.samples, 33)
                self.assertLessEqual(sum(row[1] for row in page.reads if row[0] == 'wait'), 1600)
                self.assertAlmostEqual(TargetPage.clock.now % 1.6, 0, places=8)
                self.assertEqual(len(self.checks[-1][2]['samples']), page.samples)
                self.assertFalse(page.wheels)

    def test_absent_target_is_never_a_settled_target(self):
        with self.assertRaisesRegex(AssertionError, 'fresh native frame'):
            self.namespace['wait_for_scroll_settled'](TargetPage(missing=True), '#demolition-review-title')

    def test_stalled_duplicate_frames_timestamps_and_game_clock_mutation_fail_closed(self):
        for fault in ({'stalled': True}, {'stale_frame': True}, {'stale_timestamp': True}, {'clock_mutation': True}):
            with self.subTest(fault=fault):
                page = TargetPage(**fault)
                with self.assertRaisesRegex(AssertionError, 'fresh native frame'):
                    self.namespace['wait_for_scroll_settled'](page, '#demolition-review-title')
                self.assertEqual(len(self.checks[-1][2]['samples']), page.samples)
                self.assertLessEqual(page.samples, 2)

    def test_observer_uses_original_raf_timestamp_with_timeout_and_no_game_advance(self):
        observer = SOURCE.split('window.__demoObserveFrame=', 1)[1].split('window.__demoFrameCount=0', 1)[0]
        self.assertIn('const frame=raf(timestamp=>', observer)
        self.assertIn('observe(timestamp,false)', observer)
        self.assertIn('caf(frame)', observer)
        self.assertIn('observe(null,true)', observer)
        for forbidden in ('elapsed+=', '__demoAdvance', 'requestAnimationFrame(', 'performance.now', 'Date.now', 'scrollTo(', 'scrollIntoView('):
            self.assertNotIn(forbidden, observer)

    def test_settled_but_occluded_target_still_fails_five_point_proof(self):
        page = TargetPage(in_header=True, occluded=True)
        with self.assertRaisesRegex(AssertionError, 'five unoccluded'):
            self.namespace['native_scroll_to'](page, '[data-demolition-confirm]')
        self.assertGreaterEqual(page.samples, 4)

    def test_screenshot_complete_before_after_artifact_is_saved_before_exact_assertion(self):
        node = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'responsive')
        calls = [node for node in ast.walk(node) if isinstance(node, ast.Call)]
        write = next(node for node in calls if isinstance(node.func, ast.Name) and node.func.id == 'atomic_json')
        assertion = next(node for node in calls if isinstance(node.func, ast.Name) and node.func.id == 'check' and
                         isinstance(node.args[0], ast.Constant) and node.args[0].value == 'screenshot preserves actual visible control and every glyph')
        self.assertLess(write.lineno, assertion.lineno)
        self.assertEqual(ast.unparse(assertion.args[1]), 'exact_json(before, after) and exact_json(leaves, after_leaves)')
        payload = ast.literal_eval(ast.Dict(keys=write.args[1].keys, values=[ast.Constant(None) for _ in write.args[1].values]))
        self.assertEqual(set(payload), {'before', 'after', 'textLeaves', 'afterTextLeaves'})
        self.assertIn("'worker': 300, 'supervisor': 305", SOURCE)


class TransferProofTests(unittest.TestCase):
    def setUp(self):
        self.namespace = helpers()
        def check(name, condition, detail=None):
            if not condition:
                raise AssertionError(name)
        self.namespace.update(check=check, HOME='homeworld', RESOURCES=('metal', 'crystal', 'deuterium'), WALLET_TOLERANCE=1e-6,
                              planet=lambda state, ident: next(p for p in state['planets'] if p['id'] == ident))
        self.before = {'lifetime': {'metal': '10000000'}, 'planets': [
            {'id': 'homeworld', 'resources': {'metal': '2793156.2014419464', 'crystal': '423462.959364568', 'deuterium': '51316.02897846931'}},
            {'id': 'colony-1', 'resources': {'metal': '10000', 'crystal': '10000', 'deuterium': '0'}}]}
        self.fee = {'metal': '128000', 'crystal': '0', 'deuterium': '0'}

    def refund(self):
        after = copy.deepcopy(self.before); after['planets'][0]['resources']['metal'] = '2921156.2014419464'; return after

    def test_refund_retains_actual_production_and_overshoots_old_cap(self):
        self.namespace['wallet_transfer'](self.before, self.refund(), self.fee, 1, 'refund')

    def test_clamping_to_old_cap_is_not_mistaken_for_full_refund(self):
        after = self.refund(); after['planets'][0]['resources']['metal'] = '2920000'
        with self.assertRaises(AssertionError):
            self.namespace['wallet_transfer'](self.before, after, self.fee, 1, 'refund')

    def test_noop_wrong_planet_resource_or_lifetime_mutation_is_rejected(self):
        cases = [copy.deepcopy(self.before), self.refund(), self.refund(), self.refund()]
        cases[1]['planets'][1]['resources']['metal'] = '138000'
        cases[2]['planets'][0]['resources']['crystal'] = '423463.959364568'
        cases[3]['lifetime']['metal'] = '10128000'
        for after in cases:
            with self.subTest(after=after):
                with self.assertRaises(AssertionError):
                    self.namespace['wallet_transfer'](self.before, after, self.fee, 1, 'refund')


class ConflictRecoveryPreparationTests(unittest.TestCase):
    KEY = 'infinity.original-p4.save.v1'
    STATUS = '导入失败，当前进度未改动：检测到其他标签页修改了存档，已暂停写入。请先导出本页保留的原件，再刷新读取最新存档。'

    def setUp(self):
        self.namespace = helpers()
        def check(name, condition, detail=None):
            if not condition:
                raise AssertionError(name)
        self.namespace.update(check=check, KEY=self.KEY)
        self.competing, self.original = '{ "malformed": true }', '{ "complete": "original paid timer" }'
        self.before = {self.KEY: self.competing, self.KEY + '.backup': 'older original bytes',
                       'infinity.save.v1': 'legacy sentinel', 'infinity.ui.tab': 'facilities'}
        self.after = {**self.before, self.KEY: self.original, self.KEY + '.backup.1': self.competing}

    def test_real_conflict_refusal_requires_exact_reason_and_every_storage_byte(self):
        refuse = self.namespace['verify_conflict_refusal']
        refuse(self.before, copy.deepcopy(self.before), self.STATUS)
        for key in self.before:
            changed = copy.deepcopy(self.before); changed[key] += ' '
            with self.subTest(key=key), self.assertRaisesRegex(AssertionError, 'every current'):
                refuse(self.before, changed, self.STATUS)
        for wrong in ('已导入并存入本地', '导入失败，当前进度未改动', self.STATUS + ' '):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(AssertionError, 'cold-refresh'):
                refuse(self.before, self.before, wrong)

    def test_fresh_protected_recovery_preserves_malformed_source_as_exact_backup(self):
        self.namespace['verify_recovery_storage'](self.before, self.after, self.competing, self.original)

    def test_recovery_cannot_normalize_source_erase_old_backup_or_touch_legacy(self):
        mutants = []
        for key in (self.KEY, self.KEY + '.backup', 'infinity.save.v1', self.KEY + '.backup.1'):
            value = copy.deepcopy(self.after); value[key] += ' '; mutants.append(value)
        missing = copy.deepcopy(self.after); del missing[self.KEY + '.backup.1']; mutants.append(missing)
        extra = copy.deepcopy(self.after); extra['unrelated-new-permission'] = 'enabled'; mutants.append(extra)
        for value in mutants:
            with self.subTest(value=value), self.assertRaises(AssertionError):
                self.namespace['verify_recovery_storage'](self.before, value, self.competing, self.original)

    def test_initial_placeholder_confirmation_does_not_claim_shared_corrupt_two_planet_world(self):
        confirmation = self.namespace['import_confirmation']({'version': 9, 'revision': 11}, '第 1 轮，1 颗星球，当前“母星”')
        self.assertEqual(confirmation, '已读取存档 v9/r11。\n是否替换当前进度（第 1 轮，1 颗星球，当前“母星”）？\n读取期间产生的变化也会被替换。保留当前已保存原件，写入校验成功后才采用。')
        self.assertNotIn('2 颗星球', confirmation)
        imported = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'import_save')
        guarded = next(node for node in imported.body if isinstance(node, ast.If) and ast.unparse(node.test) == 'displayed_progress is None')
        self.assertIn('read(page)', ast.unparse(guarded))
        self.assertIn('dialog.message == confirmation', ast.unparse(imported))

    def test_conflict_rejection_precedes_real_reload_and_fresh_protected_import(self):
        calls = sorted((node for node in ast.walk(TREE) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)), key=lambda node: node.lineno)
        rejected = next(node for node in calls if node.func.id == 'import_save' and any(kw.arg == 'expected_conflict' and isinstance(kw.value, ast.Constant) and kw.value.value is True for kw in node.keywords))
        reloaded = next(node for node in calls if node.func.id == 'reload_conflicted_source')
        restored = next(node for node in calls if node.func.id == 'import_save' and any(kw.arg == 'displayed_progress' for kw in node.keywords))
        self.assertLess(rejected.lineno, reloaded.lineno)
        self.assertLess(reloaded.lineno, restored.lineno)
        self.assertTrue(any(node.func.id == 'force_retained' and rejected.lineno < node.lineno < reloaded.lineno for node in calls))
        reload_body = ast.unparse(next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'reload_conflicted_source'))
        for forbidden in ('setItem', 'removeItem', 'import_save(', 'save(page'):
            self.assertNotIn(forbidden, reload_body)
        self.assertIn('page.reload(', reload_body)
        self.assertIn('verify_bundle(page)', reload_body)
        self.assertIn('verify_document_response(response)', reload_body)
        self.assertIn('exact_json(storage(page), before)', reload_body)
        self.assertIn('typeof window.__demoRetained', reload_body)
        self.assertIn('当前仅显示临时初始画面', reload_body)

    def test_paid_same_document_reimport_separately_retires_its_actual_current_cancel(self):
        self.assertIn('ready-same-world-paid-reimport-retires-current-cancel', SOURCE)
        self.assertIn('window.__demoRetained[0].disabled && window.__demoRetained[0] !== document.querySelector(s)', SOURCE)
        self.assertIn('same-world-paid-reimport-never-refunds-or-changes-job-timer', SOURCE)
        self.assertNotIn("check('recovery never re-enables the retained old", SOURCE)


class LiveFailureContractTests(unittest.TestCase):
    def test_diagnostics_capture_original_bytes_and_rethrow_before_shutdown(self):
        namespace = helpers()
        with tempfile.TemporaryDirectory(prefix='demolition-offline-') as directory:
            out = Path(directory)
            namespace.update(out=out, case='deliberate offline failure', completed=True, failure=None, evidence=[], CARD='card', QUEUE='queue',
                             raw=lambda page: page.raw(), flush=lambda: None)
            page, original = DiagnosticPage(), AssertionError('original demolition failure')
            with self.assertRaises(AssertionError) as raised:
                with page.live(), namespace['capture_live_failure']():
                    namespace['active_page'] = page
                    raise original
            self.assertIs(raised.exception, original)
            self.assertFalse(namespace['completed'])
            self.assertEqual(page.events[-1], 'Playwright stopped')
            self.assertEqual((out / 'failure-raw-save.json').read_bytes(), page.RAW.encode())
            self.assertEqual((out / 'failure-dom.html').read_bytes(), page.DOM.encode())
            self.assertEqual((out / 'failure.png').read_bytes(), b'offline fake screenshot bytes')
            self.assertIn('original demolition failure', namespace['failure']['traceback'])
            self.assertEqual(namespace['failure']['queue'], ['captured text'])
            queue = next(row for row in namespace['failure']['targetVisibility'] if row['selector'] == 'queue')
            self.assertTrue(queue['hidden'] and queue['hiddenAncestor'])
            self.assertEqual(queue['rect']['height'], 0)
            self.assertTrue(queue['controls'][0]['disabled'])
            self.assertNotIn('captureErrors', namespace['failure'])


class FrameWaitDiagnosticContracts(unittest.TestCase):
    """Static JS contracts and Python doubles, not execution/native-frame proof."""
    def setUp(self):
        self.namespace = helpers()
        directory = tempfile.TemporaryDirectory(prefix='demolition-liveness-offline-')
        self.addCleanup(directory.cleanup)
        self.out = Path(directory.name)
        self.namespace.update(out=self.out, case='offline liveness', evidence=[])
        clock_assignment = next(node for node in TREE.body if isinstance(node, ast.Assign) and
                                any(isinstance(target, ast.Name) and target.id == 'CLOCK' for target in node.targets))
        self.clock = next(node.value for node in ast.walk(clock_assignment) if isinstance(node, ast.Constant) and
                          isinstance(node.value, str) and node.value.startswith('(() =>'))
        self.wait = self.clock.split('window.__demoAdvance=async ms=>{', 1)[1].split('window.__demoNative=', 1)[0]

    def test_native_monotonic_capture_precedes_clock_override_and_records_environment(self):
        self.assertLess(self.clock.index('nativeNow=performance.now.bind(performance)'), self.clock.index("Object.defineProperty(performance,'now'"))
        for token in ('nativeEpochMs:nativeDateNow()', 'nativeMonotonicMs:nativeNow()', 'document.visibilityState',
                      'document.hasFocus()', 'viewport:{width:innerWidth,height:innerHeight}', 'appFrameCount:',
                      "['visibilitychange','focus','blur','resize']"):
            self.assertIn(token, self.clock)
        self.assertIn('if(liveness.events.length>128)liveness.events.shift()', self.clock)

    def test_only_two_actual_frames_can_complete_and_native_timer_only_rejects(self):
        self.assertEqual(self.wait.count('pendingFrame=raf('), 2)
        self.assertEqual(self.wait.count('finish(null)'), 1)
        first, second = self.wait.index('pendingFrame=raf(firstTimestamp=>'), self.wait.index('pendingFrame=raf(secondTimestamp=>')
        self.assertLess(first, second)
        self.assertLess(second, self.wait.index('finish(null)'))
        self.assertIn("guard=nativeSetTimeout(()=>{if(!settled)rejectTimeout('native-timer');},state.deadlineMs)", self.wait)
        self.assertIn('deadlineMs:5000', self.wait)
        self.assertIn('nativeNow()-state.started.nativeMonotonicMs<state.deadlineMs', self.wait)
        self.assertIn("if(overdue('first-frame'))return;", self.wait)
        self.assertIn("if(overdue('second-frame'))return;", self.wait)
        self.assertIn("error.name='NativeTwoRafTimeout';finish(error)", self.wait)
        for forbidden in ('Promise.race', 'new Promise(raf)', 'requestAnimationFrame(', 'setTimeout(resolve', 'performance.now()', 'Date.now()'):
            self.assertNotIn(forbidden, self.wait)
        self.assertEqual(self.wait.count('elapsed+=ms'), 1)
        self.assertEqual(self.wait.count("sessionStorage.setItem('demolition-clock',String(epoch+elapsed))"), 1)

    def test_cleanup_precedes_settlement_and_late_callbacks_cannot_continue(self):
        finish = self.wait.split('const finish=error=>{', 1)[1].split('const rejectTimeout=', 1)[0]
        guard = finish.index('if(settled)return;settled=true')
        settlement = finish.index('if(error)reject(error);else resolve()')
        for cleanup in ('caf(pendingFrame)', 'nativeClearTimeout(guard)', 'nativeClearInterval(heartbeat)'):
            self.assertLess(guard, finish.index(cleanup))
            self.assertLess(finish.index(cleanup), settlement)
        for callback in ('firstTimestamp', 'secondTimestamp'):
            body = self.wait.split('pendingFrame=raf(' + callback + '=>{', 1)[1]
            self.assertTrue(body.lstrip().startswith('if(settled)return;pendingFrame=null;'))
            self.assertIn('nativeFrameTimestamp:' + callback, body)
        self.assertIn("state.lastHeartbeat=mark('two-raf-heartbeat',{phase:state.phase})", self.wait)
        self.assertIn('},250)', self.wait)
        self.assertIn('catch(error){finish(error);}', self.wait)

    def test_host_events_are_monotonic_atomic_exclusive_and_do_not_poll_report(self):
        self.namespace['time'].now = 12
        self.namespace['host_stage']('before-operation', requestedMilliseconds=0)
        self.namespace['time'].now = 13
        self.namespace['host_stage']('after-operation')
        events = [json.loads(path.read_text()) for path in sorted((self.out / 'liveness-stages').glob('*.json'))]
        self.assertEqual([event['stage'] for event in events], ['before-operation', 'after-operation'])
        self.assertEqual([event['hostMonotonicSeconds'] for event in events], [12, 13])
        first = (self.out / 'liveness-stages/000001.json').read_bytes()
        self.namespace['host_stage_sequence'] = 0
        with self.assertRaises(FileExistsError):
            self.namespace['host_stage']('must-not-overwrite')
        self.assertEqual((self.out / 'liveness-stages/000001.json').read_bytes(), first)
        self.assertFalse(list((self.out / 'liveness-stages').glob('*.tmp')))
        body = ast.unparse(next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'host_stage'))
        self.assertFalse(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'flush' for node in ast.walk(ast.parse(body))))
        self.assertNotIn('page.', body)

    def test_failed_advance_retains_inflight_never_counts_success_or_retries(self):
        namespace, calls = self.namespace, []
        namespace['branch_metrics'] = {'offline liveness': {'attemptedAdvanceCalls': 0, 'successfulAdvanceCalls': 0,
            'zeroAdvanceCalls': 0, 'liveOneSecondAdvanceCalls': 0, 'simulatedSeconds': 0, 'advanceInFlight': None}}
        class Page:
            def evaluate(self, source, ms):
                calls.append((source, ms))
                raise RuntimeError('NativeTwoRafTimeout: offline double')
        with self.assertRaisesRegex(RuntimeError, 'NativeTwoRafTimeout'):
            namespace['advance'](Page(), 1000)
        metrics = namespace['branch_metrics']['offline liveness']
        self.assertEqual(len(calls), 1)
        self.assertEqual(metrics['attemptedAdvanceCalls'], 1)
        self.assertEqual(metrics['successfulAdvanceCalls'], 0)
        self.assertEqual(metrics['simulatedSeconds'], 0)
        self.assertEqual(metrics['advanceInFlight']['requestedMilliseconds'], 1000)
        events = [json.loads(path.read_text()) for path in sorted((self.out / 'liveness-stages').glob('*.json'))]
        self.assertEqual([event['stage'] for event in events], ['advance-start', 'advance-error'])
        self.assertEqual(events[-1]['rendererObservation'], 'unknown until independently captured')

    def test_failed_host_marker_cannot_replace_original_advance_error(self):
        metrics = {'attemptedAdvanceCalls': 0, 'successfulAdvanceCalls': 0, 'advanceInFlight': None}
        self.namespace['branch_metrics'] = {'offline liveness': metrics}
        original = RuntimeError('original native timeout')
        class Page:
            def evaluate(self, source, ms):
                raise original
        def stage(label, **detail):
            if label == 'advance-error':
                raise OSError('offline marker storage failure')
        self.namespace['host_stage'] = stage
        with self.assertRaises(RuntimeError) as raised:
            self.namespace['advance'](Page())
        self.assertIs(raised.exception, original)
        self.assertIn('offline marker storage failure', metrics['advanceInFlight']['hostEventError'])

    def test_observed_clock_delta_still_must_match_original_request(self):
        for requested, observed, successful in ((0, 0, True), (1000, 1000, True), (0, 1, False), (1000, 0, False)):
            with self.subTest(requested=requested, observed=observed):
                metrics = {'attemptedAdvanceCalls': 0, 'successfulAdvanceCalls': 0, 'zeroAdvanceCalls': 0,
                           'liveOneSecondAdvanceCalls': 0, 'simulatedSeconds': 0, 'advanceInFlight': None}
                self.namespace['branch_metrics'] = {'offline liveness': metrics}
                class Page:
                    def evaluate(self, source, ms):
                        return {'beforeAt': 100, 'afterAt': 100 + observed, 'nativeTwoRaf': {'phase': 'offline double'}}
                if successful:
                    self.namespace['advance'](Page(), requested)
                    self.assertEqual(metrics['successfulAdvanceCalls'], 1)
                    self.assertEqual(metrics['simulatedSeconds'], requested / 1000)
                    self.assertIsNone(metrics['advanceInFlight'])
                else:
                    with self.assertRaisesRegex(AssertionError, 'clock delta'):
                        self.namespace['advance'](Page(), requested)
                    self.assertEqual(metrics['successfulAdvanceCalls'], 0)
                    self.assertIsNotNone(metrics['advanceInFlight'])

    def test_one_raw_dom_checkpoint_precedes_each_responsive_resize_tab_advance(self):
        namespace = self.namespace
        namespace['raw'] = lambda page: page.RAW
        with DiagnosticPage().live() as page:
            namespace['responsive_checkpoint'](page, 'offline-layout', 320)
        self.assertEqual((self.out / 'offline-layout-320-before-resize-raw-save.json').read_bytes(), DiagnosticPage.RAW.encode())
        self.assertEqual((self.out / 'offline-layout-320-before-resize-dom.html').read_bytes(), DiagnosticPage.DOM.encode())
        self.assertEqual(len(namespace['evidence']), 3)
        body = ast.unparse(next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'responsive'))
        self.assertEqual(body.count('responsive_checkpoint('), 1)
        self.assertLess(body.index('responsive_checkpoint('), body.index('page.set_viewport_size('))
        self.assertLess(body.index('page.set_viewport_size('), body.index('building_tab(page)'))
        self.assertIn('for width in (320, 390, 768, 1440)', body)
        self.assertNotIn('check(', ast.unparse(next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'responsive_checkpoint')))

    def test_original_business_check_and_advance_call_census_is_byte_for_byte_ast_exact(self):
        def calls(names):
            return [ast.dump(node, include_attributes=False) for node in sorted(ast.walk(TREE), key=lambda node: getattr(node, 'lineno', 0))
                    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in names]
        def census(values):
            return len(values), hashlib.sha256(json.dumps(values).encode()).hexdigest()
        # Pinned from 7ab569045996a1a6ad8ce1aee477092144dfad74, whose green artifact
        # executed 1225 checks and 50 positive one-second advances. Static census
        # protects every original assertion and every advance call; it is not a rerun.
        # Only the final, exact current-release metadata check is the declared
        # v9/r14 -> v9/r16 adaptation. Map one immutable AST string in a copy;
        # every other check and every advance must retain the original census.
        before = ast.dump(ast.parse(
            "check('actual production release is expected v9/r14', release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 14)"
        ).body[0].value, include_attributes=False)
        after = ast.dump(ast.parse(
            "check('actual production release is expected v9/r16', release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 16)"
        ).body[0].value, include_attributes=False)
        actual = calls({'check'})
        self.assertEqual([index for index, call in enumerate(actual) if call == after], [108])
        self.assertNotIn(before, actual)
        original = actual.copy()
        original[108] = before
        self.assertEqual(census(original), (109, 'baae104d3af444105bfbae93f5313ee27ce3c7f0cf30f4d4d8a04e2eaa437948'))
        self.assertEqual(census(calls({'advance', 'one_seconds'})), (23, 'f2a321de7342851c48a202daa6efe2ac6fb554e1f7ded724fb3dc535ae8e3576'))

    def test_release_check_projection_rejects_wrong_revision_duplicate_position_and_other_check_drift(self):
        original = ast.dump(TREE, include_attributes=True)
        for mutation in ('revision', 'label', 'missing', 'duplicate', 'position', 'other_check'):
            changed = copy.deepcopy(TREE)
            checks = [node for node in sorted(ast.walk(changed), key=lambda node: getattr(node, 'lineno', 0))
                      if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'check']
            if mutation == 'revision':
                checks[108].args[1].values[1].comparators[0].value = 15
            elif mutation == 'label':
                checks[108].args[0].value = 'actual production release is expected v9/r14'
            elif mutation == 'missing':
                checks[108].func.id = 'omitted_check'
            elif mutation == 'duplicate':
                changed.body.append(ast.Expr(value=copy.deepcopy(checks[108])))
            elif mutation == 'position':
                checks[108].lineno = 0
            else:
                checks[0].args[0] = ast.Constant(value='unapproved business check change')
            with self.subTest(mutation=mutation), patch(__name__ + '.TREE', changed), self.assertRaises(AssertionError):
                self.test_original_business_check_and_advance_call_census_is_byte_for_byte_ast_exact()
        self.assertEqual(ast.dump(TREE, include_attributes=True), original)


class DiagnosticDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.namespace = helpers()
        self.namespace['time'] = real_time
        self.prior_handler = signal.getsignal(signal.SIGALRM)
        self.prior_timer = signal.getitimer(signal.ITIMER_REAL)
        signal.setitimer(signal.ITIMER_REAL, 0)
        self.addCleanup(self.restore_alarm)

    def restore_alarm(self):
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, self.prior_handler)
        signal.setitimer(signal.ITIMER_REAL, *self.prior_timer)

    def test_stalled_observation_has_local_bound_and_no_leaked_alarm(self):
        started = real_time.monotonic()
        with self.assertRaisesRegex(TimeoutError, 'renderer state remains unknown'):
            with self.namespace['diagnostic_bound'](.03):
                real_time.sleep(2)
        self.assertLess(real_time.monotonic() - started, .5)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))
        self.assertEqual(signal.getsignal(signal.SIGALRM), self.prior_handler)

    def test_cleanup_restores_original_earlier_suite_deadline_without_extending_it(self):
        handler = lambda *_: None
        signal.signal(signal.SIGALRM, handler)
        signal.setitimer(signal.ITIMER_REAL, 1)
        before = signal.getitimer(signal.ITIMER_REAL)[0]
        with self.namespace['diagnostic_bound'](.5):
            real_time.sleep(.025)
        after = signal.getitimer(signal.ITIMER_REAL)[0]
        self.assertLess(after, before - .02)
        self.assertGreater(after, 0)
        self.assertIs(signal.getsignal(signal.SIGALRM), handler)

    def test_failed_marker_write_does_not_prevent_available_browser_observations(self):
        namespace = self.namespace
        with tempfile.TemporaryDirectory(prefix='demolition-diagnostic-offline-') as directory:
            def failed_marker(*args, **kwargs):
                raise OSError('offline marker storage failure')
            namespace.update(out=Path(directory), case='offline marker failure', completed=True, failure=None, evidence=[],
                CARD='card', QUEUE='queue', flush=lambda: None, raw=lambda page: page.raw(), host_stage=failed_marker)
            with DiagnosticPage().live() as page:
                namespace['capture_failure'](AssertionError('original failure'), page)
            self.assertEqual(namespace['failure']['rawSave'], page.RAW)
            self.assertEqual(namespace['failure']['queue'], ['captured text'])
            self.assertEqual((Path(directory) / 'failure-dom.html').read_bytes(), page.DOM.encode())
            self.assertTrue(all(row['observationStatus'] == 'artifact unavailable' for row in namespace['failure']['captureErrors']))

    def test_each_failure_observation_is_independent_and_unavailable_is_unknown(self):
        namespace = self.namespace
        with tempfile.TemporaryDirectory(prefix='demolition-diagnostic-offline-') as directory:
            namespace.update(out=Path(directory), case='offline timeout', completed=True, failure=None, evidence=[],
                CARD='card', QUEUE='queue', flush=lambda: None, raw=lambda page: page.raw())
            class Page(DiagnosticPage):
                def raw(self):
                    self.observe('raw')
                    real_time.sleep(2)
                def evaluate(self, source, selectors=None):
                    if source == 'window.__demoReadLiveness()':
                        raise RuntimeError('offline double: interrupted Playwright re-entry unavailable')
                    return super().evaluate(source, selectors)
            with Page().live() as page:
                namespace['capture_failure'](AssertionError('original failure'), page)
            self.assertEqual(namespace['failure']['error'], "AssertionError('original failure')")
            missing = namespace['failure']['captureErrors']
            self.assertEqual([row['step'] for row in missing], ['raw save', 'native frame liveness'])
            self.assertTrue(all(row['observationStatus'] == 'unavailable; renderer state unknown' for row in missing))
            self.assertEqual(namespace['failure']['queue'], ['captured text'])
            self.assertEqual((Path(directory) / 'failure-dom.html').read_bytes(), page.DOM.encode())
            self.assertEqual((Path(directory) / 'failure.png').read_bytes(), b'offline fake screenshot bytes')
            self.assertIn('SIGALRM-interrupted Playwright re-entry', namespace['failure']['observationBoundary'])
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))


if __name__ == '__main__':
    unittest.main()
