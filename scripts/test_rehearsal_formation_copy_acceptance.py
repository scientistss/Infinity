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
from unittest.mock import Mock, patch

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

    def test_exact_paid31_library_is_retained_before_fresh_id_issuance(self):
        wanted = {'nextFormationId': 2, 'entries': [{'id': 1, 'revision': 1,
                  'name': '首轮母星运输护航编队', 'ships': {'small_cargo': 2, 'light_fighter': 1}}]}
        self.assertEqual(module.original_natural_formations(), wanted)
        modified = module.original_natural_formations()
        modified['entries'][0]['ships']['small_cargo'] = 99
        self.assertEqual(module.original_natural_formations(), wanted)
        rows = json.loads((ROOT / 'tests/fixtures/npc-scout-legacy.json').read_text())['rows']
        source = next(row for row in rows if row['id'] == 'r13-empty10-zero-round-loot-delivered')
        self.assertEqual(hashlib.sha256(source['raw'].encode()).hexdigest(),
                         'fae7a73c01fe9dec87d22564023a601e28853a218fc301185ba1a53463a5096b')
        self.assertEqual(json.loads(source['raw'])['state']['formations'], wanted)

    def test_created_natural_design_is_exact_id_two_and_never_array_zero(self):
        original = {'id': 1, 'revision': 1, 'name': '首轮母星运输护航编队',
                    'ships': {'small_cargo': 2, 'light_fighter': 1}}
        new = {'id': 2, 'revision': 1, 'name': '原生护航 <舰&🚀>', 'ships': {'light_fighter': 6}}
        state = {'formations': {'nextFormationId': 3, 'entries': [original, new]}, 'wallet': 'retained'}
        before = copy.deepcopy(state)
        selected = module.natural_copy_design(state)
        self.assertEqual(selected, new)
        selected['ships']['light_fighter'] = 88
        self.assertEqual(state, before)
        mutations = [
            lambda f: f.update(nextFormationId=2),
            lambda f: f['entries'].pop(0),
            lambda f: f['entries'].pop(1),
            lambda f: f['entries'].reverse(),
            lambda f: f['entries'].append(copy.deepcopy(new)),
            lambda f: f['entries'][0]['ships'].update(small_cargo=3),
            lambda f: f['entries'][0].update(id=True),
            lambda f: f['entries'][1].update(id=3),
            lambda f: f['entries'][1].update(revision=2),
            lambda f: f['entries'][1].update(name='different'),
            lambda f: f['entries'][1]['ships'].update(light_fighter=5),
            lambda f: f.update(extra='not in bound source'),
        ]
        for index, mutate in enumerate(mutations):
            bad = copy.deepcopy(before); mutate(bad['formations'])
            with self.subTest(index=index), self.assertRaises(AssertionError):
                module.natural_copy_design(bad)

    def test_natural_lifecycle_cases_resolve_exact_created_design_and_preserve_original(self):
        for name in ('lifecycle_boundaries', 'untrusted_boundaries', 'source_edit_delete_boundaries',
                     'protection_boundary', 'atomic_destination_boundary'):
            text = definition(name)
            self.assertIn('natural_copy_design(', text)
            self.assertNotIn("['entries'][0]", text)
        route = definition('replay_natural_formation_route')
        self.assertLess(route.index('original_natural_formations()'), route.index('create_formation(page'))
        self.assertIn("created_actual = json.loads(raw(page))['state']", route)
        self.assertIn('natural_copy_design(created_actual) == design', route)
        untrusted = definition('untrusted_boundaries')
        self.assertNotIn('e.options[1]', untrusted)
        for required in ("if option['text'] == label", 'len(matches) == 1', "matches[0]['value']"):
            self.assertIn(required, untrusted)

    def test_edit_and_delete_preserve_prior_design_and_all_other_game_fields(self):
        original = {'id': 1, 'revision': 1, 'name': '首轮母星运输护航编队',
                    'ships': {'small_cargo': 2, 'light_fighter': 1}}
        design = {'id': 2, 'revision': 1, 'name': '原生护航 <舰&🚀>', 'ships': {'light_fighter': 6}}
        baseline = {'formations': {'nextFormationId': 3, 'entries': [original, design]},
                    'wallet': {'metal': '123.5'}, 'nextFleetId': 12, 'orders': {'tasks': [{'id': 9}]}}
        frozen = copy.deepcopy(baseline)
        edited = copy.deepcopy(baseline)
        edited['formations']['entries'][1] = {'id': 2, 'revision': 2,
            'name': '原生护航 <舰&🚀>', 'ships': {'light_fighter': 5}}
        deleted = copy.deepcopy(baseline)
        deleted['formations']['entries'] = [copy.deepcopy(original)]
        self.assertEqual(module.natural_source_change_expected(baseline, design, 'edit'), edited)
        self.assertEqual(module.natural_source_change_expected(baseline, design, 'delete'), deleted)
        self.assertEqual(baseline, frozen)
        with self.assertRaises(AssertionError): module.natural_source_change_expected(baseline, original, 'delete')
        with self.assertRaises(AssertionError): module.natural_source_change_expected(baseline, design, 'clear')


