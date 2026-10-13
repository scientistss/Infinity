"""Exact seven-job wiring and fully audited historical six-job mandatory wiring. Python/Git only; never native or CI acceptance.
Every byte of the historical five-job workflow is projected only after its
precise approved version transitions, sixth job and aggregate changes pass.
"""
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import textwrap
import unittest
from unittest.mock import patch
from test_parallel_legacy_gate_split import WORKFLOW_PATH, jobs, steps, upload
ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = '9a27ed8c198a19f6bab9578e3d8d26ee22cdfc13'
BASE_WORKFLOW_SHA256 = 'f695e94ebb9c031c6123412e138fc391d2b4c0c0cd9c009057f0662b8894aad0'
DIAGNOSTIC_SHA = '1f66672f40556c61c4acfaeec23f1cb18c64636a'
OLD_VERSION = '0.6.24-alpha.1'
VERSION = '0.6.26-alpha.1'
OLD_JOBS = ('verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers')
ALL_JOBS = (*OLD_JOBS, 'manual-unit-orders')
RELEASE_FILES = {'package.json': 1, 'package-lock.json': 2,
    'scripts/parallel-gate-identity.py': 1, 'scripts/scout_fixture_identity.py': 2,
    'scripts/browser-rehearsal-formation-copy.py': 1,
    'scripts/test_rehearsal_formation_copy_acceptance.py': 3,
    'scripts/browser-lab-blockers.py': 1}
DIAGNOSTIC_FILES = ('.github/workflows/manual-unit-old-proof.yml',
    'scripts/browser-manual-unit-proof.py', 'scripts/manual-unit-proof-source.py',
    'scripts/test_manual_unit_proof.py', 'scripts/manual-unit-published-241a-manifest.json')

