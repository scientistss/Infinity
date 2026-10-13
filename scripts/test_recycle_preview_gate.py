"""Exact additive read-only recycle wiring, then frozen seven/six/five/four gates.
Python/Git-only source contracts. These tests do not establish native or CI acceptance.
"""
import contextlib
import copy
from functools import lru_cache
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from test_parallel_legacy_gate_split import WORKFLOW_PATH, jobs, steps, upload

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = '6b985b88ec6b263a3eeb8f34252525383a9f110f'
BASE_WORKFLOW_SHA256 = 'c1623f2182e858a4405df8c7b8a3d0e991d790c3c0d33d9d3f10c00e55796d96'
OLD_VERSION = '0.6.26-alpha.1'
VERSION = '0.6.27-alpha.1'
JOB_BUDGETS = {'verify':45, 'verify-continuation':45, 'npc-orbital':25,
    'scout-rehearsal':25, 'lab-blockers':15, 'manual-unit-payments':15,
    'manual-unit-authority':15, 'required-gates':2}
# Counts address every literal in these exact immutable ancestor files. No
# dependency, source binder, runtime/job identity, or acceptance logic may drift.
RELEASE_FILES = {
    'package.json':1, 'package-lock.json':2,
    'scripts/browser-manual-unit-orders.py':1,
    'scripts/browser-lab-blockers.py':1,
    'scripts/browser-rehearsal-formation-copy.py':1,
    'scripts/manual_unit_census.py':2,
    'scripts/test_manual_unit_census.py':2,
    'scripts/parallel-gate-identity.py':1,
    'scripts/test_parallel_gate_identity.py':1,
    'scripts/scout_fixture_identity.py':2,
    'scripts/test_scout_fixture_identity.py':2,
    'scripts/test_lab_blockers_gate.py':1,
    'scripts/test_rehearsal_formation_copy_acceptance.py':3,
}

VERSION_LINES = (
    "          assert after_lock['version'] == after_lock['packages']['']['version'] == '0.6.26-alpha.1'\n",
    "          before_lock['version'] = before_lock['packages']['']['version'] = '0.6.26-alpha.1'\n",
    '          python scripts/browser-rehearsal-formation-copy.py --url http://127.0.0.1:4173/Infinity/ --natural-report scout-rehearsal-source-evidence/natural-report.json --expected-report-sha256 "$(sha256sum scout-rehearsal-source-evidence/natural-report.json | cut -d\' \' -f1)" --expected-sha "$GITHUB_SHA" --chromium "$CHROME" --expected-version 0.6.26-alpha.1 --runtime-node "$(node --version)" --output rehearsal-formation-copy-evidence\n',
    '          python scripts/browser-lab-blockers.py --url http://127.0.0.1:4173/Infinity/ --fixture lab-blockers-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum lab-blockers-source-evidence/native-fixture.json | cut -d\' \' -f1)" --natural-report lab-blockers-source-evidence/natural-report.json --expected-report-sha256 1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d --expected-sha "$GITHUB_SHA" --expected-version 0.6.26-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output lab-blockers-evidence\n',
    '          xvfb-run -a python scripts/browser-manual-unit-orders.py --group payments --url http://127.0.0.1:4173/Infinity/ --fixture manual-unit-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum manual-unit-source-evidence/native-fixture.json | cut -d\' \' -f1)" --natural-report manual-unit-source-evidence/fresh-natural-report.json --source-binding manual-unit-source-evidence/old-source-binding.json --expected-sha "$GITHUB_SHA" --expected-version 0.6.26-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output manual-unit-evidence\n',
    '          xvfb-run -a python scripts/browser-manual-unit-orders.py --group authority --url http://127.0.0.1:4173/Infinity/ --fixture manual-unit-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum manual-unit-source-evidence/native-fixture.json | cut -d\' \' -f1)" --natural-report manual-unit-source-evidence/fresh-natural-report.json --source-binding manual-unit-source-evidence/old-source-binding.json --expected-sha "$GITHUB_SHA" --expected-version 0.6.26-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output manual-unit-evidence\n',
)

