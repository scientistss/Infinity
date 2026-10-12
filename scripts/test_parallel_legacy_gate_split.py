"""Offline CI wiring contract against the last unsplit, immutable r14 workflow.

This test runs no game, Node, browser, network request, or Git write. Passing it
establishes only the gate wiring; the exact commit still needs all four CI jobs
and the fail-closed aggregate to pass before any release claim is possible.
"""
import collections
from pathlib import Path
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = '.github/workflows/p4-original-verify.yml'
BASE_SHA = 'd3798afa99ac0f7c0d89579b79792a21855c62df'
NEW_TEST = "python -m unittest discover -s scripts -p 'test_parallel_legacy_gate_split.py' -v"
FIRST_NATIVE = 'python scripts/browser-render-scheduling.py '
CONTINUATION_NATIVE = 'python scripts/browser-demolition.py '
LAST_PROTECTION = 'python scripts/browser-ring-protection.py '
WATCHDOG = 'python scripts/browser-presentation-performance.py --watchdog-self-test'
GAME_JOBS = ('verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal')
SCOUT_VERSION_LINES = (
    "          assert after_lock['version'] == after_lock['packages']['']['version'] == '0.6.22-alpha.1'\n",
    "          before_lock['version'] = before_lock['packages']['']['version'] = '0.6.22-alpha.1'\n",
)
COMPARISON_OFFLINE_STEP = (
    '      - name: Offline exact scout comparison provenance acceptance and mandatory gate\n'
    '        run: |\n'
    "          python -m unittest discover -s scripts -p 'test_scout_comparison_provenance.py' -v\n"
    "          python -m unittest discover -s scripts -p 'test_scout_comparison_acceptance.py' -v\n"
    "          python -m unittest discover -s scripts -p 'test_scout_comparison_gate.py' -v\n"
)
SCOUT_IDENTITY_STEP = '      - name: Bind exact scout source assets runtime and complete fixture outputs\n'
SCOUT_NATIVE_COMMAND = (
    '          python scripts/browser-scout-rehearsal.py'
    ' --url http://127.0.0.1:4173/Infinity/'
    ' --natural-report scout-rehearsal-source-evidence/natural-report.json'
    ' --expected-report-sha256 "$(sha256sum scout-rehearsal-source-evidence/natural-report.json | cut -d\' \' -f1)"'
    ' --expected-sha "$GITHUB_SHA" --chromium "$CHROME" --output scout-rehearsal-evidence\n'
)
COMPARISON_NATIVE_COMMAND = SCOUT_NATIVE_COMMAND.replace(
    'scripts/browser-scout-rehearsal.py', 'scripts/browser-scout-comparison.py').replace(
    '--output scout-rehearsal-evidence', '--output scout-comparison-evidence')
SCOUT_ARTIFACT_PATH = '            scout-rehearsal-evidence\n'
COMPARISON_ARTIFACT_PATH = '            scout-comparison-evidence\n'


def jobs(workflow):
    """Read this workflow's explicit job blocks without a YAML dependency."""
    body = workflow.split('\njobs:\n', 1)[1]
    markers = list(re.finditer(r'^  ([a-z][a-z0-9-]*):\n', body, re.MULTILINE))
    result = {}
    for i, marker in enumerate(markers):
        name = marker.group(1)
        assert name not in result, ('duplicate job', name)
        end = markers[i + 1].start() if i + 1 < len(markers) else len(body)
        result[name] = body[marker.end():end]
    return result


def steps(job):
    markers = list(re.finditer(r'^      - ', job, re.MULTILINE))
    return [job[marker.start():markers[i + 1].start() if i + 1 < len(markers) else len(job)]
            for i, marker in enumerate(markers)]


def run(step):
    match = re.search(r'^(?:      - |        )run: (.*)$', step, re.MULTILINE)
    if not match:
        return ''
    if match.group(1) != '|':
        return match.group(1) + '\n'
    lines = []
    for line in step[match.end() + 1:].splitlines():
        if line and not line.startswith('          '):
            break
        lines.append(line[10:] if line else '')
    return '\n'.join(lines) + '\n'


def significant(text):
    # Ignore only non-executable comments and whitespace-only lines. Retain
    # indentation inside Python heredocs and every byte of each command.
    return [line for line in text.splitlines()
            if line.strip() and not line.lstrip().startswith('#')]


def native_parts(job, first_command):
    all_steps = steps(job)
    matches = [i for i, step in enumerate(all_steps) if first_command in run(step)]
    assert len(matches) == 1, ('native step cardinality', first_command, matches)
    index = matches[0]
    return all_steps[:index], all_steps[index], all_steps[index + 1:]


