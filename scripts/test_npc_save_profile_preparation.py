"""Stdlib-only attribution preparation, not browser or performance evidence."""
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

SCRIPT = Path(__file__).with_name('browser-npc-save-profile.py')
SPEC = importlib.util.spec_from_file_location('npc_save_profile', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def source_map():
    return {'version': 3, 'sources': ['one.ts', 'two.ts'], 'sourcesContent': ['function first() {}', 'let x;\nfunction second() {}'],
            'names': ['first', 'second'], 'mappings': 'AAAAA,KCAEC;AACA'}


def frame(name, script_id='0', url='', line=-1, column=-1):
    return {'functionName': name, 'scriptId': script_id, 'url': url, 'lineNumber': line, 'columnNumber': column}


def profile_double():
    return {'startTime': 100, 'endTime': 8200, 'nodes': [
        {'id': 1, 'callFrame': frame('(root)'), 'children': [2, 3, 4, 5]},
        {'id': 2, 'callFrame': frame('a', '7', 'http://localhost/assets/main.js', 0, 0), 'children': [6]},
        {'id': 3, 'callFrame': frame('(idle)')},
        {'id': 4, 'callFrame': frame('frame', '8', MODULE.OBSERVER_URL, 0, 0)},
        {'id': 5, 'callFrame': frame('utility', '9', '', 0, 0)},
        {'id': 6, 'callFrame': frame('b', '7', 'http://localhost/assets/main.js', 0, 7)}],
        'samples': [2, 6, 3, 4, 5, 6], 'timeDeltas': [100, 1000, 3000, 1000, 1000, 1000]}


def scripts_double():
    return {'7': {'url': 'http://localhost/assets/main.js', 'production': True, 'sha256': 'a' * 64, 'asset': 'assets/main.js'},
            '8': {'url': MODULE.OBSERVER_URL, 'production': False, 'sha256': 'b' * 64, 'asset': None}}


class SourceMapTests(unittest.TestCase):
    def test_signed_vlq_and_truncation(self):
        self.assertEqual(MODULE.vlq('ACDEgBhB'), [0, 1, -1, 2, 16, -16])
        for value in ('g', '*', 'gggggggggggg'):
            with self.subTest(value=value), self.assertRaises(AssertionError):
                MODULE.vlq(value)

    def test_source_and_name_deltas_persist_across_lines(self):
        value = source_map(); lines = MODULE.decode_map(value)
        first = MODULE.mapped_position(value, lines, 0, 0)
        second = MODULE.mapped_position(value, lines, 0, 7)
        last = MODULE.mapped_position(value, lines, 1, 2)
        self.assertEqual((first['source'], first['mappedTokenName'], first['generatedColumnGap']), ('one.ts', 'first', 0))
        self.assertEqual((second['source'], second['mappedTokenName'], second['originalColumn0'], second['generatedColumnGap']), ('two.ts', 'second', 2, 2))
        self.assertEqual((last['source'], last['originalLine0'], last['originalSourceLine']), ('two.ts', 1, 'function second() {}'))
        self.assertNotIn('mappedTokenName', last)
        self.assertIn('not an exact original function identity', second['semantics'])

    def test_unmapped_segment_and_empty_line_do_not_inherit_mapping(self):
        value = source_map(); value['mappings'] = 'AAAAA,K;'
        lines = MODULE.decode_map(value)
        self.assertIsNotNone(MODULE.mapped_position(value, lines, 0, 4))
        for line, column in ((0, 5), (0, 20), (1, 1), (2, 0), (-1, 0), (0, -1)):
            self.assertIsNone(MODULE.mapped_position(value, lines, line, column))

    def test_invalid_map_contract_rejected(self):
        for update in ({'version': 2}, {'sourceRoot': '/'}, {'sections': []}, {'mappings': 'AA'},
                       {'mappings': 'AAAAA,D'}, {'mappings': 'AAAA,ACAA'}, {'mappings': 'AEAA'}, {'mappings': 'AAAD'}, {'mappings': 'AAAAG'}):
            with self.subTest(update=update), self.assertRaises(AssertionError):
                MODULE.decode_map({**source_map(), **update})

    def test_sidecar_requires_actual_bundle_and_original_source_byte_equality(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / 'src').mkdir(); (root / 'src/one.ts').write_text('function first() {}')
            maps = root / '.cache/maps'; (maps / 'assets').mkdir(parents=True)
            js = maps / 'assets/main.js'; js.write_text('function a(){}')
            value = {'version': 3, 'sources': ['../../../src/one.ts'], 'sourcesContent': ['function first() {}'],
                     'names': ['first'], 'mappings': 'AAAAA'}
            Path(str(js) + '.map').write_text(json.dumps(value))
            release = {'files': {'assets/main.js': MODULE.sha(js.read_bytes())}}
            out = root / 'evidence'; out.mkdir()
            records, accepted = MODULE.sidecar_maps(root, maps, release, out)
            self.assertTrue(records[0]['eligible']); self.assertEqual(len(accepted), 1)
            self.assertTrue((out / records[0]['artifact']).is_file())
            (root / 'src/one.ts').write_text('tampered original')
            records, accepted = MODULE.sidecar_maps(root, maps, release)
            self.assertFalse(accepted); self.assertIn('original differs', records[0]['mappingUnavailableReason'])
            js.write_text('different production')
            records, accepted = MODULE.sidecar_maps(root, maps, release)
            self.assertFalse(accepted); self.assertIn('generated JS differs', records[0]['mappingUnavailableReason'])
            records, accepted = MODULE.sidecar_maps(root, None, release)
            self.assertFalse(accepted); self.assertIn('No hidden-map', records[0]['mappingUnavailableReason'])

    def test_linked_installed_dependencies_are_verified_but_other_paths_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp); root = base / 'game'; maps = root / '.cache/maps'; (maps / 'assets').mkdir(parents=True)
            dependencies = base / 'installed'; dependencies.mkdir(); (dependencies / 'lib.js').write_text('official dependency')
            (root / 'node_modules').symlink_to(dependencies, target_is_directory=True)
            js = maps / 'assets/main.js'; js.write_text('var a=1;')
            value = {'version': 3, 'sources': ['../../../../installed/lib.js'], 'sourcesContent': ['official dependency'], 'names': [], 'mappings': 'AAAA'}
            mapping = Path(str(js) + '.map'); mapping.write_text(json.dumps(value))
            release = {'files': {'assets/main.js': MODULE.sha(js.read_bytes())}}
            records, accepted = MODULE.sidecar_maps(root, maps, release)
            self.assertTrue(accepted); self.assertEqual(records[0]['sourceValidation'][0]['relativePath'], 'node_modules/lib.js')
            (base / 'unrelated.js').write_text('official dependency')
            value['sources'] = ['../../../../unrelated.js']; mapping.write_text(json.dumps(value))
            records, accepted = MODULE.sidecar_maps(root, maps, release)
            self.assertFalse(accepted); self.assertIn('path leaves exact', records[0]['mappingUnavailableReason'])


