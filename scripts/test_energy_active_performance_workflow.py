"""Standalone diagnostic wiring checks; they do not assert a native pass."""
import hashlib
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DiagnosticWorkflow(unittest.TestCase):
    def setUp(self):
        self.text = (ROOT / '.github/workflows/energy-active-diagnostic.yml').read_text()

    def test_released_game_and_original_gates_are_fixed(self):
        self.assertEqual(hashlib.sha256((ROOT / '.github/workflows/p4-original-verify.yml').read_bytes()).hexdigest(),
                         '81b0d09c5b42021f328fdfde3da88ce301276976985c5c29193dc006f55bd895')
        for value in ('GAME_SHA: 6af7a5e85a522ba89478c5e95d919a2c04fb2e55',
                      'GAME_TREE: 24bcfa662e8cb47a5f2d24016d34986c3ea15617',
                      'RELEASE_SHA256: 327ead4aa33749136c24ff966a6b4337e9ad00114dd39907f8324abf4179d030',
                      'assert len(entries)==719', "assert len(release['files'])==62"):
            self.assertIn(value, self.text)

    def test_isolated_read_only_job_and_fixed_budget(self):
        self.assertIn("branches: ['codex/energy-active-diag-*']", self.text)
        self.assertNotIn('codex/infinity-rebuild-*', self.text)
        self.assertEqual(re.findall(r'^  ([A-Za-z0-9_-]+):$', self.text.split('jobs:\n', 1)[1], re.M), ['observation'])
        self.assertIn('    timeout-minutes: 15\n', self.text)
        self.assertIn('  contents: read\n', self.text)
        self.assertNotIn('contents: write', self.text)
        self.assertNotIn('continue-on-error', self.text)
        self.assertNotIn('workflow_run:', self.text)

    def test_native_and_strict_reader_are_distinct_ordered_stages(self):
        self.assertLess(self.text.index('node --import tsx scripts/energy-active-performance-fixture.mjs --source-root'),
                        self.text.index('timeout --signal=TERM --kill-after=5s 505s'))
        self.assertLess(self.text.index('timeout --signal=TERM --kill-after=5s 505s'),
                        self.text.index('--validate-raw-manifest'))
        self.assertLess(self.text.index('--validate-raw-manifest'),
                        self.text.index('python scripts/check-energy-active-performance.py'))
        self.assertIn('tests/energy-active-performance-fixture-checks.mjs "$EVIDENCE/fixtures" --source-root', self.text)
        self.assertIn("if: always() && steps.native.outcome != 'skipped'", self.text)

    def test_source_dist_and_failures_are_archived(self):
        for value in ('persist-credentials: false', 'git archive "$GAME_SHA"', 'git archive "$GITHUB_SHA"',
                      'game-dist.tar', 'source-identity.json', 'set -euo pipefail',
                      'if: always()', 'if-no-files-found: error', 'retention-days: 7'):
            self.assertIn(value, self.text)
        self.assertNotIn('cancel-in-progress', self.text)


if __name__ == '__main__':
    unittest.main()