def preparation(all_steps):
    result = []
    for step in all_steps:
        # Adding this regression test is the only permitted new setup command.
        # It can be its own step or part of the existing offline-test block.
        if significant(run(step)) == [NEW_TEST]:
            continue
        lines = [line for line in significant(step)
                 if line.strip() != NEW_TEST and not line.startswith('      - name:')]
        result.append(lines)
    return result


def assert_preserved(workflow, baseline):
    current, original = jobs(workflow), jobs(baseline)
    old_pre, old_step, _ = native_parts(original['verify'], FIRST_NATIVE)
    pre_a, native_a, _ = native_parts(current['verify'], FIRST_NATIVE)
    pre_b, native_b, _ = native_parts(current['verify-continuation'], CONTINUATION_NATIVE)
    assert preparation(pre_a) == preparation(old_pre), 'group A preparation drift'
    assert preparation(pre_b) == preparation(old_pre), 'group B preparation drift'
    for native in (native_a, native_b):
        metadata = native.split('        run: |\n', 1)[0]
        assert significant(metadata) == [native.splitlines()[0]], 'native step conditional or metadata drift'
    old_lines = significant(run(old_step))
    first = next(i for i, line in enumerate(old_lines) if line.startswith(FIRST_NATIVE))
    boundary = next(i for i, line in enumerate(old_lines) if line.startswith(CONTINUATION_NATIVE))
    assert old_lines[boundary - 1].startswith(LAST_PROTECTION), 'pinned split boundary changed'
    assert significant(run(native_a)) == old_lines[:boundary], 'group A native commands drift'
    assert significant(run(native_b)) == old_lines[:first] + old_lines[boundary:], 'group B native commands drift'
    return old_lines[:first], old_lines[first:boundary], old_lines[boundary:]


def upload(job):
    found = [step for step in steps(job) if 'uses: actions/upload-artifact@v4' in step]
    assert len(found) == 1, ('artifact upload cardinality', len(found))
    return found[0]


def artifact_name(step):
    return re.search(r'^          name: (.+)$', step, re.MULTILINE).group(1)


def without_artifact_name(step):
    return significant(re.sub(r'^          name: .+\n', '', step, flags=re.MULTILINE))


def assert_scout_comparison_preserved(current, original):
    """Allow only four explicit additions to the immutable scout job.

    Validate cardinality, placement and every approved byte before reverting
    them for a whole-job comparison. Never filter arbitrary differing lines,
    commands, metadata, comments, time budgets or artifact paths.
    """
    assert original.count('0.6.22-alpha.1') == 2, 'pinned scout release lines drift'
    assert current.count('0.6.22-alpha.2') == 2, 'scout release-line cardinality'
    normalized = current
    for old in SCOUT_VERSION_LINES:
        new = old.replace('0.6.22-alpha.1', '0.6.22-alpha.2')
        assert original.count(old) == 1, 'pinned scout release line drift'
        assert normalized.count(new) == 1, 'exact scout release transition missing'
        assert old not in normalized, 'old scout release line retained'
        normalized = normalized.replace(new, old, 1)

    assert COMPARISON_OFFLINE_STEP not in original, 'comparison already in pinned scout job'
    assert current.count(COMPARISON_OFFLINE_STEP) == 1, 'exact comparison offline step missing or duplicated'
    assert current.count(COMPARISON_OFFLINE_STEP + SCOUT_IDENTITY_STEP) == 1, 'comparison offline step position drift'
    assert SCOUT_IDENTITY_STEP in original, 'pinned scout identity step missing'
    normalized = normalized.replace(COMPARISON_OFFLINE_STEP, '', 1)

    assert original.count(SCOUT_NATIVE_COMMAND) == 1, 'pinned scout native command drift'
    assert COMPARISON_NATIVE_COMMAND not in original, 'comparison native already in pinned scout job'
    assert current.count(SCOUT_NATIVE_COMMAND) == 1, 'old scout native command missing or duplicated'
    assert current.count(COMPARISON_NATIVE_COMMAND) == 1, 'comparison native command missing or duplicated'
    assert current.count(SCOUT_NATIVE_COMMAND + COMPARISON_NATIVE_COMMAND) == 1, 'comparison must immediately follow old native gate'
    normalized = normalized.replace(SCOUT_NATIVE_COMMAND + COMPARISON_NATIVE_COMMAND, SCOUT_NATIVE_COMMAND, 1)

    assert original.count(SCOUT_ARTIFACT_PATH) == 1, 'pinned scout artifact path drift'
    assert COMPARISON_ARTIFACT_PATH not in original, 'comparison artifact already in pinned scout job'
    assert current.count(COMPARISON_ARTIFACT_PATH) == 1, 'comparison artifact path missing or duplicated'
    assert current.count(SCOUT_ARTIFACT_PATH + COMPARISON_ARTIFACT_PATH) == 1, 'comparison artifact path position drift'
    normalized = normalized.replace(SCOUT_ARTIFACT_PATH + COMPARISON_ARTIFACT_PATH, SCOUT_ARTIFACT_PATH, 1)

    assert normalized == original, 'unapproved scout job drift'


class ParallelLegacyGateSplitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / WORKFLOW_PATH).read_text()
        # Full-history checkout is mandatory in each game job. Missing pinned
        # history fails this contract rather than silently skipping the audit.
        cls.baseline = subprocess.check_output(
            ['git', '-C', str(ROOT), 'show', f'{BASE_SHA}:{WORKFLOW_PATH}'], text=True)
        cls.current = jobs(cls.workflow)
        cls.original = jobs(cls.baseline)

    def test_every_original_preparation_and_native_command_preserved_in_order(self):
        setup, protection, continuation = assert_preserved(self.workflow, self.baseline)
        self.assertTrue(setup)
        self.assertTrue(protection[0].startswith(FIRST_NATIVE))
        self.assertTrue(protection[-1].startswith(LAST_PROTECTION))
        self.assertTrue(continuation[0].startswith(CONTINUATION_NATIVE))
        self.assertEqual(continuation[-1], 'exit "$PERFORMANCE_STATUS"')

    def test_all_native_command_counts_allow_only_duplicated_setup_watchdog(self):
        def browser_commands(job):
            return collections.Counter(line.strip()
                for step in steps(job) for line in run(step).splitlines()
                if re.match(r'\s*(?:python scripts/browser-|xvfb-run .*scripts/browser-)', line))
        old = browser_commands(self.original['verify'])
        actual = browser_commands(self.current['verify']) + browser_commands(self.current['verify-continuation'])
        self.assertEqual(old[WATCHDOG], 1)
        self.assertEqual(actual, old + collections.Counter({WATCHDOG: 1}))

    def test_independent_runner_context_limits_and_exact_checkout(self):
        self.assertEqual(set(self.current), set(GAME_JOBS) | {'required-gates'})
        expected_if = "    if: github.event_name != 'push' || !contains(github.event.head_commit.message, '[deep-source]')"
        for name, minutes in zip(GAME_JOBS, (45, 45, 25, 25)):
            job = self.current[name]
            with self.subTest(job=name):
                self.assertIn(expected_if + '\n', job)
                self.assertIn('    runs-on: ubuntu-latest\n', job)
                self.assertIn(f'    timeout-minutes: {minutes}\n', job)
                self.assertNotRegex(job, re.compile(r'^    (needs|container|services|strategy|environment):', re.MULTILINE))
                self.assertIn('          ref: ${{ github.sha }}\n', job)
                self.assertIn('          fetch-depth: 0\n', job)
                self.assertIn('          persist-credentials: false\n', job)
                self.assertIn('          node-version: 22\n', job)
        self.assertNotIn('continue-on-error', self.workflow)
        self.assertNotIn('actions/download-artifact', self.workflow)
        self.assertEqual(self.workflow.split('\njobs:\n', 1)[0], self.baseline.split('\njobs:\n', 1)[0])

    def test_both_legacy_runners_recreate_all_services_and_shared_fixture_paths(self):
        setup, _, _ = assert_preserved(self.workflow, self.baseline)
        text = '\n'.join(setup)
        for port in range(4173, 4178):
            self.assertIn(f'127.0.0.1:{port}/', text)
        self.assertIn('trap \'kill "$SERVER_PID" "$BEFORE_PID" "$CENSUS_BEFORE_PID" "$BUILDING_BEFORE_PID" "$AUTHORITY_PID" || true\' EXIT', setup)
        fixture = next(line for line in setup if line.startswith('node --import tsx scripts/save-session-fixture.ts '))
        self.assertIn('"$RUNNER_TEMP/pre-scout-rehearsal" > save-session-review-save.json', fixture)
        self.assertEqual(setup[-1], fixture)
        for name in ('verify', 'verify-continuation'):
            prereq = [step for step in steps(self.current[name]) if run(step) == 'bash scripts/browser-prerequisites.sh\n']
            self.assertEqual(len(prereq), 1)
            self.assertIn('        timeout-minutes: 4\n', prereq[0])

    def test_orbital_unchanged_and_scout_has_only_exact_comparison_additions(self):
        self.assertEqual(self.current['npc-orbital'], self.original['npc-orbital'])
        # The successor adds one separately specified mandatory stage. Before
        # reverting to the frozen comparison job, independently check the entire
        # current workflow against be0 and its exact enumerated additions.
        # This never strips arbitrary lines, commands, metadata or differences.
        from test_rehearsal_formation_copy_gate import assert_formation_copy_gate, baseline_workflow
        comparison_workflow = assert_formation_copy_gate(self.workflow, baseline_workflow())
        assert_scout_comparison_preserved(jobs(comparison_workflow)['scout-rehearsal'],
                                         self.original['scout-rehearsal'])

    def test_common_and_fixture_identity_wiring_covers_every_job(self):
        for name in GAME_JOBS:
            with self.subTest(job=name):
                job = self.current[name]
                self.assertIn('common-identity-sha256: ${{ steps.common_identity.outputs.common-sha256 }}', job)
                self.assertEqual(job.count('        id: common_identity\n'), 1)
                self.assertIn('python scripts/parallel-gate-identity.py --source-root', job)
        for name in ('verify', 'verify-continuation', 'npc-orbital'):
            self.assertIn('orbital-identity-sha256: ${{ steps.orbital_identity.outputs.sha256 }}', self.current[name])
            self.assertEqual(self.current[name].count('        id: orbital_identity\n'), 1)
        aggregate = self.current['required-gates']
        self.assertIn('needs: [verify, verify-continuation, npc-orbital, scout-rehearsal]', aggregate)
        self.assertIn("common = hashes_for(jobs, 'common-identity-sha256')", aggregate)
        self.assertIn("orbital = hashes_for(('verify', 'verify-continuation', 'npc-orbital'), 'orbital-identity-sha256')", aggregate)
        self.assertIn("scout = hashes_for(('scout-rehearsal',), 'scout-fixture-sha256')", aggregate)
        self.assertIn("if: ${{ always() && (github.event_name != 'push' || !contains(github.event.head_commit.message, '[deep-source]')) }}", aggregate)

    def test_artifacts_are_unique_always_archived_and_keep_every_original_path(self):
        uploads = [upload(self.current[name]) for name in GAME_JOBS]
        self.assertEqual(len(set(map(artifact_name, uploads))), len(GAME_JOBS))
        self.assertEqual(artifact_name(uploads[0]), 'original-deep-${{ github.sha }}')
        self.assertEqual(artifact_name(uploads[1]), 'original-deep-continuation-${{ github.sha }}')
        old_upload = upload(self.original['verify'])
        for name in ('verify', 'verify-continuation'):
            with self.subTest(job=name):
                self.assertEqual(without_artifact_name(upload(self.current[name])), without_artifact_name(old_upload))
                _, _, tail = native_parts(self.current[name], FIRST_NATIVE if name == 'verify' else CONTINUATION_NATIVE)
                self.assertEqual(len(tail), 2)
                self.assertIn('        if: always()\n', tail[0])
                self.assertEqual(run(tail[0]), 'git archive --format=zip --prefix=Infinity/ HEAD > source.zip\n')
        for item in uploads:
            self.assertIn('        if: always()\n', item)
            self.assertIn('          if-no-files-found: error\n', item)

    def test_new_contract_is_mandatory_in_both_legacy_jobs(self):
        for name in ('verify', 'verify-continuation'):
            self.assertEqual(self.current[name].count(NEW_TEST), 1)

    def test_missing_reordered_or_altered_old_native_gates_fail_closed(self):
        _, protected_step, _ = native_parts(self.current['verify'], FIRST_NATIVE)
        protected = significant(run(protected_step))
        first = next(line for line in protected if line.startswith(FIRST_NATIVE))
        last = next(line for line in protected if line.startswith(LAST_PROTECTION))
        for before, after in ((first, ''), (first, first.replace('4174', '4194')),
                              (last, last.replace('--expect synchronized-controls', '--expect missing'))):
            changed = self.workflow.replace(before, after, 1)
            with self.subTest(mutation=after), self.assertRaises(AssertionError):
                assert_preserved(changed, self.baseline)
        changed = self.workflow.replace(first, '__SWAPPED_FIRST__', 1).replace(last, first, 1).replace('__SWAPPED_FIRST__', last, 1)
        with self.assertRaises(AssertionError):
            assert_preserved(changed, self.baseline)

    def test_missing_or_changed_independent_setup_and_performance_command_are_refused(self):
        continuation = self.current['verify-continuation']
        mutations = (
            ('npm ci', 'echo skipped npm ci'),
            ('      - name: Independent native continuation and complete paired performance\n        run:',
             '      - name: Independent native continuation and complete paired performance\n        if: false\n        run:'),
            ('--port 4174', '--port 4194'),
            ('--moderate-fixture render-scheduling-review-save.json', '--moderate-fixture other.json'),
            ('exit "$PERFORMANCE_STATUS"', 'exit 0'),
            ('        timeout-minutes: 4', '        timeout-minutes: 8'),
        )
        for before, after in mutations:
            self.assertIn(before, continuation)
            changed = self.workflow.replace(continuation, continuation.replace(before, after, 1), 1)
            with self.subTest(mutation=after), self.assertRaises(AssertionError):
                assert_preserved(changed, self.baseline)


if __name__ == '__main__':
    unittest.main()
