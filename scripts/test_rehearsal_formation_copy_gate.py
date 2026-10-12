"""Offline fail-closed formation-copy wiring against the exact be0 release.

This is mandatory wiring and source-version evidence only, never a native run,
wall-time measurement, same-SHA CI success, or release approval. The complete
pinned workflow is compared byte-for-byte after only the enumerated additions.
"""
import ast
import hashlib
import inspect
import json
from pathlib import Path
import subprocess
import unittest

from test_parallel_legacy_gate_split import (
    COMPARISON_ARTIFACT_PATH, COMPARISON_NATIVE_COMMAND, COMPARISON_OFFLINE_STEP,
    GAME_JOBS, SCOUT_IDENTITY_STEP, SCOUT_NATIVE_COMMAND, WORKFLOW_PATH,
    jobs, run, steps, upload,
)

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = 'be0e112b964179fc15b89daa4ae6f6a722b78a92'
BASE_WORKFLOW_SHA256 = '6b0c67fa747437e3dfe1ae7c482726e676307a2e374de05d5d2681b001ed67a5'
OLD_VERSION = '0.6.22-alpha.2'
VERSION = '0.6.23-alpha.1'
FORMATION_VERSION_LINES = (
    "          assert after_lock['version'] == after_lock['packages']['']['version'] == '0.6.22-alpha.2'\n",
    "          before_lock['version'] = before_lock['packages']['']['version'] = '0.6.22-alpha.2'\n",
)
FORMATION_OFFLINE_STEP = (
    '      - name: Offline exact formation copy acceptance source seal and mandatory gate\n'
    '        run: |\n'
    "          python -m unittest discover -s scripts -p 'test_rehearsal_formation_copy_acceptance.py' -v\n"
    '          python scripts/test_rehearsal_formation_copy_provenance.py --verify-candidate "$GITHUB_SHA" -v\n'
    "          python -m unittest discover -s scripts -p 'test_rehearsal_formation_copy_gate.py' -v\n"
)
FORMATION_NATIVE_COMMAND = COMPARISON_NATIVE_COMMAND.replace(
    'scripts/browser-scout-comparison.py', 'scripts/browser-rehearsal-formation-copy.py').replace(
    '--output scout-comparison-evidence',
    '--expected-version 0.6.23-alpha.1 --runtime-node "$(node --version)" --output rehearsal-formation-copy-evidence')
FORMATION_ARTIFACT_PATH = '            rehearsal-formation-copy-evidence\n'


def baseline_workflow():
    return subprocess.check_output(
        ['git', '-C', str(ROOT), 'show', f'{BASE_SHA}:{WORKFLOW_PATH}']).decode('utf-8')


def expected_formation_workflow(baseline):
    """Construct the sole accepted workflow from a hash-pinned full baseline.

    No arbitrary diff, line, comment, command or job is ignored. Existing
    historical gate tests may inspect the returned baseline only after this
    independent complete current-workflow check has succeeded.
    """
    assert hashlib.sha256(baseline.encode('utf-8')).hexdigest() == BASE_WORKFLOW_SHA256, 'pinned be0 workflow bytes differ'
    expected = baseline
    for old in FORMATION_VERSION_LINES:
        assert expected.count(old) == 1, 'pinned formation release line cardinality'
        expected = expected.replace(old, old.replace(OLD_VERSION, VERSION), 1)
    for old, new in (
        (COMPARISON_OFFLINE_STEP + SCOUT_IDENTITY_STEP,
         COMPARISON_OFFLINE_STEP + FORMATION_OFFLINE_STEP + SCOUT_IDENTITY_STEP),
        (SCOUT_NATIVE_COMMAND + COMPARISON_NATIVE_COMMAND,
         SCOUT_NATIVE_COMMAND + COMPARISON_NATIVE_COMMAND + FORMATION_NATIVE_COMMAND),
        (COMPARISON_ARTIFACT_PATH, COMPARISON_ARTIFACT_PATH + FORMATION_ARTIFACT_PATH),
    ):
        assert expected.count(old) == 1, 'pinned insertion anchor cardinality'
        assert new not in expected, 'formation addition already in pinned release'
        expected = expected.replace(old, new, 1)
    return expected