MANUAL_JOB = r'''  manual-unit-orders:
    # Separate mandatory paid manual-unit acceptance; historical bug proof is diagnostic only.
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
      - name: Offline exact manual unit acceptance source seal and mandatory gate
        run: |
          set -euo pipefail
          python -m unittest discover -s scripts -p 'test_manual_unit_acceptance.py' -v 2>&1 | tee "$RUNNER_TEMP/manual-unit-acceptance.log"
          python -m unittest discover -s scripts -p 'test_manual_unit_display_contract.py' -v 2>&1 | tee "$RUNNER_TEMP/manual-unit-display_contract.log"
          python -m unittest discover -s scripts -p 'test_manual_unit_legacy_inputs.py' -v 2>&1 | tee "$RUNNER_TEMP/manual-unit-legacy_inputs.log"
          python scripts/test_manual_unit_provenance.py --verify-candidate "$GITHUB_SHA" -v 2>&1 | tee "$RUNNER_TEMP/manual-unit-provenance.log"
          python -m unittest discover -s scripts -p 'test_manual_unit_gate.py' -v 2>&1 | tee "$RUNNER_TEMP/manual-unit-gate.log"
      - name: Prepare independently clean exact manual unit execution source
        run: |
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain=v1 --untracked-files=all)"
          git worktree add --detach "$RUNNER_TEMP/manual-unit-current" "$GITHUB_SHA"
          ln -s "$GITHUB_WORKSPACE/node_modules" "$RUNNER_TEMP/manual-unit-current/node_modules"
          test -z "$(git -C "$RUNNER_TEMP/manual-unit-current" status --porcelain=v1 --untracked-files=all)"
      - name: Bind exact manual unit source production assets and actual Node runtime
        id: common_identity
        run: python scripts/parallel-gate-identity.py --source-root "$RUNNER_TEMP/manual-unit-current"
      - name: Reproduce old natural checkpoints using only exact old producer and diagnostic binding
        run: |
          mkdir -p manual-unit-source-evidence
          git worktree add --detach "$RUNNER_TEMP/manual-unit-old" 241a51de31364e9086abcc304884bf9df7cd6912
          git worktree add --detach "$RUNNER_TEMP/manual-unit-diagnostic" 1f66672f40556c61c4acfaeec23f1cb18c64636a
          git archive --format=zip --prefix=Infinity/ 241a51de31364e9086abcc304884bf9df7cd6912 > manual-unit-source-evidence/source-241a.zip
          (cd "$RUNNER_TEMP/manual-unit-old" && npm ci) > manual-unit-source-evidence/old-npm-ci.log 2>&1
          (cd "$RUNNER_TEMP/manual-unit-old" && GITHUB_SHA=241a51de31364e9086abcc304884bf9df7cd6912 npm run build) > manual-unit-source-evidence/old-build.log 2>&1
          (cd "$RUNNER_TEMP/manual-unit-old" && node --import tsx scripts/natural-growth-journey.ts) > manual-unit-source-evidence/fresh-natural-report.json 2> manual-unit-source-evidence/fresh-natural-report.log
          echo '9102da6f8fc52427b642883389d186726a8cf0c02747aa6c135150566458d8ea  manual-unit-source-evidence/fresh-natural-report.json' | sha256sum -c -
          python "$RUNNER_TEMP/manual-unit-diagnostic/scripts/manual-unit-proof-source.py" --proof-root "$RUNNER_TEMP/manual-unit-diagnostic" --baseline-root "$RUNNER_TEMP/manual-unit-old" --source-archive manual-unit-source-evidence/source-241a.zip --test-sha 1f66672f40556c61c4acfaeec23f1cb18c64636a --dist "$RUNNER_TEMP/manual-unit-old/dist" --published-manifest "$RUNNER_TEMP/manual-unit-diagnostic/scripts/manual-unit-published-241a-manifest.json" --output manual-unit-source-evidence/old-source-binding.json
          (cd "$RUNNER_TEMP/manual-unit-current" && node --import tsx scripts/manual-unit-native-fixture.ts "$GITHUB_WORKSPACE/manual-unit-source-evidence/fresh-natural-report.json" "$GITHUB_WORKSPACE/manual-unit-source-evidence/old-source-binding.json" "$GITHUB_SHA") > manual-unit-source-evidence/native-fixture.json
          sha256sum manual-unit-source-evidence/native-fixture.json > manual-unit-source-evidence/native-fixture.sha256.txt
          test -z "$(git -C "$RUNNER_TEMP/manual-unit-current" status --porcelain=v1 --untracked-files=all)"
          test -z "$(git -C "$RUNNER_TEMP/manual-unit-old" status --porcelain=v1 --untracked-files=all)"
          test -z "$(git -C "$RUNNER_TEMP/manual-unit-diagnostic" status --porcelain=v1 --untracked-files=all)"
      - name: Browser prerequisites
        timeout-minutes: 4
        run: bash scripts/browser-prerequisites.sh
      - name: Mandatory native paid manual units on independent HTTP service and browser
        run: |
          npm run preview -- --host 127.0.0.1 --port 4173 > manual-unit-preview.log 2>&1 &
          SERVER_PID=$!
          trap 'kill "$SERVER_PID" || true' EXIT
          READY=0
          for i in $(seq 1 30); do
            if curl -fsS http://127.0.0.1:4173/Infinity/release.json > /dev/null; then READY=1; break; fi
            sleep 1
          done
          test "$READY" = 1
          CHROME="$(command -v google-chrome || command -v google-chrome-stable)"
          xvfb-run -a python scripts/browser-manual-unit-orders.py --url http://127.0.0.1:4173/Infinity/ --fixture manual-unit-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum manual-unit-source-evidence/native-fixture.json | cut -d' ' -f1)" --natural-report manual-unit-source-evidence/fresh-natural-report.json --source-binding manual-unit-source-evidence/old-source-binding.json --expected-sha "$GITHUB_SHA" --expected-version 0.6.26-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output manual-unit-evidence
      - name: Archive exact readable manual unit source
        if: always()
        run: git archive --format=zip --prefix=Infinity/ HEAD > manual-unit-source.zip
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: manual-unit-orders-${{ github.sha }}
          path: |
            dist
            manual-unit-source.zip
            common-identity.json
            tests/fixtures/manual-unit-provenance.json
            manual-unit-source-evidence
            manual-unit-evidence
            manual-unit-preview.log
            ${{ runner.temp }}/manual-unit-*.log
          retention-days: 7
          if-no-files-found: error

'''


