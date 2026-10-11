"""Static preflight only. Does not launch Node, a browser, or claim native evidence."""
import ast
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


if __name__ == '__main__':
    unittest.main()
