"""Offline contract only. No Node, browser, native timing, or CI-green evidence."""
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
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/browser-rehearsal-formation-copy.py'


def load_runner():
    spec = importlib.util.spec_from_file_location('formation_copy_acceptance_contract', SCRIPT)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


module = load_runner()
SOURCE = SCRIPT.read_text()
TREE = ast.parse(SOURCE)


def definition(name):
    node = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == name)
    return ast.get_source_segment(SOURCE, node)


class IndependentQuantityContract(unittest.TestCase):
    def test_sparse_copy_is_complete_dense13_and_never_mutates_input(self):
        source = {'light_fighter': 6}; frozen = copy.deepcopy(source)
        value = module.dense_counts(source)
        self.assertEqual(tuple(value), module.SHIPS)
        self.assertEqual(value, {ship: '6' if ship == 'light_fighter' else '0' for ship in module.SHIPS})
        self.assertEqual(source, frozen)

    def test_every_flying_type_keeps_exact_saved_1e6_limit(self):
        self.assertEqual(len(module.SHIPS), 13)
        self.assertNotIn('solar_satellite', module.SHIPS)
        self.assertEqual(module.MAX_FORMATION_QUANTITY, 1_000_000)
        self.assertEqual(module.MAX_MANUAL_QUANTITY, 1_000_000_000_000)
        source = {ship: 1_000_000 for ship in module.SHIPS}
        self.assertEqual(module.dense_counts(source), {ship: '1000000' for ship in module.SHIPS})
        for ship in module.SHIPS:
            with self.subTest(ship=ship):
                bad = {**source, ship: 1_000_001}
                with self.assertRaises(ValueError): module.dense_counts(bad)

    def test_malformed_sparse_saved_design_is_not_silently_coerced(self):
        for value in ({}, None, [], {'light_fighter': True}, {'light_fighter': 0}, {'light_fighter': -1},
                      {'light_fighter': 1.5}, {'light_fighter': '6'}, {'light_fighter': float('nan')},
                      {'light_fighter': float('inf')}, {'solar_satellite': 1}, {'rocket_launcher': 1},
                      {'light_fighter': 6, 'unknown': 0}, {'light_fighter': 1_000_000_000_000}):
            with self.subTest(value=value), self.assertRaises(ValueError): module.dense_counts(value)

    def test_deficits_keep_target_and_only_current_landed_inventory(self):
        source = {'light_fighter': 20, 'small_cargo': 4}
        landed = {'light_fighter': 7, 'small_cargo': 5, 'deathstar': 100}
        original = copy.deepcopy([source, landed])
        value = module.expected_deficits(source, landed)
        self.assertEqual(len(value), 13)
        self.assertEqual(next(row for row in value if row['unit'] == 'light_fighter'),
                         {'unit': 'light_fighter', 'target': 20, 'landed': 7, 'deficit': 13})
        self.assertEqual(next(row for row in value if row['unit'] == 'small_cargo')['deficit'], 0)
        self.assertEqual(next(row for row in value if row['unit'] == 'deathstar')['target'], 0)
        self.assertEqual([source, landed], original)
        self.assertEqual(module.dense_counts(source)['light_fighter'], '20')

    def test_invalid_landed_counts_fail_instead_of_turning_into_stock(self):
        for value in (True, -1, 1.5, '7', None, 2**53, float('inf')):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.expected_deficits({'light_fighter': 20}, {'light_fighter': value})

    def test_independent_oracle_adds_only_explicit_saved_formations(self):
        state = {'formations': {'nextFormationId': 1, 'entries': []}, 'npcEconomy': {'now': 31},
                 'randomState': 123, 'nextFleetId': 12, 'planets': [{'resources': {'metal': '10'}}],
                 'research': {'levels': {'weapons_tech': 1}}, 'orders': {'tasks': []}}
        formations = {'nextFormationId': 2, 'entries': [{'id': 1, 'revision': 1, 'name': '天然编成', 'ships': {'light_fighter': 6}}]}
        frozen = copy.deepcopy([state, formations]); expected = copy.deepcopy(state); expected['formations'] = formations
        actual = module.with_formations(state, formations)
        self.assertEqual(actual, expected)
        self.assertEqual([state, formations], frozen)
        actual['formations']['entries'][0]['ships']['light_fighter'] = 99
        self.assertEqual([state, formations], frozen)
        self.assertEqual(module.with_formations(state, None), state)


