"""Python/Git-only mutation tests. Never runs Node or a browser."""
import copy
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('experiment', Path(__file__).with_name('check-fleet-row-experiment.py'))
P = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(P)
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = 'a' * 40


def valid_report(mode='native-timing'):
    report = {'baselineSourceSha': P.BASELINE, 'candidateSourceSha': CANDIDATE, 'mode': mode,
              'completed': True, 'observationsComplete': True, 'globalCleanupComplete': True, 'errors': [],
              'supervisor': {'workerExitCode': 0, 'timedOut': False, 'error': None,
                             'noObservedLiveOwnedDescendants': True, 'remainingLiveOwnedPids': []}}
    if mode == 'native-timing':
        report.update(plannedCases=P.schedule(), runs=[{**plan, 'valid': True, 'cleanupComplete': True,
                      'windows': [{'number': n, 'valid': True} for n in (1, 2, 3)]} for plan in P.schedule()],
                      comparisons={profile: {'pairs': [{}, {}, {}, {}]} for profile in P.FIXTURES})
    else:
        report.update(runs=[{'profile': profile, 'side': side, 'valid': True, 'cleanupComplete': True,
                            'snapshots': dict.fromkeys(P.STEPS)} for profile in P.FIXTURES for side in ('baseline', 'candidate')],
                      equivalence={profile: {'equal': True} for profile in P.FIXTURES})
    return report


class SourceScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reads the actual single-file worktree delta before or after commit.
        cls.patch = P.git(ROOT, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index',
                          '--no-color', '--unified=3', '--src-prefix=a/', '--dst-prefix=b/', P.BASELINE, '--', P.PRODUCTION_FILE)

    def trees(self):
        before = {P.PRODUCTION_FILE: ('100644', 'old'), 'scripts/check-ui-baseline.mjs': ('100644', 'unchanged')}
        after = {**before, P.PRODUCTION_FILE: ('100644', 'new'), **{p: ('100644', 'new') for p in P.ADDITIONS}}
        return before, after

    def test_exact_actual_patch_and_file_bytes(self):
        before, after = self.trees(); P.validate_delta(before, after, self.patch)
        self.assertEqual(P.digest((ROOT / P.PRODUCTION_FILE).read_bytes()), P.CANDIDATE_FILE_SHA256)

    def test_patch_byte_or_hunk_changed(self):
        before, after = self.trees()
        for patch in (self.patch + b'\n', self.patch.replace(b'rows.has', b'rows.get'), b''):
            with self.assertRaisesRegex(AssertionError, 'Full production patch'):
                P.validate_delta(before, after, patch)

    def test_second_baseline_file_changed(self):
        before, after = self.trees(); after['scripts/check-ui-baseline.mjs'] = ('100644', 'modified')
        with self.assertRaisesRegex(AssertionError, 'outside'):
            P.validate_delta(before, after, self.patch)

    def test_baseline_file_deleted(self):
        before, after = self.trees(); del after['scripts/check-ui-baseline.mjs']
        with self.assertRaisesRegex(AssertionError, 'removed'):
            P.validate_delta(before, after, self.patch)

    def test_extra_or_missing_addition(self):
        for key, add in [('src/hidden.ts', True), ('docs/FLEET_ROW_LOOKUP_EXPERIMENT.md', False)]:
            before, after = self.trees()
            if add: after[key] = ('100644', 'extra')
            else: del after[key]
            with self.assertRaisesRegex(AssertionError, 'additions'):
                P.validate_delta(before, after, self.patch)

    def test_changed_production_mode(self):
        before, after = self.trees(); after[P.PRODUCTION_FILE] = ('100755', 'new')
        with self.assertRaisesRegex(AssertionError, 'mode'):
            P.validate_delta(before, after, self.patch)

    def test_actual_bytes_modes_symlinks_and_untracked(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name); (root / 'src').mkdir(); (root / 'public').mkdir(); path = root / 'src/x.ts'; path.write_bytes(b'original')
            oid = hashlib.sha1(b'blob 8\0original').hexdigest(); expected = {'src/x.ts': ('100644', oid)}
            P.verify_files(root, expected)
            path.write_bytes(b'modified')
            with self.assertRaisesRegex(AssertionError, 'differs'): P.verify_files(root, expected)
            path.write_bytes(b'original'); path.chmod(0o755)
            with self.assertRaisesRegex(AssertionError, 'mode'): P.verify_files(root, expected)
            path.chmod(0o644); (root / 'src/extra.ts').write_bytes(b'extra')
            with self.assertRaisesRegex(AssertionError, 'Untracked'): P.verify_files(root, expected)
            (root / 'src/extra.ts').unlink(); path.unlink(); path.symlink_to('/dev/null')
            with self.assertRaisesRegex(AssertionError, 'Symlink'): P.verify_files(root, expected)


