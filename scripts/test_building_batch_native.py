"""Offline contracts for the independent bounded native lane; no browser execution."""
import ast
from contextlib import contextmanager
import copy
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


class NativeContract(unittest.TestCase):
    def test_fixed_scenarios_match_independent_census(self):
        browser = load('batch_browser_contract', 'scripts/browser-building-batch.py')
        census = load('batch_census_contract', 'scripts/building_batch_census.py')
        self.assertEqual(browser.SCENARIOS, census.SCENARIOS)
        self.assertEqual(len(browser.SCENARIOS), 25)
        self.assertEqual(len(set(browser.SCENARIOS)), 25)
        self.assertEqual(browser.WIDTHS, (320, 390, 768, 1440))
        self.assertEqual(browser.WORK_SECONDS, 630)
        self.assertEqual(browser.SUPERVISOR_SECONDS, 650)
        self.assertLess(browser.WORK_SECONDS, browser.SUPERVISOR_SECONDS)
        self.assertLess(browser.SUPERVISOR_SECONDS, 660)

    def test_fixture_only_imports_public_core_apis(self):
        source = (ROOT / 'scripts/building-batch-natural-fixture.mjs').read_text()
        modules = re.findall(r"from ['\"]([^'\"]+)['\"]", source)
        self.assertTrue(modules)
        self.assertTrue(all(name.startswith(('node:', '../src/game/')) for name in modules))
        self.assertIn('createInitialState(WORLD_SEED, ARCADE_SEED)', source)
        self.assertIn('WORLD_SEED = 20261013, ARCADE_SEED = 31415926', source)
        self.assertIn("else throw new Error(`Unknown argument ${key}; this producer accepts no save/report input`)", source)
        self.assertNotIn('natural-growth-journey', source)
        self.assertNotIn('9102da6f', source)
        self.assertNotIn('1_000_000', source)
        self.assertIn("secondsPerCall: 1, calls: count, mode: 'live'", source)
        self.assertIn("classification: 'synthetic-legal-capacity-boundary; not-natural-colonization'", source)

    def test_whole_state_and_normal_native_actions_are_preserved(self):
        source = (ROOT / 'scripts/browser-building-batch.py').read_text()
        tree = ast.parse(source)
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)]
        attrs = [node.func.attr for node in calls if isinstance(node.func, ast.Attribute)]
        self.assertIn('set_input_files', attrs)
        self.assertIn('click', attrs)
        self.assertIn('screenshot', attrs)
        self.assertIn('new_cdp_session', attrs)
        self.assertIn("Debugger.getScriptSource", source)
        self.assertIn("sha(responses[0].body())", source)
        self.assertIn("actual == expected", source)
        self.assertIn("fixture['authorized']['state']", source)
        self.assertIn("fixture['completed']['state']", source)
        self.assertIn("fixture['noReplay']['state']", source)
        self.assertNotIn('page.route(', source)
        self.assertNotIn('add_style_tag(', source)
        self.assertNotIn('add_script_tag(', source)
        self.assertIn("'storage-readback-failure'", source)
        self.assertIn('armed=true', source)
        self.assertIn("'protected cached export retains original complete state'", source)

    def test_readonly_production_observer_rejects_ambiguous_or_mutated_serializer(self):
        specimens = load('batch_public_observer_specimens', 'scripts/test_ring_protection_observer.py')
        shapes = load('batch_public_observer_shapes', 'scripts/browser-ring-protection.py')
        exact = specimens.R14_CURRENT
        self.assertEqual(len(shapes.production_serializers(exact)), 1)
        self.assertEqual(len(shapes.production_serializers(exact + exact)), 2)
        for before, after in (('e.orders.nextJobId', 'e.orders.nextTaskId'),
                              ('activePlanetId:e.activePlanetId,', ''),
                              ('state', 'changed'),
                              ('return{npcEconomy:', 'sideEffect();return{npcEconomy:')):
            if before not in exact: continue
            self.assertEqual(shapes.production_serializers(exact.replace(before, after, 1)), [])
        source = (ROOT / 'scripts/browser-building-batch.py').read_text()
        self.assertIn('globalThis.__batchObserveRequested&&', source)
        self.assertIn('globalThis.__batchObserveRequested=false),false)', source)
        self.assertIn('read-only observer leaves complete native KEY raw bytes unchanged', source)
        self.assertIn('natural-unobserved-control', source)
        self.assertIn('seal_event_scope(page)', source)
        self.assertIn('navigationSequence', source)
        self.assertIn('paidJobObservations', source)
        self.assertNotIn('Debugger.evaluateOnCallFrame', source)

    def test_watchdog_owns_only_verified_processes(self):
        source = (ROOT / 'scripts/browser-building-batch.py').read_text()
        self.assertIn("current['start'] == observed['start']", source)
        self.assertIn("marker.encode() in (entry / 'cmdline').read_bytes().split(b'\\0')", source)
        self.assertIn('survivors', source)
        self.assertNotIn('pkill', source)
        self.assertNotIn('killall', source)
        self.assertIn("raise ValueError('Native output must be a fresh empty directory')", source)


