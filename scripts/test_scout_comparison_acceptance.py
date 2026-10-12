"""Offline comparison acceptance contract. No Node, build, or browser evidence."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from decimal import Decimal, localcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/browser-scout-comparison.py'
spec = importlib.util.spec_from_file_location('scout_comparison_acceptance_contract', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def snapshot(ident, observed, stock):
    return {'model': 'npc-scout-snapshot-v1', 'fleetId': ident, 'originId': 'home',
            'target': {'galaxy': 1, 'system': 56, 'position': 15}, 'observedAt': observed,
            'stock': stock, 'garrison': {'light_fighter': 4, 'heavy_fighter': 0},
            'defenderTech': {'weapons': 0, 'shields': 0, 'armour': 0}}


def state():
    a = snapshot(11, '31.5', [0.1, 30000, 5e-324])
    b = snapshot(13, '36.5', [0.3, 29998.125, 10000])
    b['garrison']['light_fighter'] = 1
    return {'messages': [{'id': 'scout-11', 'at': 31.5, 'text': 'Original observation one', 'npcScoutSnapshot': a},
                         {'id': 'ordinary-return', 'at': 34, 'text': 'Ordinary retained message', 'npcScoutSnapshot': None},
                         {'id': 'scout-13', 'at': 36.5, 'text': 'Original observation two', 'npcScoutSnapshot': b}],
            'fleets': [{'id': 13, 'remaining': 1.5, 'returning': True, 'mission': 'scout'}],
            'planets': [{'resources': {'metal': '123'}, 'units': {'espionage_probe': 0}}],
            'research': {'levels': {'weapons_tech': 1}}, 'nextFleetId': 14,
            'npcEconomy': {'now': 36.5, 'sites': {}}, 'randomState': 12345}


class IndependentPairTests(unittest.TestCase):
    def test_exact_decimal_difference_and_all_original_fields(self):
        original = state(); frozen = copy.deepcopy(original)
        value = module.independent_pair(original)
        self.assertEqual(original, frozen)
        self.assertEqual(value['beforeId'], 'scout-11')
        self.assertEqual(value['afterId'], 'scout-13')
        self.assertEqual(Decimal(value['values']['delta']['stock.metal']), Decimal('0.2'))
        self.assertEqual(Decimal(value['values']['delta']['stock.crystal']), Decimal('-1.875'))
        self.assertEqual(Decimal(value['values']['delta']['garrison.light_fighter']), Decimal('-3'))
        with localcontext() as context:
            context.prec = 400
            expected = Decimal('10000') - Decimal('5e-324')
        self.assertEqual(Decimal(value['values']['delta']['stock.deuterium']), expected)
        self.assertEqual(value['before'], original['messages'][0]['npcScoutSnapshot'])
        self.assertEqual(value['after'], original['messages'][2]['npcScoutSnapshot'])
        self.assertEqual(value['before']['observedAt'], '31.5')
        self.assertEqual(set(value['values']['before']), set(module.NUMERIC_FIELDS))

    def test_browser_json_numeric_lexemes_have_independent_golden_differences(self):
        # Literal JSON.stringify-format tokens, no production model or JS oracle.
        cases = [('100000000000000000000', '100000000000000020000', '20000'),
                 ('1e-7', '1.0000000000000002e-7', '2e-23'),
                 ('0.30000000000000004', '0.3', '-4e-17'),
                 ('5e-324', '1e-323', '5e-324')]
        for before, after, difference in cases:
            with self.subTest(before=before, after=after):
                value = state()
                value['messages'][0]['npcScoutSnapshot']['stock'][0] = 'BEFORE_TOKEN'
                value['messages'][2]['npcScoutSnapshot']['stock'][0] = 'AFTER_TOKEN'
                raw = json.dumps({'state': value}).replace('"BEFORE_TOKEN"', before).replace('"AFTER_TOKEN"', after)
                result = module.independent_pair_from_raw(raw)
                self.assertEqual(Decimal(result['values']['before']['stock.metal']), Decimal(before))
                self.assertEqual(Decimal(result['values']['after']['stock.metal']), Decimal(after))
                self.assertEqual(Decimal(result['values']['delta']['stock.metal']), Decimal(difference))

    def test_order_is_retained_message_array_never_time_or_id(self):
        original = state(); original['messages'].reverse()
        value = module.independent_pair(original)
        self.assertEqual(value['beforeId'], 'scout-13')
        self.assertEqual(value['afterId'], 'scout-11')
        self.assertEqual(Decimal(value['values']['delta']['stock.metal']), Decimal('-0.2'))
        self.assertEqual(value['before']['observedAt'], '36.5')
        self.assertEqual(value['after']['observedAt'], '31.5')

    def test_reversed_anchor_does_not_reverse_before_and_after(self):
        self.assertEqual(module.independent_pair(state()), module.independent_pair(state(), 'scout-13', 'scout-11'))

    def test_nonretained_same_message_duplicate_identity_future_model_different_target_fail(self):
        for kind in ('missing', 'duplicate', 'model', 'target'):
            with self.subTest(kind=kind):
                value = state()
                if kind == 'missing': value['messages'].pop()
                if kind == 'duplicate': value['messages'].append(copy.deepcopy(value['messages'][0]))
                if kind == 'model': value['messages'][0]['npcScoutSnapshot']['model'] = 'future-v2'
                if kind == 'target': value['messages'][0]['npcScoutSnapshot']['target']['position'] = 6
                with self.assertRaises(ValueError): module.independent_pair(value)
        with self.assertRaises(ValueError): module.independent_pair(state(), 'scout-11', 'scout-11')

    def test_numeric_oracle_rejects_boolean_nonfinite_and_strings(self):
        for value in (True, '1', None, float('inf'), float('nan')):
            with self.subTest(value=value), self.assertRaises(ValueError): module.decimal_text(value)


class ExplicitSyntheticBoundaryTests(unittest.TestCase):
    def test_fifo_changes_only_messages_and_retains_both_actual_snapshots(self):
        original = {'schema': 'example', 'revision': 14, 'version': 9, 'savedAt': 1000, 'lastTickAt': 1000, 'state': state()}
        raw = json.dumps(original, ensure_ascii=False)
        for evicted in ('scout-11', 'scout-13'):
            changed_raw, seconds = module.synthetic_eviction(raw, evicted)
            changed = json.loads(changed_raw)
            self.assertEqual(seconds, 2)
            self.assertEqual(len(changed['state']['messages']), 150)
            self.assertEqual(changed['state']['messages'][0]['id'], evicted)
            pair = {row['id']: row for row in changed['state']['messages'][:2]}
            for old in original['state']['messages']:
                if old['npcScoutSnapshot'] is not None: self.assertEqual(pair[old['id']], old)
            changed['state']['messages'] = original['state']['messages']
            self.assertEqual(changed, original)
            self.assertEqual(json.loads(raw), original)

    def test_fifo_requires_actual_bounded_paid_return(self):
        for remaining in (0, 121, -1):
            value = state(); value['fleets'][0]['remaining'] = remaining
            with self.assertRaises(ValueError): module.synthetic_eviction(json.dumps({'state': value}), 'scout-11')


class NativeContractTests(unittest.TestCase):
    def test_ci_gate_precedes_import_and_cannot_run_locally(self):
        source = SCRIPT.read_text()
        self.assertLess(source.index("if os.environ.get('CI') != 'true'"), source.index('from playwright.sync_api import'))
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(SCRIPT), '--natural-report', 'unused',
                '--expected-report-sha256', '0' * 64, '--expected-sha', 'a' * 40, '--output', directory],
                env={**os.environ, 'CI': 'false', 'GITHUB_ACTIONS': 'false'}, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('CI-only', result.stderr)
        self.assertNotIn('playwright', result.stderr)

    def test_definitions_only_loader_never_runs_prior_acceptance(self):
        module.load_reviewed_helpers()
        for name in ('NativeCheckJournal', 'verify_bundle', 'verify_document_response', 'native_scroll_to', 'storage_check'):
            self.assertTrue(callable(getattr(module, name)))
        self.assertNotIn('playwright', sys.modules)

    def test_new_independent_browser_and_context_never_reuses_old_runner(self):
        source = SCRIPT.read_text()
        self.assertIn('with sync_playwright() as playwright, live_failure_evidence():', source)
        self.assertIn('browser = playwright.chromium.launch(', source)
        tree = ast.parse((ROOT / 'scripts/browser-scout-rehearsal.py').read_text())
        boot = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'boot')
        self.assertIn('browser.new_context(', ast.unparse(boot))
        self.assertIn('page = context.new_page()', ast.unparse(boot))
        self.assertNotIn('connect_over_cdp', source)
        self.assertNotIn('browser.contexts[', source)

    def test_native_two_scout_provenance_and_exact_economic_inputs(self):
        source = SCRIPT.read_text()
        for text in ("boot(fixtures['origin']['raw'])", "fixtures['tape']", 'configure_paid_request(page, operation)',
                     "trusted_click(page, '#space-send')", "Fraction(operation['expectedFuel'])",
                     "captures['scout13-returned']", "captures['scout13-after-real-battle']",
                     "Omitted existing read-only rehearsal", "'natural-native-operation'"):
            self.assertIn(text, source)
        for forbidden in ('page.route(', 'route.fulfill(', 'add_script_tag(', 'window.__game', 'window.gameState',
                          'Profiler.start', 'rehearseNpcScout(', 'buildNpcScoutComparison(', 'sendFleet('):
            self.assertNotIn(forbidden, source)
        tree = ast.parse(source)
        replay = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'replay_natural_pair')
        replay_source = ast.get_source_segment(source, replay)
        for forbidden in ('setItem(', "['resources'] =", "['research'] =", "['messages'] ="):
            self.assertNotIn(forbidden, replay_source)

    def test_exact_same_commit_tree_scripts_and_report_hash_are_bound(self):
        source = SCRIPT.read_text()
        for text in ('HEAD^{tree}', '--porcelain=v1', 'args.expected_sha', 'routeScriptSha256',
                     'fixturePoolSha256', 'dependencyLockSha256', 'args.expected_report_sha256',
                     'verify_bundle(page)', 'verify_document_response(response)'):
            self.assertIn(text, source)
        shared = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        for text in ('Debugger.getScriptSource', 'httpSha256', 'executedSourceSha256', 'releaseSha256'):
            self.assertIn(text, shared)

    def test_four_widths_all_actual_fields_full_storage_and_caret_preservation(self):
        self.assertEqual(module.WIDTHS, (320, 390, 768, 1440))
        source = SCRIPT.read_text()
        for text in ("caret='initial'", 'CAPTURE_REFERENCES', 'CAPTURE_STATE', "witness['before'] == witness['after']",
                     'text_leaf_visibility(page', "len(row['points']) == 5", "initial_tab='save', visible_tab='messages'",
                     'whole_state(f\'{width}-readonly-comparison\'', 'data-comparison-field',
                     "for side in ('before', 'after', 'delta')", 'raw-before-assertion'):
            self.assertIn(text, source)
        self.assertNotIn("caret='hide'", source)
        self.assertNotIn('force=True', source)
        self.assertNotIn('scrollIntoView(', source)

    def test_closed_select_never_claims_hidden_option_glyph_proof(self):
        source = SCRIPT.read_text(); tree = ast.parse(source)
        native_select = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'native_select_proof')
        selected = ast.get_source_segment(source, native_select)
        self.assertIn('visibility(page', selected)
        self.assertIn('selectedOptions', selected)
        self.assertIn('snap(page', selected)
        self.assertNotIn('text_leaf_visibility', selected)
        self.assertIn("native_select_proof(page, f'{width}-choose-other')", source)
        self.assertNotIn("control_proof(page, PREFIX + 'other'", source)

    def test_natural_raw_envelope_and_storage_precede_state_and_payment_assertions(self):
        source = SCRIPT.read_text(); tree = ast.parse(source)
        replay = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'replay_natural_pair')
        text = ast.get_source_segment(source, replay)
        self.assertLess(text.index("persist_json('natural-browser-'"), text.index("whole_state(operation['name'], actual_state"))
        self.assertIn("'storage': storage(page)", text)
        self.assertLess(text.index("'actualRaw': reloaded_storage[KEY]"), text.index("check('native partial scout reload retains exact raw'"))
        self.assertLess(text.index("persist_json('native-paid-before-'"), text.index("trusted_click(page, '#space-send')"))
        self.assertLess(text.index("'beforeStorage': before_storage, 'afterStorage': after_storage"), text.index("check('separate actual trusted dispatch"))
        self.assertIn("independent_pair_from_raw(captures['scout13-returned'])", text)
        lexical = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'independent_pair_from_raw')
        self.assertIn('parse_float=Decimal', ast.unparse(lexical))

    def test_every_save_preserves_whole_raw_before_parsing_and_lifecycle_starts_on_save(self):
        source = SCRIPT.read_text(); tree = ast.parse(source)
        save = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'save')
        text = ast.get_source_segment(source, save)
        self.assertLess(text.index('persist_json('), text.index('json.loads('))
        self.assertIn("'raw': saved_raw, 'storage': storage(page)", text)
        lifecycle = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'lifecycle_boundaries')
        text = ast.get_source_segment(source, lifecycle)
        self.assertLess(text.index("whole_state(kind + '-baseline', save(page), expected)"), text.index('open_comparison(page)'))
        self.assertLess(text.index('open_comparison(page)'), text.index('before = storage(page)'))

    def test_lifecycle_claims_have_explicit_paths_and_no_forced_negative_action(self):
        source = SCRIPT.read_text()
        for text in ('new-selection', 'tab-away', 'cancelled-import', 'same-world-import', 'corrupt-import',
                     'cancelled-reset', 'accepted-reset', 'hidden-aba', 'style-aba', 'aria-hidden-aba',
                     'same-node-detach', 'same-id-replacement', 'result-replacement',
                     'eviction_boundaries', 'protection_boundary', 'if visible and enabled:',
                     "action = 'native-unavailable'", 'events == [] if action'):
            self.assertIn(text, source)
        function = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == 'retired_result')
        branch = next(node for node in function.body if isinstance(node, ast.If))
        self.assertEqual(ast.unparse(branch.test), 'visible and enabled')
        self.assertIn('trusted_click', ast.unparse(branch.body))
        self.assertNotIn('trusted_click', ast.unparse(branch.orelse))

    def test_complete_raw_evidence_written_before_equality_assertions(self):
        source = SCRIPT.read_text()
        tree = ast.parse(source)
        for name in ('whole_state', 'assert_comparison', 'retired_result'):
            function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
            body = ast.get_source_segment(source, function)
            if name == 'retired_result': body = body[body.index('reference = persist_json'):]
            self.assertLess(body.index('persist_json('), body.index('check('))


class JournalTests(unittest.TestCase):
    def setUp(self):
        module.load_reviewed_helpers()

    def setup_recorder(self, root):
        values = {'args': SimpleNamespace(expected_sha='a' * 40), 'source_tree': 'b' * 40,
                  'script_hashes': {}, 'fixture_sha256': 'c' * 64, 'case': 'offline-journal-contract',
                  'completed': True, 'failure': None, 'checks': [{'case': 'offline', 'name': 'durable check', 'passed': True, 'detail': None}],
                  'evidence': [], 'source_bindings': [{'source': 'binding'}], 'errors': [], 'failed_requests': [],
                  'passed_count': 1, 'failed_count': 0, 'recorded_checks': 0, 'recorded_evidence': 0,
                  'recorded_sources': 0, 'recorded_errors': 0, 'recorded_requests': 0, 'last_progress_at': 0,
                  'report_path': root / 'report.json', 'progress_path': root / 'progress.json',
                  'journal_path': root / 'checks.jsonl'}
        for key, value in values.items(): setattr(module, key, value)
        module.journal = module.NativeCheckJournal(values['journal_path'])

    def test_full_sealed_report_reconstructs_all_source_bindings_and_arrays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.setup_recorder(root)
            try:
                module.flush(full=True, final=True)
                report = module.recover_native_report(module.journal_path, module.report_path, module.progress_path, True)
                self.assertTrue(report['completed'])
                self.assertTrue(report['recording']['sealedReportVerified'])
                self.assertEqual(report['sourceBindings'], module.source_bindings)
                self.assertEqual(len(report['checks']), 1)
                self.assertEqual(len(report['evidence']), 1)
            finally: os.close(module.journal.fd)

    def test_ordinary_flush_serializes_only_new_suffix_not_growing_full_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.setup_recorder(root)
            try:
                module.flush(); before = module.journal.sequence
                module.flush()
                self.assertEqual(module.journal.sequence, before + 1)
                rows = [json.loads(line)['entry'] for line in module.journal_path.read_text().splitlines()]
                self.assertEqual(sum(row['kind'] == 'check' for row in rows), 1)
                self.assertEqual(sum(row['kind'] == 'evidence' for row in rows), 1)
                for row in rows:
                    if row['kind'] == 'snapshot': self.assertNotIn('checks', row['value'])
            finally: os.close(module.journal.fd)

    def test_unsealed_or_corrupt_tail_never_counts_as_pass_and_retains_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); self.setup_recorder(root)
            module.completed = False; module.checks[0]['passed'] = False
            try: module.flush(full=True)
            finally: os.close(module.journal.fd)
            with module.journal_path.open('ab') as stream: stream.write(b'{broken-tail')
            report = module.recover_native_report(module.journal_path, module.report_path, module.progress_path, False)
            self.assertFalse(report['completed'])
            self.assertFalse(report['checks'][0]['passed'])
            self.assertIsNotNone(report['recording']['replayError'])
            self.assertTrue(module.journal_path.read_bytes().endswith(b'{broken-tail'))


if __name__ == '__main__': unittest.main()