class SampleAttributionTests(unittest.TestCase):
    def summarize(self, profile=None, scripts=None):
        value = source_map()
        return MODULE.profile_summary(profile if profile is not None else profile_double(),
                                      scripts if scripts is not None else scripts_double(),
                                      {'assets/main.js': (value, MODULE.decode_map(value))})

    def test_all_nodes_positions_and_full_ancestry_retained(self):
        summary = self.summarize(); nodes = {row['nodeId']: row for row in summary['nodes']}
        self.assertEqual(len(nodes), 6); self.assertEqual(summary['sampleCount'], 6)
        self.assertEqual(nodes[6]['stackNodeIds'], [1, 2, 6]); self.assertEqual(nodes[6]['parentNodeId'], 2)
        self.assertEqual(nodes[2]['selfSampleCount'], 1); self.assertEqual(nodes[2]['inclusiveSampleCount'], 3)
        self.assertEqual(nodes[1]['inclusiveSampleCount'], 6); self.assertEqual(nodes[1]['selfSampleCount'], 0)
        self.assertEqual(nodes[6]['callFrame'], profile_double()['nodes'][5]['callFrame'])
        self.assertEqual(nodes[6]['scriptSha256'], 'a' * 64)
        self.assertEqual(nodes[6]['sourceMapPosition']['mappedTokenName'], 'second')
        self.assertEqual(summary['selfSampleCountsByCategory'], {'production': 3, 'read-only-observer': 1, 'vm-or-idle': 1, 'automation-or-unattributed': 1})

    def test_counts_do_not_multiply_sampling_interval_into_fake_cpu_time(self):
        summary = self.summarize()
        self.assertEqual(summary['rawTimeDeltaSumUs'], 7100)
        self.assertEqual(summary['profileSpanUs'], 8100)
        self.assertEqual(summary['observedTimeDeltaUs']['max'], 3000)
        self.assertNotIn('cpuMs', summary); self.assertNotIn('selfTimeMs', summary['nodes'][0])
        self.assertIn('not call counts or CPU milliseconds', summary['semantics'])

    def test_production_script_requires_verified_id_and_matching_url(self):
        with self.assertRaisesRegex(AssertionError, 'verified production'):
            self.summarize(scripts={})
        scripts = scripts_double(); scripts['7']['url'] = 'http://different/'
        with self.assertRaisesRegex(AssertionError, 'URL differ'):
            self.summarize(scripts=scripts)

    def test_invalid_profiles_reject_before_attribution(self):
        changes = [lambda p: p['nodes'].append(copy.deepcopy(p['nodes'][0])),
                   lambda p: p['nodes'][0]['children'].append(99),
                   lambda p: p['nodes'][0]['children'].append(6),
                   lambda p: p['nodes'][5].update(children=[2]),
                   lambda p: p['samples'].append(1),
                   lambda p: p['samples'].__setitem__(0, 999),
                   lambda p: p['timeDeltas'].__setitem__(0, -1),
                   lambda p: p.update(endTime=float('nan')),
                   lambda p: p.update(endTime=99),
                   lambda p: p.update(samples=[], timeDeltas=[])]
        for change in changes:
            profile = profile_double(); change(profile)
            with self.subTest(profile=profile), self.assertRaises(AssertionError):
                self.summarize(profile)