class DiagnosticPage:
    """Offline double: every page API rejects capture after context teardown."""
    DOM = '<html><input type="checkbox" data-batch-planet="homeworld"></html>'
    RAW = '{"state":{"unchanged":"original bytes"}}'
    WITNESS = {'documentId': 'offline-document', 'navigationSequence': 1,
               'events': [{'kind': 'change', 'trusted': True, 'planet': 'homeworld'}]}

    def __init__(self, failures=()):
        self.failures = set(failures)
        self.calls = []
        self.alive = False

    def capture(self, step):
        self.calls.append(step)
        if not self.alive:
            raise RuntimeError('Event loop is closed')
        if step in self.failures:
            raise RuntimeError('unavailable ' + step)

    def content(self):
        self.capture('DOM')
        return self.DOM

    def evaluate(self, expression, *arguments):
        if expression == 'window.__batchWitness':
            self.capture('events')
            return copy.deepcopy(self.WITNESS)
        if expression == '(key)=>localStorage.getItem(key)' and len(arguments) == 1:
            self.capture('storage')
            return self.RAW
        raise AssertionError('Unexpected diagnostic evaluation: ' + expression)

    def screenshot(self, *, path, full_page, caret):
        self.capture('screenshot')
        assert full_page is True and caret == 'initial'
        Path(path).write_bytes(b'offline screenshot bytes')

    @contextmanager
    def live(self):
        self.alive = True
        try:
            yield self
        finally:
            self.alive = False
            self.calls.append('Playwright stopped')


