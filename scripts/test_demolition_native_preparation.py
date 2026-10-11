"""Offline contracts for demolition evidence helpers; never launches Node/browser.

python -m unittest discover -s scripts -p 'test_demolition_native_preparation.py' -v
AST-extracted helpers and explicit doubles test orchestration, not native proof.
"""
import ast
from contextlib import contextmanager
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import traceback
import unittest
from test_terraformer_native_preparation import TargetPage as OriginalTargetPage, DiagnosticPage as OriginalDiagnosticPage

SCRIPT = Path(__file__).with_name('browser-demolition.py')
SOURCE = SCRIPT.read_text(encoding='utf-8')
TREE = ast.parse(SOURCE)
NAMES = {'exact_json', 'native_scroll_to', 'capture_failure', 'capture_live_failure', 'wallet_transfer', 'wallet_golden', 'advance', 'wait_for_scroll_settled', 'responsive'}


def helpers():
    namespace = {'contextmanager': contextmanager, 'hashlib': hashlib, 'traceback': traceback, 'time': FakeClock()}
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


if __name__ == '__main__':
    unittest.main()