class NativeContract(unittest.TestCase):
    def test_ci_only_fails_before_browser_import(self):
        self.assertLess(SOURCE.index("if os.environ.get('CI') != 'true'"), SOURCE.index('from playwright.sync_api import'))
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(SCRIPT), '--natural-report', 'unused',
                '--expected-report-sha256', '0' * 64, '--expected-sha', 'a' * 40,
                '--expected-version', '0.6.24-alpha.1', '--runtime-node', 'v22.18.0', '--output', directory],
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
                         'natural_source_change_expected(baseline, design, action)',
                         'retired_copy(page, original', 'whole_state('):
            self.assertIn(required, text)
        self.assertNotIn('evaluate(', text)
        for required in ("edited['revision'] += 1", "if row['id'] == design['id']", "if row['id'] != design['id']"):
            self.assertIn(required, definition('natural_source_change_expected'))

    def test_lifecycle_adversarial_cases_and_real_protection_are_explicit(self):
        text = definition('lifecycle_boundaries')
        for kind in ('cancel', 'escape', 'tab-away', 'cancelled-import', 'same-world-import', 'corrupt-import',
                     'copy-hidden-aba', 'copy-style-aba', 'copy-aria-hidden-aba', 'select-hidden-aba',
                     'option-hidden-aba', 'option-style-aba', 'option-aria-hidden-aba', 'forged-option-value',
                     'same-node-detach', 'same-id-copy-replacement', 'same-id-input-replacement', 'option-clone'):
            self.assertIn(kind, text)
        for required in ('identity = original.evaluate(', 'sameNode:e===replacement',
                         'originalConnected:e.isConnected', 'replacementConnected:replacement.isConnected',
                         "identity['sameNode'] is False and identity['originalConnected'] is False",
                         "identity['replacementConnected'] is True and identity['replacementIsCurrent'] is True",
                         "identity['originalId'] == identity['replacementId'] == 'npc-rehearsal-copy'",
                         "identity['sameIdCount'] == 1", "retired_copy(page, replacement, 'forged same-ID replacement')",
                         "condition=draft_values(page) == draft", "save(page), baseline"):
            self.assertIn(required, text)
        retired = definition('retired_copy')
        for required in ('control = original.evaluate(', 'connected:e.isConnected',
                         "style.visibility==='visible'&&rect.width>0&&rect.height>0",
                         "enabled:!e.matches(':disabled')", 'if connected and visible and enabled:',
                         "action = 'native-unavailable'", 'original.click(timeout=2000)',
                         'events == [] if action', "events[0]['trusted'] is True"):
            self.assertIn(required, retired)
        for forbidden in ('.is_enabled(', '.is_visible(', '.element_handle(', 'force=', 'except ',
                          'document.querySelector', 'document.getElementById'):
            self.assertNotIn(forbidden, retired)
        self.assertLess(retired.index('retired-copy-before-'), retired.index('original.click('))
        # Offline doubles deliberately do not expose Playwright state methods or
        # a same-ID lookup. This executes Python control flow, not browser JS.
        value = load_runner(); value.load_reviewed_helpers(); value.checks = []
        def exercise(control, effect=None):
            live = {'values': {ship: '0' for ship in value.SHIPS}, 'draft': {'ships': ['unchanged']},
                    'results': 0, 'fillDisabled': True, 'events': []}
            persisted = []
            def native_click(*, timeout):
                self.assertEqual(timeout, 2000)
                live['events'].append({'trusted': True, 'id': 'npc-rehearsal-copy'})
                if effect == 'values': live['values']['light_fighter'] = '6'
                elif effect == 'draft': live['draft']['ships'] = ['changed']
                elif effect == 'results': live['results'] = 3
                elif effect == 'fill': live['fillDisabled'] = False
                elif effect == 'untrusted': live['events'][0]['trusted'] = False
                elif effect == 'missing-event': live['events'].clear()
                elif effect == 'duplicate-event': live['events'] *= 2
                elif effect == 'click-error': raise RuntimeError('native actionability failure')
            original = SimpleNamespace(evaluate=Mock(return_value=control), click=Mock(side_effect=native_click))
            if effect == 'read-error': original.evaluate.side_effect = RuntimeError('handle read failure')
            def evaluate(expression, *args):
                if expression == 'window.__npcClicks.length': return len(live['events'])
                self.assertEqual(expression, '(n)=>window.__npcClicks.slice(n)')
                return live['events'][args[0]:]
            def locator(selector):
                if selector == value.PREFIX + 'results .npc-battle-report':
                    return SimpleNamespace(count=lambda: live['results'])
                self.assertEqual(selector, value.PREFIX + 'fill')
                return SimpleNamespace(is_disabled=lambda: live['fillDisabled'])
            page = SimpleNamespace(evaluate=evaluate, locator=locator)
            def persist(label, data):
                persisted.append((label, copy.deepcopy(data))); return {'file': label}
            def check(name, passed, detail=None): self.assertTrue(passed, name)
            with patch.object(value, 'rehearsal_values', side_effect=lambda _: copy.deepcopy(live['values'])), \
                 patch.object(value, 'draft_values', side_effect=lambda _: copy.deepcopy(live['draft'])), \
                 patch.object(value, 'storage', return_value={'complete': 'unchanged bytes'}), \
                 patch.object(value, 'persist_json', side_effect=persist), patch.object(value, 'check', check), \
                 patch.object(value, 'advance') as advance:
                value.retired_copy(page, original, 'offline-exact-handle')
                original.evaluate.assert_called_once()
                actionable = all(control[key] for key in ('connected', 'visible', 'enabled'))
                self.assertEqual(original.click.call_count, int(actionable))
                self.assertEqual(advance.call_count, int(actionable))
                self.assertEqual(persisted[0][1]['control'], control)
                witness = persisted[-1][1]
                self.assertEqual(witness['control'], control)
                self.assertEqual(witness['action'], 'actual-native-click' if actionable else 'native-unavailable')
                self.assertEqual(witness['beforeValues'], witness['afterValues'])
                self.assertEqual(witness['beforeDraft'], witness['afterDraft'])
                self.assertEqual(witness['storage'], {'complete': 'unchanged bytes'})
                self.assertEqual(witness['events'], live['events'] if actionable else [])
        for connected in (False, True):
            for visible in (False, True):
                for enabled in (False, True):
                    control = {'connected': connected, 'visible': visible, 'enabled': enabled}
                    with self.subTest(control=control): exercise(control)
        actionable = {'connected': True, 'visible': True, 'enabled': True}
        for effect in ('values', 'draft', 'results', 'fill', 'untrusted', 'missing-event', 'duplicate-event'):
            with self.subTest(effect=effect), self.assertRaises(AssertionError): exercise(actionable, effect)
        for effect in ('click-error', 'read-error'):
            with self.subTest(effect=effect), self.assertRaises(RuntimeError): exercise(actionable, effect)
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
        (self.root / 'package.json').write_text(json.dumps({'version': '0.6.24-alpha.1'}))
        (self.root / '.gitignore').write_text('scripts/ignored.py\n')
        def git(*args): return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL)
        self.git = git
        git('init'); git('add', '.')
        git('-c', 'user.name=Offline Contract', '-c', 'user.email=offline@example.invalid', 'commit', '-qm', 'Offline fixture only')
        self.sha = git('rev-parse', 'HEAD').decode().strip()
        self.identity = {'identitySha256': 'b' * 64, 'identity': {'rawSha256': {'natural': 'c' * 64}}}

    def call(self, **overrides):
        args = {'workspace': self.root, 'expected_sha': self.sha, 'expected_version': '0.6.24-alpha.1',
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
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); value = self.runner(root); events = []
            original = value.persist_json('formation-3-save-after', {'original': 'retained'})
            original_path = root / original['file']; original_bytes = original_path.read_bytes()
            class Page:
                def content(self): events.append('html'); raise RuntimeError('HTML unavailable')
                def screenshot(self, *, timeout, caret):
                    events.append('screenshot')
                    self_test.assertEqual((timeout, caret), (2000, 'initial'))
                    return b'offline-png-stub'
            self_test = self; value.active_page = Page()
            def storage(_): events.append('storage'); return {'all': 'unmodified failure raw\n'}
            with patch.object(value, 'storage', storage):
                for _ in range(2):
                    frozen = {path: path.read_bytes() for path in root.rglob('*') if path.is_file()
                              and path not in (value.report_path, value.progress_path, value.journal_path)}
                    with self.assertRaises(FileExistsError):
                        with value.live_failure_evidence():
                            value.persist_json('formation-3-save-after', {'replacement': 'must fail'})
                    for path, body in frozen.items(): self.assertEqual(path.read_bytes(), body)
            self.assertEqual(events, ['storage', 'html', 'screenshot'] * 2)
            self.assertEqual(original_path.read_bytes(), original_bytes)
            captures = [row for row in value.evidence if row.get('kind') == 'live-failure-capture']
            self.assertEqual(len(captures), 2)
            self.assertNotEqual(captures[0]['file'], captures[1]['file'])
            for row in captures:
                record = json.loads((root / row['file']).read_bytes())
                self.assertEqual(record, row['capture'])
                self.assertEqual([item['status'] for item in record['captures']], ['captured', 'failed', 'captured'])
                self.assertIn('HTML unavailable', record['captures'][1]['error'])
                self.assertEqual(json.loads((root / record['captures'][0]['file']).read_bytes()), {'all': 'unmodified failure raw\n'})
            report = json.loads(value.report_path.read_bytes())
            value.verify_file_references(report)
            self.assertFalse(report['completed']); self.assertIn('FileExistsError', report['failure'])
            self.assertIsNone(value.replay_native_journal(value.journal_path)[1]['seal'])
            with patch.object(value, 'capture_live_failure', side_effect=RuntimeError('diagnostics unavailable')):
                with self.assertRaisesRegex(AssertionError, 'primary failure'):
                    with value.live_failure_evidence(): raise AssertionError('primary failure')
            report = json.loads(value.report_path.read_bytes())
            self.assertIn('primary failure', report['failure'])
            self.assertEqual(report['evidence'][-1]['kind'], 'live-failure-capture-error')
            self.assertIn('diagnostics unavailable', report['evidence'][-1]['error'])
        for previous, elapsed, restored in ((20, .5, 19.5), (.25, .5, .001)):
            with self.subTest(worker_timer=previous), tempfile.TemporaryDirectory() as directory:
                value = self.runner(Path(directory))
                page = SimpleNamespace(content=lambda: '<html>offline</html>', screenshot=lambda **_: b'offline-png-stub')
                with patch.object(value, 'storage', return_value={'exact': 'raw'}), \
                     patch.object(value.signal, 'signal'), patch.object(value.signal, 'setitimer') as timer, \
                     patch.object(value.signal, 'getitimer', return_value=(previous, 0)), \
                     patch.object(value.time, 'monotonic', side_effect=[100, 100 + elapsed]):
                    captured = value.capture_live_failure(page)
                self.assertEqual(timer.call_args_list[0].args, (value.signal.ITIMER_REAL, min(6, previous)))
                self.assertEqual(timer.call_args_list[-1].args, (value.signal.ITIMER_REAL, restored, 0))
                self.assertEqual(captured['workerDeadlineElapsedDuringCapture'], elapsed >= previous)
        with tempfile.TemporaryDirectory() as directory:
            value = self.runner(Path(directory)); handler = None
            def set_handler(_signal, callback):
                nonlocal handler
                handler = callback
            def expired_storage(_): handler(None, None)
            with patch.object(value, 'storage', expired_storage), patch.object(value.signal, 'signal', set_handler), \
                 patch.object(value.signal, 'setitimer') as timer, patch.object(value.signal, 'getitimer', return_value=(0, 0)):
                captured = value.capture_live_failure(object())
            self.assertEqual(timer.call_args_list[0].args, (value.signal.ITIMER_REAL, 6))
            self.assertTrue(captured['boundExpired'])
            self.assertEqual([row['status'] for row in captured['captures']], ['failed', 'not-attempted', 'not-attempted'])
            self.assertIn('Six-second', captured['captures'][0]['error'])

    def test_unsealed_success_snapshot_never_counts_as_native_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.runner(Path(directory)); value.check('offline only', True)
            value.completed = True; value.flush(full=True)
            result = value.recover_native_report(value.journal_path, value.report_path, value.progress_path, True)
            self.assertFalse(result['completed'])
            self.assertFalse(result['recording']['sealedReportVerified'])
        for target in ('evidence', 'check-before', 'check-after', 'full-source', 'source-binding'):
            for mutation in ('missing', 'changed', 'wrong-hash', 'symlink', 'parent-path'):
                with self.subTest(target=target, mutation=mutation), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory); value = self.runner(root); value.active_page = None
                    reference = value.persist_json('exact-original', {'exact': 'bytes'})
                    # Keep the reference exclusively at this depth, so another
                    # top-level copy cannot hide a broken recursive traversal.
                    nested = copy.deepcopy(reference)
                    value.evidence.clear(); value.recorded_evidence = 0
                    if target == 'evidence': value.evidence.append({'before': {'after': [nested]}})
                    elif target.startswith('check-'):
                        value.check('nested reference must verify', True, {target[6:]: [nested]})
                    elif target == 'full-source': value.full_source_reference = nested
                    else: value.source_bindings.append({'before': {'after': [nested]}})
                    path = root / reference['file']
                    if mutation == 'missing': path.unlink()
                    elif mutation == 'changed': path.write_bytes(b'overwritten bytes')
                    elif mutation == 'wrong-hash': nested['sha256'] = '0' * 64
                    elif mutation == 'symlink':
                        actual = root / 'untouched-original.json'; path.rename(actual); path.symlink_to(actual)
                    else: nested['file'] = '../outside.json'
                    with self.assertRaisesRegex(ValueError, 'artifact reference'):
                        with value.live_failure_evidence():
                            value.completed = True; value.flush(full=True, final=True)
                    report = json.loads(value.report_path.read_bytes())
                    self.assertFalse(value.completed); self.assertFalse(report['completed'])
                    self.assertIn('artifact reference', report['failure'])
                    self.assertIsNone(value.replay_native_journal(value.journal_path)[1]['seal'])
                    self.assertFalse(value.recover_native_report(value.journal_path, value.report_path, value.progress_path, True)['completed'])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); value = self.runner(root)
            reference = value.persist_json('exact-original', {'all': 'complete bytes'})
            value.check('same original may be referenced repeatedly', True, {'before': reference, 'after': [reference]})
            value.full_source_reference = reference
            value.completed = True; value.flush(full=True, final=True)
            result = value.recover_native_report(value.journal_path, value.report_path, value.progress_path, True)
            self.assertTrue(result['completed']); self.assertTrue(result['recording']['sealedReportVerified'])

    def test_raw_before_assertion_is_persisted_and_hashed(self):
        with tempfile.TemporaryDirectory() as directory:
            value = self.runner(Path(directory)); raw = {'before': {'key': 'original raw\n'}, 'after': {'key': 'different raw\n'}}
            reference = value.persist_json('exact/raw', raw)
            path = Path(directory) / reference['file']
            self.assertEqual(json.loads(path.read_bytes()), raw)
            self.assertEqual(reference['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(reference['kind'], 'raw-before-assertion')
            self.assertEqual(value.checks, [])
            self.assertEqual(reference['file'], 'offline/exact-raw.json')
            frozen = path.read_bytes(); inode = path.stat().st_ino
            for label in ('exact/raw', 'exact-raw'):
                with self.subTest(collision=label), self.assertRaises(FileExistsError):
                    value.persist_json(label, {'overwrites': 'forbidden even after sanitization'})
                self.assertEqual(path.read_bytes(), frozen); self.assertEqual(path.stat().st_ino, inode)
                self.assertEqual(len(value.evidence), 1)
            # Both native branches deliberately issue ID 3 from the same world.
            # Their pre-save bytes may match; their post-save bytes must coexist.
            references = []
            for case, state in (
                ('natural-saved-1e6-targets-remain-unclipped-stock-shortage', {'ships': {ship: 1_000_000 for ship in module.SHIPS}}),
                ('actual-native-64-codepoint-unbroken-source-name', {'name': 'W' * 64, 'ships': {'light_fighter': 6}}),
            ):
                value.begin_case(case)
                for phase, data in (('before', {'same': 'original raw'}), ('after', state)):
                    references.append(value.persist_json('formation-3-save-' + phase, data))
            self.assertEqual(len({row['file'] for row in references}), 4)
            self.assertEqual(references[0]['sha256'], references[2]['sha256'])
            self.assertNotEqual(references[1]['sha256'], references[3]['sha256'])
            value.verify_file_references({'references': references})
            for bad_case in ('../escape', 'lossy/case', 'lossy.case', '', 'a' * 101):
                value.case = bad_case
                with self.subTest(case=bad_case), self.assertRaises(ValueError): value.persist_json('unused', {})
            value.case = 'offline'
            # The competing writer creates the destination only at publication:
            # an exists()-then-replace implementation would lose these bytes.
            racing = Path(directory) / 'offline' / 'raced.json'
            real_link = os.link
            def publish_competitor(source, destination):
                destination.write_bytes(b'concurrent original')
                return real_link(source, destination)
            with patch.object(value.os, 'link', publish_competitor), self.assertRaises(FileExistsError):
                value.persist_json('raced', {'replacement': 'forbidden'})
            self.assertEqual(racing.read_bytes(), b'concurrent original')
            with patch.object(value.os, 'fsync', side_effect=OSError('durability failed')), self.assertRaises(OSError):
                value.persist_json('failed-fsync', {})
            self.assertFalse((Path(directory) / 'offline' / 'failed-fsync.json').exists())
            self.assertEqual(list(Path(directory).rglob('.evidence-*.tmp')), [])


if __name__ == '__main__': unittest.main()