class RunnerContractTests(unittest.TestCase):
    def test_browser_guard_precedes_files_source_checks_and_playwright_import(self):
        environment = {key: value for key, value in os.environ.items() if key not in ('CI', 'GITHUB_ACTIONS')}
        result = subprocess.run([sys.executable, str(SCRIPT), '--fixture', '/missing', '--source-root', '/missing',
                                 '--expected-sha', MODULE.GAME_SHA, '--expected-fixture-sha256', 'a' * 64],
                                env=environment, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0); self.assertIn('GitHub-CI-only', result.stderr)
        self.assertNotIn('FileNotFoundError', result.stderr)
        imports = [node.module for node in ast.parse(SCRIPT.read_text()).body if isinstance(node, ast.ImportFrom)]
        self.assertFalse(any(name and name.startswith('playwright') for name in imports))

    def test_only_two_bounded_raw_profiles_without_timing_benchmark(self):
        text = SCRIPT.read_text()
        self.assertEqual(text.count("cdp.send('Profiler.start')"), 2)
        self.assertEqual(MODULE.WHOLE_SECONDS, 90); self.assertEqual(MODULE.ACTION_MS, 10000)
        self.assertEqual(MODULE.SAMPLING_INTERVAL_US, 1000)
        for forbidden in ('Performance.getMetrics', 'Debugger.pause', 'setBreakpoint', 'setScriptSource', 'startPreciseCoverage', 'Emulation.set', 'page.route('):
            self.assertNotIn(forbidden, text)
        self.assertIn("require(page.url == 'about:blank'", text)
        self.assertIn('page.mouse.click(**point)', text)
        self.assertIn("row['beforeRaw'] != row['afterRaw']", text)
        self.assertIn('PRESSURE.qualify_click(rows, selector, storage=True)', text)
        self.assertIn("require(sha(raw) == RELEASE_SHA", text)

    def test_observer_and_prior_unprofiled_runner_are_unchanged(self):
        self.assertTrue(MODULE.PROBE.startswith(MODULE.PRESSURE.PROBE))
        self.assertEqual(MODULE.PROBE[len(MODULE.PRESSURE.PROBE):], '\n//# sourceURL=' + MODULE.OBSERVER_URL)
        self.assertNotIn('Profiler.', Path(__file__).with_name('browser-npc-pressure.py').read_text())
        self.assertEqual(MODULE.sha(Path(__file__).with_name('npc-pressure-fixture.ts').read_bytes()), MODULE.FIXTURE_SCRIPT_SHA)
        self.assertEqual(MODULE.GAME_SHA, 'a8454529ee5abf8d915fee7f4cc1c5d77d6a8ef7')

    def test_debugger_after_both_profiles_and_raw_evidence_before_qualification(self):
        text = SCRIPT.read_text()
        self.assertLess(text.index("stop_profile(cdp, 'startup'"), text.index("stop_profile(cdp, 'save'"))
        self.assertLess(text.index("stop_profile(cdp, 'save'"), text.index("cdp.send('Debugger.enable')"))
        self.assertLess(text.index("atomic_json(out / 'save-native-click-and-storage.json'"), text.index('PRESSURE.qualify_click(rows, selector, storage=True)'))
        tree = ast.parse(text)
        worker = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'native_worker')
        final_calls = [call for node in ast.walk(worker) if isinstance(node, ast.Try) for final in node.finalbody
                       for call in ast.walk(final) if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == 'stop_profile']
        self.assertEqual(len(final_calls), 2)


if __name__ == '__main__':
    unittest.main()
