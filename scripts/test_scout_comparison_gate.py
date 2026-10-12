"""Offline fail-closed scout comparison wiring against the exact split release.

No game, Node, browser or network is run. The frozen be0 comparison workflow
retains this exact historical contract; the successor's independently hash-pinned
whole-workflow test must pass before that historical body is inspected below.
All four same-SHA game jobs and the unchanged aggregate must still pass.
"""
from pathlib import Path
import subprocess
import unittest

from test_parallel_legacy_gate_split import (
    COMPARISON_ARTIFACT_PATH, COMPARISON_NATIVE_COMMAND, COMPARISON_OFFLINE_STEP,
    GAME_JOBS, SCOUT_ARTIFACT_PATH, SCOUT_IDENTITY_STEP, SCOUT_NATIVE_COMMAND,
    SCOUT_VERSION_LINES, WORKFLOW_PATH, assert_scout_comparison_preserved, jobs,
    run, steps, upload,
)


ROOT = Path(__file__).resolve().parents[1]
SPLIT_SHA = 'e729c7ff3c4ef519bfd14da9dc132ba7d971de48'
FROZEN_COMPARISON_SHA = 'be0e112b964179fc15b89daa4ae6f6a722b78a92'


def assert_comparison_gate(workflow, baseline):
    current, original = jobs(workflow), jobs(baseline)
    expected_jobs = set(GAME_JOBS) | {'required-gates'}
    assert set(original) == expected_jobs, 'pinned four-job workflow drift'
    assert set(current) == expected_jobs, 'missing or additional mandatory job'
    assert_scout_comparison_preserved(current['scout-rehearsal'], original['scout-rehearsal'])
    for name in (*GAME_JOBS[:-1], 'required-gates'):
        assert current[name] == original[name], ('immutable legacy or aggregate job drift', name)
    # Also preserve headers, job order, comments and every byte outside scout.
    normalized = workflow.replace(current['scout-rehearsal'], original['scout-rehearsal'], 1)
    assert normalized == baseline, 'unapproved workflow drift outside scout'


class ScoutComparisonGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Preserve the exact completed comparison-stage history, with no broad
        # allowance for successor commands. Its current extension is separately
        # audited against every byte of be0 before these historical tests run.
        from test_rehearsal_formation_copy_gate import assert_formation_copy_gate
        cls.workflow = subprocess.check_output(
            ['git', '-C', str(ROOT), 'show', f'{FROZEN_COMPARISON_SHA}:{WORKFLOW_PATH}'], text=True)
        assert_formation_copy_gate((ROOT / WORKFLOW_PATH).read_bytes().decode('utf-8'), cls.workflow)
        cls.baseline = subprocess.check_output(
            ['git', '-C', str(ROOT), 'show', f'{SPLIT_SHA}:{WORKFLOW_PATH}'], text=True)
        cls.current = jobs(cls.workflow)
        cls.original = jobs(cls.baseline)

    def assert_refused(self, before, after, job='scout-rehearsal'):
        target = self.current[job]
        self.assertEqual(target.count(before), 1, ('mutation anchor cardinality', before))
        changed = self.workflow.replace(target, target.replace(before, after, 1), 1)
        with self.assertRaises(AssertionError):
            assert_comparison_gate(changed, self.baseline)

    def test_only_explicit_scout_additions_are_allowed(self):
        assert_comparison_gate(self.workflow, self.baseline)

    def test_every_declared_comparison_entrypoint_is_present(self):
        for name in ('test_scout_comparison_provenance.py', 'test_scout_comparison_acceptance.py',
                     'test_scout_comparison_gate.py', 'browser-scout-comparison.py'):
            with self.subTest(source=name):
                source = ROOT / 'scripts' / name
                self.assertTrue(source.is_file())
                self.assertTrue(source.read_bytes())

    def test_offline_step_is_independent_unique_and_before_identity_and_browser(self):
        all_steps = steps(self.current['scout-rehearsal'])
        self.assertEqual(all_steps.count(COMPARISON_OFFLINE_STEP), 1)
        index = all_steps.index(COMPARISON_OFFLINE_STEP)
        self.assertTrue(all_steps[index + 1].startswith(SCOUT_IDENTITY_STEP))
        self.assertIn("'test_scout_rehearsal_acceptance.py'", all_steps[index - 1])
        self.assertIn("'test_scout_fixture_identity.py'", all_steps[index - 1])
        for command in run(COMPARISON_OFFLINE_STEP).splitlines():
            self.assertEqual(self.workflow.count(command), 1)
        native_index = next(i for i, step in enumerate(all_steps) if SCOUT_NATIVE_COMMAND in step)
        self.assertLess(index, native_index)

    def test_old_and_new_native_share_server_but_use_separate_exact_outputs(self):
        scout = self.current['scout-rehearsal']
        native = next(step for step in steps(scout) if SCOUT_NATIVE_COMMAND in step)
        original_native = next(step for step in steps(self.original['scout-rehearsal'])
                               if SCOUT_NATIVE_COMMAND in step)
        self.assertEqual(native.replace(COMPARISON_NATIVE_COMMAND, '', 1), original_native)
        self.assertIn(SCOUT_NATIVE_COMMAND + COMPARISON_NATIVE_COMMAND, native)
        self.assertEqual(native.count('npm run preview -- --host 127.0.0.1 --port 4173'), 1)
        self.assertEqual(native.count('trap \'kill "$SERVER_PID" || true\' EXIT'), 1)

    def test_artifact_addition_preserves_all_old_paths_metadata_and_source_archive(self):
        current = upload(self.current['scout-rehearsal'])
        original = upload(self.original['scout-rehearsal'])
        self.assertEqual(current.replace(COMPARISON_ARTIFACT_PATH, '', 1), original)
        self.assertIn(SCOUT_ARTIFACT_PATH + COMPARISON_ARTIFACT_PATH, current)
        self.assertIn('        if: always()\n', current)
        self.assertIn('          if-no-files-found: error\n', current)
        self.assertIn('          retention-days: 7\n', current)

    def test_missing_each_offline_test_or_whole_step_is_refused(self):
        for line in COMPARISON_OFFLINE_STEP.splitlines(keepends=True)[2:]:
            with self.subTest(command=line):
                self.assert_refused(line, '')
        self.assert_refused(COMPARISON_OFFLINE_STEP, '')

    def test_duplicate_reordered_or_repositioned_offline_checks_are_refused(self):
        self.assert_refused(COMPARISON_OFFLINE_STEP, COMPARISON_OFFLINE_STEP * 2)
        lines = COMPARISON_OFFLINE_STEP.splitlines(keepends=True)
        self.assert_refused(COMPARISON_OFFLINE_STEP, ''.join(lines[:2] + list(reversed(lines[2:]))))
        self.assert_refused(COMPARISON_OFFLINE_STEP + SCOUT_IDENTITY_STEP,
                            SCOUT_IDENTITY_STEP + COMPARISON_OFFLINE_STEP)

    def test_missing_old_or_new_native_gate_is_refused(self):
        for command in (SCOUT_NATIVE_COMMAND, COMPARISON_NATIVE_COMMAND):
            with self.subTest(command=command):
                self.assert_refused(command, '')
                self.assert_refused(command, command * 2)

    def test_new_native_must_immediately_follow_complete_old_command(self):
        pair = SCOUT_NATIVE_COMMAND + COMPARISON_NATIVE_COMMAND
        self.assert_refused(pair, COMPARISON_NATIVE_COMMAND + SCOUT_NATIVE_COMMAND)
        self.assert_refused(pair, SCOUT_NATIVE_COMMAND + '          true\n' + COMPARISON_NATIVE_COMMAND)
        self.assert_refused(pair, SCOUT_NATIVE_COMMAND + '          exit 0\n' + COMPARISON_NATIVE_COMMAND)

    def test_every_old_and_new_native_argument_is_exact(self):
        mutations = (
            ('--url http://127.0.0.1:4173/Infinity/', '--url http://127.0.0.1:4193/Infinity/'),
            ('--natural-report scout-rehearsal-source-evidence/natural-report.json', '--natural-report other.json'),
            ('--expected-report-sha256 "$(sha256sum scout-rehearsal-source-evidence/natural-report.json | cut -d\' \' -f1)"',
             '--expected-report-sha256 "' + '0' * 64 + '"'),
            ('--expected-sha "$GITHUB_SHA"', '--expected-sha previous'),
            ('--chromium "$CHROME"', '--chromium other-browser'),
        )
        for command in (SCOUT_NATIVE_COMMAND, COMPARISON_NATIVE_COMMAND):
            for before, after in mutations:
                with self.subTest(command=command.split()[1], parameter=before):
                    self.assertIn(before, command)
                    self.assert_refused(command, command.replace(before, after, 1))
            self.assert_refused(command, command.replace('--output ', '--output wrong-', 1))

    def test_skipped_optional_or_error_masking_checks_are_refused(self):
        offline = COMPARISON_OFFLINE_STEP
        for metadata in ('        if: false\n', '        if: ${{ success() && false }}\n',
                         '        continue-on-error: true\n', '        timeout-minutes: 30\n',
                         '        shell: bash +e {0}\n'):
            with self.subTest(metadata=metadata):
                self.assert_refused(offline, offline.replace('        run: |\n', metadata + '        run: |\n', 1))
        native_header = '      - name: Native scout rehearsal, authority and four-width acceptance\n'
        for metadata in ('        if: false\n', '        continue-on-error: true\n'):
            self.assert_refused(native_header, native_header + metadata)
        for command in (SCOUT_NATIVE_COMMAND, COMPARISON_NATIVE_COMMAND):
            for suffix in (' || true\n', '; true\n', ' &\n'):
                with self.subTest(command=command.split()[1], suffix=suffix):
                    self.assert_refused(command, command.rstrip('\n') + suffix)

    def test_original_job_and_browser_prerequisite_budgets_cannot_shrink_or_expand(self):
        for name, minutes in zip(GAME_JOBS, (45, 45, 25, 25)):
            for changed in (minutes - 1, minutes + 1):
                with self.subTest(job=name, minutes=changed):
                    self.assert_refused(f'    timeout-minutes: {minutes}\n',
                                        f'    timeout-minutes: {changed}\n', name)
        for changed in (3, 8):
            self.assert_refused('        timeout-minutes: 4\n', f'        timeout-minutes: {changed}\n')

    def test_missing_source_archive_or_any_original_or_new_artifact_path_is_refused(self):
        self.assert_refused('        run: git archive --format=zip --prefix=Infinity/ HEAD > scout-rehearsal-source.zip\n', '')
        archive = upload(self.current['scout-rehearsal'])
        paths = [line + '\n' for line in archive.splitlines() if line.startswith('            ')]
        self.assertEqual(len(paths), 8)
        for path in paths:
            with self.subTest(path=path):
                self.assert_refused(path, '')
        self.assert_refused(COMPARISON_ARTIFACT_PATH, COMPARISON_ARTIFACT_PATH * 2)
        self.assert_refused('          if-no-files-found: error\n', '          if-no-files-found: warn\n')
        self.assert_refused(archive, archive.replace('        if: always()\n', '        if: success()\n', 1))

    def test_source_preparation_and_full_checkout_cannot_be_weakened(self):
        for before, after in (
            ('          ref: ${{ github.sha }}\n', '          ref: main\n'),
            ('          fetch-depth: 0\n', '          fetch-depth: 1\n'),
            ('          persist-credentials: false\n', '          persist-credentials: true\n'),
            ('      - run: npm ci\n', ''),
            ('      - run: npm run build\n', ''),
            ('          git worktree add --detach "$RUNNER_TEMP/scout-current" "$GITHUB_SHA"\n', ''),
            ('          test -z "$(git -C "$RUNNER_TEMP/scout-current" status --porcelain=v1 --untracked-files=all)"\n', ''),
            ('          assert before_lock == after_lock\n', ''),
        ):
            with self.subTest(source=before):
                self.assert_refused(before, after)

    def test_release_allowance_is_two_exact_lines_only(self):
        for old in SCOUT_VERSION_LINES:
            new = old.replace('0.6.22-alpha.1', '0.6.22-alpha.2')
            for replacement in (old, '', new.replace('alpha.2', 'alpha.3'), new + new):
                with self.subTest(line=old, replacement=replacement):
                    self.assert_refused(new, replacement)
        self.assert_refused("          assert before_lock['version'] == before_lock['packages']['']['version'] == '0.6.21-alpha.1'\n", '')

    def test_all_four_jobs_and_unchanged_fail_closed_aggregate_are_mandatory(self):
        for name in (*GAME_JOBS, 'required-gates'):
            with self.subTest(job=name):
                changed = self.workflow.replace(f'  {name}:\n' + self.current[name], '', 1)
                with self.assertRaises(AssertionError):
                    assert_comparison_gate(changed, self.baseline)
        aggregate = 'required-gates'
        self.assert_refused('    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal]\n',
                            '    needs: [verify, verify-continuation, npc-orbital]\n', aggregate)
        self.assert_refused("              assert job['result'] == 'success', (name, job['result'])\n",
                            "              assert job['result'] in ('success', 'skipped'), (name, job['result'])\n", aggregate)
        self.assert_refused("          scout = hashes_for(('scout-rehearsal',), 'scout-fixture-sha256')\n", '', aggregate)

    def test_existing_legacy_native_and_watchdog_commands_remain_immutable(self):
        for name in ('verify', 'verify-continuation', 'npc-orbital'):
            candidates = [line + '\n' for line in self.current[name].splitlines()
                          if line.startswith('          python scripts/browser-')]
            self.assertTrue(candidates, name)
            for command in candidates:
                with self.subTest(job=name, command=command):
                    self.assert_refused(command, '', name)


if __name__ == '__main__':
    unittest.main()
