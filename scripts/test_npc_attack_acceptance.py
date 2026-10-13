"""Python-only static/geometry preflight. No Node, browser or native evidence claim."""
import ast
import copy
import math
import json
import unittest
import hashlib
import os
import sys
import subprocess
import tempfile
import time
import traceback
from unittest import mock
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



class NativeReloadScheduleContract(unittest.TestCase):
    """Exercise the real pre-browser validator without importing Playwright."""

    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        tree = ast.parse(cls.source)
        selected = ast.Module(body=[node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name in ('native_reload_schedule_valid', 'exact_json')
            or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                and target.id == 'NATIVE_RELOAD_CHECKPOINTS' for target in node.targets)], type_ignores=[])
        cls.functions = {}
        exec(compile(selected, '<offline-native-reload-contract>', 'exec'), cls.functions)
        cls.reloads = ('attack7-paid-outbound', 'attack8-paid-outbound',
                      'win8-loot-delivered-once', 'empty10-zero-round-loot-delivered')

    def fixture(self):
        names = [f'save-only-{n}' for n in range(30)] + list(self.reloads)
        return {'schema': 'infinity-npc-attack-natural-route-v2',
            'source': {'reloadSchedule': 'native-main-four'},
            'reloadSchedule': {'name': 'native-four-reload-oracle', 'mode': 'native-main-four',
                'checkpointNames': list(self.reloads), 'strictRoundtripsPerCheckpoint': 2,
                'validation': 'detached-copies', 'candidateReadsPerReload': 1, 'controlReadsPerReload': 1,
                'blockedRetryAdoptsReload': False},
            'milestones': [{'name': name, 'strictRoundtrips': 2, 'stateAdoptedFromReload': name in self.reloads,
                'candidateReloadReads': int(name in self.reloads), 'controlReloadReads': int(name in self.reloads)} for name in names],
            'tape': [{'kind': 'checkpoint', 'name': name} for name in names],
            'branches': {'blockedRetry': {'stateAdoptedFromReload': False, 'strictRoundtrips': 1}}}

    def valid(self, fixture):
        return self.functions['native_reload_schedule_valid'](fixture)

    def test_exact_four_reload_oracle_is_accepted(self):
        self.assertEqual(self.functions['NATIVE_RELOAD_CHECKPOINTS'], self.reloads)
        self.assertTrue(self.valid(self.fixture()))

    def test_missing_old_frequent_or_mislabeled_metadata_is_rejected(self):
        for mutation in ('missing', 'v1', 'frequent', 'source', 'one_missing', 'reordered',
                         'validation', 'double_adoption', 'legacy_mismatch', 'blocked', 'boolean_read'):
            fixture = self.fixture()
            with self.subTest(mutation=mutation):
                schedule = fixture['reloadSchedule']
                if mutation == 'missing': del fixture['reloadSchedule']
                elif mutation == 'v1': fixture['schema'] = 'infinity-npc-attack-natural-route-v1'
                elif mutation == 'frequent': schedule.update(name='frequent-reload-regression', mode='frequent-reload')
                elif mutation == 'source': fixture['source']['reloadSchedule'] = 'frequent-reload'
                elif mutation == 'one_missing': schedule['checkpointNames'].pop()
                elif mutation == 'reordered': schedule['checkpointNames'].reverse()
                elif mutation == 'validation': schedule['strictRoundtripsPerCheckpoint'] = 1
                elif mutation == 'double_adoption': schedule['candidateReadsPerReload'] = 2
                elif mutation == 'legacy_mismatch': schedule['controlReadsPerReload'] = 0
                elif mutation == 'blocked': schedule['blockedRetryAdoptsReload'] = True
                elif mutation == 'boolean_read': schedule['candidateReadsPerReload'] = True
                self.assertFalse(self.valid(fixture))

    def test_actual_adoption_and_complete_checkpoint_sequence_are_required(self):
        for mutation in ('all_adopted', 'undeclared_adoption', 'missed_reload', 'candidate_twice',
                         'legacy_missing', 'strict_missing', 'boolean_read', 'duplicate', 'incomplete',
                         'tape_reordered', 'tape_missing', 'blocked_adopted', 'blocked_unvalidated'):
            fixture = self.fixture()
            with self.subTest(mutation=mutation):
                rows = fixture['milestones']
                if mutation == 'all_adopted':
                    for row in rows: row.update(stateAdoptedFromReload=True, candidateReloadReads=1, controlReloadReads=1)
                elif mutation == 'undeclared_adoption': rows[0]['stateAdoptedFromReload'] = True
                elif mutation == 'missed_reload': rows[-1]['stateAdoptedFromReload'] = False
                elif mutation == 'candidate_twice': rows[-1]['candidateReloadReads'] = 2
                elif mutation == 'legacy_missing': rows[-1]['controlReloadReads'] = 0
                elif mutation == 'strict_missing': rows[0]['strictRoundtrips'] = 1
                elif mutation == 'boolean_read': rows[-1]['candidateReloadReads'] = True
                elif mutation == 'duplicate': rows[0]['name'] = rows[1]['name']
                elif mutation == 'incomplete': rows.pop()
                elif mutation == 'tape_reordered': fixture['tape'].reverse()
                elif mutation == 'tape_missing': fixture['tape'].pop()
                elif mutation == 'blocked_adopted': fixture['branches']['blockedRetry']['stateAdoptedFromReload'] = True
                elif mutation == 'blocked_unvalidated': fixture['branches']['blockedRetry'].pop('strictRoundtrips')
                self.assertFalse(self.valid(fixture))

    def test_schedules_have_separate_outputs_and_both_complete_ci_gates(self):
        # Validate the entire approved five-job successor before replaying
        # this immutable four-job contract against its exact pinned parent.
        from test_lab_blockers_gate import previous_workflow
        workflow = previous_workflow()
        verify = workflow.split('  verify:\n', 1)[1].split('  verify-continuation:\n', 1)[0]
        continuation = workflow.split('  verify-continuation:\n', 1)[1].split('  npc-orbital:\n', 1)[0]
        orbital = workflow.split('  npc-orbital:\n', 1)[1].split('  scout-rehearsal:\n', 1)[0]
        aggregate = workflow.split('  required-gates:\n', 1)[1]
        calls = [line for line in verify.splitlines() if 'node --import tsx scripts/npc-attack-natural-route.ts ' in line]
        self.assertEqual(len(calls), 2)
        self.assertNotIn('--reload-schedule', calls[0])
        self.assertIn('--output "$GITHUB_WORKSPACE/npc-attack-natural-report.json"', calls[0])
        self.assertIn('--reload-schedule native-main-four', calls[1])
        self.assertIn('--output "$GITHUB_WORKSPACE/npc-attack-native-report.json"', calls[1])
        independent = [line for line in orbital.splitlines() if 'node --import tsx scripts/npc-attack-natural-route.ts ' in line]
        self.assertEqual(independent, [calls[1]])
        continuation_calls = [line for line in continuation.splitlines() if 'node --import tsx scripts/npc-attack-natural-route.ts ' in line]
        self.assertEqual(continuation_calls, calls)
        self.assertEqual(sum('node --import tsx scripts/npc-attack-natural-route.ts ' in line for line in workflow.splitlines()), 5)
        self.assertNotIn('python scripts/browser-npc-attack.py ', verify)
        self.assertNotIn('python scripts/browser-npc-attack.py ', continuation)
        browsers = [line.strip() for line in workflow.splitlines() if 'python scripts/browser-npc-attack.py ' in line]
        self.assertEqual(browsers, [
            'python scripts/browser-npc-attack.py --url http://127.0.0.1:4173/Infinity/ '
            '--fixture npc-attack-native-report.json --natural-report npc-attack-native-report.json '
            '--expected-report-sha256 "$(sha256sum npc-attack-native-report.json | cut -d\' \' -f1)" '
            '--expected-sha "$GITHUB_SHA" --output npc-attack-evidence'])
        self.assertIn(browsers[0], orbital)
        self.assertIn('    timeout-minutes: 45\n', verify)
        self.assertIn('    timeout-minutes: 45\n', continuation)
        self.assertIn('    timeout-minutes: 25\n', orbital)
        self.assertNotIn('continue-on-error', workflow)
        condition = "    if: github.event_name != 'push' || !contains(github.event.head_commit.message, '[deep-source]')"
        for job in (verify, continuation, orbital):
            self.assertIn(condition, job)
            self.assertIn('          ref: ${{ github.sha }}', job)
            self.assertIn('          fetch-depth: 0', job)
            self.assertIn('          persist-credentials: false', job)
            self.assertIn('      - run: npm ci', job)
            self.assertIn('      - run: npm run build', job)
            self.assertIn('run: bash scripts/browser-prerequisites.sh', job)
            self.assertIn('            npc-attack-native-report.json', job)
            self.assertIn('            orbital-identity.json', job)
            self.assertIn('            dist', job)
            self.assertIn('            source.zip', job)
            self.assertIn("'fixturePoolSha256': sha(canonical(pool))", job)
            self.assertIn("pool['native']['source']['baseReportSha256'] = sha(canonical(pool['r12']))", job)
            self.assertIn("native['source']['baseReportSha256'] == raw_hashes['r12']", job)
        self.assertIn('            npc-attack-natural-report.json', verify)
        self.assertIn('            npc-attack-natural-report.json', continuation)
        self.assertIn('test "$READY" = 1', orbital)
        self.assertIn('name: npc-orbital-${{ github.sha }}', orbital)
        self.assertIn('needs: [verify, verify-continuation, npc-orbital, scout-rehearsal]', aggregate)
        self.assertIn("always() && (github.event_name != 'push'", aggregate)
        self.assertIn("assert job['result'] == 'success'", aggregate)
        self.assertIn('assert len(set(hashes)) == 1', aggregate)

    def test_historical_workflow_projection_refuses_missing_lab_or_weakened_current_gates(self):
        workflow_path = ROOT / '.github/workflows/p4-original-verify.yml'
        original_read = Path.read_bytes
        current = original_read(workflow_path).decode('utf-8')
        recycle_gate = original_read(ROOT / 'scripts/test_recycle_preview_gate.py')
        fleet_adapter = b'    from test_fleet_row_gate import previous_workflow as successor_workflow\n'
        fleet_gate = original_read(ROOT / 'scripts/test_fleet_row_gate.py')
        research_adapter = b'    from test_research_unlock_copy_gate import previous_workflow as successor_workflow\n'
        if research_adapter in fleet_gate:
            self.assertIn(fleet_adapter, recycle_gate)
            expected_error = 'Unapproved research-unlock-copy workflow drift'
        elif fleet_adapter in recycle_gate:
            expected_error = 'Unapproved fleet-row workflow drift'
        else:
            expected_error = 'Unapproved recycle workflow drift'
        start, end = current.index('  lab-blockers:\n'), current.index('  required-gates:\n')
        mutations = (
            current[:start] + current[end:],
            current.replace("assert job['result'] == 'success'", "assert job['result'] in ('success', 'skipped')", 1),
            current.replace('python scripts/browser-npc-attack.py ', 'echo skipped-orbital ', 1),
        )
        for changed in mutations:
            self.assertNotEqual(changed, current)
            def read_bytes(path, changed=changed):
                return changed.encode('utf-8') if path == workflow_path else original_read(path)
            with mock.patch.object(Path, 'read_bytes', read_bytes):
                with self.assertRaisesRegex(AssertionError, '^' + expected_error + '$'):
                    self.test_schedules_have_separate_outputs_and_both_complete_ci_gates()

    def test_live_reload_adoption_is_distinct_from_strict_validation(self):
        source = (ROOT / 'scripts/npc-attack-natural-route.ts').read_text()
        self.assertIn('args.get("--reload-schedule") ?? "frequent-reload"', source)
        self.assertIn('if (!["frequent-reload", "native-main-four"].includes(RELOAD_SCHEDULE)) throw', source)
        checkpoint = source[source.index('function checkpoint('):source.index('// Independent ordinary-route oracle:')]
        self.assertIn('const restored = deserializeState(parsed.state)', checkpoint)
        self.assertIn('const twice = deserializeState(importSave(canonical).state)', checkpoint)
        self.assertIn('const adopted = !nativeSchedule || NATIVE_RELOAD_CHECKPOINTS.includes(name)', checkpoint)
        self.assertIn('if (adopted) {', checkpoint)
        self.assertIn('state = nativeSchedule ? restored : twice', checkpoint)
        self.assertIn('control = old.save.deserializeState', checkpoint)
        self.assertNotIn('blockedState = deserializeState(importSave(blockedRaw).state)', source)
        self.assertIn('const blockedReloadedCopy = deserializeState(importSave(blockedRaw).state)', source)
        self.assertIn('if (!nativeSchedule) blockedState = blockedReloadedCopy', source)
        self.assertIn('blockedRetryAdoptsReload: !nativeSchedule', source)
        self.assertIn('native_reload_schedule_valid(source_report)', self.source)
        self.assertLess(self.source.index('native_reload_schedule_valid(source_report)'), self.source.index('with sync_playwright()'))
        self.assertIn('main_reload_checkpoints == list(NATIVE_RELOAD_CHECKPOINTS)', self.source)


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


