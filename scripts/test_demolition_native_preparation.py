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
from test_terraformer_native_preparation import TargetPage, DiagnosticPage

SCRIPT = Path(__file__).with_name('browser-demolition.py')
SOURCE = SCRIPT.read_text(encoding='utf-8')
TREE = ast.parse(SOURCE)
NAMES = {'exact_json', 'native_scroll_to', 'capture_failure', 'capture_live_failure', 'wallet_transfer', 'wallet_golden', 'advance'}


def helpers():
    namespace = {'contextmanager': contextmanager, 'hashlib': hashlib, 'traceback': traceback}
    nodes = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), namespace)
    return namespace


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
        def check(name, condition, detail=None):
            self.checks.append((name, condition, detail))
            if not condition:
                raise AssertionError(name)
        self.namespace.update(check=check, advance=lambda page: None, visibility=lambda page, selectors: page.proof)

    def test_topbar_resource_capture_uses_its_actual_unobstructed_region(self):
        page = TargetPage(in_header=True)
        self.namespace['native_scroll_to'](page, '[data-bind="res-metal"]')
        self.assertEqual(page.wheels, [])
        self.assertEqual(self.checks[0][2]['limits']['top'], 12)
        self.assertIn('five unoccluded hit-tests', self.checks[-1][0])

    def test_mobile_static_header_and_desktop_sticky_header_are_distinct(self):
        mobile = TargetPage(position='static', y=700, height=1000)
        self.namespace['native_scroll_to'](mobile, '#demolition-review')
        self.assertTrue(mobile.wheels)
        desktop = TargetPage(position='sticky', y=700, height=1000)
        with self.assertRaisesRegex(AssertionError, 'fits its actual'):
            self.namespace['native_scroll_to'](desktop, '#demolition-review')

    def test_occluded_disabled_or_missing_fifth_hit_cannot_be_passed_as_layout(self):
        for fault in ({'visible': False}, {'contained': False}, {'occluded': True}):
            with self.subTest(fault=fault):
                with self.assertRaisesRegex(AssertionError, 'five unoccluded'):
                    self.namespace['native_scroll_to'](TargetPage(in_header=True, **fault), '[data-demolition-confirm]')
        page = TargetPage(in_header=True); page.proof['targets'][0]['points'].pop()
        with self.assertRaisesRegex(AssertionError, 'five unoccluded'):
            self.namespace['native_scroll_to'](page, '[data-demolition-confirm]')


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


if __name__ == '__main__':
    unittest.main()
