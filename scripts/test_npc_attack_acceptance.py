"""Python-only static/geometry preflight. No Node, browser or native evidence claim."""
import ast
import copy
import math
import json
import unittest
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class AttackAcceptanceContract(unittest.TestCase):
    def test_native_script_compiles_without_executing_browser(self):
        ast.parse((ROOT / 'scripts/browser-npc-attack.py').read_text())

    def test_native_suite_is_ci_only_and_exact_source_bound(self):
        source = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        for text in ("os.environ.get('CI') != 'true'", "os.environ.get('GITHUB_ACTIONS') != 'true'",
                     'Debugger.getScriptSource', 'httpSha256', 'expected_report_sha256',
                     '047d49cbf04fd5424bca4d7d45e861e0439a0d51c4ac54700f77e263bb8eadcc',
                     "source_report['source']['sourceScopeStatusPorcelain'] == ''",
                     "source_report['outcome']['status'] == 'passed'"):
            self.assertIn(text, source)
        for forbidden in ('add_script_tag(', 'page.route(', 'route.fulfill(', 'window.__game', 'window.gameState'):
            self.assertNotIn(forbidden, source)

    def test_natural_candidate_has_no_economic_patch_or_combat_oracle_import(self):
        source = (ROOT / 'scripts/npc-attack-natural-route.ts').read_text()
        for line in source.splitlines():
            if line.startswith('import '):
                self.assertNotIn('npc-battle"', line)
                self.assertNotIn('npc-loot"', line)
                self.assertNotIn('encounter-combat', line)
                self.assertNotIn('npc-wallet"', line)
                self.assertNotIn('npc-remainder"', line)
        for forbidden in ('state.npcEconomy =', 'state.research.levels.', 'state.planets[0].resources =', 'activePlanet(state).resources ='):
            self.assertNotIn(forbidden, source)
        self.assertIn('const sourceState = state', source)
        self.assertIn('serializeState(sourceState), before', source)
        self.assertIn('shadowState()', source)
        self.assertIn('ordinary natural loot must dock without a representational retry lottery', source)

    def test_literal_golden_loss_and_win_are_both_meaningful(self):
        fixture = json.loads((ROOT / 'tests/fixtures/npc-attack-independent-goldens.json').read_text())
        draw, win = fixture['draw7'], fixture['win8']
        self.assertEqual((draw['winner'], len(draw['rounds']), draw['attackerAfter'], draw['defenderAfter']),
                         ('draw', 6, {'light_fighter': 3}, {'light_fighter': 2}))
        self.assertEqual((win['winner'], len(win['rounds']), win['attackerAfter'], win['defenderAfter']),
                         ('attacker', 3, {'light_fighter': 6}, {}))
        self.assertEqual([r['round'] for r in draw['rounds']], list(range(1, 7)))
        self.assertTrue(all(r['attackDamage'] > 0 and r['defendDamage'] > 0 for r in draw['rounds']))

    def test_remainder_goldens_obey_an_independent_exact_fraction_equation(self):
        fixture = json.loads((ROOT / 'tests/fixtures/npc-attack-independent-goldens.json').read_text())
        for row in fixture['remainderGoldens']:
            source, prior = Fraction(row['source']), Fraction(row['prior'])
            movement = row['signedInteger']
            if row['wallet'] is None:
                self.assertLess(source, -movement)
                continue
            wallet, pending = Fraction(row['wallet']), Fraction(row['remainder'])
            self.assertEqual(source + prior + movement - wallet - pending, 0, row['name'])
            self.assertGreaterEqual(pending, 0)
            self.assertLess(pending, 1)
            self.assertLessEqual(wallet, source + prior + movement)
        source = (ROOT / 'scripts/npc-attack-natural-route.ts').read_text()
        self.assertIn('const GRID = 10n ** 256n', source)
        self.assertIn('NPC signed five-term exact conservation', source)
        self.assertIn('legacy paid action preserves every per-planet right', source)
        self.assertNotIn('ordinary-precision-wait-', source)

    def test_native_has_actual_interaction_and_boundary_witnesses(self):
        source = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        for text in ('native_tape(page)', '(320, 390, 768, 1440)', 'cargo_draft_witness', 'inspect_reports',
                     'same_time_boundaries', 'recall_and_offline', 'old_node_witnesses', 'storage_faults',
                     'cross_tab', 'remainder_reset_boundaries', 'blocked_retry_boundary', 'exact_confirmation', 'elementFromPoint', 'set_input_files', 'Storage.prototype.setItem',
                     'native-recalled-return', 'native-offline-second-startup', 'same-seed-same-ids-world-replacement'):
            self.assertIn(text, source)


    def test_synthetic_boundaries_are_explicit_and_natural_sequence_is_fixed(self):
        source = (ROOT / 'scripts/npc-attack-natural-route.ts').read_text()
        for text in ('EXPLICIT SYNTHETIC BOUNDARY', 'syntheticChanges:', 'mainComplete = true',
                     'unchanged natural action/time sequence finishes at31 seconds',
                     'curvature entire state equals pinned old evaluator',
                     'abandonment removes only owned colony/offers',
                     'second retry is all-state no-op', 'five-term pair'):
            self.assertIn(text, source)
        self.assertLess(source.index('mainComplete = true'), source.index('syntheticColony.npcResourceRemainder.metal ='))
        native = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        for text in ('curvature-cancel-retains-complete-earned-state', 'abandon-cancel-preserves-every-field',
                     'failed-retry-keeps-ship-cargo-right-report-once', 'retired-retry-node-cannot-credit-twice'):
            self.assertIn(text, native)



