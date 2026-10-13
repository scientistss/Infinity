"""Offline exact five-job wiring; never native execution or same-SHA CI proof.

The current workflow is constructed from every byte of the pinned c80 workflow
and only the explicit release tokens, independent job and aggregate below.
Historical gate suites may project to c80 only after this whole-file audit and
its exact release-file transitions pass. Nothing is filtered or skipped.
"""
import ast
import contextlib
import copy
import hashlib
import gzip
import io
import json
import os
from pathlib import Path
import subprocess
import textwrap
import unittest
from unittest.mock import patch

from test_parallel_legacy_gate_split import GAME_JOBS, WORKFLOW_PATH, jobs, run, steps, upload

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = 'c80a6728fe9e1769ca4e67fe794b8f0eedfb8627'
BASE_WORKFLOW_SHA256 = '3aeeb66de96a12261f16cdf89fb68b3682752d4ab54329cce8434b0e2efb5cc1'
CORRECTED_FORMATION_SHA = '54d1ff0896045d61464ca6de057da3706e2981ac'
OLD_VERSION = '0.6.23-alpha.1'
VERSION = '0.6.24-alpha.1'
ALL_GAME_JOBS = (*GAME_JOBS, 'lab-blockers')
REPORT_PATH = 'lab-blockers-source-evidence/natural-report.json'
ARCHIVE_PATH = 'tests/fixtures/lab-blockers-be0-research-network-report.json.gz'
ARCHIVE_SHA256 = '0ddea5009ff9832630bf5621a1f51b1c1c8211bd253045c45025d43f5c1bc8db'
REPORT_SHA256 = '1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d'
RELEASE_FILES = {'package.json': 1, 'package-lock.json': 2,
                 'scripts/parallel-gate-identity.py': 1, 'scripts/scout_fixture_identity.py': 2}
CORRECTED_FORMATION_VERSION_FILES = {'scripts/browser-rehearsal-formation-copy.py': 1,
                                     'scripts/test_rehearsal_formation_copy_acceptance.py': 3}
VERSION_LINES = (
    "          assert after_lock['version'] == after_lock['packages']['']['version'] == '0.6.23-alpha.1'\n",
    "          before_lock['version'] = before_lock['packages']['']['version'] = '0.6.23-alpha.1'\n",
)
AGGREGATE_TRANSITIONS = (
    ('    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal]\n',
     '    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers]\n'),
    ('      - name: Require all four jobs and exact source asset runtime and fixture identities\n',
     '      - name: Require all five jobs and exact source asset runtime and fixture identities\n'),
    ("          assert set(jobs) == {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal'}, jobs\n",
     "          assert set(jobs) == {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers'}, jobs\n"),
)