class FailureCaptureContract(unittest.TestCase):
    """Execute the actual failure handlers with doubles, never a browser."""
    def setUp(self):
        self.script = ROOT / 'scripts/browser-building-batch.py'
        self.browser = load('batch_failure_contract', 'scripts/browser-building-batch.py')
        tree = ast.parse(self.script.read_text())
        self.worker = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'worker')
        self.lifecycle = copy.deepcopy(next(node for node in self.worker.body if isinstance(node, ast.Try)))
        self.context = self.lifecycle.body[0]
        self.assertIsInstance(self.context, ast.With)
        temporary = tempfile.TemporaryDirectory(prefix='batch-failure-offline-')
        self.addCleanup(temporary.cleanup)
        self.out = Path(temporary.name)
        self.namespace = dict(vars(self.browser), out=self.out, started=self.browser.time.monotonic(),
                              current={'id': 'natural-payments-reload-no-replay'},
                              report={'completed': True, 'evidence': []})
        names = {'flush', 'dump', 'raw', 'capture_failure', 'retain_before_teardown'}
        helpers = [node for node in self.worker.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual({node.name for node in helpers}, names)
        exec(compile(ast.Module(body=helpers, type_ignores=[]), str(self.script), 'exec'), self.namespace)

    def fail_live(self, page, original=None):
        original = original or AssertionError('original checkbox acceptance failure')
        self.namespace.update(active_page=page, sync_playwright=page.live, original=original)
        # Keep the real with/except flow; replace only its browser workload with
        # a deliberate failure. This also executes the outer fallback handler.
        self.context.body = [ast.Raise(exc=ast.Name(id='original', ctx=ast.Load()), cause=None)]
        code = ast.fix_missing_locations(ast.Module(body=[self.lifecycle], type_ignores=[]))
        with self.assertRaises(type(original)) as caught:
            exec(compile(code, str(self.script), 'exec'), self.namespace)
        self.assertIs(caught.exception, original)
        self.assertFalse(self.namespace['report']['completed'])
        self.assertEqual(page.calls[-1], 'Playwright stopped')
        return self.namespace['report']['failure']

    def test_actual_capture_guard_exits_before_playwright_and_outer_fallback_has_no_page_access(self):
        self.assertEqual([item.context_expr.func.id for item in self.context.items],
                         ['sync_playwright', 'retain_before_teardown'])
        outer = ast.unparse(self.lifecycle.handlers[0])
        self.assertIn("if 'failure' not in report:", outer)
        self.assertIn('capture_failure(error, capture_page=False)', outer)
        for forbidden in ('active_page.', 'dump(', 'raw(', 'flush('):
            self.assertNotIn(forbidden, outer)

    def test_all_evidence_captured_once_before_close_and_original_exception_preserved(self):
        page = DiagnosticPage()
        failure = self.fail_live(page)
        self.assertEqual(page.calls, ['DOM', 'storage', 'events', 'screenshot', 'Playwright stopped'])
        self.assertNotIn('captureErrors', failure)
        self.assertIn('original checkbox acceptance failure', failure['traceback'])
        self.assertEqual(failure['scenario'], 'natural-payments-reload-no-replay')
        self.assertEqual(next(self.out.glob('*-failure-dom.html')).read_text(), page.DOM)
        self.assertEqual(next(self.out.glob('*-failure-storage.json')).read_text(), page.RAW)
        self.assertEqual(json.loads(next(self.out.glob('*-failure-events.json')).read_text()), page.WITNESS)
        self.assertEqual((self.out / 'failure.png').read_bytes(), b'offline screenshot bytes')
        for evidence in self.namespace['report']['evidence']:
            data = (self.out / evidence['file']).read_bytes()
            self.assertEqual(evidence['sha256'], self.browser.sha(data))
            self.assertEqual(evidence['bytes'], len(data))
        self.assertEqual(json.loads((self.out / 'report.json').read_text())['failure'], failure)

    def test_each_capture_error_keeps_other_evidence_and_never_retries_or_replaces_original(self):
        for unavailable in ('DOM', 'storage', 'events', 'screenshot'):
            with self.subTest(unavailable=unavailable):
                self.namespace['report'] = {'completed': True, 'evidence': []}
                page = DiagnosticPage(failures={unavailable})
                failure = self.fail_live(page)
                self.assertEqual(page.calls, ['DOM', 'storage', 'events', 'screenshot', 'Playwright stopped'])
                self.assertEqual(failure['captureErrors'], [{'step': unavailable, 'error': repr(RuntimeError('unavailable ' + unavailable))}])
                self.assertEqual(failure['error'], repr(AssertionError('original checkbox acceptance failure')))

    def test_report_write_failure_does_not_mask_original_or_prevent_page_capture(self):
        def unavailable():
            raise OSError('report filesystem unavailable')
        self.namespace['flush'] = unavailable
        page = DiagnosticPage()
        failure = self.fail_live(page, original=KeyboardInterrupt('original worker interruption'))
        self.assertEqual(page.calls, ['DOM', 'storage', 'events', 'screenshot', 'Playwright stopped'])
        self.assertEqual([row['step'] for row in failure['captureErrors']],
                         ['original failure report', 'DOM', 'storage', 'events', 'final failure report'])
        self.assertEqual((self.out / 'failure.png').read_bytes(), b'offline screenshot bytes')

    def test_unexpected_capture_error_preserves_original_and_still_closes_context(self):
        original_capture = self.namespace['capture_failure']
        def broken_capture(error, capture_page=True):
            original_capture(error, capture_page=capture_page)
            raise RuntimeError('unexpected capture implementation failure')
        self.namespace['capture_failure'] = broken_capture
        page = DiagnosticPage()
        failure = self.fail_live(page)
        self.assertEqual(page.calls, ['DOM', 'storage', 'events', 'screenshot', 'Playwright stopped'])
        self.assertIn('original checkbox acceptance failure', failure['error'])

    def test_startup_failure_only_records_report_without_using_dead_page(self):
        page = DiagnosticPage()
        original = RuntimeError('Playwright startup failed')
        @contextmanager
        def unavailable():
            raise original
            yield
        self.namespace.update(active_page=page, sync_playwright=unavailable, current=None)
        self.context.body = [ast.Pass()]
        code = ast.fix_missing_locations(ast.Module(body=[self.lifecycle], type_ignores=[]))
        with self.assertRaises(RuntimeError) as caught:
            exec(compile(code, str(self.script), 'exec'), self.namespace)
        self.assertIs(caught.exception, original)
        self.assertEqual(page.calls, [])
        self.assertEqual(self.namespace['report']['failure']['scenario'], 'binding')
        self.assertFalse(self.namespace['report']['completed'])


if __name__ == '__main__':
    unittest.main()