class NativeScrollGeometryContract(unittest.TestCase):
    """Offline geometry and input sequencing, never substitutes for native CI."""

    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        tree = ast.parse(cls.source)
        names = {'scroll_region_plan', 'horizontal_wheel_proven', 'native_horizontal_to'}
        selected = ast.Module(body=[node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[])
        cls.functions = {'math': math}
        exec(compile(selected, '<offline-native-scroll-functions>', 'exec'), cls.functions)

    def state(self, width=320, top=940, bottom=1800, target_x=692.53125, target_y=960, scroll_left=0):
        def rect(x, y, right, bottom):
            return {'x': x, 'y': y, 'right': right, 'bottom': bottom,
                    'width': right - x, 'height': bottom - y}
        return {'viewport': {'width': width, 'height': 1100, 'top': 0}, 'scrollX': 0, 'scrollY': 107, 'clips': [],
            'region': {'rect': rect(20, top, width - 20, bottom),
                'clientRect': rect(20, top, width - 20, bottom), 'index': 3,
                'scrollLeft': scroll_left, 'scrollWidth': max(750, width - 40), 'clientWidth': width - 40,
                'scrollTop': 0, 'scrollHeight': bottom - top, 'clientHeight': bottom - top},
            'target': {'rect': rect(target_x, target_y, target_x + 48.515625, target_y + 32), 'insideRegion': True}}

    def plan(self, state):
        return self.functions['scroll_region_plan'](state)

    def test_region_top_above_900_uses_real_visible_intersection(self):
        state = self.state(top=952.375, target_y=1327.125)
        plan = self.plan(state)
        self.assertTrue(plan['points'])
        self.assertTrue(all(952.375 < point['y'] < 1100 for point in plan['points']))
        self.assertFalse(plan['targetContainedY'])
        self.assertGreater(plan['deltaY'], 0)
        self.assertEqual(plan['deltaX'], 442)

    def test_partial_bottom_and_top_fragments_do_not_require_tall_region_to_fit(self):
        for top, bottom, target_y in [(1070, 3070, 1075), (-1900, 60, 10)]:
            with self.subTest(top=top):
                state = self.state(top=top, bottom=bottom, target_y=target_y)
                self.assertGreater(state['region']['rect']['height'], 1100)
                plan = self.plan(state)
                self.assertTrue(plan['points'])
                self.assertTrue(plan['targetFitsY'])
                for point in plan['points']:
                    self.assertTrue(max(0, top) < point['y'] < min(1100, bottom))

    def test_wholly_offscreen_region_has_no_horizontal_pointer_and_needs_vertical_input(self):
        for top, bottom, target_y, direction in [(1200, 3000, 1400, 1), (-2000, -10, -60, -1)]:
            with self.subTest(top=top):
                plan = self.plan(self.state(top=top, bottom=bottom, target_y=target_y))
                self.assertEqual(plan['points'], [])
                self.assertFalse(plan['targetContainedY'])
                self.assertGreater(plan['deltaY'] * direction, 0)

    def test_all_original_widths_and_both_horizontal_directions(self):
        for width in (320, 390, 768, 1440):
            for direction in (-1, 1):
                with self.subTest(width=width, direction=direction):
                    x = -60 if direction < 0 else width + 30
                    plan = self.plan(self.state(width=width, target_x=x))
                    self.assertGreater(plan['deltaX'] * direction, 0)
                    self.assertTrue(plan['targetFitsX'])
                    self.assertTrue(plan['targetContainedY'])
                    self.assertTrue(all(20 < point['x'] < width - 20 for point in plan['points']))

    def test_clipping_ancestors_constrain_points_and_target_width(self):
        state = self.state()
        state['clips'] = [{'rect': {'x': 80, 'y': 985, 'right': 210, 'bottom': 1025}, 'clipX': True, 'clipY': True}]
        plan = self.plan(state)
        self.assertEqual(plan['clip'], {'x': 80, 'y': 985, 'right': 210, 'bottom': 1025})
        self.assertTrue(all(80 < point['x'] < 210 and 985 < point['y'] < 1025 for point in plan['points']))
        state['clips'][0]['rect']['right'] = 100
        self.assertFalse(self.plan(state)['targetFitsX'])

    def test_actual_edge_containment_has_no_new_padding_threshold(self):
        state = self.state(target_x=20, target_y=940)
        state['target']['rect'].update(width=280, right=300)
        plan = self.plan(state)
        self.assertTrue(plan['targetFitsX'])
        self.assertTrue(plan['targetContainedX'])
        self.assertTrue(plan['targetContainedY'])
        self.assertEqual(plan['deltaX'], 0)

    def test_subpixel_wheel_delta_is_rounded_outward_without_padding(self):
        state = self.state(target_x=251.5)
        self.assertEqual(self.plan(state)['deltaX'], 1)
        state['target']['rect'].update(x=19.75, right=68.265625)
        self.assertEqual(self.plan(state)['deltaX'], -1)

    def wheel_fixture(self, direction=1):
        before = self.state(target_x=692.53125 if direction > 0 else -60, scroll_left=0 if direction > 0 else 500)
        after = copy.deepcopy(before)
        delta = self.plan(before)['deltaX']
        after['region']['scrollLeft'] += delta
        after['target']['rect']['x'] -= delta
        after['target']['rect']['right'] -= delta
        point = {**self.plan(before)['points'][0], 'insideRegion': True}
        event = {'trusted': True, 'deltaX': delta, 'deltaY': 0, 'clientX': point['x'], 'clientY': point['y'],
                 'scrollRegion': {'index': 3, 'targetContained': True}}
        return before, after, point, delta, [event]

    def test_wheel_proof_requires_real_directional_progress_and_actual_event_target(self):
        prove = self.functions['horizontal_wheel_proven']
        for direction in (-1, 1):
            self.assertTrue(prove(*self.wheel_fixture(direction)))
        for mutation in ('wrong_hit', 'outside_clip', 'no_progress', 'reverse_progress', 'unmoved_target',
                         'wrong_container', 'no_container', 'not_contained', 'untrusted', 'wrong_x', 'wrong_y', 'wrong_delta', 'no_event'):
            before, after, point, delta, events = self.wheel_fixture()
            with self.subTest(mutation=mutation):
                if mutation == 'wrong_hit': point['insideRegion'] = False
                elif mutation == 'outside_clip': point['y'] = 900
                elif mutation == 'no_progress': after['region']['scrollLeft'] = before['region']['scrollLeft']
                elif mutation == 'reverse_progress': after['region']['scrollLeft'] = before['region']['scrollLeft'] - delta
                elif mutation == 'unmoved_target': after['target'] = copy.deepcopy(before['target'])
                elif mutation == 'wrong_container': events[0]['scrollRegion']['index'] = 2
                elif mutation == 'no_container': events[0]['scrollRegion'] = None
                elif mutation == 'not_contained': events[0]['scrollRegion']['targetContained'] = False
                elif mutation == 'untrusted': events[0]['trusted'] = False
                elif mutation == 'wrong_x': events[0]['clientX'] += 1
                elif mutation == 'wrong_y': events[0]['clientY'] += 1
                elif mutation == 'wrong_delta': events[0]['deltaX'] = -delta
                elif mutation == 'no_event': events.clear()
                self.assertFalse(prove(before, after, point, delta, events))

    def run_offline_preparation(self, state, occluded=False, no_progress=False, wrong_event=False, settle_failure=False):
        state = copy.deepcopy(state)
        saved, audits, events, moves, wheels, waits = [], [], [], [], [], []
        scope = dict(self.functions)
        # Rebind the actual helper's globals to read-only Python fixtures. This
        # exercises the shipped decision/input order without executing any JS.
        tree = ast.parse(self.source)
        selected = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)
            and node.name == 'native_horizontal_to'], type_ignores=[])
        def persist(): saved.append(copy.deepcopy(audits))
        def check(name, passed, detail=None):
            if not passed:
                self.assertEqual(saved[-1], audits, 'raw audit must already be persisted before failure')
                raise AssertionError(name)
        def hit(_page, _region, points):
            return [{**point, 'insideRegion': not occluded, 'hit': {'tag': 'ASIDE' if occluded else 'TD'}} for point in points]
        def visible(_page, _selectors):
            plan = self.plan(state)
            return {'targets': [{'visible': True, 'contained': plan['targetContainedX'] and plan['targetContainedY'],
                'points': [{'unoccluded': not occluded} for _ in range(5)]}]}
        def wait(_page, _target, _region):
            waits.append(copy.deepcopy(state))
            if settle_failure and wheels:
                raise AssertionError('synthetic native settle failure')
        class Mouse:
            def move(_self, x, y): moves.append({'x': x, 'y': y})
            def wheel(_self, x, y):
                wheels.append((x, y))
                events.append({'trusted': True, 'deltaX': x, 'deltaY': y,
                    'clientX': moves[-1]['x'], 'clientY': moves[-1]['y'],
                    'scrollRegion': None if wrong_event else {'index': 3, 'targetContained': True}})
                if no_progress: return
                state['region']['scrollLeft'] += x
                state['scrollY'] += y
                for key in ('x', 'right'): state['target']['rect'][key] -= x
                for key in ('y', 'bottom'):
                    state['target']['rect'][key] -= y
                    state['region']['rect'][key] -= y
                    state['region']['clientRect'][key] -= y
        class Page:
            mouse = Mouse()
            def evaluate(_self, source, start=None):
                return len(events) if start is None else copy.deepcopy(events[start:])
        scope.update(case='offline synthetic geometry', evidence=audits, flush=persist, check=check,
            wait_for_scroll_settled=wait, scroll_region_state=lambda *_: copy.deepcopy(state),
            scroll_pointer_hits=hit, visibility=visible)
        exec(compile(selected, '<offline-native-scroll-sequence>', 'exec'), scope)
        error = None
        try: scope['native_horizontal_to'](Page(), '.space-table-scroll', '[original-action]')
        except AssertionError as failure: error = str(failure)
        return {'error': error, 'wheels': wheels, 'saved': saved, 'audits': audits, 'waits': waits}

    def test_wholly_offscreen_tall_table_is_vertically_prepared_before_horizontal_wheel(self):
        result = self.run_offline_preparation(self.state(top=1200, bottom=3000, target_y=1510))
        self.assertIsNone(result['error'])
        self.assertEqual(len(result['wheels']), 2)
        self.assertEqual(result['wheels'][0][0], 0)
        self.assertGreater(result['wheels'][0][1], 0)
        self.assertGreater(result['wheels'][1][0], 0)
        self.assertEqual(result['wheels'][1][1], 0)
        self.assertEqual(len(result['waits']), 3)

    def test_offline_input_sequence_supports_both_directions_at_every_original_width(self):
        for width in (320, 390, 768, 1440):
            for direction in (-1, 1):
                with self.subTest(width=width, direction=direction):
                    state = self.state(width=width, target_x=-60 if direction < 0 else width + 30,
                                       scroll_left=500 if direction < 0 else 0)
                    result = self.run_offline_preparation(state)
                    self.assertIsNone(result['error'])
                    self.assertEqual(len(result['wheels']), 1)
                    self.assertGreater(result['wheels'][0][0] * direction, 0)
                    self.assertEqual(result['wheels'][0][1], 0)

    def test_occluded_container_never_receives_a_horizontal_wheel(self):
        result = self.run_offline_preparation(self.state(), occluded=True)
        self.assertIsNotNone(result['error'])
        self.assertTrue(all(x == 0 for x, _ in result['wheels']))
        self.assertLessEqual(len(result['wheels']), 1)

    def test_wrong_event_or_zero_progress_fails_instead_of_retrying_or_claiming_exposed(self):
        for option in ('wrong_event', 'no_progress'):
            with self.subTest(option=option):
                result = self.run_offline_preparation(self.state(), **{option: True})
                self.assertIsNotNone(result['error'])
                self.assertEqual(len(result['wheels']), 1)
                row = result['audits'][0]['attempts'][0]
                self.assertIn('beforeWheel', row)
                self.assertIn('after', row)
                self.assertIn('events', row)
                self.assertEqual(result['saved'][-1], result['audits'])

    def test_native_settle_failure_still_saves_actual_input_and_after_geometry(self):
        result = self.run_offline_preparation(self.state(), settle_failure=True)
        self.assertEqual(result['error'], 'synthetic native settle failure')
        row = result['audits'][0]['attempts'][0]
        self.assertIn('after', row)
        self.assertEqual(len(row['events']), 1)
        self.assertEqual(result['saved'][-1], result['audits'])

    def test_both_call_sites_share_the_helper_without_legacy_magic_clamps(self):
        tree = ast.parse(self.source)
        for name in ('route_attack', 'report_body_glyphs'):
            code = ast.get_source_segment(self.source, next(node for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name == name))
            self.assertIn('native_horizontal_to(page,', code)
            self.assertNotIn('mouse.wheel', code)
            self.assertNotIn('native_scroll_to(page, region)', code)
        self.assertNotIn("min(region['y'] + 30, 900)", self.source)
        for forbidden in ('scrollIntoView(', 'force=True', 'scrollLeft =', 'scrollLeft='):
            self.assertNotIn(forbidden, self.source)

if __name__ == '__main__':
    unittest.main()