LAB_JOB = r'''  lab-blockers:
    # Independent mandatory native acceptance, with no borrowed current-job results.
    if: github.event_name != 'push' || !contains(github.event.head_commit.message, '[deep-source]')
    runs-on: ubuntu-latest
    timeout-minutes: 15
    outputs:
      common-identity-sha256: ${{ steps.common_identity.outputs.common-sha256 }}
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.sha }}
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Offline exact lab blocker acceptance source seal and mandatory gate
        run: |
          python -m unittest discover -s scripts -p 'test_lab_blockers_acceptance.py' -v
          python scripts/test_lab_blockers_provenance.py --verify-candidate "$GITHUB_SHA" -v
          python -m unittest discover -s scripts -p 'test_lab_blockers_gate.py' -v
      - name: Prepare independently clean exact lab execution source
        run: |
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain=v1 --untracked-files=all)"
          git worktree add --detach "$RUNNER_TEMP/lab-blockers-current" "$GITHUB_SHA"
          ln -s "$GITHUB_WORKSPACE/node_modules" "$RUNNER_TEMP/lab-blockers-current/node_modules"
          test -z "$(git -C "$RUNNER_TEMP/lab-blockers-current" status --porcelain=v1 --untracked-files=all)"
      - name: Bind exact lab source production assets and actual Node runtime
        id: common_identity
        run: python scripts/parallel-gate-identity.py --source-root "$RUNNER_TEMP/lab-blockers-current"
      - name: Verify immutable natural input and generate separately classified lab branches
        run: |
          mkdir -p lab-blockers-source-evidence
          python - <<'PYCODE'
          import importlib.util
          from pathlib import Path
          spec = importlib.util.spec_from_file_location('lab_historical_source', 'scripts/browser-lab-blockers.py')
          module = importlib.util.module_from_spec(spec)
          spec.loader.exec_module(module)
          Path('lab-blockers-source-evidence/natural-report.json').write_bytes(module.validated_historical_bytes())
          PYCODE
          echo "1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d  lab-blockers-source-evidence/natural-report.json" | sha256sum -c -
          (cd "$RUNNER_TEMP/lab-blockers-current" && node --import tsx scripts/lab-blockers-native-fixture.ts "$GITHUB_WORKSPACE/lab-blockers-source-evidence/natural-report.json" 1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d "$GITHUB_SHA") > lab-blockers-source-evidence/native-fixture.json
          sha256sum lab-blockers-source-evidence/native-fixture.json > lab-blockers-source-evidence/native-fixture.sha256.txt
          test -z "$(git -C "$RUNNER_TEMP/lab-blockers-current" status --porcelain=v1 --untracked-files=all)"
      - name: Browser prerequisites
        timeout-minutes: 4
        run: bash scripts/browser-prerequisites.sh
      - name: Mandatory native lab blockers on independent HTTP service and browser
        run: |
          npm run preview -- --host 127.0.0.1 --port 4173 > lab-blockers-preview.log 2>&1 &
          SERVER_PID=$!
          trap 'kill "$SERVER_PID" || true' EXIT
          READY=0
          for i in $(seq 1 30); do
            if curl -fsS http://127.0.0.1:4173/Infinity/release.json > /dev/null; then READY=1; break; fi
            sleep 1
          done
          test "$READY" = 1
          CHROME="$(command -v google-chrome || command -v google-chrome-stable)"
          python scripts/browser-lab-blockers.py --url http://127.0.0.1:4173/Infinity/ --fixture lab-blockers-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum lab-blockers-source-evidence/native-fixture.json | cut -d' ' -f1)" --natural-report lab-blockers-source-evidence/natural-report.json --expected-report-sha256 1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d --expected-sha "$GITHUB_SHA" --expected-version 0.6.24-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output lab-blockers-evidence
      - name: Archive exact readable lab source
        if: always()
        run: git archive --format=zip --prefix=Infinity/ HEAD > lab-blockers-source.zip
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: lab-blockers-${{ github.sha }}
          path: |
            dist
            lab-blockers-source.zip
            common-identity.json
            tests/fixtures/lab-blockers-be0-research-network-report.json.gz
            tests/fixtures/lab-blockers-be0-research-network-provenance.json
            lab-blockers-source-evidence
            lab-blockers-evidence
            lab-blockers-preview.log
          retention-days: 7
          if-no-files-found: error

'''


def baseline_bytes(relative):
    return subprocess.check_output(['git', '-C', str(ROOT), 'show', f'{BASE_SHA}:{relative}'])


def baseline_workflow():
    return baseline_bytes(WORKFLOW_PATH).decode('utf-8')


def exact_replace(body, old, new):
    assert body.count(old) == 1, ('pinned exact transition cardinality', old)
    assert old != new and new not in body, ('already-applied exact transition', new)
    return body.replace(old, new, 1)