class EvidenceCompleteness(unittest.TestCase):
    def test_complete_modes(self):
        for mode in ('native-timing', 'controlled-equivalence'):
            P.validate_report(valid_report(mode), CANDIDATE, mode)

    def test_wrong_source_or_mode(self):
        for field, value in [('candidateSourceSha', 'b' * 40), ('baselineSourceSha', CANDIDATE), ('mode', 'controlled-equivalence')]:
            report = valid_report(); report[field] = value
            with self.assertRaises(AssertionError): P.validate_report(report, CANDIDATE, 'native-timing')

    def test_failure_or_incomplete_aggregate(self):
        for field, value in [('completed', False), ('observationsComplete', 1), ('globalCleanupComplete', False), ('errors', ['failure'])]:
            report = valid_report(); report[field] = value
            with self.assertRaisesRegex(AssertionError, 'Incomplete'): P.validate_report(report, CANDIDATE, 'native-timing')

    def test_supervisor_failure(self):
        for field, value in [('workerExitCode', 1), ('workerExitCode', False), ('timedOut', True), ('error', {}),
                             ('remainingLiveOwnedPids', [1]), ('noObservedLiveOwnedDescendants', False)]:
            report = valid_report(); report['supervisor'][field] = value
            with self.assertRaisesRegex(AssertionError, 'supervisor'): P.validate_report(report, CANDIDATE, 'native-timing')

    def test_incomplete_invalid_or_reordered_native(self):
        base = valid_report()
        changes = [lambda r: r['runs'].pop(), lambda r: r['runs'].reverse(), lambda r: r['plannedCases'].pop(),
                   lambda r: r['runs'][0]['windows'].pop(), lambda r: r['runs'][0].update(valid=False),
                   lambda r: r['runs'][0]['windows'][0].update(valid=False), lambda r: r['runs'][0].update(cleanupComplete=False),
                   lambda r: r['comparisons']['moderate']['pairs'].pop()]
        for change in changes:
            report = copy.deepcopy(base); change(report)
            with self.assertRaises(AssertionError): P.validate_report(report, CANDIDATE, 'native-timing')

    def test_boolean_schedule_ids_are_rejected(self):
        changes = [lambda r: r['plannedCases'][0].update(block=True), lambda r: r['runs'][0].update(pair=True),
                   lambda r: r['runs'][0].update(position=True), lambda r: r['runs'][0]['windows'][0].update(number=True)]
        for change in changes:
            report = valid_report(); change(report)
            with self.assertRaises(AssertionError): P.validate_report(report, CANDIDATE, 'native-timing')

    def test_incomplete_controlled_equality(self):
        changes = [lambda r: r['runs'].pop(), lambda r: r['runs'][0]['snapshots'].pop('manual-save'),
                   lambda r: r['equivalence']['combined'].update(equal=False)]
        for change in changes:
            report = valid_report('controlled-equivalence'); change(report)
            with self.assertRaises(AssertionError): P.validate_report(report, CANDIDATE, 'controlled-equivalence')

    def test_no_inherited_performance_success_threshold(self):
        report = valid_report(); report['comparisons']['moderate']['aggregate'] = {'candidateOverBaseline': 2}
        P.validate_report(report, CANDIDATE, 'native-timing')

    def test_workflow_is_independent_and_keeps_both_jobs(self):
        workflow = (ROOT / '.github/workflows/fleet-row-lookup.yml').read_text()
        for text in ["branches: ['codex/infinity-fleet-row-index-20261013']", 'fail-fast: false', 'minutes: 8', 'minutes: 15',
                     'node-version: 22', 'source --baseline', 'saves --baseline', 'if: always()', 'npm test --', 'npm run build',
                     'node node_modules/typescript/bin/tsc --noEmit', 'GIT_NO_REPLACE_OBJECTS']:
            self.assertIn(text, workflow)
        self.assertNotIn('continue-on-error', workflow)
        self.assertNotIn('pages: write', workflow)
        self.assertNotIn('pull_request:', workflow)


if __name__ == '__main__':
    unittest.main()