OFFLINE_ANCHOR = "          python -m unittest discover -s scripts -p 'test_migration_quota_progress.py' -v\n"
OFFLINE_ADDITION = """          python -m unittest discover -s scripts -p 'test_recycle_preview_gate.py' -v
          python -m unittest discover -s scripts -p 'test_recycle_preview_acceptance.py' -v
          python -m unittest discover -s scripts -p 'test_recycle_preview_provenance.py' -v
          python -m unittest discover -s scripts -p 'test_recycle_preview_display_contract.py' -v
"""
NATIVE_ANCHOR = '          # Remaining independent old suites and complete performance samples run in verify-continuation.\n'
NATIVE_ADDITION = r'''          # One bounded read-only recycle preview; preserve all prior native commands and budgets.
          mkdir -p recycle-preview-source-evidence
          PIRATE_INPUT_SHA256="$(sha256sum deep-fixtures/pirate.json | cut -d' ' -f1)"
          cp deep-fixtures/pirate.json recycle-preview-source-evidence/pirate-input.json
          sha256sum recycle-preview-source-evidence/pirate-input.json > recycle-preview-source-evidence/pirate-input.sha256.txt
          node --import tsx scripts/recycle-preview-fixture.ts deep-fixtures/pirate.json "$PIRATE_INPUT_SHA256" "$GITHUB_SHA" > recycle-preview-source-evidence/native-fixture.json 2> recycle-preview-source-evidence/fixture-producer.log
          sha256sum recycle-preview-source-evidence/native-fixture.json > recycle-preview-source-evidence/native-fixture.sha256.txt
          CHROME="$(command -v google-chrome || command -v google-chrome-stable)"
          timeout --signal=TERM --kill-after=5s 235s xvfb-run -a python scripts/browser-recycle-preview.py --url http://127.0.0.1:4173/Infinity/ --fixture recycle-preview-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum recycle-preview-source-evidence/native-fixture.json | cut -d' ' -f1)" --pirate-input deep-fixtures/pirate.json --expected-input-sha256 "$PIRATE_INPUT_SHA256" --expected-sha "$GITHUB_SHA" --expected-version 0.6.27-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output recycle-preview-evidence > recycle-preview-browser.log 2>&1
'''
ARTIFACT_ANCHOR = '          name: original-deep-${{ github.sha }}\n          path: |\n'
ARTIFACT_ADDITION = '''            recycle-preview-source-evidence
            recycle-preview-evidence
            recycle-preview-browser.log
'''


@lru_cache(maxsize=None)
def baseline_bytes(path):
    assert path == WORKFLOW_PATH or path in RELEASE_FILES, path
    return subprocess.check_output(['git', '-C', str(ROOT), 'show', BASE_SHA+':'+path])


def baseline_workflow():
    raw = baseline_bytes(WORKFLOW_PATH)
    assert hashlib.sha256(raw).hexdigest() == BASE_WORKFLOW_SHA256, 'Pinned public seven-job workflow drift'
    return raw.decode('utf-8')


def exact_replace(body, before, after):
    assert body.count(before) == 1 and before != after and after not in body, before
    return body.replace(before, after, 1)


def expected_workflow(baseline):
    assert hashlib.sha256(baseline.encode()).hexdigest() == BASE_WORKFLOW_SHA256, 'Pinned baseline bytes differ'
    expected = baseline
    assert len(VERSION_LINES) == 6 and baseline.count(OLD_VERSION) == 6
    for line in VERSION_LINES:
        assert line.count(OLD_VERSION) == 1
        expected = exact_replace(expected, line, line.replace(OLD_VERSION, VERSION))
    original_verify = jobs(expected)['verify']
    verify = exact_replace(original_verify, OFFLINE_ANCHOR, OFFLINE_ANCHOR+OFFLINE_ADDITION)
    verify = exact_replace(verify, NATIVE_ANCHOR, NATIVE_ADDITION+NATIVE_ANCHOR)
    verify = exact_replace(verify, ARTIFACT_ANCHOR, ARTIFACT_ANCHOR+ARTIFACT_ADDITION)
    return exact_replace(expected, original_verify, verify)