class NativeCompactReportContract(unittest.TestCase):
    """Exercise independent literal summary and capture contracts without a browser."""

    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        tree = ast.parse(cls.source)
        names = {'compact_report_expected', 'store_compact_screenshot', 'inspect_closed_report', 'verify_compact_report_coverage'}
        constants = {'COMPACT_REPORT_HOOKS', 'COMPACT_BLOCKED_TEXT'}
        selected = ast.Module(body=[node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name in names
            or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in constants
                for target in node.targets)], type_ignores=[])
        cls.functions = {'Fraction': Fraction, 'hashlib': hashlib, 'json': json}
        exec(compile(selected, '<offline-compact-report-contract>', 'exec'), cls.functions)

    def fixture(self):
        golden = json.loads((ROOT / 'tests/fixtures/npc-attack-independent-goldens.json').read_text())['draw7']
        receipt = {'fleetId': 7, 'originId': 'colony-1', 'target': {'galaxy': 1, 'system': 56, 'position': 6},
            'at': '25892.3997786282', 'delivery': 'returning', 'loot': [0, 0, 0], 'battle': golden}
        state = {'activePlanetId': 'homeworld', 'planets': [
            {'id': 'homeworld', 'name': '母星', 'coordinates': {'galaxy': 1, 'system': 56, 'position': 8}},
            {'id': 'colony-1', 'name': '远航殖民地 <星光 & 北岸> 测试', 'coordinates': {'galaxy': 2, 'system': 3, 'position': 4}}],
            'fleets': [{'id': 7, 'mission': 'attack', 'npcAttack': {'phase': {'kind': 'returning', 'reason': 'battle'}}}]}
        return receipt, state

    def expected(self, receipt, state):
        return self.functions['compact_report_expected'](receipt, state)

    def test_exact_draw_loss_uses_own_permanent_casualties_and_current_origin(self):
        receipt, state = self.fixture()
        self.assertEqual(self.expected(receipt, state), {'outcome': '平',
            'route': '远航殖民地 <星光 & 北岸> 测试 [2:3:4] → [1:56:6]',
            'lossText': '我方永久损失：1 艘', 'lootText': '实际装载：金属 0 · 晶体 0 · 重氢 0',
            'delivery': '战后返航', 'timeText': '游戏时间 7 小时 11 分', 'roundText': '6 回合'})
        # Two enemy casualties cannot substitute for the one actual own loss.
        self.assertEqual(receipt['battle']['defenderBefore']['light_fighter'] - receipt['battle']['defenderAfter']['light_fighter'], 2)

    def test_live_name_is_looked_up_again_and_missing_origin_never_uses_active_planet(self):
        receipt, state = self.fixture(); frozen = copy.deepcopy(receipt)
        state['planets'][1]['name'] = '同 ID 新名称'
        self.assertEqual(self.expected(receipt, state)['route'], '同 ID 新名称 [2:3:4] → [1:56:6]')
        state['planets'].pop()
        self.assertEqual(self.expected(receipt, state)['route'], '原出发星球已不可用 → [1:56:6]')
        self.assertEqual(receipt, frozen)

    def test_win_zero_round_and_large_exact_loaded_amounts_are_not_wallet_or_capacity(self):
        receipt, state = self.fixture()
        receipt['battle'] = json.loads((ROOT / 'tests/fixtures/npc-attack-independent-goldens.json').read_text())['win8']
        receipt['loot'] = [9007199254740991, 0, 23]
        result = self.expected(receipt, state)
        self.assertEqual(result['outcome'], '胜')
        self.assertEqual(result['lossText'], '我方永久损失：0 艘')
        self.assertEqual(result['lootText'], '实际装载：金属 9007199254740991 · 晶体 0 · 重氢 23')
        receipt['battle'].update(rounds=[], defenderBefore={}, defenderAfter={})
        self.assertEqual(self.expected(receipt, state)['outcome'], '无驻军收集')
        self.assertEqual(self.expected(receipt, state)['roundText'], '0 回合')
        receipt['battle']['defenderBefore'] = {'light_fighter': 1}
        self.assertEqual(self.expected(receipt, state)['outcome'], '胜')
        receipt['battle']['winner'] = 'defender'
        self.assertEqual(self.expected(receipt, state)['outcome'], '败')

    def test_delivery_uses_current_matching_attack_and_terminal_receipt_wins(self):
        receipt, state = self.fixture()
        phase = state['fleets'][0]['npcAttack']['phase']
        phase['dockBlocked'] = True
        self.assertEqual(self.expected(receipt, state)['delivery'], '入港受阻')
        for delivery, text in [('delivered', '已入港'), ('destroyed', '全损'), ('forfeited', '已丢弃')]:
            receipt['delivery'] = delivery
            self.assertEqual(self.expected(receipt, state)['delivery'], text)
        receipt['delivery'] = 'returning'
        for mutation in ('wrong_id', 'wrong_mission', 'wrong_reason', 'missing_fleet'):
            altered = copy.deepcopy(state)
            if mutation == 'wrong_id': altered['fleets'][0]['id'] = 8
            elif mutation == 'wrong_mission': altered['fleets'][0]['mission'] = 'scout'
            elif mutation == 'wrong_reason': altered['fleets'][0]['npcAttack']['phase']['reason'] = 'recall'
            else: altered['fleets'] = []
            self.assertEqual(self.expected(receipt, altered)['delivery'], '交付状态不可确认')

    def test_readable_time_is_independent_exact_floor_and_keeps_receipt_raw(self):
        receipt, state = self.fixture()
        for value, text in [('0', '0 秒'), ('59.999', '59 秒'), ('61.999', '1 分 1 秒'),
                            ('3601.99', '1 小时 0 分'), ('90061.001', '1 天 1 小时')]:
            receipt['at'] = value
            self.assertEqual(self.expected(receipt, state)['timeText'], '游戏时间 ' + text)
            self.assertEqual(receipt['at'], value)
        for value in ('-1', '1000000000001'):
            receipt['at'] = value
            with self.assertRaises(AssertionError): self.expected(receipt, state)

    def test_oracle_rejects_unsupported_fleets_invalid_loss_and_noninteger_loot(self):
        for mutation in ('other_ship', 'negative_loss', 'float_loot', 'negative_loot', 'short_loot'):
            receipt, state = self.fixture()
            if mutation == 'other_ship': receipt['battle']['attackerBefore']['cruiser'] = 1
            elif mutation == 'negative_loss': receipt['battle']['attackerAfter']['light_fighter'] = 5
            elif mutation == 'float_loot': receipt['loot'][0] = 1.5
            elif mutation == 'negative_loot': receipt['loot'][0] = -1
            else: receipt['loot'].pop()
            with self.assertRaises(AssertionError): self.expected(receipt, state)

    def test_screenshot_dedup_requires_actual_identical_bytes_and_keeps_full_digest(self):
        store = self.functions['store_compact_screenshot']
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = store(root, b'exact PNG bytes')
            self.assertFalse(first['identicalBytesAlreadyStored'])
            second = store(root, b'exact PNG bytes')
            self.assertTrue(second['identicalBytesAlreadyStored'])
            self.assertEqual(first['file'], second['file'])
            self.assertNotEqual(first['file'], store(root, b'different PNG bytes')['file'])
            self.assertEqual(first['sha256'], hashlib.sha256(b'exact PNG bytes').hexdigest())
            (root / first['file']).write_bytes(b'corrupted existing capture')
            with self.assertRaises(AssertionError): store(root, b'exact PNG bytes')

    def run_closed_matrix(self, clipped=False):
        receipt, state = self.fixture(); captures, calls, rows = [], [], []
        scope = dict(self.functions)
        tree = ast.parse(self.source)
        selected = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)
                                   and node.name == 'inspect_closed_report'], type_ignores=[])
        class Page:
            viewport_size = {'width': 1440, 'height': 1100}
            def set_viewport_size(self, value): self.viewport_size = value
            def locator(self, selector): return self
            def evaluate(self, source): return False if 'e.open' in source else True
            def screenshot(self, **kwargs):
                captures.append(self.viewport_size['width']); return ('PNG-' + str(self.viewport_size['width'])).encode()
        def check(name, passed, detail=None):
            if not passed: raise AssertionError(name)
        def text(_page, _selector, _receipt, wanted): calls.append((_page.viewport_size['width'], wanted))
        def glyphs(_page, selectors): return {'leaves': [{'passed': not clipped} for _ in selectors]}
        scope.update(compact_report_proofs=set(), closed_report_text=text, check=check, case='offline', evidence=rows,
            advance=lambda *_: None, native_scroll_to=lambda *_: None, flush=lambda: None, out=Path('/unused'),
            visibility=lambda *_: {'targets': [{'visible': True, 'contained': True, 'points': [{'unoccluded': True}] * 5}]},
            text_leaf_visibility=glyphs, store_compact_screenshot=lambda _out, data: {'sha256': hashlib.sha256(data).hexdigest()})
        exec(compile(selected, '<offline-closed-summary-sequence>', 'exec'), scope)
        page = Page(); error = None
        try:
            scope['inspect_closed_report'](page, '#receipt', receipt, state, 'first')
            scope['inspect_closed_report'](page, '#receipt', receipt, state, 'unchanged')
            receipt['delivery'] = 'delivered'
            scope['inspect_closed_report'](page, '#receipt', receipt, state, 'delivered')
        except AssertionError as caught: error = str(caught)
        return captures, calls, rows, page.viewport_size['width'], error

    def test_distinct_returning_and_delivered_states_get_four_actual_captures(self):
        captures, calls, rows, width, error = self.run_closed_matrix()
        self.assertIsNone(error)
        self.assertEqual(captures, [320, 390, 768, 1440] * 2)
        self.assertEqual([width for width, _ in calls], [320, 390, 768, 1440, 1440, 320, 390, 768, 1440])
        self.assertEqual(len(rows), 8)
        self.assertEqual(width, 1440)
        self.assertTrue(all(row['kind'] == 'compact-closed-summary' for row in rows))

    def test_clipped_closed_text_fails_before_screenshot_or_coverage_record(self):
        captures, calls, rows, _width, error = self.run_closed_matrix(clipped=True)
        self.assertIn('every CLOSED summary glyph', error)
        self.assertEqual(captures, [])
        self.assertEqual(rows, [])

    def test_final_matrix_gate_rejects_missing_state_wrong_scope_and_corrupt_capture(self):
        tree = ast.parse(self.source)
        selected = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)
            and node.name == 'verify_compact_report_coverage'], type_ignores=[])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); data = b'offline identical image bytes'
            metadata = self.functions['store_compact_screenshot'](root, data)
            rows = []
            for fleet_id, outcome in ((7, '平'), (8, '胜'), (10, '无驻军收集')):
                for delivery in ('战后返航', '已入港'):
                    for width in (320, 390, 768, 1440):
                        rows.append({'kind': 'compact-closed-summary', 'label': 'native-oracle-checkpoint',
                            'fleetId': fleet_id, 'width': width, 'expected': {'outcome': outcome, 'delivery': delivery}, **metadata})
            for label, delivery in (('native-blocked-retry', '入港受阻'),
                                    ('synthetic-current-report-origin', '已入港'), ('synthetic-missing-report-origin', '已入港')):
                for width in (320, 390, 768, 1440):
                    rows.append({'kind': 'compact-closed-summary', 'label': label, 'fleetId': 8, 'width': width,
                                 'expected': {'outcome': '胜', 'delivery': delivery}, **metadata})
            def check(name, passed, detail=None):
                if not passed: raise AssertionError(name)
            scope = {'hashlib': hashlib, 'check': check, 'evidence': rows, 'out': root}
            exec(compile(selected, '<offline-compact-matrix-gate>', 'exec'), scope)
            scope['verify_compact_report_coverage']()
            for mutation in ('missing_state', 'wrong_scope', 'missing_boundary', 'corrupt_bytes'):
                altered = copy.deepcopy(rows); scope['evidence'] = altered
                if mutation == 'missing_state': altered.pop(16)
                elif mutation == 'wrong_scope': altered[0]['label'] = 'synthetic-replacement'
                elif mutation == 'missing_boundary': altered.pop()
                else: (root / metadata['file']).write_bytes(b'corrupt')
                with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                    scope['verify_compact_report_coverage']()
                (root / metadata['file']).write_bytes(data)

    def test_native_closed_checks_precede_detail_open_and_keep_original_full_detail_proofs(self):
        tree = ast.parse(self.source)
        def body(name): return ast.get_source_segment(self.source, next(node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == name))
        inspection = body('inspect_reports')
        self.assertLess(inspection.index('inspect_closed_report('), inspection.index("press('Enter')"))
        for text in ('report_body_glyphs(', 'snapshot_control(page, summary,', 'ordinary repaint retains keyed open report node'):
            self.assertIn(text, inspection)
        details = body('report_body_glyphs')
        for text in ('all five historical report paragraphs', '实际游戏时间', 'Fraction(page.locator(leaf).inner_text())',
                     'snapshot_control(page, leaf,', "if key != 'delivery'"):
            self.assertIn(text, details)
        self.assertLess(details.index('all five historical report paragraphs'), details.index('if proof_key in report_glyph_proofs'))
        self.assertIn("inspect_reports(page, fixtures['expected'][name]", self.source)
        boundary = body('report_identity_boundary')
        for text in ('import_save(', 'exact_confirmation(', 'synthetic-current-report-origin',
                     'synthetic-missing-report-origin', 'native-abandon-removes-only-identity-colony-and-offers'):
            self.assertIn(text, boundary)
        self.assertNotIn('rename', boundary)
        self.assertIn('verify_compact_report_coverage()', self.source)


