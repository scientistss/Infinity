"""Offline contracts for the independent bounded native lane; no browser execution."""
import ast
import importlib.util
from pathlib import Path
import re
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


if __name__ == '__main__':
    unittest.main()