SIX_BASE_SHA = '123785c4f7fdb57a3968012d81aab74f6a3ad18b'
SIX_BASE_WORKFLOW_SHA256 = 'e16b5d79140bdca65f58015e78f35268630910d6b7782906ef731be53eea0349'
MANUAL_GROUPS = ('payments', 'authority')
SEVEN_JOBS = (*OLD_JOBS, 'manual-unit-payments', 'manual-unit-authority')


def six_workflow():
    raw = subprocess.check_output(['git','-C',str(ROOT),'show',SIX_BASE_SHA+':'+WORKFLOW_PATH])
    assert hashlib.sha256(raw).hexdigest()==SIX_BASE_WORKFLOW_SHA256, 'Pinned original six-job workflow drift'
    return raw.decode()


def split_job(group):
    assert group in MANUAL_GROUPS
    job=MANUAL_JOB
    for before,after in (
        ('  manual-unit-orders:\n','  manual-unit-'+group+':\n'),
        ('          name: manual-unit-orders-${{ github.sha }}\n','          name: manual-unit-'+group+'-${{ github.sha }}\n'),
        ('      common-identity-sha256: ${{ steps.common_identity.outputs.common-sha256 }}\n',
         '      common-identity-sha256: ${{ steps.common_identity.outputs.common-sha256 }}\n'
         '      manual-fixture-sha256: ${{ steps.manual_census.outputs.manual-fixture-sha256 }}\n'
         '      manual-census-json: ${{ steps.manual_census.outputs.manual-census-json }}\n'),
        ("          python -m unittest discover -s scripts -p 'test_manual_unit_gate.py' -v 2>&1 | tee \"$RUNNER_TEMP/manual-unit-gate.log\"\n",
         "          python -m unittest discover -s scripts -p 'test_manual_unit_gate.py' -v 2>&1 | tee \"$RUNNER_TEMP/manual-unit-gate.log\"\n"
         "          python -m unittest discover -s scripts -p 'test_manual_unit_census.py' -v 2>&1 | tee \"$RUNNER_TEMP/manual-unit-census.log\"\n"),
        ('          xvfb-run -a python scripts/browser-manual-unit-orders.py --url ',
         '          xvfb-run -a python scripts/browser-manual-unit-orders.py --group '+group+' --url '),
        ('      - name: Archive exact readable manual unit source\n',
         '      - name: Verify actual completed native group census and complete original fixture binding\n'
         '        id: manual_census\n'
         '        run: python scripts/manual_unit_census.py report --group '+group+' --report manual-unit-evidence/manual-unit-browser-report.json --fixture manual-unit-source-evidence/native-fixture.json --source-binding manual-unit-source-evidence/old-source-binding.json --common-identity common-identity.json --expected-sha "$GITHUB_SHA" --output manual-unit-census.json\n'
         '      - name: Archive exact readable manual unit source\n'),
        ('            common-identity.json\n','            common-identity.json\n            manual-unit-census.json\n'),
        ('      - uses: actions/upload-artifact@v4\n',
         '      - name: Collect offline logs under the exact workspace artifact root\n'
         '        if: always()\n'
         '        run: |\n'
         '          mkdir -p manual-unit-offline-logs\n'
         '          for logfile in "$RUNNER_TEMP"/manual-unit-*.log; do\n'
         '            if test -f "$logfile"; then cp "$logfile" manual-unit-offline-logs/; fi\n'
         '          done\n'
         '      - uses: actions/upload-artifact@v4\n'),
        ('            ${{ runner.temp }}/manual-unit-*.log\n','            manual-unit-offline-logs\n'),
    ):
        job=exact_replace(job,before,after)
    return job