class NativeContract(unittest.TestCase):
    def test_ci_only_fails_before_browser_import(self):
        self.assertLess(SOURCE.index("if os.environ.get('CI') != 'true'"), SOURCE.index('from playwright.sync_api import'))
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(SCRIPT), '--natural-report', 'unused',
                '--expected-report-sha256', '0' * 64, '--expected-sha', 'a' * 40,
                '--expected-version', '0.6.23-alpha.1', '--runtime-node', 'v22.18.0', '--output', directory],
                env={**os.environ, 'CI': 'false', 'GITHUB_ACTIONS': 'false', 'PYTHONDONTWRITEBYTECODE': '1'},
                capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('CI-only', result.stderr)
            self.assertNotIn('playwright', result.stderr)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_only_named_helpers_load_without_old_runner_or_browser(self):
        module.load_reviewed_helpers()
        for name in ('NativeCheckJournal', 'snap', 'verify_bundle', 'verify_document_response',
                     'native_scroll_to', 'storage_check', 'open_report'):
            self.assertTrue(callable(getattr(module, name)))
        self.assertFalse(hasattr(module, 'browser'))
        self.assertNotIn('playwright', sys.modules)
        self.assertNotIn('main', definition('load_reviewed_helpers'))

    def test_independent_browser_begins_at_exact_genuine_paid31(self):
        text = definition('main')
        for required in ('with sync_playwright() as playwright, live_failure_evidence():',
                         'browser = playwright.chromium.launch(', "boot(fixtures['origin']['raw'])",
                         'replay_natural_formation_route(page)', "captures['run-cancel-reopen-fill-still-unpaid']"):
            self.assertIn(required, text)
        for forbidden in ('page.route(', 'route.fulfill(', 'add_script_tag(', 'window.__game', 'window.gameState',
                          'connect_over_cdp', 'browser.contexts[', 'Profiler.start', 'rehearseNpcScout(',
                          'sendFleet(', 'createFormationReplenishment(', 'force=True', 'scrollIntoView('):
            self.assertNotIn(forbidden, SOURCE)

    def test_unchanged_natural_economic_tape_uses_actual_saved_design_then_real_dispatch(self):
        text = definition('replay_natural_formation_route')
        for required in ("fixtures['tape']", "create_formation(page, NATURAL_FORMATION_NAME, {'light_fighter': 6})",
                         'with_formations(row[\'expected\'], formations)', 'natural_four_widths(page, design, expected)',
                         "trusted_click(page, '#space-send')", "Fraction(operation['expectedFuel'])",
                         "captures['scout13-returned']", "'status': 'executed'"):
            self.assertIn(required, text)
        for forbidden in ('setItem(', "['resources'] =", "['research'] =", "['messages'] =", 'omitted-readonly'):
            self.assertNotIn(forbidden, text)
        self.assertLess(text.index("persist_json('paid-before-'"), text.index("trusted_click(page, '#space-send')"))
        self.assertLess(text.index("persist_json('paid-after-'"), text.index("check('only separate real dispatch"))

    def test_every_save_and_new_ui_mutation_durably_capture_raw_before_assertion(self):
        text = definition('save')
        self.assertLess(text.index('persist_json('), text.index('json.loads('))
        self.assertIn("'raw': saved_raw, 'storage': storage(page)", text)
        for name in ('choose_formation', 'copy_formation', 'create_formation'):
            text = definition(name)
            self.assertIn('persist_json(', text)
            self.assertIn('storage(page)', text)
        text = definition('create_formation')
        self.assertLess(text.index("save-before'"), text.index("trusted_click(page, '#formation-save')"))
        self.assertLess(text.index("save-after'"), text.index('actual = json.loads'))

    def test_four_widths_dense13_geometry_and_readonly_screenshots(self):
        self.assertEqual(module.WIDTHS, (320, 390, 768, 1440))
        text = definition('natural_four_widths')
        for required in ('for width in WIDTHS:', 'for ship in SHIPS:', 'native_input_proof(page, ship,',
                         'native_select_proof(page', 'copy_formation(page', 'inspect_natural_examples(page, width)',
                         "initial_tab='save', visible_tab='messages'", 'whole_state(f\'{width}-read-only-copy-run-fill-entire-game\''):
            self.assertIn(required, text)
        self.assertIn("len(row['points']) == 5", definition('control_proof'))
        self.assertIn('text_leaf_visibility(page', definition('control_proof'))
        helper = (ROOT / 'scripts/browser-scout-rehearsal.py').read_text()
        self.assertIn("caret='initial'", helper)
        self.assertIn('witness[\'before\']==after', helper)
        self.assertNotIn("caret='hide'", SOURCE)


    def test_native_input_value_uses_geometry_and_label_glyphs_never_fake_value_ranges(self):
        text = definition('native_input_proof')
        for required in ('value:e.value', 'type:e.type', "len(row['points']) == 5", 'label_selector',
                         'text_leaf_visibility(page, [label_selector])', 'not native value painting'):
            self.assertIn(required, text)
        self.assertNotIn('text_leaf_visibility(page, [selector])', text)
        self.assertNotIn('control_proof(page, PREFIX + \'ship-\'', definition('natural_four_widths'))
        value = load_runner(); value.load_reviewed_helpers()
        value.evidence = []; value.case = 'offline'
        input_state = {'tag': 'INPUT', 'type': 'number', 'value': '6', 'min': '0', 'max': '1000000000000',
                       'step': '1', 'connected': True, 'unique': True, 'current': True, 'disabled': False}
        class Page:
            def locator(self, selector): return SimpleNamespace(evaluate=lambda _: input_state)
            def evaluate(self, _): return True
        def check(name, passed, detail=None): self.assertTrue(passed, name)
        geometry = {'targets': [{'visible': True, 'contained': True, 'points': [{'unoccluded': True}] * 5}]}
        with patch.object(value, 'native_scroll_to'), patch.object(value, 'visibility', return_value=geometry), \
             patch.object(value, 'text_leaf_visibility', return_value={'leaves': [{'passed': True}]}) as glyphs, \
             patch.object(value, 'check', check):
            value.native_input_proof(Page(), 'light_fighter', '6', 'native-input')
            self.assertEqual(glyphs.call_args.args[1], ['label.space-ship:has(#npc-rehearsal-ship-light_fighter) > span'])
            input_state['value'] = '5'
            with self.assertRaises(AssertionError): value.native_input_proof(Page(), 'light_fighter', '6', 'mutated-value')

    def test_maximum_legal_unbroken_name_has_four_width_source_glyph_evidence(self):
        text = definition('long_name_four_widths')
        for required in ("name = 'W' * 64", 'create_formation(page', 'for width in WIDTHS:',
                         "PREFIX + 'formation-source'", 'native_select_proof(page', 'copy_formation(page', 'e=>e.scrollWidth<=e.clientWidth', 'whole_state('):
            self.assertIn(required, text)
        self.assertIn('long_name_four_widths(natural_raw)', definition('main'))

    def test_closed_native_select_avoids_false_hidden_glyph_claim(self):
        text = definition('native_select_proof')
        self.assertIn('selectedOptions', text); self.assertIn('visibility(page', text)
        self.assertNotIn('text_leaf_visibility', text)
        self.assertIn('snap(page', text)

    def test_selection_keeps_values_but_retires_old_review_and_copy_consumes_choice(self):
        text = definition('choose_formation')
        for required in ('rehearsal_values(page) == before', 'draft_values(page) == draft',
                         'new or repeated explicit selection retires old examples and Fill',
                         "PREFIX + 'results .npc-battle-report'", "PREFIX + 'fill'"):
            self.assertIn(required, text)
        text = definition('natural_four_widths')
        self.assertIn('old_results = ', text)
        self.assertIn("all(row.evaluate('(e)=>!e.isConnected') for row in old_results)", text)
        text = definition('copy_formation')
        self.assertIn('dense_counts(design[\'ships\'])', text)
        self.assertIn("page.locator(PREFIX + 'formation').input_value() == ''", text)
        self.assertIn("page.locator(PREFIX + 'copy').is_disabled()", text)

    def test_unclipped_stock_shortage_and_two_distinct_caps_are_explicit(self):
        text = definition('insufficient_stock_boundaries')
        for required in ('MAX_FORMATION_QUANTITY for ship in SHIPS', 'assert_deficits(page, design, expected)',
                         'MAX_FORMATION_QUANTITY + 1', 'rejects Run without clipping', 'len(wanted) == 13'):
            self.assertIn(required, text)
        text = definition('manual_limit_boundary')
        for required in ('EXPLICIT-SYNTHETIC', "fixtures['branches']['performance']", 'MAX_MANUAL_QUANTITY + 1',
                         '13e12 total', 'syntheticChanges', 'whole_state('):
            self.assertIn(required, text)
        self.assertNotIn('native_clock=True', text)

    def test_native_source_mutations_have_honest_navigation_boundary_and_exact_state_oracle(self):
        text = definition('source_edit_delete_boundaries')
        for required in ("for action in ('edit', 'delete')", "('before-copy', 'after-independent-fill')",
                         'formation_library(page)', 'actual source edit/delete does not rewrite independent ordinary draft',
                         "expected['formations']['entries'][0]['revision'] += 1", "expected['formations']['entries'] = []",
                         'retired_copy(page, original', 'whole_state('):
            self.assertIn(required, text)
        self.assertNotIn('evaluate(', text)

    def test_lifecycle_adversarial_cases_and_real_protection_are_explicit(self):
        text = definition('lifecycle_boundaries')
        for kind in ('cancel', 'escape', 'tab-away', 'cancelled-import', 'same-world-import', 'corrupt-import',
                     'copy-hidden-aba', 'copy-style-aba', 'copy-aria-hidden-aba', 'select-hidden-aba',
                     'option-hidden-aba', 'option-style-aba', 'option-aria-hidden-aba', 'forged-option-value',
                     'same-node-detach', 'same-id-copy-replacement', 'same-id-input-replacement', 'option-clone'):
            self.assertIn(kind, text)
        self.assertIn('if visible and enabled:', definition('retired_copy'))
        self.assertIn("action = 'native-unavailable'", definition('retired_copy'))
        self.assertIn('events == [] if action', definition('retired_copy'))
        text = definition('protection_boundary')
        for required in ("row['trusted'] is True", "row['oldValue'] == before[KEY]", "row['newValue'] == competing_raw",
                         'reload_bound(page)', 'recovery cannot revive', 'whole_state('):
            self.assertIn(required, text)

    def test_scripted_negative_inputs_never_fake_trusted_events(self):
        text = definition('untrusted_boundaries')
        self.assertIn("new Event('change',{bubbles:true})", text)
        self.assertIn('untrusted click cannot consume a genuine trusted source selection', text)
        self.assertIn('consumed copy cannot overwrite independently hand-edited numbers', text)
        for forbidden in ("isTrusted:", "isTrusted=", "'isTrusted'", '"isTrusted"', 'defineProperty(event'):
            self.assertNotIn(forbidden, SOURCE)
        text = definition('atomic_destination_boundary')
        self.assertIn("e.type='file'", text); self.assertIn('EXPLICIT-DOM', text)
        self.assertIn('rehearsal_values(page) == before', text)
        self.assertIn('retired_copy(page, original', text)

    def test_full_identity_http_v8_version_and_four_required_jobs_stay_distinct(self):
        text = definition('source_identity')
        for required in ('HEAD^{tree}', '--porcelain=v1', '--ignored', 'sourceCode', 'sourceModes',
                         'hashlib.sha1', 'source must be an ordinary file', 'scout_fixture_identity(workspace, summary, runtime_node)', 'expected_version != CANDIDATE_VERSION',
                         "identity['identity']['rawSha256']['natural'] != natural_sha256", 'scripts/browser-rehearsal-formation-copy.py'):
            self.assertIn(required, text)
        self.assertIn("release_metadata['version'] == args.expected_version", SOURCE)
        self.assertIn('verify_bundle(page); verify_document_response(response)', SOURCE)
        shared = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        for required in ('Debugger.getScriptSource', 'httpSha256', 'executedSourceSha256', 'releaseSha256'):
            self.assertIn(required, shared)
        self.assertIn('All four independent jobs (verify, verify-continuation, npc-orbital, scout-rehearsal)', SOURCE)
        self.assertIn('required-gates must pass for this exact source SHA', SOURCE)

    def test_bounded_independent_journal_no_timeout_or_success_shortcut(self):
        for required in ('signal.alarm(600)', 'time.monotonic() + 610', 'NativeCheckJournal(journal_path)',
                         "journal.append('seal'", 'recover_native_report', 'matching PID/start time',
                         'hostElapsedSeconds', 'workerBoundSeconds', 'supervisorBoundSeconds'):
            self.assertIn(required, SOURCE)
        for forbidden in ('checks = checks[', 'checks.clear()', 'signal.alarm(900)', 'deadline = time.monotonic() + 910'):
            self.assertNotIn(forbidden, SOURCE)
        self.assertNotIn('sourceCode', definition('metadata'))


class FullSourceMutationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        names = ('scripts/browser-rehearsal-formation-copy.py', 'scripts/test_rehearsal_formation_copy_acceptance.py',
                 'scripts/browser-scout-rehearsal.py', 'scripts/browser-npc-attack.py', 'scripts/scout_fixture_identity.py',
                 'scripts/scout-rehearsal-natural-route.ts', 'tests/fixtures/npc-scout-legacy.json',
                 'package-lock.json', 'src/index.ts', '.github/workflows/verify.yml', 'public/a.txt')
        for name in names:
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('independent offline fixture\n')
        (self.root / 'package.json').write_text(json.dumps({'version': '0.6.23-alpha.1'}))
        (self.root / '.gitignore').write_text('scripts/ignored.py\n')
        def git(*args): return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL)
        self.git = git
        git('init'); git('add', '.')
        git('-c', 'user.name=Offline Contract', '-c', 'user.email=offline@example.invalid', 'commit', '-qm', 'Offline fixture only')
        self.sha = git('rev-parse', 'HEAD').decode().strip()
        self.identity = {'identitySha256': 'b' * 64, 'identity': {'rawSha256': {'natural': 'c' * 64}}}

    def call(self, **overrides):
        args = {'workspace': self.root, 'expected_sha': self.sha, 'expected_version': '0.6.23-alpha.1',
                'runtime_node': 'v22.18.0', 'natural_sha256': 'c' * 64, **overrides}
        with patch.object(module, 'scout_fixture_identity', return_value=self.identity) as identity:
            result = module.source_identity(**args)
            self.assertEqual(identity.call_args.kwargs, {})
            return result

    def test_clean_full_tree_binds_every_file_hash_mode_and_this_runner(self):
        summary, identity, scripts = self.call()
        expected = self.git('ls-files').decode().splitlines()
        self.assertEqual(set(summary['sourceCode']), set(expected))
        self.assertEqual(set(summary['sourceModes']), set(expected))
        for name in expected:
            self.assertEqual(summary['sourceCode'][name], hashlib.sha256((self.root / name).read_bytes()).hexdigest())
        self.assertEqual(summary['sourceSha'], self.sha)
        self.assertEqual(summary['fullTree'], self.git('rev-parse', 'HEAD^{tree}').decode().strip())
        self.assertEqual(identity, self.identity)
        self.assertIn('scripts/browser-rehearsal-formation-copy.py', scripts)

    def test_wrong_commit_version_or_natural_bytes_fail_closed(self):
        for change in ({'expected_sha': 'a' * 40}, {'expected_version': '0.6.22-alpha.2'}, {'natural_sha256': 'd' * 64}):
            with self.subTest(change=change), self.assertRaises(ValueError): self.call(**change)

    def test_tracked_source_edit_fails_even_outside_old_src_only_scope(self):
        path = self.root / '.github/workflows/verify.yml'; path.write_text('changed workflow\n')
        with self.assertRaises(ValueError): self.call()

    def test_untracked_and_ignored_source_cannot_borrow_clean_sha(self):
        for name in ('scripts/untracked.py', 'scripts/ignored.py'):
            with self.subTest(name=name):
                path = self.root / name; path.write_text('not committed')
                try:
                    with self.assertRaises(ValueError): self.call()
                finally: path.unlink()

    def test_skip_worktree_cannot_hide_changed_actual_blob(self):
        self.git('update-index', '--skip-worktree', 'src/index.ts')
        (self.root / 'src/index.ts').write_text('hidden modified blob')
        with self.assertRaisesRegex(ValueError, 'bytes/mode'): self.call()

    def test_unchanged_body_with_hidden_mode_change_fails(self):
        self.git('config', 'core.fileMode', 'false')
        path = self.root / 'src/index.ts'; path.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'bytes/mode'): self.call()

    def test_symlink_source_is_rejected_without_using_target_as_evidence(self):
        self.git('update-index', '--skip-worktree', 'src/index.ts')
        path = self.root / 'src/index.ts'; path.unlink(); path.symlink_to(self.root / 'public/a.txt')
        with self.assertRaisesRegex(ValueError, 'ordinary file'): self.call()