def expected_lab_workflow(baseline):
    assert hashlib.sha256(baseline.encode('utf-8')).hexdigest() == BASE_WORKFLOW_SHA256, 'pinned c80 workflow bytes differ'
    expected = baseline
    for line in VERSION_LINES:
        expected = exact_replace(expected, line, line.replace(OLD_VERSION, VERSION))
    # This exact existing browser argument is release metadata. Its command,
    # ordering, inputs, output and observation budgets remain unchanged.
    old_argument = '--expected-version 0.6.23-alpha.1 --runtime-node "$(node --version)" --output rehearsal-formation-copy-evidence\n'
    expected = exact_replace(expected, old_argument, old_argument.replace(OLD_VERSION, VERSION))
    expected = exact_replace(expected, '  required-gates:\n', LAB_JOB + '  required-gates:\n')
    for old, new in AGGREGATE_TRANSITIONS:
        expected = exact_replace(expected, old, new)
    return expected


def assert_lab_blockers_gate(workflow, baseline):
    assert workflow == expected_lab_workflow(baseline), 'unapproved lab-blocker workflow drift'
    return baseline


def assert_release_transitions():
    from test_manual_unit_gate import previous_release_bytes as successor_release_bytes
    for relative, cardinality in RELEASE_FILES.items():
        before = baseline_bytes(relative)
        assert before.count(OLD_VERSION.encode()) == cardinality, ('pinned release cardinality', relative)
        assert successor_release_bytes(relative) == before.replace(OLD_VERSION.encode(), VERSION.encode()), ('unapproved release/source drift', relative)
    # Preserve the actual test-only successor fixes, including all 36 tests.
    # Only its four exact current-release literals change for this release.
    for relative, cardinality in CORRECTED_FORMATION_VERSION_FILES.items():
        before = subprocess.check_output(['git', '-C', str(ROOT), 'show',
            f'{CORRECTED_FORMATION_SHA}:{relative}'])
        assert before.count(OLD_VERSION.encode()) == cardinality, ('corrected formation release cardinality', relative)
        assert successor_release_bytes(relative) == before.replace(OLD_VERSION.encode(), VERSION.encode()), ('corrected formation source drift', relative)


def previous_workflow(workflow=None):
    """Audit the complete successor before running unchanged historical rules."""
    if workflow is None:
        from test_manual_unit_gate import previous_workflow as successor_workflow
        workflow = successor_workflow()
    baseline = baseline_workflow()
    assert_lab_blockers_gate(workflow, baseline)
    assert_release_transitions()
    return baseline


def previous_release_bytes(relative):
    """Only these four version-only inputs have an exact historical projection."""
    assert relative in RELEASE_FILES, ('unsupported historical source projection', relative)
    previous_workflow()
    return baseline_bytes(relative)


def aggregate_code(workflow):
    body = jobs(workflow)['required-gates']
    return textwrap.dedent(body.split("python - <<'PYCODE'\n", 1)[1].split('          PYCODE', 1)[0])


class LabBlockersGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_manual_unit_gate import previous_workflow as successor_workflow
        cls.workflow = successor_workflow()
        cls.baseline = baseline_workflow()
        cls.current, cls.original = jobs(cls.workflow), jobs(cls.baseline)

    def assert_refused(self, before, after, job='lab-blockers'):
        target = self.current[job]
        self.assertEqual(target.count(before), 1, ('mutation cardinality', before))
        changed = self.workflow.replace(target, target.replace(before, after, 1), 1)
        with self.assertRaises(AssertionError):
            assert_lab_blockers_gate(changed, self.baseline)

    def test_complete_hash_pinned_workflow_and_release_delta(self):
        self.assertEqual(previous_workflow(self.workflow), self.baseline)
        for altered in (self.baseline + '\n', self.baseline.replace('\n', '\r\n')):
            with self.assertRaises(AssertionError):
                assert_lab_blockers_gate(self.workflow, altered)

    def test_original_four_jobs_and_headers_only_have_three_explicit_release_tokens(self):
        self.assertEqual(tuple(self.current), (*ALL_GAME_JOBS, 'required-gates'))
        self.assertEqual(self.workflow.split('\njobs:\n', 1)[0], self.baseline.split('\njobs:\n', 1)[0])
        for name in GAME_JOBS:
            expected = self.original[name]
            if name == 'scout-rehearsal':
                self.assertEqual(expected.count(OLD_VERSION), 3)
                expected = expected.replace(OLD_VERSION, VERSION)
            self.assertEqual(self.current[name], expected, name)
        for prefix in ('# injected comment\n', 'env:\n  OPTIONAL: "true"\n'):
            with self.assertRaises(AssertionError):
                assert_lab_blockers_gate(prefix + self.workflow, self.baseline)
        with self.assertRaises(AssertionError):
            assert_lab_blockers_gate(self.workflow.replace('\n', '\r\n'), self.baseline)

    def test_old_timeouts_observation_commands_and_performance_order_are_byte_exact(self):
        for name, minutes in zip(ALL_GAME_JOBS, (45, 45, 25, 25, 15)):
            for changed in (minutes - 1, minutes + 1):
                self.assert_refused(f'    timeout-minutes: {minutes}\n', f'    timeout-minutes: {changed}\n', name)
            native = [line + '\n' for line in self.current[name].splitlines()
                      if line.startswith('          python scripts/browser-')]
            self.assertTrue(native, name)
            for line in native:
                self.assert_refused(line, '', name)
                self.assert_refused(line, line * 2, name)
        for name in GAME_JOBS[:-1]:
            self.assertEqual(self.current[name], self.original[name])

    def test_each_job_missing_duplicate_extra_or_reordered_is_refused(self):
        blocks = [f'  {name}:\n' + self.current[name] for name in self.current]
        for block in blocks:
            for changed in (self.workflow.replace(block, '', 1), self.workflow + block):
                with self.assertRaises(AssertionError):
                    assert_lab_blockers_gate(changed, self.baseline)
        pair = blocks[3] + blocks[4]
        self.assertEqual(self.workflow.count(pair), 1)
        with self.assertRaises(AssertionError):
            assert_lab_blockers_gate(self.workflow.replace(pair, blocks[4] + blocks[3]), self.baseline)
        with self.assertRaises(AssertionError):
            assert_lab_blockers_gate(self.workflow + '  optional:\n    runs-on: ubuntu-latest\n', self.baseline)

    def test_independent_runner_checkout_build_node22_and_http_service(self):
        lab = self.current['lab-blockers']
        self.assertNotIn('    needs:', lab)
        for banned in ('actions/download-artifact', 'continue-on-error', 'connect_over_cdp', 'browser.contexts['):
            self.assertNotIn(banned, lab)
        for line in ('    runs-on: ubuntu-latest\n', '          ref: ${{ github.sha }}\n',
                     '          fetch-depth: 0\n', '          persist-credentials: false\n',
                     '          node-version: 22\n', '      - run: npm ci\n', '      - run: npm run build\n',
                     '          test "$READY" = 1\n',
                     '          git worktree add --detach "$RUNNER_TEMP/lab-blockers-current" "$GITHUB_SHA"\n'):
            self.assert_refused(line, '')
        self.assertEqual(lab.count('npm run preview -- --host 127.0.0.1 --port 4173'), 1)
        self.assertEqual(lab.count('trap \'kill "$SERVER_PID" || true\' EXIT'), 1)
        for version in ('20', '24', 'latest'):
            self.assert_refused('          node-version: 22\n', f'          node-version: {version}\n')

    def test_each_new_step_and_command_is_unique_ordered_and_mandatory(self):
        all_steps = steps(self.current['lab-blockers'])
        self.assertEqual(len(all_steps), 12)
        for step in all_steps:
            self.assert_refused(step, '')
            self.assert_refused(step, step * 2)
            for line in step.splitlines(keepends=True):
                if line.startswith('          ') and not line.lstrip().startswith('#'):
                    if self.current['lab-blockers'].count(line) == 1:
                        self.assert_refused(line, '')
        for first, second in zip(all_steps, all_steps[1:]):
            self.assert_refused(first + second, second + first)
        for step in all_steps[2:-2]:
            self.assert_refused(step, step.replace('      - ', '      - if: false\n        ', 1))
            self.assert_refused(step, step.replace('      - ', '      - continue-on-error: true\n        ', 1))
        for command in (line for step in all_steps for line in run(step).splitlines()
                        if line.startswith(('python ', '(cd ', 'echo '))):
            full = '          ' + command + '\n'
            if full in self.current['lab-blockers']:
                for suffix in (' || true\n', '; true\n', ' &\n'):
                    self.assert_refused(full, full.rstrip('\n') + suffix)

    def test_offline_acceptance_seal_gate_precede_identity_fixture_and_browser(self):
        lab = self.current['lab-blockers']
        ordered = [
            "python -m unittest discover -s scripts -p 'test_lab_blockers_acceptance.py' -v",
            'python scripts/test_lab_blockers_provenance.py --verify-candidate "$GITHUB_SHA" -v',
            "python -m unittest discover -s scripts -p 'test_lab_blockers_gate.py' -v",
            'python scripts/parallel-gate-identity.py --source-root "$RUNNER_TEMP/lab-blockers-current"',
            'node --import tsx scripts/lab-blockers-native-fixture.ts ',
            'bash scripts/browser-prerequisites.sh', 'python scripts/browser-lab-blockers.py ']
        offsets = [lab.index(value) for value in ordered]
        self.assertEqual(offsets, sorted(offsets))
        for value in ordered:
            self.assertEqual(lab.count(value), 1)
        for filename in ('test_lab_blockers_acceptance.py', 'test_lab_blockers_provenance.py',
                         'test_lab_blockers_gate.py', 'browser-lab-blockers.py', 'lab-blockers-native-fixture.ts'):
            self.assertTrue((ROOT / 'scripts' / filename).is_file(), filename)

    def test_report_and_fixture_are_full_bytes_and_never_borrow_current_native_results(self):
        packed = (ROOT / ARCHIVE_PATH).read_bytes()
        self.assertEqual((len(packed), hashlib.sha256(packed).hexdigest()), (74414, ARCHIVE_SHA256))
        raw = gzip.decompress(packed)
        self.assertEqual(len(raw), 836611)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), REPORT_SHA256)
        historical = json.loads(raw)
        self.assertEqual(historical['source']['sourceSha'], 'be0e112b964179fc15b89daa4ae6f6a722b78a92')
        self.assertEqual(historical['source']['sourceSha'], historical['source']['gitHead'])
        self.assertEqual(historical['source']['sourceScopeStatusPorcelain'], '')
        self.assertEqual(historical['source']['worktreeStatusPorcelain'], '')
        self.assertEqual(historical['outcome']['status'], 'passed')
        self.assertFalse(historical['provenance']['injectedGameState'])
        lab = self.current['lab-blockers']
        for line in lab.splitlines(keepends=True):
            if REPORT_SHA256 in line:
                self.assert_refused(line, line.replace(REPORT_SHA256, '0' * 64))
        native = next(line for line in lab.splitlines(keepends=True)
                      if 'python scripts/browser-lab-blockers.py ' in line)
        for before, after in (
            ('--expected-sha "$GITHUB_SHA"', '--expected-sha HEAD'),
            ('--expected-version 0.6.24-alpha.1', '--expected-version 0.6.23-alpha.1'),
            ('--runtime-node "$(node --version)"', '--runtime-node v22.0.0'),
            ('--url http://127.0.0.1:4173/Infinity/', '--url http://127.0.0.1:4193/Infinity/'),
            ('--chromium "$CHROME"', '--chromium other'),
            ('--output lab-blockers-evidence', '--output scout-rehearsal-evidence'),
            ('--fixture lab-blockers-source-evidence/native-fixture.json', '--fixture old-fixture.json'),
            ('--natural-report ' + REPORT_PATH, '--natural-report current-synthetic.json'),
            ('"$(sha256sum lab-blockers-source-evidence/native-fixture.json | cut -d\' \' -f1)"', '"' + '0' * 64 + '"'),
        ):
            self.assertIn(before, native)
            self.assert_refused(native, native.replace(before, after, 1))

    def test_native_browser_context_watchdogs_and_failure_originals_are_separate(self):
        source = (ROOT / 'scripts/browser-lab-blockers.py').read_text()
        functions = {node.name: ast.get_source_segment(source, node) for node in ast.parse(source).body
                     if isinstance(node, ast.FunctionDef)}
        self.assertIn('browser = playwright.chromium.launch(', functions['main'])
        self.assertIn('browser.new_context(', functions['boot'])
        self.assertIn('signal.alarm(600)', functions['main'])
        self.assertIn('time.monotonic() + 610', functions['supervise'])
        self.assertIn('live_failure_evidence()', functions['main'])
        for name in ('lab-blockers-browser-report.json', 'lab-blockers-checks.jsonl',
                     'lab-blockers-progress.json', 'lab-blockers-full-source-binding.json'):
            self.assertIn(name, source)
        for banned in ('connect_over_cdp', 'browser.contexts[', 'scout-comparison-evidence',
                       'scout-rehearsal-evidence', 'rehearsal-formation-copy-evidence'):
            self.assertNotIn(banned, source)
        self.assertIn('  PYTHONDONTWRITEBYTECODE: "1"\n', self.workflow)

    def test_all_failure_evidence_source_and_fixture_bytes_are_always_archived(self):
        archive = upload(self.current['lab-blockers'])
        paths = [line + '\n' for line in archive.splitlines() if line.startswith('            ')]
        self.assertEqual(len(paths), 8)
        for line in paths:
            self.assert_refused(line, '')
            self.assert_refused(line, line * 2)
        for before, after in (
            ('          retention-days: 7\n', '          retention-days: 1\n'),
            ('          if-no-files-found: error\n', '          if-no-files-found: warn\n'),
            ('          name: lab-blockers-${{ github.sha }}\n', '          name: scout-rehearsal-${{ github.sha }}\n'),
        ):
            self.assert_refused(before, after)
        self.assert_refused(archive, archive.replace('        if: always()\n', '        if: success()\n'))
        source_archive = next(step for step in steps(self.current['lab-blockers']) if 'git archive ' in step)
        self.assert_refused(source_archive, source_archive.replace('        if: always()\n', '        if: success()\n'))
        self.assert_refused(source_archive, source_archive.replace(' HEAD >', ' HEAD src >'))

    def test_aggregate_changes_only_three_explicit_lines_and_preserves_old_identity_rules(self):
        expected = self.original['required-gates']
        for before, after in AGGREGATE_TRANSITIONS:
            expected = exact_replace(expected, before, after)
        self.assertEqual(self.current['required-gates'], expected)
        for line in expected.splitlines(keepends=True):
            if 'hashes_for(' in line or "assert job['result']" in line or 'assert set(jobs)' in line:
                self.assert_refused(line, '', 'required-gates')
        for name in ALL_GAME_JOBS:
            line = next(line for line in self.current[name].splitlines(keepends=True)
                        if 'python scripts/parallel-gate-identity.py ' in line)
            self.assert_refused(line, '', name)

    def test_aggregate_rejects_every_non_success_missing_extra_bad_or_mismatched_common_identity(self):
        states = {name: {'result': 'success', 'outputs': {'common-identity-sha256': 'a' * 64}}
                  for name in ALL_GAME_JOBS}
        for name in GAME_JOBS[:-1]:
            states[name]['outputs']['orbital-identity-sha256'] = 'b' * 64
        states['scout-rehearsal']['outputs']['scout-fixture-sha256'] = 'c' * 64
        code = compile(aggregate_code(self.workflow), '<actual-five-job-aggregate>', 'exec')
        def execute(value):
            with patch.dict(os.environ, {'JOB_RESULTS': json.dumps(value)}), contextlib.redirect_stdout(io.StringIO()):
                exec(code, {})
        execute(states)
        for name in ALL_GAME_JOBS:
            for status in ('failure', 'cancelled', 'skipped', 'in_progress', '', None):
                altered = copy.deepcopy(states); altered[name]['result'] = status
                with self.subTest(name=name, status=status), self.assertRaises(AssertionError): execute(altered)
            altered = copy.deepcopy(states); del altered[name]
            with self.assertRaises(AssertionError): execute(altered)
            for digest in ('', 'wrong', 'A' * 64, '0' * 63, 'd' * 64, None):
                altered = copy.deepcopy(states); altered[name]['outputs']['common-identity-sha256'] = digest
                with self.subTest(name=name, digest=digest), self.assertRaises((AssertionError, TypeError)): execute(altered)
            altered = copy.deepcopy(states); del altered[name]['outputs']['common-identity-sha256']
            with self.assertRaises(AssertionError): execute(altered)
        altered = copy.deepcopy(states); altered['unexpected'] = copy.deepcopy(states['lab-blockers'])
        with self.assertRaises(AssertionError): execute(altered)

    def test_only_three_existing_release_tokens_change_and_wrong_versions_fail_closed(self):
        for old in VERSION_LINES:
            new = old.replace(OLD_VERSION, VERSION)
            for replacement in (old, '', new * 2, new.replace(VERSION, '0.6.24-alpha.2')):
                self.assert_refused(new, replacement, 'scout-rehearsal')
        line = next(line for line in self.current['scout-rehearsal'].splitlines(keepends=True)
                    if 'browser-rehearsal-formation-copy.py ' in line)
        self.assert_refused(line, line.replace(VERSION, OLD_VERSION), 'scout-rehearsal')
        assert_release_transitions()
        from test_manual_unit_gate import previous_release_bytes as successor_release_bytes
        current = json.loads(successor_release_bytes('package-lock.json'))
        historical = json.loads(subprocess.check_output(['git', '-C', str(ROOT), 'show',
            'cc19bf5e1a459cf8e667ca55f4891ca9ffd25a71:package-lock.json']))
        self.assertEqual(historical['version'], '0.6.21-alpha.1')
        self.assertEqual(historical['packages']['']['version'], '0.6.21-alpha.1')
        historical['version'] = historical['packages']['']['version'] = VERSION
        self.assertEqual(current, historical)

    def test_release_and_corrected_formation_changes_cannot_hide_behind_projection(self):
        original_read = Path.read_bytes
        for relative in (*RELEASE_FILES, *CORRECTED_FORMATION_VERSION_FILES):
            target = ROOT / relative
            original = original_read(target)
            for changed in (original + b'\n', original.replace(b'0.6.27-alpha.1', OLD_VERSION.encode(), 1)):
                def read_bytes(path, target=target, changed=changed):
                    return changed if path == target else original_read(path)
                with self.subTest(relative=relative), patch.object(Path, 'read_bytes', read_bytes):
                    with self.assertRaises(AssertionError):
                        previous_workflow(self.workflow)
        # A correct version label never licenses altered dependency contents.
        target = ROOT / 'package-lock.json'
        changed = json.loads(original_read(target))
        changed['packages']['node_modules/break_infinity.js']['version'] = '0.0.0'
        altered_lock = json.dumps(changed).encode()
        def read_bytes(path):
            return altered_lock if path == target else original_read(path)
        with patch.object(Path, 'read_bytes', read_bytes), self.assertRaises(AssertionError):
            previous_workflow(self.workflow)

    def test_previous_stage_projection_rejects_current_drift_before_returning_historical_bytes(self):
        self.assertEqual(previous_workflow(self.workflow), self.baseline)
        with self.assertRaises(AssertionError):
            previous_workflow(self.workflow.replace('    timeout-minutes: 15\n', '    timeout-minutes: 16\n'))
        with self.assertRaises(AssertionError):
            previous_release_bytes('src/game/save.ts')
        for relative in RELEASE_FILES:
            self.assertEqual(previous_release_bytes(relative), baseline_bytes(relative))


if __name__ == '__main__':
    unittest.main()