AGGREGATE_ARTIFACT_STEPS = r'''      - name: Checkout exact source for independent original-artifact census verification
        uses: actions/checkout@v7
        with:
          ref: ${{ github.sha }}
          fetch-depth: 0
          persist-credentials: false
      - name: Download exact same-run payments artifact
        uses: actions/download-artifact@v4
        with:
          name: manual-unit-payments-${{ github.sha }}
          path: ${{ runner.temp }}/manual-unit-payments-artifact
      - name: Download exact same-run authority artifact
        uses: actions/download-artifact@v4
        with:
          name: manual-unit-authority-${{ github.sha }}
          path: ${{ runner.temp }}/manual-unit-authority-artifact
      - name: Recompute source fixture and complete scenario census from both original native artifacts
        env:
          JOB_RESULTS: ${{ toJSON(needs) }}
        run: python scripts/manual_unit_census.py aggregate --payments "$RUNNER_TEMP/manual-unit-payments-artifact" --authority "$RUNNER_TEMP/manual-unit-authority-artifact" --expected-sha "$GITHUB_SHA" --output manual-unit-aggregate-census.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: manual-unit-aggregate-census-${{ github.sha }}
          path: manual-unit-aggregate-census.json
          retention-days: 7
          if-no-files-found: error
'''


def expected_split_workflow(baseline):
    assert hashlib.sha256(baseline.encode()).hexdigest()==SIX_BASE_WORKFLOW_SHA256, 'Pinned six-job workflow bytes differ'
    assert baseline==expected_workflow(baseline_workflow()), 'Original six-to-five workflow contract differs'
    result=exact_replace(baseline,MANUAL_JOB,split_job('payments')+split_job('authority'))
    for before,after in (
        ('    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers, manual-unit-orders]\n',
         '    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers, manual-unit-payments, manual-unit-authority]\n'),
        ('      - name: Require all six jobs and exact source asset runtime and fixture identities\n',
         '      - name: Require all seven jobs and exact source asset runtime and fixture identities\n'),
        ("          assert set(jobs) == {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers', 'manual-unit-orders'}, jobs\n",
         "          assert set(jobs) == {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers', 'manual-unit-payments', 'manual-unit-authority'}, jobs\n"),
    ):
        result=exact_replace(result,before,after)
    # The final original aggregate Python terminator is the only insertion point.
    marker='          PYCODE\n'
    assert result.endswith(marker)
    return result+AGGREGATE_ARTIFACT_STEPS


def assert_split_gate(workflow,baseline):
    assert workflow==expected_split_workflow(baseline), 'unapproved seven-job workflow drift'


def previous_six_workflow(workflow=None):
    """Audit every actual seven-job byte before exposing the frozen six-job contract."""
    if workflow is None:
        from test_recycle_preview_gate import previous_workflow as successor_workflow
        workflow = successor_workflow()
    baseline=six_workflow()
    assert_split_gate(workflow,baseline)
    assert_release_transitions()
    return baseline



def baseline_bytes(path):
    return subprocess.check_output(['git', '-C', str(ROOT), 'show', f'{BASE_SHA}:{path}'])


def baseline_workflow():
    raw = baseline_bytes(WORKFLOW_PATH)
    assert hashlib.sha256(raw).hexdigest() == BASE_WORKFLOW_SHA256
    return raw.decode()


def exact_replace(body, before, after):
    assert body.count(before) == 1 and before != after and after not in body, before
    return body.replace(before, after, 1)


def expected_workflow(baseline):
    assert hashlib.sha256(baseline.encode()).hexdigest() == BASE_WORKFLOW_SHA256
    expected = baseline
    # Four named release-only lines. No global replacement or arbitrary filtering.
    lines = [line for line in baseline.splitlines(keepends=True) if OLD_VERSION in line]
    assert len(lines) == 4
    assert [line.strip().split()[0] for line in lines] == ['assert', "before_lock['version']", 'python', 'python']
    for line in lines:
        assert line.count(OLD_VERSION) == 1
        expected = exact_replace(expected, line, line.replace(OLD_VERSION, VERSION))
    expected = exact_replace(expected, '  required-gates:\n', MANUAL_JOB + '  required-gates:\n')
    for before, after in (
        ('    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers]\n',
         '    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers, manual-unit-orders]\n'),
        ('      - name: Require all five jobs and exact source asset runtime and fixture identities\n',
         '      - name: Require all six jobs and exact source asset runtime and fixture identities\n'),
        ("          assert set(jobs) == {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers'}, jobs\n",
         "          assert set(jobs) == {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers', 'manual-unit-orders'}, jobs\n")):
        expected = exact_replace(expected, before, after)
    return expected