class DurableEvidenceContract(unittest.TestCase):
    def runner(self, root):
        value = load_runner(); value.load_reviewed_helpers()
        value.out = root; value.report_path = root / 'report.json'; value.progress_path = root / 'progress.json'
        value.journal_path = root / 'checks.jsonl'; value.journal = value.NativeCheckJournal(value.journal_path)
        self.addCleanup(os.close, value.journal.fd)
        value.args = SimpleNamespace(expected_sha='a' * 40)
        value.source_tree = 'b' * 40; value.fixture_sha256 = 'c' * 64; value.script_hashes = {}
        value.fixture_identity = {'identitySha256': 'd' * 64}; value.full_source_reference = {'sha256': 'e' * 64}
        value.case = 'offline'; value.failure = None; value.completed = False
        value.checks = []; value.evidence = []; value.source_bindings = []; value.errors = []; value.failed_requests = []
        for name in ('recorded_checks', 'recorded_evidence', 'recorded_sources', 'recorded_errors',
                     'recorded_requests', 'last_progress_at', 'passed_count', 'failed_count'): setattr(value, name, 0)
        return value

    def test_failure_preserves_durable_prefix_before_raising(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.runner(Path(directory)); value.check('passed before failure', True)
            with self.assertRaisesRegex(AssertionError, 'real failure'): value.check('real failure', False, {'raw': 'unmodified bytes'})
            report, metadata = value.replay_native_journal(value.journal_path)
            self.assertEqual([row['passed'] for row in report['checks']], [True, False])
            self.assertEqual(report['checks'][1]['detail'], {'raw': 'unmodified bytes'})
            self.assertIsNone(metadata['error'])

    def test_unsealed_success_snapshot_never_counts_as_native_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.runner(Path(directory)); value.check('offline only', True)
            value.completed = True; value.flush(full=True)
            result = value.recover_native_report(value.journal_path, value.report_path, value.progress_path, True)
            self.assertFalse(result['completed'])
            self.assertFalse(result['recording']['sealedReportVerified'])

    def test_raw_before_assertion_is_persisted_and_hashed(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.runner(Path(directory)); raw = {'before': {'key': 'original raw\n'}, 'after': {'key': 'different raw\n'}}
            reference = value.persist_json('exact/raw', raw)
            path = Path(directory) / reference['file']
            self.assertEqual(json.loads(path.read_bytes()), raw)
            self.assertEqual(reference['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(reference['kind'], 'raw-before-assertion')
            self.assertEqual(value.checks, [])


if __name__ == '__main__': unittest.main()