def assert_recycle_gate(workflow, baseline):
    assert workflow == expected_workflow(baseline), 'Unapproved recycle workflow drift'


def assert_release_transitions():
    for path, count in RELEASE_FILES.items():
        local = ROOT/path
        assert local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111), ('Expected ordinary nonexecutable release source', path)
        before = baseline_bytes(path)
        assert before.count(OLD_VERSION.encode()) == count, ('Pinned release literal cardinality', path)
        from test_fleet_row_gate import previous_release_bytes as successor_release_bytes
        assert successor_release_bytes(path) == before.replace(OLD_VERSION.encode(), VERSION.encode()), ('Exact recycle release-only transition', path)


def previous_workflow(workflow=None):
    """Expose public 6b only after every actual successor workflow/release byte passes."""
    from test_fleet_row_gate import previous_workflow as successor_workflow
    actual_previous = successor_workflow()
    if workflow is None: workflow = actual_previous
    baseline = baseline_workflow()
    assert_recycle_gate(workflow, baseline)
    assert_release_transitions()
    return baseline


def previous_release_bytes(path):
    assert path in RELEASE_FILES, ('Unsupported exact recycle release projection', path)
    previous_workflow()
    return baseline_bytes(path)


class RecyclePreviewGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_fleet_row_gate import previous_workflow as successor_workflow
        cls.workflow = successor_workflow()
        cls.baseline = baseline_workflow()
        cls.current, cls.original = jobs(cls.workflow), jobs(cls.baseline)

    def reject(self, before, after):
        if self.workflow.count(before) == 1:
            altered = self.workflow.replace(before, after, 1)
        else:
            verify = self.current['verify']
            self.assertEqual(verify.count(before), 1, before)
            altered = self.workflow.replace(verify, verify.replace(before, after, 1), 1)
        with self.assertRaises(AssertionError):
            assert_recycle_gate(altered, self.baseline)

    def test_complete_exact_workflow_and_public_baseline_projection(self):
        self.assertEqual(previous_workflow(), self.baseline)
        for altered in (self.baseline+'\n', self.baseline.replace('\n','\r\n')):
            with self.assertRaises(AssertionError): assert_recycle_gate(self.workflow, altered)
        for altered in (self.workflow+'\n', self.workflow.replace('\n','\r\n')):
            with self.assertRaises(AssertionError): previous_workflow(altered)
        with self.assertRaises(AssertionError): previous_release_bytes('src/game/save.ts')

    def test_all_seven_contexts_and_original_job_budgets_and_aggregate_unchanged(self):
        self.assertEqual(tuple(self.current), tuple(JOB_BUDGETS))
        self.assertEqual(self.current['required-gates'], self.original['required-gates'])
        self.assertEqual(self.workflow.split('\njobs:\n')[0], self.baseline.split('\njobs:\n')[0])
        for name, minutes in JOB_BUDGETS.items():
            block = '  '+name+':\n'+self.current[name]
            self.assertIn(f'    timeout-minutes: {minutes}\n', block)
            for value in (minutes-1, minutes+1):
                self.reject(block, block.replace(f'    timeout-minutes: {minutes}\n', f'    timeout-minutes: {value}\n',1))
            self.reject(block, '')
            self.reject(block, block*2)
            if name != 'verify':
                self.assertEqual(self.current[name], self.original[name].replace(OLD_VERSION, VERSION))
        with self.assertRaises(AssertionError):
            assert_recycle_gate(self.workflow+'  extra:\n    runs-on: ubuntu-latest\n', self.baseline)
        first='  verify:\n'+self.current['verify']; second='  verify-continuation:\n'+self.current['verify-continuation']
        self.reject(first+second, second+first)

    def test_every_new_offline_and_native_line_is_exact_mandatory_and_unique(self):
        for block in (OFFLINE_ADDITION, NATIVE_ADDITION):
            self.reject(block, '')
            self.reject(block, block*2)
            for line in block.splitlines(keepends=True):
                self.reject(line, '')
                self.reject(line, line*2)
                if not line.lstrip().startswith('#'):
                    for suffix in (' || true\n', '; true\n', ' &\n'):
                        self.reject(line, line.rstrip('\n')+suffix)
        for line in VERSION_LINES:
            new = line.replace(OLD_VERSION, VERSION)
            for bad in (line, new.replace(VERSION,'0.6.27-alpha.2'), ''):
                self.reject(new, bad)

    def test_new_command_exact_hashes_release_runtime_input_and_240_second_hard_ceiling(self):
        command = next(line+'\n' for line in NATIVE_ADDITION.splitlines() if 'python scripts/browser-recycle-preview.py ' in line)
        for before, after in (
            ('--signal=TERM', '--signal=KILL'), ('--kill-after=5s 235s', '--kill-after=10s 240s'),
            ('--kill-after=5s 235s', '--kill-after=5s 234s'),
            ('--fixture recycle-preview-source-evidence/native-fixture.json', '--fixture stale.json'),
            ('--expected-fixture-sha256 "$(sha256sum recycle-preview-source-evidence/native-fixture.json | cut -d\' \' -f1)"', '--expected-fixture-sha256 stale'),
            ('--pirate-input deep-fixtures/pirate.json', '--pirate-input alien.json'),
            ('--expected-input-sha256 "$PIRATE_INPUT_SHA256"', '--expected-input-sha256 stale'),
            ('--expected-sha "$GITHUB_SHA"', '--expected-sha '+BASE_SHA),
            ('--expected-version '+VERSION, '--expected-version '+OLD_VERSION),
            ('--runtime-node "$(node --version)"', '--runtime-node v22.0.0'),
            ('--chromium "$CHROME"', '--chromium other'),
            ('--output recycle-preview-evidence', '--output /tmp/omitted'),
            (' > recycle-preview-browser.log 2>&1', ''),
        ):
            self.assertIn(before,command)
            self.reject(command,command.replace(before,after,1))
        fixture = next(line+'\n' for line in NATIVE_ADDITION.splitlines() if 'node --import tsx scripts/recycle-preview-fixture.ts ' in line)
        self.reject(fixture,fixture.replace('"$GITHUB_SHA"','"'+BASE_SHA+'"',1))
        self.reject(fixture,fixture.replace('"$PIRATE_INPUT_SHA256"','"stale"',1))

    def test_all_prior_commands_order_and_service_readiness_are_preserved(self):
        current=self.current['verify']; original=self.original['verify']
        for block in (OFFLINE_ADDITION,NATIVE_ADDITION,ARTIFACT_ADDITION):
            self.assertEqual(current.count(block),1)
            current=current.replace(block,'',1)
        self.assertEqual(current,original)
        addition_at=self.current['verify'].index(NATIVE_ADDITION)
        for port in range(4173,4178):
            self.assertLess(self.current['verify'].index('curl -fsS http://127.0.0.1:'+str(port)+'/'),addition_at)
        self.assertLess(self.current['verify'].index('python scripts/browser-ring-protection.py '),addition_at)
        self.assertNotIn('recycle-preview',self.current['verify-continuation'])
        self.assertNotIn('browser-presentation-performance.py',NATIVE_ADDITION)
        for step in steps(self.current['verify']):
            if NATIVE_ADDITION not in step and OFFLINE_ADDITION not in step: continue
            head=step.splitlines(keepends=True)[0]
            for metadata in ('        if: false\n','        continue-on-error: true\n','        shell: bash +e {0}\n'):
                self.reject(step,step.replace(head,head+metadata,1))

    def test_original_source_and_new_complete_input_output_log_always_archived(self):
        block=upload(self.current['verify'])
        self.assertIn('        if: always()\n',block)
        self.assertIn('            source.zip\n',block)
        self.assertIn('            deep-fixtures\n',block)
        self.assertIn('          if-no-files-found: error\n',block)
        for line in ARTIFACT_ADDITION.splitlines(keepends=True):
            self.assertIn(line,block)
            self.reject(line,'')
            self.reject(line,line*2)
        self.reject(block,block.replace('        if: always()\n','',1))
        self.reject(block,block.replace('          if-no-files-found: error\n','          if-no-files-found: warn\n',1))

    def test_current_versions_and_all_dependency_runtime_and_job_binder_bytes_exact(self):
        assert_release_transitions()
        old_lock=json.loads(baseline_bytes('package-lock.json'))
        from test_fleet_row_gate import previous_release_bytes as successor_release_bytes
        current=json.loads(successor_release_bytes('package-lock.json'))
        old_lock['version']=old_lock['packages']['']['version']=VERSION
        self.assertEqual(current,old_lock)
        for path in RELEASE_FILES:
            self.assertEqual(previous_release_bytes(path),baseline_bytes(path))
        from manual_unit_census import RUNTIME_KEYS
        self.assertEqual(RUNTIME_KEYS['githubJob'],'GITHUB_JOB')
        self.assertEqual(RUNTIME_KEYS['githubSha'],'GITHUB_SHA')

    def test_any_source_drift_or_version_decrease_fails_before_old_projection(self):
        from test_research_unlock_copy_gate import VERSION as CURRENT_VERSION
        original_read=Path.read_bytes
        for relative in RELEASE_FILES:
            target=ROOT/relative;original=original_read(target)
            for changed in (original+b'\n',original.replace(CURRENT_VERSION.encode(),OLD_VERSION.encode(),1),original.replace(CURRENT_VERSION.encode(),VERSION.encode(),1)):
                self.assertNotEqual(changed,original,relative)
                def altered(path,target=target,changed=changed):
                    return changed if path==target else original_read(path)
                with self.subTest(relative=relative),patch.object(Path,'read_bytes',altered),self.assertRaises(AssertionError):
                    previous_workflow()
        target=ROOT/'package-lock.json'
        changed=original_read(target).replace(b'"version": "2.2.0"',b'"version": "0.0.0"',1)
        self.assertNotEqual(changed,original_read(target))
        def altered(path):return changed if path==target else original_read(path)
        with patch.object(Path,'read_bytes',altered),self.assertRaises(AssertionError):previous_workflow()

    def test_original_seven_to_six_to_five_to_four_contracts_still_execute(self):
        from test_manual_unit_gate import previous_six_workflow, previous_workflow as five_workflow, six_workflow, baseline_workflow as five_baseline
        from test_lab_blockers_gate import previous_workflow as four_workflow, baseline_workflow as four_baseline
        self.assertEqual(previous_six_workflow(),six_workflow())
        self.assertEqual(five_workflow(),five_baseline())
        self.assertEqual(four_workflow(),four_baseline())

    def test_actual_aggregate_still_rejects_every_skipped_failed_missing_or_extra_job(self):
        from test_manual_unit_gate import aggregate_code
        names=tuple(name for name in JOB_BUDGETS if name!='required-gates')
        base={name:{'result':'success','outputs':{'common-identity-sha256':'a'*64}} for name in names}
        for name in ('verify','verify-continuation','npc-orbital'):base[name]['outputs']['orbital-identity-sha256']='b'*64
        base['scout-rehearsal']['outputs']['scout-fixture-sha256']='c'*64
        code=compile(aggregate_code(self.workflow),'<actual-recycle-seven-required-jobs>','exec')
        def execute(value):
            with patch.dict(os.environ,{'JOB_RESULTS':json.dumps(value)}),contextlib.redirect_stdout(io.StringIO()):exec(code,{})
        execute(base)
        for name in names:
            for result in ('failure','cancelled','skipped','in_progress','',None):
                bad=copy.deepcopy(base);bad[name]['result']=result
                with self.assertRaises(AssertionError):execute(bad)
            bad=copy.deepcopy(base);del bad[name]
            with self.assertRaises(AssertionError):execute(bad)
        bad=copy.deepcopy(base);bad['recycle-preview']=copy.deepcopy(base['verify'])
        with self.assertRaises(AssertionError):execute(bad)


if __name__ == '__main__': unittest.main()