def assert_manual_unit_gate(workflow, baseline):
    assert workflow == expected_workflow(baseline), 'unapproved six-job workflow drift'


def assert_release_transitions():
    for path in (*RELEASE_FILES, *DIAGNOSTIC_FILES):
        local = ROOT / path
        assert local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111), ('Expected ordinary nonexecutable release or diagnostic source', path)
    for path, count in RELEASE_FILES.items():
        before = baseline_bytes(path)
        assert before.count(OLD_VERSION.encode()) == count, path
        from test_recycle_preview_gate import previous_release_bytes as successor_release_bytes
        assert successor_release_bytes(path) == before.replace(OLD_VERSION.encode(), VERSION.encode()), ('exact release transition', path)
    for path in DIAGNOSTIC_FILES:
        expected = subprocess.check_output(['git', '-C', str(ROOT), 'show', f'{DIAGNOSTIC_SHA}:{path}'])
        assert (ROOT / path).read_bytes() == expected, ('immutable diagnostic ancestor', path)


def previous_workflow(workflow=None):
    if workflow is None:
        workflow = previous_six_workflow()
    baseline = baseline_workflow()
    assert_manual_unit_gate(workflow, baseline)
    assert_release_transitions()
    return baseline


def previous_release_bytes(path):
    assert path in RELEASE_FILES, ('unsupported exact historical release projection', path)
    previous_workflow()
    return baseline_bytes(path)


def aggregate_code(workflow):
    return textwrap.dedent(jobs(workflow)['required-gates'].split("python - <<'PYCODE'\n", 1)[1].split('          PYCODE', 1)[0])


class ManualUnitGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = previous_six_workflow()
        cls.baseline = baseline_workflow()
        cls.current, cls.original = jobs(cls.workflow), jobs(cls.baseline)

    def reject(self, before, after, job='manual-unit-orders'):
        block = self.current[job]
        self.assertEqual(block.count(before), 1, before)
        changed = self.workflow.replace(block, block.replace(before, after, 1), 1)
        with self.assertRaises(AssertionError):
            assert_manual_unit_gate(changed, self.baseline)

    def test_exact_whole_workflow_and_release_projection(self):
        self.assertEqual(previous_workflow(), self.baseline)
        self.assertEqual(tuple(self.current), (*ALL_JOBS, 'required-gates'))
        self.assertEqual(self.workflow.split('\njobs:\n')[0], self.baseline.split('\njobs:\n')[0])
        for bad in (self.baseline + '\n', self.baseline.replace('\n', '\r\n')):
            with self.assertRaises(AssertionError): assert_manual_unit_gate(self.workflow, bad)

    def test_every_old_job_has_only_its_exact_version_changes(self):
        for name in OLD_JOBS:
            before = self.original[name]
            self.assertEqual(before.count(OLD_VERSION), {'scout-rehearsal': 3, 'lab-blockers': 1}.get(name, 0))
            self.assertEqual(self.current[name], before.replace(OLD_VERSION, VERSION), name)

    def test_all_six_job_budgets_and_all_native_commands_are_immutable(self):
        for name, minutes in zip(ALL_JOBS, (45, 45, 25, 25, 15, 15)):
            for delta in (-1, 1):
                self.reject(f'    timeout-minutes: {minutes}\n', f'    timeout-minutes: {minutes + delta}\n', name)
            commands = [line + '\n' for line in self.current[name].splitlines() if line.startswith(('          python scripts/browser-', '          xvfb-run -a python scripts/browser-'))]
            self.assertTrue(commands)
            for line in commands:
                self.reject(line, '', name)
                self.reject(line, line.rstrip('\n') + ' || true\n', name)
                self.reject(line, line * 2, name)

    def test_missing_duplicate_reordered_or_extra_job_is_refused(self):
        blocks = [f'  {name}:\n' + body for name, body in self.current.items()]
        for block in blocks:
            for bad in (self.workflow.replace(block, '', 1), self.workflow + block):
                with self.assertRaises(AssertionError): assert_manual_unit_gate(bad, self.baseline)
        pair = blocks[-3] + blocks[-2]
        self.assertEqual(self.workflow.count(pair), 1)
        with self.assertRaises(AssertionError):
            assert_manual_unit_gate(self.workflow.replace(pair, blocks[-2] + blocks[-3]), self.baseline)
        with self.assertRaises(AssertionError):
            assert_manual_unit_gate(self.workflow + '  bypass:\n    runs-on: ubuntu-latest\n', self.baseline)

    def test_every_new_step_and_every_native_argument_is_exact(self):
        for step in steps(self.current['manual-unit-orders']):
            self.reject(step, '')
            self.reject(step, step * 2)
        command = next(line + '\n' for line in self.current['manual-unit-orders'].splitlines() if 'python scripts/browser-manual-unit-orders.py ' in line)
        for token in ('--url http://127.0.0.1:4173/Infinity/', '--expected-sha "$GITHUB_SHA"',
                      '--expected-version 0.6.26-alpha.1', '--runtime-node "$(node --version)"',
                      '--chromium "$CHROME"', '--output manual-unit-evidence',
                      '--natural-report manual-unit-source-evidence/fresh-natural-report.json',
                      '--source-binding manual-unit-source-evidence/old-source-binding.json',
                      '--fixture manual-unit-source-evidence/native-fixture.json'):
            self.assertIn(token, command)
            self.reject(command, command.replace(token, '', 1))
        self.reject(command, command.replace('sha256sum manual-unit-source-evidence/native-fixture.json', 'echo stale', 1))

    def test_native_checks_cannot_be_conditional_optional_backgrounded_or_masked(self):
        for step in steps(self.current['manual-unit-orders']):
            if '        if: always()\n' in step: continue
            for metadata in ('        if: false\n', '        continue-on-error: true\n', '        shell: bash +e {0}\n'):
                head = step.splitlines(keepends=True)[0]
                self.reject(step, step.replace(head, head + metadata, 1))
        command = next(line + '\n' for line in self.current['manual-unit-orders'].splitlines() if 'python scripts/browser-manual-unit-orders.py ' in line)
        for suffix in (' || true\n', '; true\n', ' &\n'):
            self.reject(command, command.rstrip('\n') + suffix)

    def test_independent_clean_checkout_build_runtime_browser_and_full_artifacts(self):
        block = self.current['manual-unit-orders']
        self.assertNotIn('    needs:', block)
        for banned in ('continue-on-error', 'actions/download-artifact', 'connect_over_cdp', 'browser.contexts['):
            self.assertNotIn(banned, block)
        for line in ('          ref: ${{ github.sha }}\n', '          fetch-depth: 0\n',
                     '          persist-credentials: false\n', '          node-version: 22\n',
                     '      - run: npm ci\n', '      - run: npm run build\n',
                     '          test "$READY" = 1\n'):
            self.reject(line, '')
        archive = upload(block)
        for line in archive.splitlines(keepends=True):
            if line.startswith('            ') or 'if-no-files-found: error' in line:
                self.reject(line, '')
        self.reject(archive, archive.replace('        if: always()\n', '', 1))
        self.reject('        run: git archive --format=zip --prefix=Infinity/ HEAD > manual-unit-source.zip\n',
                    '        run: git archive --format=zip --prefix=Infinity/ HEAD src > manual-unit-source.zip\n')

    def test_fresh_old_report_and_immutable_diagnostic_are_not_downloaded_acceptance(self):
        block = self.current['manual-unit-orders']
        for text in ('241a51de31364e9086abcc304884bf9df7cd6912', DIAGNOSTIC_SHA,
                     'node --import tsx scripts/natural-growth-journey.ts',
                     '9102da6f8fc52427b642883389d186726a8cf0c02747aa6c135150566458d8ea'):
            self.assertIn(text, block)
        for line in block.splitlines(keepends=True):
            if 'fresh-natural-report' in line or 'manual-unit-proof-source.py' in line:
                self.reject(line, '')
        self.assertNotIn('python scripts/browser-manual-unit-proof.py', block)

    def test_aggregate_executes_all_six_success_and_rejects_any_bad_or_absent_identity(self):
        base = {name: {'result':'success', 'outputs':{'common-identity-sha256':'a'*64}} for name in ALL_JOBS}
        for name in OLD_JOBS[:3]: base[name]['outputs']['orbital-identity-sha256'] = 'b'*64
        base['scout-rehearsal']['outputs']['scout-fixture-sha256'] = 'c'*64
        def execute(value):
            with patch.dict(os.environ, {'JOB_RESULTS':json.dumps(value)}), contextlib.redirect_stdout(io.StringIO()):
                exec(compile(aggregate_code(self.workflow), '<six-required-gates>', 'exec'), {})
        execute(base)
        for name in ALL_JOBS:
            for status in ('failure', 'cancelled', 'skipped', 'in_progress', '', None):
                bad=copy.deepcopy(base); bad[name]['result']=status
                with self.assertRaises(AssertionError): execute(bad)
            bad=copy.deepcopy(base); del bad[name]
            with self.assertRaises(AssertionError): execute(bad)
            for value in ('', 'A'*64, 'a'*63, 'd'*64, None):
                bad=copy.deepcopy(base); bad[name]['outputs']['common-identity-sha256']=value
                with self.assertRaises((AssertionError,TypeError)): execute(bad)
            bad=copy.deepcopy(base); del bad[name]['outputs']['common-identity-sha256']
            with self.assertRaises(AssertionError): execute(bad)
        bad=copy.deepcopy(base); bad['unexpected']=copy.deepcopy(base['manual-unit-orders'])
        with self.assertRaises(AssertionError): execute(bad)

    def test_release_and_diagnostic_bytes_cannot_hide_behind_projection(self):
        read = Path.read_bytes
        for relative in (*RELEASE_FILES, *DIAGNOSTIC_FILES):
            target=ROOT/relative; changed=read(target)+b'\n'
            def altered(path, target=target, changed=changed):
                return changed if path==target else read(path)
            with patch.object(Path, 'read_bytes', altered), self.assertRaises(AssertionError): previous_workflow()
        with self.assertRaises(AssertionError): previous_release_bytes('src/main.ts')


class SplitManualGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_recycle_preview_gate import previous_workflow as successor_workflow
        cls.workflow=successor_workflow()
        cls.baseline=six_workflow()
        cls.current,cls.original=jobs(cls.workflow),jobs(cls.baseline)
    def reject(self,before,after,job):
        body=self.current[job]
        self.assertEqual(body.count(before),1,before)
        changed=self.workflow.replace(body,body.replace(before,after,1),1)
        with self.assertRaisesRegex(AssertionError,'unapproved seven-job workflow drift'):
            assert_split_gate(changed,self.baseline)
    def test_exact_seven_six_five_projection_preserves_all_old_job_bytes(self):
        self.assertEqual(previous_six_workflow(),self.baseline)
        self.assertEqual(previous_workflow(),baseline_workflow())
        self.assertEqual(tuple(self.current),(*SEVEN_JOBS,'required-gates'))
        for name in OLD_JOBS:self.assertEqual(self.current[name],self.original[name],name)
        self.assertEqual(self.workflow.split('\njobs:\n')[0],self.baseline.split('\njobs:\n')[0])
    def test_all_seven_jobs_budgets_and_aggregate_two_minutes_remain_exact(self):
        for name,minutes in zip((*SEVEN_JOBS,'required-gates'),(45,45,25,25,15,15,15,2)):
            for value in (minutes-1,minutes+1):self.reject(f'    timeout-minutes: {minutes}\n',f'    timeout-minutes: {value}\n',name)
            block='  '+name+':\n'+self.current[name]
            for bad in (self.workflow.replace(block,'',1),self.workflow+block):
                with self.assertRaises(AssertionError):assert_split_gate(bad,self.baseline)
    def test_both_groups_have_independent_exact_preparation_native_census_and_artifacts(self):
        for group in MANUAL_GROUPS:
            name='manual-unit-'+group;body=self.current[name]
            self.assertNotIn('    needs:',body)
            self.assertNotIn('download-artifact',body)
            self.assertIn('--group '+group+' --url',body)
            self.assertIn('name: '+name+'-${{ github.sha }}',body)
            self.assertIn('manual-census-json: ${{ steps.manual_census.outputs.manual-census-json }}',body)
            self.assertIn("'test_manual_unit_census.py'",body)
            for step in steps(body):
                self.reject(step,'',name);self.reject(step,step*2,name)
            command=next(line+'\n' for line in body.splitlines() if 'xvfb-run -a python scripts/browser-manual-unit-orders.py ' in line)
            for old,new in (('--group '+group,'--group other'),('--expected-sha "$GITHUB_SHA"','--expected-sha old'),
                ('--expected-fixture-sha256','--optional-fixture-sha256'),('--runtime-node "$(node --version)"','--runtime-node v22.0.0')):
                self.reject(command,command.replace(old,new,1),name)
            for suffix in (' || true\n','; true\n',' &\n'):self.reject(command,command.rstrip('\n')+suffix,name)
            for step in steps(body):
                if '        if: always()\n' not in step:
                    head=step.splitlines(keepends=True)[0]
                    for optional in ('        if: false\n','        continue-on-error: true\n','        shell: bash +e {0}\n'):
                        self.reject(step,step.replace(head,head+optional,1),name)
    def test_aggregate_checks_success_before_exact_artifact_downloads_and_recomputation(self):
        body=self.current['required-gates'];all_steps=steps(body)
        self.assertIn("assert job['result'] == 'success'",all_steps[0])
        self.assertIn('actions/checkout@v7',all_steps[1])
        for index,group in ((2,'payments'),(3,'authority')):
            self.assertIn('uses: actions/download-artifact@v4',all_steps[index])
            self.assertIn('name: manual-unit-'+group+'-${{ github.sha }}',all_steps[index])
            self.assertNotIn('pattern:',all_steps[index]);self.assertNotIn('run-id:',all_steps[index])
        self.assertIn('manual_unit_census.py aggregate',all_steps[4])
        for step in all_steps:
            self.reject(step,'','required-gates')
            if 'if: always()' not in step:
                head=step.splitlines(keepends=True)[0]
                self.reject(step,step.replace(head,head+'        continue-on-error: true\n',1),'required-gates')
    def test_actual_seven_job_aggregate_rejects_every_non_success_and_bad_identity(self):
        base={name:{'result':'success','outputs':{'common-identity-sha256':'a'*64}} for name in SEVEN_JOBS}
        for name in OLD_JOBS[:3]:base[name]['outputs']['orbital-identity-sha256']='b'*64
        base['scout-rehearsal']['outputs']['scout-fixture-sha256']='c'*64
        code=compile(aggregate_code(self.workflow),'<actual-seven-job-first-stage>','exec')
        def execute(value):
            with patch.dict(os.environ,{'JOB_RESULTS':json.dumps(value)}),contextlib.redirect_stdout(io.StringIO()):exec(code,{})
        execute(base)
        for name in SEVEN_JOBS:
            for result in ('failure','cancelled','skipped','in_progress','',None):
                bad=copy.deepcopy(base);bad[name]['result']=result
                with self.assertRaises(AssertionError):execute(bad)
            bad=copy.deepcopy(base);del bad[name]
            with self.assertRaises(AssertionError):execute(bad)
            for key in base[name]['outputs']:
                for digest in ('','invalid','A'*64,None):
                    bad=copy.deepcopy(base);bad[name]['outputs'][key]=digest
                    with self.assertRaises((AssertionError,TypeError)):execute(bad)
                bad=copy.deepcopy(base);del bad[name]['outputs'][key]
                with self.assertRaises(AssertionError):execute(bad)
            bad=copy.deepcopy(base);bad[name]['outputs']['common-identity-sha256']='d'*64
            with self.assertRaises(AssertionError):execute(bad)
        bad=copy.deepcopy(base);bad['unexpected']=copy.deepcopy(base['manual-unit-payments'])
        with self.assertRaises(AssertionError):execute(bad)
    def test_bad_workflow_cannot_hide_behind_historical_six_projection(self):
        for bad in (self.workflow+'\n',self.workflow.replace('\n','\r\n'),self.workflow.replace('--group payments','--group authority',1)):
            with self.assertRaises(AssertionError):previous_six_workflow(bad)



if __name__ == '__main__': unittest.main()
