"""Offline lab-blocker acceptance contract. No Node/build/browser evidence."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/browser-lab-blockers.py'
FIXTURE = ROOT / 'scripts/lab-blockers-native-fixture.ts'
spec = importlib.util.spec_from_file_location('lab_blockers_native_acceptance', SCRIPT)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


def job(number=183, building='research_lab', level=7, total=4.189090909090909):
    return {'building': building, 'targetLevel': level, 'jobId': number, 'taskId': None,
            'source': 'manual', 'paid': {'metal': '12800', 'crystal': '25600', 'deuterium': '12800'},
            'totalSeconds': total, 'remainingSeconds': total}


def world():
    return {'planets': [
        {'id': 'homeworld', 'name': '母星', 'coordinates': {'galaxy': 1, 'system': 56, 'position': 11},
         'buildQueue': [job()], 'demolition': None},
        {'id': 'colony-1', 'name': '殖民地 1:56:10', 'coordinates': {'galaxy': 1, 'system': 56, 'position': 10},
         'buildQueue': [], 'demolition': None}],
        'activePlanetId': 'colony-1', 'orders': {'nextJobId': 185, 'tasks': []}}


def definition(name):
    text = SCRIPT.read_text(); tree = ast.parse(text)
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    return ast.get_source_segment(text, node)


class IndependentDisplayOracleTests(unittest.TestCase):
    def test_single_real_head_exact_identity_target_and_chinese_copy(self):
        original = world(); frozen = copy.deepcopy(original); value = module.independent_blockers(original)
        self.assertEqual(original, frozen)
        self.assertEqual(value['planetCount'], 1); self.assertEqual(value['jobCount'], 1)
        self.assertEqual(value['summary'], '研究受阻：1处实验室施工')
        self.assertEqual(value['items'], [{'planetId': 'homeworld', 'jobId': '183', 'kind': 'upgrade', 'queuePosition': '1',
            'text': '母星 [1:56:11] · 升级 → 等级 7 · 建造队列第 1 位 · 已付 · 施工中 · 工作 #183'}])

    def test_one_planet_two_paid_jobs_counts_one_place_and_two_jobs(self):
        state = world(); state['planets'][0]['buildQueue'].append(job(184, level=8, total=0))
        value = module.independent_blockers(state)
        self.assertEqual((value['planetCount'], value['jobCount']), (1, 2))
        self.assertEqual(value['note'], '按星球计，共 2 项已付工作（含排队）；以下仅列已付款的升级与拆除。')
        self.assertIn('建造队列第 2 位 · 已付排队', value['items'][1]['text'])
        self.assertNotIn('施工中', value['items'][1]['text'])

    def test_nonlab_head_keeps_real_lab_position_and_never_calls_it_running(self):
        state = world(); state['planets'][0]['buildQueue'].insert(0, job(180, 'fusion_reactor', 1, 1))
        value = module.independent_blockers(state)
        self.assertEqual(len(value['items']), 1)
        self.assertEqual(value['items'][0]['queuePosition'], '2')
        self.assertIn('已付排队', value['items'][0]['text'])
        self.assertNotIn('施工中', value['items'][0]['text'])

    def test_zero_duration_head_is_explicitly_waiting(self):
        state = world(); state['planets'][0]['buildQueue'][0]['totalSeconds'] = 0
        self.assertIn('已付排队', module.independent_blockers(state)['items'][0]['text'])

    def test_global_scope_and_independent_demolition_level(self):
        state = world(); state['planets'][1]['demolition'] = {'building': 'research_lab', 'jobId': 184, 'toLevel': 2}
        value = module.independent_blockers(state)
        self.assertEqual((value['planetCount'], value['jobCount']), (2, 2))
        self.assertEqual(value['items'][1], {'planetId': 'colony-1', 'jobId': '184', 'kind': 'demolition', 'queuePosition': '',
            'text': '殖民地 1:56:10 [1:56:10] · 拆除 → 等级 2 · 独立拆除位 · 已付 · 施工中 · 工作 #184'})

    def test_unpaid_intent_and_nonlab_work_never_become_blockers(self):
        state = world(); state['planets'][0]['buildQueue'] = [job(building='metal_mine')]
        state['planets'][1]['demolition'] = {'building': 'solar_plant'}
        state['orders']['tasks'] = [{'kind': 'building', 'building': 'research_lab', 'targetLevel': 10,
                                     'status': 'running', 'activeJob': None}]
        self.assertEqual(module.independent_blockers(state), {'planetCount': 0, 'jobCount': 0, 'items': [], 'summary': '', 'note': ''})

    def test_names_remain_literal_and_state_is_immutable(self):
        state = world(); state['planets'][0]['name'] = '<script>&"星🚀ABCDEFGHIJKLMNOPQRSTUVWX'
        frozen = copy.deepcopy(state); value = module.independent_blockers(state)
        self.assertTrue(value['items'][0]['text'].startswith(state['planets'][0]['name'] + ' [1:56:11]'))
        self.assertEqual(state, frozen)

    def test_active_planet_and_plan_status_do_not_change_paid_global_fact(self):
        state = world(); expected = module.independent_blockers(state)
        state['activePlanetId'] = 'homeworld'; state['orders']['tasks'].append({'status': 'paused'})
        self.assertEqual(module.independent_blockers(state), expected)


class NativeRunnerContractTests(unittest.TestCase):
    def test_release_schema_uses_explicit_lift_without_relabeling_historical_input(self):
        historical = {'schema': 'infinity-original-p4', 'version': 9, 'revision': 14,
                      'state': {'allHistoricalFields': ['retained', 123]}, 'savedAt': 500, 'lastTickAt': 500}
        before = copy.deepcopy(historical)
        self.assertTrue(module.lab_release_schema_matches({'saveVersion': 9, 'saveRevision': 16}, historical))
        for release in ({'saveVersion': 9, 'saveRevision': 14}, {'saveVersion': 9, 'saveRevision': 15},
                        {'saveVersion': 8, 'saveRevision': 16}, {'saveVersion': 9}, {}):
            self.assertFalse(module.lab_release_schema_matches(release, historical))
        self.assertEqual(historical, before)
        for revision in (13, 15, 16):
            changed = copy.deepcopy(historical); changed['revision'] = revision
            with self.assertRaisesRegex(AssertionError, '^Only genuine r14 envelope may use this adapter$'):
                module.lab_release_schema_matches({'saveVersion': 9, 'saveRevision': 16}, changed)

    def test_shared_release_verifier_has_only_one_reviewed_predicate_change(self):
        shared = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        old = "release_metadata.get('saveVersion') == fixtures['base']['version'] and release_metadata.get('saveRevision') == fixtures['base']['revision']"
        original = next(node for node in ast.parse(shared).body if isinstance(node, ast.FunctionDef) and node.name == 'verify_bundle')
        expected = ast.parse(ast.get_source_segment(shared, original).replace(old,
            "lab_release_schema_matches(release_metadata, fixtures['base'])"))
        observed = []; real_compile = compile
        def capture(source, filename, *args, **kwargs):
            if filename == '<reviewed-lab-r14-to-r16-release-verifier>': observed.append(source)
            return real_compile(source, filename, *args, **kwargs)
        with patch('builtins.compile', side_effect=capture): module.load_reviewed_helpers()
        self.assertEqual(len(observed), 1)
        self.assertEqual(ast.dump(observed[0]), ast.dump(expected))
        original_read = Path.read_text
        def changed(path, *args, **kwargs):
            value = original_read(path, *args, **kwargs)
            return value.replace(old, 'True') if path == ROOT / 'scripts/browser-npc-attack.py' else value
        with patch.object(Path, 'read_text', changed):
            with self.assertRaisesRegex(RuntimeError, '^Exact historical release-schema predicate changed$'):
                module.load_reviewed_helpers()

    def test_ci_only_gate_precedes_playwright_import(self):
        source = SCRIPT.read_text()
        self.assertLess(source.index("if os.environ.get('CI') != 'true'"), source.index('from playwright.sync_api import'))
        with tempfile.TemporaryDirectory() as out:
            command = [sys.executable, str(SCRIPT), '--fixture', 'unused', '--expected-fixture-sha256', '0' * 64,
                '--natural-report', 'unused', '--expected-report-sha256', module.REPORT_SHA,
                '--expected-sha', 'a' * 40, '--expected-version', module.CANDIDATE_VERSION,
                '--runtime-node', 'v22.0.0', '--output', out]
            result = subprocess.run(command, capture_output=True, text=True, timeout=10,
                env={**os.environ, 'CI': 'false', 'GITHUB_ACTIONS': 'false'})
        self.assertNotEqual(result.returncode, 0); self.assertIn('CI-only', result.stderr)
        self.assertNotIn('playwright', result.stderr)

    def test_import_has_no_node_browser_or_prior_runner_side_effect(self):
        module.load_reviewed_helpers()
        for name in ('NativeCheckJournal', 'verify_bundle', 'verify_document_response', 'native_scroll_to', 'storage_check'):
            self.assertTrue(callable(getattr(module, name)))
        self.assertNotIn('playwright', sys.modules)
        self.assertNotIn('exec_module', definition('load_reviewed_helpers'))

    def test_new_independent_browser_and_context_native_file_import(self):
        main, boot = definition('main'), definition('boot')
        for text in ('browser = playwright.chromium.launch(', 'boot(fixtures[\'initialRaw\'], empty=True)',
                     "import_file(page, fixtures['initialRaw'], True", 'with sync_playwright() as playwright, live_failure_evidence():'):
            self.assertIn(text, main)
        self.assertIn('browser.new_context(', boot); self.assertIn('context.new_page()', boot)
        self.assertIn('if not empty: entries.append', boot)
        for forbidden in ('connect_over_cdp', 'browser.contexts[', 'window.gameState', 'window.__game',
                          'page.route(', 'route.fulfill(', 'add_script_tag(', 'Profiler.start'):
            self.assertNotIn(forbidden, SCRIPT.read_text())

    def test_native_payments_always_capture_originals_before_assertions(self):
        source = definition('replay_natural_route')
        self.assertLess(source.index('before_reference = persist_json'), source.index('trusted_click(page, PAY)'))
        self.assertLess(source.index('reference = persist_json'), source.index("check('real payment allocates"))
        self.assertIn("'expectedState': fixtures['expected']", source)
        self.assertIn("whole_state(name, actual, expected)", source)
        for forbidden in ('setItem(', "['resources'] =", "['research'] =", "['buildQueue'] =", 'enqueue('):
            self.assertNotIn(forbidden, source)

    def test_four_widths_native_glyph_hits_caret_and_keyboard(self):
        self.assertEqual(module.WIDTHS, (320, 390, 768, 1440))
        source = SCRIPT.read_text()
        for text in ("caret='initial'", 'CAPTURE_REFERENCES', 'CAPTURE_STATE', "witness['before'] == witness['after']",
                     'text_leaf_visibility(page', "len(row['points']) == 5", 'all_storage(page)',
                     "keyboard='Enter'", "keyboard='Space'", 'raw-before-assertion'):
            self.assertIn(text, source)
        for forbidden in ("caret='hide'", 'force=True', 'scrollIntoView(', 'MutationObserver', 'PerformanceObserver'):
            self.assertNotIn(forbidden, source)

    def test_screenshots_persist_dom_before_and_after_even_if_capture_fails(self):
        source = definition('snap')
        self.assertLess(source.index("witness['before'] ="), source.index('page.screenshot('))
        self.assertLess(source.index("witness['after'] ="), source.index("check('caret=initial"))
        self.assertIn('finally:', source); self.assertIn('dispose_capture_handles(refs)', source)

    def test_disclosure_compares_all_local_and_session_bytes_and_original_quotes(self):
        source = definition('summary_toggle')
        self.assertLess(source.index('reference_before = persist_json'), source.index('.click()'))
        self.assertLess(source.index('reference = persist_json'), source.index("check('native disclosure"))
        self.assertIn('after == before and after_controls == controls', source)
        self.assertIn("'expected': before", source)
        self.assertIn('sessionStorage', definition('all_storage'))
        self.assertIn('selectedPlanet', definition('original_research_controls'))

    def test_import_reset_protection_and_cancel_have_exact_state_boundaries(self):
        source = SCRIPT.read_text()
        for text in ('natural-native-paid186-separate-cancellation-branch', 'actual-cancellation-clears-summary',
                     'actual-completion-clears-summary', 'cancelled-import', 'different-world-import',
                     'accepted-new-world', "original.evaluate('(e)=>e.isConnected')", 'protected-frozen-old-progress',
                     "competing['lastTickAt'] = competing['savedAt']", 'recovery-current-full-world'):
            self.assertIn(text, source)
        protection = definition('protection_boundary')
        self.assertIn("row['trusted'] is True", protection)
        self.assertIn('summary_toggle(page, False)', protection)
        self.assertIn('storage_check(', protection)
        self.assertEqual(source.count('localStorage.setItem('), 1)

    def test_full_source_current_fixture_historical_report_and_http_v8_are_bound(self):
        source = SCRIPT.read_text()
        for text in ('HEAD^{tree}', '--porcelain=v1', "git('ls-tree', '-r', '-z'", "b'blob '",
                     'sourceModes', 'expected_producer', 'args.expected_fixture_sha256', 'runtimeNode',
                     "hashlib.sha256(report_bytes).hexdigest() != REPORT_SHA", 'verify_bundle(page)',
                     'verify_document_response(response)'):
            self.assertIn(text, source)
        shared = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        for text in ('Debugger.getScriptSource', 'httpSha256', 'executedSourceSha256', 'releaseSha256'):
            self.assertIn(text, shared)

    def test_incremental_journal_and_600_610_bounds(self):
        source = SCRIPT.read_text(); flush = definition('flush')
        self.assertIn('signal.alarm(600)', source); self.assertIn('time.monotonic() + 610', source)
        self.assertIn('recorded_checks < len(checks)', flush); self.assertIn('recorded_evidence < len(evidence)', flush)
        self.assertIn("journal.append('seal'", flush); self.assertIn('recover_native_report(', source)
        self.assertIn("info['birth'] == birth", definition('supervise'))
        self.assertNotIn("atomic_json(report_path, metadata())", flush)

    def test_adopted_epochs_use_independent_literal_route_offsets_and_preserve_originals(self):
        source = definition('assert_adopted_epoch'); route = definition('replay_natural_route')
        self.assertIn("fixtures['base']['savedAt'] + elapsed_seconds * 1000", source)
        self.assertIn("'browserDateNow': page.evaluate('Date.now()')", source)
        self.assertIn("assert_adopted_epoch(page, 'natural-paid186-native-reload', 384)", route)
        self.assertIn("assert_adopted_epoch(page, 'historical-milestone01-complete', 418)", route)
        self.assertLess(source.index('reference = persist_json'), source.index('check(label'))
        self.assertIn("'raw': saved_raw", source); self.assertIn("'expected': expected", source)
        self.assertIn('not human wall-clock duration', source)
        module.load_reviewed_helpers()
        with tempfile.TemporaryDirectory() as directory:
            module.out = Path(directory); module.checks = []; module.evidence = []; module.case = 'offline-epoch'
            raw = json.dumps({'savedAt': 1384000, 'lastTickAt': 1383999, 'state': {'complete': 'original'}})
            def checked(_name, condition, detail):
                witness = json.loads((module.out / detail['file']).read_text())
                self.assertEqual(witness['raw'], raw)
                self.assertEqual(witness['expected'], {'savedAt': 1384000, 'lastTickAt': 1384000, 'browserDateNow': 1384000})
                if not condition: raise AssertionError('Expected independently detected lastTickAt mismatch')
            with patch.object(module, 'fixtures', {'base': {'savedAt': 1000000}}, create=True), \
                 patch.object(module, 'raw', return_value=raw), patch.object(module, 'all_storage', return_value={'local': {}, 'session': {}}), \
                 patch.object(module, 'flush', return_value=None), patch.object(module, 'check', side_effect=checked):
                with self.assertRaises(AssertionError):
                    module.assert_adopted_epoch(SimpleNamespace(evaluate=lambda _: 1384000), 'bad-epoch', 384)

    def test_whole_state_failure_writes_complete_originals_before_throw(self):
        module.load_reviewed_helpers()
        with tempfile.TemporaryDirectory() as directory:
            records = []; module.out = Path(directory); module.case = 'offline-failure'; module.checks = []; module.evidence = []
            def check(_name, condition, detail):
                records.append((condition, detail))
                self.assertTrue((module.out / detail['file']).is_file())
                self.assertEqual(json.loads((module.out / detail['file']).read_text()), {'actual': {'all': 1}, 'expected': {'all': 2}})
                if not condition: raise AssertionError('Expected offline mismatch')
            with patch.object(module, 'flush', return_value=None), patch.object(module, 'check', side_effect=check):
                with self.assertRaises(AssertionError): module.whole_state('full-originals', {'all': 1}, {'all': 2})
            self.assertEqual(len(records), 1); self.assertIs(records[0][0], False)


class FixturePreparationContractTests(unittest.TestCase):
    def test_lossless_archive_double_hash_and_complete_provenance(self):
        original = module.validated_historical_bytes(ROOT)
        self.assertEqual(len(original), 836611)
        self.assertEqual(hashlib.sha256(original).hexdigest(), module.REPORT_SHA)
        self.assertTrue(module.valid_natural_report(json.loads(original)))
        source = definition('validated_historical_bytes')
        self.assertLess(source.index('hashlib.sha256(packed)'), source.index('gzip.decompress(packed)'))
        self.assertIn('sourceArtifactId', source); self.assertIn('sourceRunId', source)

    def test_bad_compressed_bytes_are_rejected_before_decompression(self):
        packed = (ROOT / module.GZIP_PATH).read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / module.GZIP_PATH; path.parent.mkdir(parents=True)
            path.write_bytes(bytes([packed[0] ^ 1]) + packed[1:])
            with patch.object(module.gzip, 'decompress', side_effect=AssertionError('Must never decompress unverified bytes')):
                with self.assertRaisesRegex(ValueError, 'before decompression'):
                    module.validated_historical_bytes(directory)

    def test_natural_entire_handoffs_and_independent_literal_jobs(self):
        source = FIXTURE.read_text()
        for text in (module.REPORT_SHA, module.HISTORICAL_SHA, 'const initialRaw = JSON.stringify(origin.save)',
                     'paidAt = [0, 5, 14, 384]', '4.189090909090909', '33.512727272727275',
                     '183 + offset', '12800 * 2 ** offset', 'elapsed === 418',
                     'exact(serializeState(state), liftR14StateToR16(final.save.state)', 'tick(state, 1, "live")'):
            self.assertIn(text, source)
        natural = source.split('// Every synthetic input')[0]
        for forbidden in ('resources =', 'planet.name =', 'createInitialState(', 'state.research.levels.'):
            self.assertNotIn(forbidden, natural)

    def test_synthetic_inputs_cannot_be_misclassified_natural(self):
        source = FIXTURE.read_text()
        for text in ('EXPLICIT SYNTHETIC:', 'same-planet-two-jobs', 'nonlab-head-lab-tail',
                     'multi-planet-upgrades', 'mixed-demolition-long-names', 'unpaid-intent-only',
                     'quoteDemolition(value, "research_lab")', 'commitDemolition(value, quote.quote)',
                     'zero-gap startup changed input', 'strict roundtrip changed input'):
            self.assertIn(text, source)
        self.assertNotIn('labBlockers(', source)

    def test_synthetic_nonlab_head_respects_unchanged_two_slot_capacity(self):
        source = FIXTURE.read_text()
        self.assertIn('const nonlabHead = name === "nonlab-head-lab-tail" || name === "mixed-demolition-long-names"', source)
        self.assertIn('if (!nonlabHead) value = accept(enqueue(value, "research_lab", "manual"));', source)
        loop = source.split('for (const name of [')[1].split('let unpaid =')[0]
        self.assertEqual(loop.count('value = accept(enqueue(value, "research_lab", "manual"))'), 2)
        self.assertNotIn('queueCapacity', source)

    def test_pin_matches_actual_authorized_report_if_present(self):
        path = ROOT.parent / 'ci-be0-verify/natural-research-network-report.json'
        if not path.is_file(): self.skipTest('Historical input is supplied separately in CI')
        data = path.read_bytes(); report = json.loads(data)
        self.assertEqual(hashlib.sha256(data).hexdigest(), module.REPORT_SHA)
        self.assertTrue(module.valid_natural_report(report))
        for field in ('sourceSha', 'sourceScopeStatusPorcelain'):
            changed = copy.deepcopy(report); changed['source'][field] = 'tampered'
            self.assertFalse(module.valid_natural_report(changed))
        changed = copy.deepcopy(report); changed['provenance']['noSyntheticFunds'] = False
        self.assertFalse(module.valid_natural_report(changed))


if __name__ == '__main__': unittest.main()