class NativeJournalContract(unittest.TestCase):
    """Run the actual native recorder offline, never importing Playwright."""

    @classmethod
    def setUpClass(cls):
        cls.source = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        cls.tree = ast.parse(cls.source)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.out = Path(self.directory.name)
        names = {'NativeCheckJournal', 'replay_native_journal', 'recover_native_report',
                 'atomic_json', 'flush', 'check', 'capture_failure'}
        selected = ast.Module(body=[node for node in self.tree.body
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names], type_ignores=[])
        self.scope = dict(json=json, os=os, time=time, hashlib=hashlib, traceback=traceback, sys=sys)
        exec(compile(selected, '<offline-native-recorder>', 'exec'), self.scope)
        self.journal = self.scope['NativeCheckJournal'](self.out / 'npc-attack-checks.jsonl')
        self.addCleanup(os.close, self.journal.fd)
        self.checks, self.evidence = [], []
        self.scope.update(journal=self.journal, checks=self.checks, evidence=self.evidence,
            out=self.out, report_path=self.out / 'npc-attack-browser-report.json',
            progress_path=self.out / 'npc-attack-progress.json', case='offline native recorder',
            completed=False, failure=None, last_progress_at=0.0, recorder_host_seconds=0.0,
            HOST_STARTED_MONOTONIC=time.monotonic(), CARD='#card', QUEUE='#queue')
        self.metadata = {'case': 'offline native recorder', 'timing': {'simulatedSeconds': 0},
                         'sourceSha': 'a' * 40, 'errors': [], 'failedRequests': []}
        self.scope['full_report'] = lambda: {**self.metadata,
            'completed': self.scope['completed'], 'result': 'passed' if self.scope['completed'] else 'incomplete',
            'checks': self.checks, 'evidence': self.evidence,
            'passed': sum(row['passed'] for row in self.checks), 'failure': self.scope['failure']}

    def replay(self):
        return self.scope['replay_native_journal'](self.journal.path)

    def recover(self, worker_ok=True):
        return self.scope['recover_native_report'](self.journal.path, self.scope['report_path'],
                                                  self.scope['progress_path'], worker_ok)

    def add_check(self, name='assertion', passed=True, detail=None):
        row = {'case': self.scope['case'], 'name': name, 'passed': passed}
        if detail is not None: row['detail'] = detail
        self.checks.append(row)
        self.scope['flush']()

    def seal(self):
        self.scope['completed'] = True
        self.scope['flush'](full=True, final=True)

    def test_success_requires_sealed_equal_report_and_clean_worker(self):
        self.add_check(detail={'中文': 'exact\\nbytes', 'number': 1.125})
        self.assertFalse(self.recover()['completed'])
        self.seal()
        report = self.recover()
        self.assertTrue(report['completed'])
        self.assertTrue(report['recording']['sealedReportVerified'])
        self.assertTrue(report['recording']['reconstructionComplete'])
        self.assertFalse(self.recover(worker_ok=False)['completed'])
        self.scope['report_path'].write_text('{"completed":true,"checks":[]}', encoding='utf-8')
        self.assertFalse(self.recover()['completed'])

    def test_every_flush_preserves_current_metadata_without_a_full_report_write(self):
        self.add_check()
        self.metadata.update(case='main', timing={'simulatedSeconds': 25, 'advanceInFlight': None},
                             errors=['observed app failure'], sourceSha='b' * 40)
        self.scope['flush']()
        report, state = self.replay()
        self.assertIsNone(state['error'])
        for key, value in self.metadata.items(): self.assertEqual(report[key], value)
        self.assertFalse(self.scope['report_path'].exists())
        self.assertLess(self.scope['progress_path'].stat().st_size, 2048)

    def test_current_native_audit_aliases_follow_each_existing_flush(self):
        row = {'attempt': 1, 'before': {'x': 0}}
        audit = {'kind': 'native-scroll-region-preparation', 'attempts': [row]}
        self.evidence.append(audit)
        self.add_check(detail=row)
        self.add_check(name='whole audit', detail=audit)
        for key, value in [('plan', {'x': 2}), ('immediateEvents', [{'trusted': True}]),
                           ('after', {'x': 2, 'glyph': '晶体'})]:
            row[key] = value
            self.scope['flush']()
            report, state = self.replay()
            self.assertIsNone(state['error'])
            self.assertEqual(report['checks'], self.checks)
            self.assertEqual(report['evidence'], self.evidence)
        row['final'] = {'nested': [1, {'two': 2}]}
        self.evidence.append({'file': 'next.png', 'sha256': 'f' * 64})
        self.scope['flush']()
        self.assertEqual(self.replay()[0]['checks'], self.checks)
        self.seal()
        self.assertTrue(self.recover()['completed'])

    def test_full_boundary_reconciles_all_final_values_without_loss(self):
        detail = {'initial': ['raw', 1.0]}
        self.add_check(detail=detail)
        detail['later'] = {'exact': '0.00000000006'}
        self.seal()
        self.assertEqual(self.replay()[0]['checks'], self.checks)
        self.assertTrue(self.recover()['completed'])

    def test_failed_check_is_fsynced_before_it_raises_and_cannot_pass(self):
        real_fsync = os.fsync
        with mock.patch.object(os, 'fsync', wraps=real_fsync) as fsync:
            with self.assertRaisesRegex(AssertionError, 'durable failure'):
                self.scope['check']('durable failure', False, {'complete': ['error', '原件']})
            self.assertGreaterEqual(fsync.call_count, 1)
        report, state = self.replay()
        self.assertIsNone(state['error'])
        self.assertEqual(report['checks'][-1]['detail'], {'complete': ['error', '原件']})
        self.assertFalse(report['checks'][-1]['passed'])
        self.seal()
        self.assertFalse(self.recover()['completed'])

    def test_short_writes_are_completed_and_zero_writes_poison_the_writer(self):
        real_write = os.write
        with mock.patch.object(os, 'write', side_effect=lambda fd, data: real_write(fd, data[:17])):
            self.add_check(detail={'bytes': 'x' * 100})
        self.assertIsNone(self.replay()[1]['error'])
        before = self.journal.path.read_bytes()
        with mock.patch.object(os, 'write', return_value=0):
            with self.assertRaises(OSError): self.add_check(name='zero write')
        self.assertIsNotNone(self.journal.error)
        with self.assertRaises(OSError): self.scope['flush']()
        self.assertEqual(self.journal.path.read_bytes(), before)
        self.assertFalse(self.recover()['completed'])

    def test_partial_write_timeout_retains_raw_tail_and_only_verified_prefix(self):
        self.add_check()
        prefix, state = self.replay()
        real_write, calls = os.write, []
        def interrupted(fd, data):
            calls.append(1)
            if len(calls) == 1: return real_write(fd, data[:23])
            raise TimeoutError('900-second worker bound')
        with mock.patch.object(os, 'write', side_effect=interrupted):
            with self.assertRaises(TimeoutError): self.add_check(name='interrupted')
        raw = self.journal.path.read_bytes()
        recovered, result = self.replay()
        self.assertEqual(recovered, prefix)
        self.assertEqual(result['sequence'], state['sequence'])
        self.assertIn('unterminated', result['error'])
        self.assertFalse(self.recover()['completed'])
        self.assertEqual(self.journal.path.read_bytes(), raw)

    def test_fsync_error_poisoning_never_permits_a_success_seal(self):
        with mock.patch.object(os, 'fsync', side_effect=OSError('disk sync error')):
            with self.assertRaises(OSError): self.add_check()
        self.assertIsNotNone(self.journal.error)
        with self.assertRaises(OSError): self.seal()
        self.assertFalse(self.recover()['completed'])
        self.assertIsNone(self.replay()[1]['seal'])

    def test_complete_physical_write_then_error_keeps_newest_prefix_and_emergency_report(self):
        real_write = os.write
        def complete_then_error(fd, data):
            real_write(fd, data)
            raise OSError('failure after complete physical write')
        with mock.patch.object(os, 'write', side_effect=complete_then_error):
            with self.assertRaises(OSError): self.add_check(detail={'complete': 'actual bytes'})
        self.assertEqual(self.journal.sequence, 0)
        prefix, state = self.replay()
        self.assertEqual(state['sequence'], 1)
        self.assertEqual(prefix['checks'], self.checks)
        self.scope['capture_failure'](RuntimeError('capture after write error'))
        report = self.recover(worker_ok=False)
        self.assertFalse(report['completed'])
        self.assertEqual(report['checks'], self.checks)
        emergency = self.out / report['recording']['emergencyFullReport']
        self.assertIn('capture after write error', json.loads(emergency.read_bytes())['failure']['error'])

    def test_actual_python_sigkill_retains_durable_prefix_and_cannot_pass(self):
        path, ready = self.out / 'killed-worker.jsonl', self.out / 'worker-ready'
        program = """
import ast, hashlib, json, os, sys, time
from pathlib import Path
tree = ast.parse(Path(sys.argv[1]).read_text())
selected = ast.Module(body=[n for n in tree.body if isinstance(n, ast.ClassDef)
    and n.name == 'NativeCheckJournal'], type_ignores=[])
exec(compile(selected, '<killed-native-recorder>', 'exec'))
journal = NativeCheckJournal(Path(sys.argv[2]))
journal.sync([{'case': 'killed worker', 'name': 'durable native assertion',
    'passed': True, 'detail': {'all': ['exact', '晶体', 1.25]}}], [])
journal.append('snapshot', {'completed': False, 'case': 'killed worker',
    'timing': {'simulatedSeconds': 25}})
Path(sys.argv[3]).write_text('ready')
time.sleep(60)
"""
        process = subprocess.Popen([sys.executable, '-c', program,
            str(ROOT / 'scripts/browser-npc-attack.py'), str(path), str(ready)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(ready.exists(), 'isolated Python recorder did not reach its durable boundary')
            process.kill(); process.wait(timeout=5)
            self.assertLess(process.returncode, 0)
            raw = path.read_bytes()
            report = self.scope['recover_native_report'](path, self.scope['report_path'],
                                                        self.scope['progress_path'], False)
            self.assertFalse(report['completed'])
            self.assertEqual(report['checks'][0]['detail'], {'all': ['exact', '晶体', 1.25]})
            self.assertEqual(report['timing']['simulatedSeconds'], 25)
            self.assertEqual(report['recording']['verifiedPrefixSequence'], 2)
            self.assertEqual(path.read_bytes(), raw)
        finally:
            if process.poll() is None: process.kill()
            process.communicate(timeout=5)

    def test_corruption_reorder_missing_record_and_truncated_seal_fail_closed(self):
        self.add_check(name='one'); self.add_check(name='two'); self.seal()
        original = self.journal.path.read_bytes(); lines = original.splitlines(keepends=True)
        variants = [b''.join(lines[:-1]), original[:-7], original + b'partial',
                    b''.join(lines[1:]), b''.join([lines[1], lines[0], *lines[2:]]),
                    original.replace(b'"one"', b'"bad"', 1),
                    original.replace(b'{"entry":', b'{ "entry":', 1)]
        for data in variants:
            with self.subTest(bytes=len(data)):
                self.journal.path.write_bytes(data)
                self.assertFalse(self.recover()['completed'])
                self.assertEqual(self.journal.path.read_bytes(), data)
        self.journal.path.write_bytes(original)
        self.assertTrue(self.recover()['completed'])

    def test_semantically_invalid_update_does_not_mutate_the_verified_prefix(self):
        row = {'attempt': 1, 'before': {'x': 0}}
        self.evidence.append({'kind': 'native-scroll-region-preparation', 'attempts': [row]})
        self.add_check(detail=row)
        prefix, state = self.replay()
        self.journal.append('evidence', {'index': 0,
            'record': {'kind': 'native-scroll-region-preparation', 'attempts': []}})
        replay, invalid = self.replay()
        self.assertIsNotNone(invalid['error'])
        self.assertEqual(invalid['sequence'], state['sequence'])
        self.assertEqual(replay, prefix)

    def test_failure_diagnostics_survive_a_poisoned_journal(self):
        class Locator:
            def all_text_contents(self): return ['visible and hidden text']
        class Page:
            def locator(self, _selector): return Locator()
            def evaluate(self, *_args): return {'diagnostic': 'retained'}
            def content(self): return '<html>original DOM</html>'
            def screenshot(self, **_kwargs): return b'original PNG bytes'
        self.scope['raw'] = lambda _page: '{"raw":"original save"}'
        with mock.patch.object(os, 'write', side_effect=OSError('journal disk full')):
            with self.assertRaises(OSError): self.add_check(name='write failed')
        self.scope['capture_failure'](RuntimeError('original assertion error'), Page())
        report = self.recover(worker_ok=False)
        self.assertFalse(report['completed'])
        self.assertIn('original assertion error', report['failure']['error'])
        self.assertEqual((self.out / 'failure-raw-save.json').read_bytes(), b'{"raw":"original save"}')
        self.assertTrue((self.out / 'failure-dom.html').exists())
        self.assertTrue((self.out / 'failure.png').exists())
        self.assertIn('recordingError', report)

    def test_newer_failure_diagnostics_beat_an_older_unsealed_full_report(self):
        self.add_check()
        self.scope['failure'] = {'error': 'original failure'}
        self.scope['flush'](full=True)
        self.scope['failure']['rawSave'] = 'newest exact raw save'
        self.scope['flush']()
        report = self.recover(worker_ok=False)
        self.assertEqual(report['failure']['rawSave'], 'newest exact raw save')

    def test_nonobject_missing_or_truncated_full_reports_fail_closed_with_reason(self):
        self.add_check()
        for contents in (None, '[]', 'null', '{"completed":'):
            with self.subTest(contents=contents):
                path = self.scope['report_path']
                if contents is None:
                    if path.exists(): path.unlink()
                else: path.write_text(contents, encoding='utf-8')
                report = self.recover()
                self.assertFalse(report['completed'])
                self.assertIsNotNone(report['recording']['reportReadError'])
                self.assertEqual(report['checks'], self.checks)

    def test_final_atomic_replace_failure_cannot_create_a_success_seal(self):
        self.add_check()
        with mock.patch.object(Path, 'replace', side_effect=OSError('atomic replacement failed')):
            with self.assertRaises(OSError): self.seal()
        self.assertIsNone(self.replay()[1]['seal'])
        self.assertFalse(self.recover()['completed'])
        self.assertTrue(list(self.out.glob('*.tmp')))

    def test_successful_final_flush_stays_under_unchanged_worker_deadline(self):
        self.assertIn('signal.alarm(900)', self.source)
        self.assertIn('deadline = time.monotonic() + 910', self.source)
        final = self.source.index('completed = True; browser.close(); flush(full=True, final=True)')
        self.assertLess(final, self.source.index('signal.alarm(0)', final))
        self.assertNotIn('flush(', self.source[self.source.index('signal.alarm(0)', final):])

    @unittest.skipUnless(os.environ.get('NPC_ACCEPTANCE_ARCHIVED_REPORT'),
                         'Set NPC_ACCEPTANCE_ARCHIVED_REPORT for the byte-pinned 2,889-check CI archive replay')
    def test_archived_2889_checks_details_order_and_complete_report_roundtrip(self):
        source = Path(os.environ['NPC_ACCEPTANCE_ARCHIVED_REPORT']).read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(),
                         'b8682659bc0485d08722e84992e2ad5f8a1b8a0044ee852af9c9522a34886044')
        archive = json.loads(source)
        self.assertEqual(len(archive['checks']), 2889)
        for check in archive['checks']:
            self.checks.append(check)
            self.journal.sync(self.checks, self.evidence)
        self.evidence.extend(archive['evidence'])
        self.journal.sync(self.checks, self.evidence, full=True)
        self.journal.append('snapshot', {key: value for key, value in archive.items()
                                         if key not in ('checks', 'evidence')})
        report, state = self.replay()
        self.assertIsNone(state['error'])
        self.assertEqual(report, archive)
        encoded = self.scope['NativeCheckJournal'].encoded
        for expected, actual in zip(archive['checks'], report['checks']):
            self.assertEqual(encoded(actual), encoded(expected))
            if 'detail' in expected: self.assertEqual(encoded(actual['detail']), encoded(expected['detail']))
        self.assertEqual(json.dumps(report, sort_keys=True, ensure_ascii=False),
                         json.dumps(archive, sort_keys=True, ensure_ascii=False))
        self.assertFalse(self.recover(worker_ok=False)['completed'])

class R14ExistingNativeScoutContract(unittest.TestCase):
    """Exercise copied Python arrival expectations without importing Playwright."""
    @classmethod
    def setUpClass(cls):
        cls.economy = (ROOT / 'scripts/browser-npc-economy.py').read_text()
        cls.attack = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        tree = ast.parse(cls.economy)
        selected = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef)
            and node.name in ('independent_report', 'independent_scout_message', 'exact_json')], type_ignores=[])
        cls.functions = {}
        exec(compile(selected, '<offline-r14-arrival-contract>', 'exec'), cls.functions)

    def test_current_only_revision_changes_keep_exact_legacy_origins(self):
        for source, old_revision, origin_hash in ((self.attack, 12, '047d49cbf04fd5424bca4d7d45e861e0439a0d51c4ac54700f77e263bb8eadcc'),
              (self.economy, 11, 'd456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a')):
            self.assertIn("fixtures['originalSave']['revision'] == " + str(old_revision), source)
            self.assertIn("fixtures['base']['revision'] == 14", source)
            self.assertIn("release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 14", source)
            self.assertIn(origin_hash, source)
            self.assertIn("same = exact_json(actual, expected)", source)
            self.assertNotIn("pop('npcScoutSnapshot'", source)
        render = (ROOT / 'scripts/browser-render-scheduling.py').read_text()
        self.assertIn('from r14_compatibility import', render)
        self.assertIn('lift_legacy_state_to_r14(state, source_revision=8', render)
        self.assertIn("seed['revision']==8", render)

    def test_both_literal_arrivals_have_every_exact_typed_field(self):
        for fleet_id, age, observed, stock in ((4, 3, '25813', [515, 257.5, 3]), (5, 65, '25875', [825, 412.5, 65])):
            expected = {'id': f'scout-{fleet_id}', 'at': int(observed), 'text': self.functions['independent_report'](age),
                'npcScoutSnapshot': {'model': 'npc-scout-snapshot-v1', 'fleetId': fleet_id, 'originId': 'homeworld',
                    'target': {'galaxy': 1, 'system': 56, 'position': 6}, 'observedAt': observed, 'stock': stock,
                    'garrison': {'light_fighter': 4, 'heavy_fighter': 0}, 'defenderTech': {'weapons': 0, 'shields': 0, 'armour': 0}}}
            self.assertEqual(self.functions['independent_scout_message'](fleet_id, age), expected)
        self.assertIn('exact_json(messages[0], independent_scout_message(fleet_id, age))', self.economy)

    def test_no_snapshot_field_or_legacy_time_can_be_tolerated_or_omitted(self):
        expected = self.functions['independent_scout_message'](4, 3)
        changes = [('at',), ('id',), ('text',), ('npcScoutSnapshot',),
            *[('npcScoutSnapshot', key) for key in expected['npcScoutSnapshot']],
            *[('npcScoutSnapshot', 'target', key) for key in ('galaxy', 'system', 'position')],
            *[('npcScoutSnapshot', 'garrison', key) for key in ('light_fighter', 'heavy_fighter')],
            *[('npcScoutSnapshot', 'defenderTech', key) for key in ('weapons', 'shields', 'armour')]]
        for keys in changes:
            changed = copy.deepcopy(expected); parent = changed
            for key in keys[:-1]: parent = parent[key]
            parent[keys[-1]] = None
            with self.subTest(path=keys): self.assertFalse(self.functions['exact_json'](changed, expected))
        for at in (25813.00000001, True, '25813'):
            changed = copy.deepcopy(expected); changed['at'] = at
            self.assertFalse(self.functions['exact_json'](changed, expected))
        changed = copy.deepcopy(expected); changed['npcScoutSnapshot']['unknown'] = 0
        self.assertFalse(self.functions['exact_json'](changed, expected))

    def test_arrival_goldens_cannot_accept_other_fleet_or_time(self):
        for fleet_id, age in ((4, 65), (5, 3), (6, 3), (4, 3.00000001)):
            with self.subTest(fleet_id=fleet_id, age=age), self.assertRaises(AssertionError):
                self.functions['independent_scout_message'](fleet_id, age)

    def test_existing_native_rows_are_exact_and_screenshot_selector_is_keyed(self):
        for source in (self.economy, self.attack):
            self.assertIn("assert_message_rows(evidence, state['messages'])", source)
            self.assertIn('MESSAGE_ROWS_SAMPLE_JS', source)
            self.assertIn('(320, 390, 768, 1440)', source)
        self.assertIn('> p:first-of-type', self.economy)
        self.assertIn('data-message-id=', self.economy)
        self.assertNotIn('.space-message:nth-child(', self.economy)
        self.assertIn("[{**m, 'npcScoutSnapshot': None} for m in branch['save']['state']['messages']]", self.economy)
        self.assertIn("all(set(m) == {'id', 'at', 'text'}", self.economy)


if __name__ == '__main__':
    unittest.main()