def assert_formation_copy_gate(workflow, baseline):
    assert workflow == expected_formation_workflow(baseline), 'unapproved formation workflow drift'
    return baseline


class RehearsalFormationCopyGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / WORKFLOW_PATH).read_bytes().decode('utf-8')
        cls.baseline = baseline_workflow()
        cls.current = jobs(cls.workflow)
        cls.original = jobs(cls.baseline)

    def assert_refused(self, before, after, job='scout-rehearsal'):
        target = self.current[job]
        self.assertEqual(target.count(before), 1, ('mutation anchor cardinality', before))
        changed = self.workflow.replace(target, target.replace(before, after, 1), 1)
        with self.assertRaises(AssertionError):
            assert_formation_copy_gate(changed, self.baseline)

    def test_only_enumerated_additions_to_hash_pinned_full_be0_are_accepted(self):
        self.assertEqual(assert_formation_copy_gate(self.workflow, self.baseline), self.baseline)
        with self.assertRaises(AssertionError):
            assert_formation_copy_gate(self.workflow, self.baseline + '\n')

    def test_all_four_jobs_aggregate_headers_and_outside_scout_are_wholebyte_immutable(self):
        self.assertEqual(set(self.current), set(GAME_JOBS) | {'required-gates'})
        for name in (*GAME_JOBS[:-1], 'required-gates'):
            self.assertEqual(self.current[name], self.original[name])
        self.assertEqual(self.workflow.replace(self.current['scout-rehearsal'], self.original['scout-rehearsal'], 1), self.baseline)
        for prefix in ('# unexpected metadata\n', 'env:\n  OPTIONAL: "true"\n'):
            with self.assertRaises(AssertionError):
                assert_formation_copy_gate(prefix + self.workflow, self.baseline)
        with self.assertRaises(AssertionError):
            assert_formation_copy_gate(self.workflow.replace('\n', '\r\n'), self.baseline)

    def test_original_timeouts_and_browser_prerequisites_never_expand_or_shrink(self):
        for name, minutes in zip(GAME_JOBS, (45, 45, 25, 25)):
            for value in (minutes - 1, minutes + 1):
                self.assert_refused(f'    timeout-minutes: {minutes}\n', f'    timeout-minutes: {value}\n', name)
        for value in (3, 5):
            self.assert_refused('        timeout-minutes: 4\n', f'        timeout-minutes: {value}\n')

    def test_no_job_may_be_missing_added_or_reordered(self):
        for name in (*GAME_JOBS, 'required-gates'):
            block = f'  {name}:\n' + self.current[name]
            for changed in (self.workflow.replace(block, '', 1), self.workflow + block):
                with self.subTest(job=name), self.assertRaises(AssertionError):
                    assert_formation_copy_gate(changed, self.baseline)
        with self.assertRaises(AssertionError):
            assert_formation_copy_gate(self.workflow + '  optional:\n    runs-on: ubuntu-latest\n', self.baseline)

    def test_fail_closed_aggregate_and_all_identity_links_remain_exact(self):
        aggregate = 'required-gates'
        self.assert_refused('    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal]\n',
                            '    needs: [verify, verify-continuation, npc-orbital]\n', aggregate)
        self.assert_refused("              assert job['result'] == 'success', (name, job['result'])\n",
                            "              assert job['result'] in ('success', 'skipped'), (name, job['result'])\n", aggregate)
        for line in self.current[aggregate].splitlines(keepends=True):
            if ' = hashes_for(' in line:
                self.assert_refused(line, '', aggregate)
        for name in GAME_JOBS:
            line = next(line for line in self.current[name].splitlines(keepends=True)
                        if 'python scripts/parallel-gate-identity.py ' in line)
            self.assert_refused(line, '', name)

    def test_offline_commands_are_unique_ordered_mandatory_before_identity_and_browser(self):
        all_steps = steps(self.current['scout-rehearsal'])
        self.assertEqual(all_steps.count(FORMATION_OFFLINE_STEP), 1)
        index = all_steps.index(FORMATION_OFFLINE_STEP)
        self.assertEqual(all_steps[index - 1], COMPARISON_OFFLINE_STEP)
        self.assertTrue(all_steps[index + 1].startswith(SCOUT_IDENTITY_STEP))
        native_index = next(i for i, step in enumerate(all_steps) if SCOUT_NATIVE_COMMAND in step)
        self.assertLess(index, native_index)
        for command in run(FORMATION_OFFLINE_STEP).splitlines():
            self.assertEqual(self.workflow.count(command), 1)
        self.assertIn('--verify-candidate "$GITHUB_SHA"', FORMATION_OFFLINE_STEP)

    def test_native_immediately_follows_unchanged_rehearsal_and_comparison_on_same_service(self):
        native = next(step for step in steps(self.current['scout-rehearsal']) if SCOUT_NATIVE_COMMAND in step)
        old_native = next(step for step in steps(self.original['scout-rehearsal']) if SCOUT_NATIVE_COMMAND in step)
        self.assertEqual(native.replace(FORMATION_NATIVE_COMMAND, '', 1), old_native)
        self.assertIn(SCOUT_NATIVE_COMMAND + COMPARISON_NATIVE_COMMAND + FORMATION_NATIVE_COMMAND, native)
        self.assertEqual(native.count('npm run preview -- --host 127.0.0.1 --port 4173'), 1)
        self.assertEqual(native.count('trap \'kill "$SERVER_PID" || true\' EXIT'), 1)
        self.assertEqual(native.count('CHROME="$(command -v google-chrome || command -v google-chrome-stable)"'), 1)

    def test_new_native_uses_independent_browser_context_output_and_unchanged_hard_bounds(self):
        source = (ROOT / 'scripts/browser-rehearsal-formation-copy.py').read_text()
        tree = ast.parse(source)
        functions = {node.name: ast.get_source_segment(source, node)
                     for node in tree.body if isinstance(node, ast.FunctionDef)}
        self.assertIn('browser = playwright.chromium.launch(', functions['main'])
        self.assertIn("'boot'", functions['load_reviewed_helpers'])
        helper_source = (ROOT / 'scripts/browser-scout-rehearsal.py').read_text()
        boot = next(node for node in ast.parse(helper_source).body
                    if isinstance(node, ast.FunctionDef) and node.name == 'boot')
        self.assertIn('browser.new_context(', ast.get_source_segment(helper_source, boot))
        self.assertIn('signal.alarm(600)', functions['main'])
        self.assertIn('time.monotonic() + 610', functions['supervise'])
        for forbidden in ('connect_over_cdp', 'browser.contexts[', 'scout-comparison-evidence', 'scout-rehearsal-evidence'):
            self.assertNotIn(forbidden, source)
        self.assertIn('--output rehearsal-formation-copy-evidence\n', FORMATION_NATIVE_COMMAND)

    def test_every_declared_new_test_native_and_seal_entrypoint_exists(self):
        for name in ('test_rehearsal_formation_copy_acceptance.py', 'test_rehearsal_formation_copy_provenance.py',
                     'test_rehearsal_formation_copy_gate.py', 'browser-rehearsal-formation-copy.py'):
            path = ROOT / 'scripts' / name
            self.assertTrue(path.is_file(), name)
            self.assertTrue(path.read_bytes(), name)
        acceptance = ast.parse((ROOT / 'scripts/test_rehearsal_formation_copy_acceptance.py').read_text())
        self.assertEqual(sum(isinstance(node, ast.FunctionDef) and node.name.startswith('test_')
                             for node in ast.walk(acceptance)), 36)

    def test_offline_missing_duplicate_reordered_extra_or_repositioned_command_is_refused(self):
        self.assert_refused(FORMATION_OFFLINE_STEP, '')
        self.assert_refused(FORMATION_OFFLINE_STEP, FORMATION_OFFLINE_STEP * 2)
        lines = FORMATION_OFFLINE_STEP.splitlines(keepends=True)
        for line in lines[2:]:
            self.assert_refused(line, '')
            self.assert_refused(line, line * 2)
            self.assert_refused(line, line.rstrip('\n') + ' || true\n')
        self.assert_refused(FORMATION_OFFLINE_STEP, ''.join(lines[:2] + lines[2:][::-1]))
        self.assert_refused(FORMATION_OFFLINE_STEP, FORMATION_OFFLINE_STEP + '          true\n')
        pair = COMPARISON_OFFLINE_STEP + FORMATION_OFFLINE_STEP
        self.assert_refused(pair, FORMATION_OFFLINE_STEP + COMPARISON_OFFLINE_STEP)
        self.assert_refused('--verify-candidate "$GITHUB_SHA"', '--verify-candidate HEAD')

    def test_skipped_optional_error_masking_or_backgrounded_steps_are_refused(self):
        for metadata in ('        if: false\n', '        if: ${{ success() && false }}\n',
                         '        continue-on-error: true\n', '        timeout-minutes: 30\n',
                         '        shell: bash +e {0}\n'):
            self.assert_refused(FORMATION_OFFLINE_STEP,
                FORMATION_OFFLINE_STEP.replace('        run: |\n', metadata + '        run: |\n', 1))
        native_header = '      - name: Native scout rehearsal, authority and four-width acceptance\n'
        for metadata in ('        if: false\n', '        continue-on-error: true\n'):
            self.assert_refused(native_header, native_header + metadata)
        for command in (SCOUT_NATIVE_COMMAND, COMPARISON_NATIVE_COMMAND, FORMATION_NATIVE_COMMAND):
            for suffix in (' || true\n', '; true\n', ' &\n'):
                self.assert_refused(command, command.rstrip('\n') + suffix)

    def test_missing_duplicated_reordered_or_separated_native_gate_is_refused(self):
        for command in (SCOUT_NATIVE_COMMAND, COMPARISON_NATIVE_COMMAND, FORMATION_NATIVE_COMMAND):
            self.assert_refused(command, '')
            self.assert_refused(command, command * 2)
        pair = COMPARISON_NATIVE_COMMAND + FORMATION_NATIVE_COMMAND
        self.assert_refused(pair, FORMATION_NATIVE_COMMAND + COMPARISON_NATIVE_COMMAND)
        for line in ('          true\n', '          exit 0\n', '          set +e\n'):
            self.assert_refused(pair, COMPARISON_NATIVE_COMMAND + line + FORMATION_NATIVE_COMMAND)

    def test_each_old_and_new_native_argument_is_exact(self):
        mutations = (
            ('--url http://127.0.0.1:4173/Infinity/', '--url http://127.0.0.1:4193/Infinity/'),
            ('--natural-report scout-rehearsal-source-evidence/natural-report.json', '--natural-report old-report.json'),
            ('--expected-report-sha256 "$(sha256sum scout-rehearsal-source-evidence/natural-report.json | cut -d\' \' -f1)"',
             '--expected-report-sha256 "' + '0' * 64 + '"'),
            ('--expected-sha "$GITHUB_SHA"', '--expected-sha previous'),
            ('--chromium "$CHROME"', '--chromium other-browser'),
        )
        for command in (SCOUT_NATIVE_COMMAND, COMPARISON_NATIVE_COMMAND, FORMATION_NATIVE_COMMAND):
            for before, after in mutations:
                self.assertIn(before, command)
                self.assert_refused(command, command.replace(before, after, 1))
            self.assert_refused(command, command.replace('--output ', '--output wrong-', 1))
        for before, after in (('--expected-version 0.6.23-alpha.1', '--expected-version 0.6.22-alpha.2'),
                              ('--runtime-node "$(node --version)"', '--runtime-node v22.0.0'),
                              ('--runtime-node "$(node --version)"', '')):
            self.assert_refused(FORMATION_NATIVE_COMMAND, FORMATION_NATIVE_COMMAND.replace(before, after, 1))

    def test_artifact_adds_one_directory_and_preserves_every_original_path_and_metadata(self):
        current = upload(self.current['scout-rehearsal'])
        original = upload(self.original['scout-rehearsal'])
        self.assertEqual(current.replace(FORMATION_ARTIFACT_PATH, '', 1), original)
        self.assertEqual(current.count(FORMATION_ARTIFACT_PATH), 1)
        self.assertIn(COMPARISON_ARTIFACT_PATH + FORMATION_ARTIFACT_PATH, current)
        self.assertIn('        if: always()\n', current)
        self.assertIn('          if-no-files-found: error\n', current)
        self.assertIn('          retention-days: 7\n', current)
        self.assertIn('git archive --format=zip --prefix=Infinity/ HEAD > scout-rehearsal-source.zip\n', self.workflow)

    def test_missing_duplicate_extra_artifact_or_incomplete_source_archive_is_refused(self):
        archive = upload(self.current['scout-rehearsal'])
        paths = [line + '\n' for line in archive.splitlines() if line.startswith('            ')]
        self.assertEqual(len(paths), 9)
        for path in paths:
            self.assert_refused(path, '')
        self.assert_refused(FORMATION_ARTIFACT_PATH, FORMATION_ARTIFACT_PATH * 2)
        self.assert_refused(FORMATION_ARTIFACT_PATH, FORMATION_ARTIFACT_PATH + '            extra-evidence\n')
        self.assert_refused('          if-no-files-found: error\n', '          if-no-files-found: warn\n')
        self.assert_refused(archive, archive.replace('        if: always()\n', '        if: success()\n', 1))
        self.assert_refused('        run: git archive --format=zip --prefix=Infinity/ HEAD > scout-rehearsal-source.zip\n',
                            '        run: git archive --format=zip --prefix=Infinity/ HEAD src > scout-rehearsal-source.zip\n')

    def test_source_checkout_natural_producer_historical_lock_and_browser_remain_exact(self):
        for before, after in (
            ('          ref: ${{ github.sha }}\n', '          ref: main\n'),
            ('          fetch-depth: 0\n', '          fetch-depth: 1\n'),
            ('          persist-credentials: false\n', '          persist-credentials: true\n'),
            ('      - run: npm ci\n', ''), ('      - run: npm run build\n', ''),
            ('          git worktree add --detach "$RUNNER_TEMP/scout-current" "$GITHUB_SHA"\n', ''),
            ('          test -z "$(git -C "$RUNNER_TEMP/scout-current" status --porcelain=v1 --untracked-files=all)"\n', ''),
            ("          assert before_lock['version'] == before_lock['packages']['']['version'] == '0.6.21-alpha.1'\n", ''),
            ('          assert before_lock == after_lock\n', ''),
            ('          test "$READY" = 1\n', ''),
        ):
            self.assert_refused(before, after)
        natural = next(line for line in self.current['scout-rehearsal'].splitlines(keepends=True)
                       if '(cd "$RUNNER_TEMP/scout-current" && node --import tsx' in line)
        self.assert_refused(natural, '')

    def test_only_two_exact_workflow_release_lines_change(self):
        for old in FORMATION_VERSION_LINES:
            new = old.replace(OLD_VERSION, VERSION)
            for changed in (old, '', new * 2, new.replace(VERSION, '0.6.23-alpha.2')):
                self.assert_refused(new, changed)

    def test_package_lock_and_identity_source_allow_only_exact_version_bytes(self):
        for relative, cardinality in (('package.json', 1), ('package-lock.json', 2),
                                      ('scripts/scout_fixture_identity.py', 2),
                                      ('scripts/parallel-gate-identity.py', 1)):
            before = subprocess.check_output(['git', '-C', str(ROOT), 'show', f'{BASE_SHA}:{relative}'])
            self.assertEqual(before.count(OLD_VERSION.encode()), cardinality, relative)
            self.assertEqual((ROOT / relative).read_bytes(), before.replace(OLD_VERSION.encode(), VERSION.encode()), relative)
        current = json.loads((ROOT / 'package-lock.json').read_bytes())
        historical = json.loads(subprocess.check_output(['git', '-C', str(ROOT), 'show',
            'cc19bf5e1a459cf8e667ca55f4891ca9ffd25a71:package-lock.json']))
        self.assertEqual(historical['version'], '0.6.21-alpha.1')
        self.assertEqual(historical['packages']['']['version'], '0.6.21-alpha.1')
        historical['version'] = historical['packages']['']['version'] = VERSION
        self.assertEqual(current, historical)

    def test_scout_identity_keeps_original_three_parameter_signature(self):
        from scout_fixture_identity import scout_fixture_identity
        self.assertEqual(str(inspect.signature(scout_fixture_identity)), '(workspace, clean_source_summary, runtime)')

    def test_every_legacy_native_command_remains_immutable(self):
        for name in ('verify', 'verify-continuation', 'npc-orbital'):
            commands = [line + '\n' for line in self.current[name].splitlines()
                        if line.startswith('          python scripts/browser-')]
            self.assertTrue(commands, name)
            for command in commands:
                self.assert_refused(command, '', name)


if __name__ == '__main__':
    unittest.main()
