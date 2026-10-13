"""Exact fleet-row formal release wiring before the frozen recycle gate chain.

Python/Git-only contracts. Source seals, native acceptance and remote CI remain
independent requirements; no historical experiment result is rewritten here.
"""
import contextlib
import copy
from functools import lru_cache
import hashlib
import io
import json
import os
import re
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
from test_parallel_legacy_gate_split import WORKFLOW_PATH, jobs, steps, upload

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = '7ab569045996a1a6ad8ce1aee477092144dfad74'
BASE_WORKFLOW_SHA256 = '9d82de5f12de4a3a30a89ac05d01397b0ab80de1d0651e9b87be5ba840abe486'
OLD_VERSION = '0.6.27-alpha.1'
VERSION = '0.6.29-alpha.1'
JOB_BUDGETS = {'verify':45, 'verify-continuation':45, 'npc-orbital':25,
    'scout-rehearsal':25, 'lab-blockers':15, 'manual-unit-payments':15,
    'manual-unit-authority':15, 'required-gates':2}
# Only these exact version literals may differ from each immutable ancestor.
# Every dependency, runtime binder, job identity and acceptance byte is retained.
RELEASE_FILES = {
    'package.json':1, 'package-lock.json':2,
    'scripts/browser-manual-unit-orders.py':1,
    'scripts/browser-lab-blockers.py':1,
    'scripts/browser-rehearsal-formation-copy.py':1,
    'scripts/browser-recycle-preview.py':1,
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
    '          timeout --signal=TERM --kill-after=5s 235s xvfb-run -a python scripts/browser-recycle-preview.py --url http://127.0.0.1:4173/Infinity/ --fixture recycle-preview-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum recycle-preview-source-evidence/native-fixture.json | cut -d\' \' -f1)" --pirate-input deep-fixtures/pirate.json --expected-input-sha256 "$PIRATE_INPUT_SHA256" --expected-sha "$GITHUB_SHA" --expected-version 0.6.27-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output recycle-preview-evidence > recycle-preview-browser.log 2>&1\n',
    "          assert after_lock['version'] == after_lock['packages']['']['version'] == '0.6.27-alpha.1'\n",
    "          before_lock['version'] = before_lock['packages']['']['version'] = '0.6.27-alpha.1'\n",
    '          python scripts/browser-rehearsal-formation-copy.py --url http://127.0.0.1:4173/Infinity/ --natural-report scout-rehearsal-source-evidence/natural-report.json --expected-report-sha256 "$(sha256sum scout-rehearsal-source-evidence/natural-report.json | cut -d\' \' -f1)" --expected-sha "$GITHUB_SHA" --chromium "$CHROME" --expected-version 0.6.27-alpha.1 --runtime-node "$(node --version)" --output rehearsal-formation-copy-evidence\n',
    '          python scripts/browser-lab-blockers.py --url http://127.0.0.1:4173/Infinity/ --fixture lab-blockers-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum lab-blockers-source-evidence/native-fixture.json | cut -d\' \' -f1)" --natural-report lab-blockers-source-evidence/natural-report.json --expected-report-sha256 1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d --expected-sha "$GITHUB_SHA" --expected-version 0.6.27-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output lab-blockers-evidence\n',
    '          xvfb-run -a python scripts/browser-manual-unit-orders.py --group payments --url http://127.0.0.1:4173/Infinity/ --fixture manual-unit-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum manual-unit-source-evidence/native-fixture.json | cut -d\' \' -f1)" --natural-report manual-unit-source-evidence/fresh-natural-report.json --source-binding manual-unit-source-evidence/old-source-binding.json --expected-sha "$GITHUB_SHA" --expected-version 0.6.27-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output manual-unit-evidence\n',
    '          xvfb-run -a python scripts/browser-manual-unit-orders.py --group authority --url http://127.0.0.1:4173/Infinity/ --fixture manual-unit-source-evidence/native-fixture.json --expected-fixture-sha256 "$(sha256sum manual-unit-source-evidence/native-fixture.json | cut -d\' \' -f1)" --natural-report manual-unit-source-evidence/fresh-natural-report.json --source-binding manual-unit-source-evidence/old-source-binding.json --expected-sha "$GITHUB_SHA" --expected-version 0.6.27-alpha.1 --runtime-node "$(node --version)" --chromium "$CHROME" --output manual-unit-evidence\n',
)

OFFLINE_ANCHOR = "          python -m unittest discover -s scripts -p 'test_recycle_preview_display_contract.py' -v\n"
OFFLINE_ADDITION = """          python -m unittest discover -s scripts -p 'test_fleet_row_gate.py' -v
          python scripts/test_fleet_row_provenance.py --verify-candidate "$GITHUB_SHA" -v
"""


@lru_cache(maxsize=32)
def immutable_baseline_blob(repository, reference, path, read_type):
    # Only the fifteen immutable baseline blobs are cached, never live files or
    # assertions. Repository, full commit, path and object type are all keys.
    assert repository == str(Path(repository).resolve()), 'Canonical fleet baseline repository required'
    assert reference == BASE_SHA and re.fullmatch('[0-9a-f]{40}', reference), 'Exact full fleet baseline commit required'
    assert path == WORKFLOW_PATH or path in RELEASE_FILES, ('Unsupported fleet baseline path', path)
    assert read_type == 'blob', 'Only raw fleet baseline blobs are permitted'
    command = ['git', '--no-replace-objects', '-C', repository]
    oid = subprocess.check_output([*command, 'rev-parse', '--verify', reference+':'+path]).decode().strip()
    assert re.fullmatch('[0-9a-f]{40}', oid), 'Exact full fleet baseline blob identity required'
    raw = subprocess.check_output([*command, 'cat-file', read_type, oid])
    computed = hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    assert computed == oid, 'Fleet baseline raw bytes do not match their Git blob identity'
    return raw


def baseline_bytes(path):
    assert path == WORKFLOW_PATH or path in RELEASE_FILES, ('Unsupported fleet baseline path', path)
    return immutable_baseline_blob(str(ROOT.resolve()), BASE_SHA, path, 'blob')


def baseline_workflow():
    raw = baseline_bytes(WORKFLOW_PATH)
    assert hashlib.sha256(raw).hexdigest() == BASE_WORKFLOW_SHA256, 'Pinned public recycle workflow drift'
    return raw.decode('utf-8')


def exact_replace(body, before, after):
    assert body.count(before) == 1 and before != after and after not in body, before
    return body.replace(before, after, 1)


def expected_workflow(baseline):
    assert hashlib.sha256(baseline.encode()).hexdigest() == BASE_WORKFLOW_SHA256, 'Pinned fleet baseline bytes differ'
    assert len(VERSION_LINES) == 7 and baseline.count(OLD_VERSION) == 7
    expected = baseline
    for line in VERSION_LINES:
        assert line.count(OLD_VERSION) == 1
        expected = exact_replace(expected, line, line.replace(OLD_VERSION, VERSION))
    verify = jobs(expected)['verify']
    changed = exact_replace(verify, OFFLINE_ANCHOR, OFFLINE_ANCHOR+OFFLINE_ADDITION)
    return exact_replace(expected, verify, changed)


def assert_fleet_gate(workflow, baseline):
    assert workflow == expected_workflow(baseline), 'Unapproved fleet-row workflow drift'


def ordinary_source(path):
    local = ROOT/path
    assert local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111), ('Expected ordinary nonexecutable fleet release source', path)
    return local


def assert_release_transitions():
    from test_research_unlock_copy_gate import previous_release_files as successor_release_files
    projected = successor_release_files()
    for path, count in RELEASE_FILES.items():
        local = ordinary_source(path)
        before = baseline_bytes(path)
        assert before.count(OLD_VERSION.encode()) == count, ('Pinned fleet release literal cardinality', path)
        assert projected[path] == before.replace(OLD_VERSION.encode(), VERSION.encode()), ('Exact fleet release-only transition', path)


def previous_workflow(workflow=None):
    """Expose frozen 7ab only after all actual successor workflow/release bytes pass."""
    from test_research_unlock_copy_gate import previous_workflow as successor_workflow
    current = successor_workflow()
    baseline = baseline_workflow()
    assert_fleet_gate(current, baseline)
    if workflow is not None:
        assert_fleet_gate(workflow, baseline)
    assert_release_transitions()
    return baseline


def previous_release_bytes(path):
    assert path in RELEASE_FILES, ('Unsupported exact fleet release projection', path)
    previous_workflow()
    return baseline_bytes(path)


class FleetRowBaselineBlobTests(unittest.TestCase):
    def setUp(self): immutable_baseline_blob.cache_clear()
    def tearDown(self): immutable_baseline_blob.cache_clear()

    @staticmethod
    def oid(raw): return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()

    def test_only_verified_raw_blob_bytes_are_cached_with_no_replace_on_both_reads(self):
        raw = b'fixed immutable baseline blob\n'; oid = self.oid(raw)
        with patch.object(subprocess, 'check_output', side_effect=[(oid+'\n').encode(), raw]) as git:
            self.assertEqual(baseline_bytes('package.json'), raw)
            self.assertEqual(baseline_bytes('package.json'), raw)
        command = ['git', '--no-replace-objects', '-C', str(ROOT.resolve())]
        self.assertEqual(git.call_args_list[0].args[0], [*command, 'rev-parse', '--verify', BASE_SHA+':package.json'])
        self.assertEqual(git.call_args_list[1].args[0], [*command, 'cat-file', 'blob', oid])
        self.assertEqual(git.call_count, 2)
        self.assertEqual(immutable_baseline_blob.cache_info().maxsize, 32)
        self.assertEqual(immutable_baseline_blob.cache_info().currsize, 1)

    def test_canonical_repository_full_commit_and_path_are_separate_cache_keys(self):
        raw = b'verified synthetic baseline'; oid = self.oid(raw)
        def git(command): return (oid+'\n').encode() if 'rev-parse' in command else raw
        original_root, original_reference = ROOT, BASE_SHA
        with patch.object(subprocess, 'check_output', side_effect=git) as calls:
            baseline_bytes('package.json')
            with patch(__name__+'.ROOT', original_root/'scripts'/'..'):
                baseline_bytes('package.json')
            self.assertEqual(calls.call_count, 2, 'Canonical aliases should identify the same repository')
            with patch(__name__+'.ROOT', original_root/'distinct-repository'):
                baseline_bytes('package.json')
            self.assertEqual(calls.call_count, 4, 'Different repositories must not reuse cached bytes')
            baseline_bytes('package-lock.json')
            self.assertEqual(calls.call_count, 6, 'Different paths must not reuse cached bytes')
            with patch(__name__+'.BASE_SHA', 'a'*40): baseline_bytes('package.json')
            self.assertEqual(calls.call_count, 8, 'Different full commits must not reuse cached bytes')
            self.assertEqual(calls.call_args_list[6].args[0][-1], 'a'*40+':package.json')
        self.assertEqual(BASE_SHA, original_reference)

    def test_wrong_blob_hash_and_malformed_object_identity_never_enter_cache(self):
        raw = b'original exact blob'; oid = self.oid(raw)
        for identifier, altered in (((oid+'\n').encode(), raw+b'tamper'), (b'not-a-full-object\n', raw)):
            immutable_baseline_blob.cache_clear()
            with patch.object(subprocess, 'check_output', side_effect=[identifier, altered]):
                with self.assertRaises(AssertionError): baseline_bytes('package.json')
            self.assertEqual(immutable_baseline_blob.cache_info().currsize, 0)
            with patch.object(subprocess, 'check_output', side_effect=[(oid+'\n').encode(), raw]) as retry:
                self.assertEqual(baseline_bytes('package.json'), raw)
            self.assertEqual(retry.call_count, 2)

    def test_git_errors_are_not_cached_and_exact_read_can_be_retried(self):
        raw = b'valid retry blob'; oid = self.oid(raw)
        for fail_at in ('resolve', 'read'):
            immutable_baseline_blob.cache_clear()
            error = subprocess.CalledProcessError(1, ['git', '--no-replace-objects'])
            failed = [error] if fail_at == 'resolve' else [(oid+'\n').encode(), error]
            with patch.object(subprocess, 'check_output', side_effect=failed):
                with self.assertRaises(subprocess.CalledProcessError): baseline_bytes('package.json')
            self.assertEqual(immutable_baseline_blob.cache_info().currsize, 0)
            with patch.object(subprocess, 'check_output', side_effect=[(oid+'\n').encode(), raw]) as retry:
                self.assertEqual(baseline_bytes('package.json'), raw)
            self.assertEqual(retry.call_count, 2)

    def test_primed_blob_cannot_authorize_unknown_path_type_or_noncanonical_identity(self):
        raw = b'valid priming blob'; oid = self.oid(raw)
        with patch.object(subprocess, 'check_output', side_effect=[(oid+'\n').encode(), raw]):
            baseline_bytes('package.json')
        root = str(ROOT.resolve())
        with patch.object(subprocess, 'check_output') as git:
            for arguments in ((root, BASE_SHA, 'package.json', 'tree'),
                              (root, BASE_SHA, 'package.json', '--batch'),
                              (root, BASE_SHA, 'src/main.ts', 'blob'),
                              (root, BASE_SHA[:7], 'package.json', 'blob'),
                              (root+'/scripts/..', BASE_SHA, 'package.json', 'blob')):
                with self.assertRaises(AssertionError): immutable_baseline_blob(*arguments)
            with self.assertRaises(AssertionError): baseline_bytes('src/main.ts')
            git.assert_not_called()
        self.assertEqual(immutable_baseline_blob.cache_info().currsize, 1)

    def test_live_workflow_and_release_mutations_fail_after_all_baseline_blobs_are_primed(self):
        previous_workflow()
        self.assertEqual(immutable_baseline_blob.cache_info().currsize, 15)
        original_read = Path.read_bytes
        from test_research_unlock_copy_gate import previous_workflow as successor_workflow
        workflow = successor_workflow()
        for relative in (WORKFLOW_PATH, *RELEASE_FILES):
            target = ROOT/relative
            changed = original_read(target)+b'\n'
            def altered(path): return changed if path == target else original_read(path)
            with self.subTest(path=relative), patch.object(Path, 'read_bytes', altered):
                with self.assertRaises(AssertionError): previous_workflow(workflow)
                with self.assertRaises(AssertionError): previous_release_bytes('package.json')


class FleetRowGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_research_unlock_copy_gate import previous_workflow as successor_workflow
        cls.workflow = successor_workflow()
        cls.baseline = baseline_workflow()
        cls.current, cls.original = jobs(cls.workflow), jobs(cls.baseline)

    def reject(self, before, after, job=None):
        body = self.workflow if job is None else self.current[job]
        self.assertEqual(body.count(before), 1, before)
        changed = body.replace(before, after, 1)
        altered = changed if job is None else self.workflow.replace(body, changed, 1)
        self.assertNotEqual(altered, self.workflow)
        with self.assertRaises(AssertionError):
            previous_workflow(altered)

    def altered_read(self, target, changed):
        original_read = Path.read_bytes
        self.assertNotEqual(changed, original_read(target), target)
        def altered(path):
            return changed if path == target else original_read(path)
        return patch.object(Path, 'read_bytes', altered)

    def test_exact_current_workflow_and_release_checked_before_every_projection(self):
        self.assertEqual(previous_workflow(), self.baseline)
        self.assertEqual(previous_workflow(self.workflow), self.baseline)
        for path in RELEASE_FILES:
            self.assertEqual(previous_release_bytes(path), baseline_bytes(path))
        for altered in (self.baseline+'\n', self.baseline.replace('\n', '\r\n')):
            with self.assertRaises(AssertionError): assert_fleet_gate(self.workflow, altered)
        for altered in (self.workflow+'\n', self.workflow.replace('\n', '\r\n'), self.baseline):
            with self.assertRaises(AssertionError): previous_workflow(altered)
        with self.assertRaises(AssertionError): previous_release_bytes('src/game/save.ts')
        target = ROOT/WORKFLOW_PATH
        with self.altered_read(target, self.workflow.encode()+b'\n'):
            with self.assertRaises(AssertionError): previous_workflow(self.workflow)
            with self.assertRaises(AssertionError): previous_release_bytes('package.json')

    def test_exact_only_seven_anchored_workflow_release_lines(self):
        self.assertEqual(self.workflow.count(VERSION), 7)
        self.assertNotIn(OLD_VERSION, self.workflow)
        for line in VERSION_LINES:
            current = line.replace(OLD_VERSION, VERSION)
            for changed in (line, current.replace(VERSION, '0.6.29-alpha.2'), '', current*2):
                self.reject(current, changed)

    def test_new_source_and_gate_commands_are_mandatory_unique_and_unmasked(self):
        self.assertEqual(self.workflow.count(OFFLINE_ANCHOR+OFFLINE_ADDITION), 1)
        self.reject(OFFLINE_ADDITION, '')
        self.reject(OFFLINE_ADDITION, OFFLINE_ADDITION*2)
        self.reject(OFFLINE_ANCHOR+OFFLINE_ADDITION, OFFLINE_ADDITION+OFFLINE_ANCHOR)
        for line in OFFLINE_ADDITION.splitlines(keepends=True):
            for changed in ('', line*2, '          # '+line.lstrip(),
                            line.rstrip('\n')+' || true\n',
                            line.rstrip('\n')+'; true\n',
                            line.rstrip('\n')+' &\n',
                            line.replace('python ', 'true # python ', 1)):
                self.reject(line, changed)
        step = next(step for step in steps(self.current['verify']) if OFFLINE_ADDITION in step)
        head = step.splitlines(keepends=True)[0]
        for metadata in ('        if: false\n', '        continue-on-error: true\n',
                         '        shell: bash +e {0}\n', '        timeout-minutes: 1\n'):
            self.reject(step, step.replace(head, head+metadata, 1))

    def test_all_job_order_budgets_identity_and_required_aggregate_are_exact(self):
        self.assertEqual(tuple(self.current), tuple(JOB_BUDGETS))
        self.assertEqual(self.current['required-gates'], self.original['required-gates'])
        self.assertEqual(self.workflow.split('\njobs:\n')[0], self.baseline.split('\njobs:\n')[0])
        self.assertIn("'codex/infinity-rebuild-*'", self.workflow.split('\njobs:\n')[0])
        for name, minutes in JOB_BUDGETS.items():
            block = '  '+name+':\n'+self.current[name]
            self.assertIn(f'    timeout-minutes: {minutes}\n', block)
            for changed in ('', block*2, block.replace('  '+name+':\n', '  alien-job:\n', 1),
                            block.replace(f'    timeout-minutes: {minutes}\n', f'    timeout-minutes: {minutes+1}\n', 1),
                            block.replace('    runs-on:', '    continue-on-error: true\n    runs-on:', 1),
                            block.replace('    runs-on:', '    needs: [unrelated]\n    runs-on:', 1)):
                self.reject(block, changed)
            condition = next(line for line in block.splitlines(keepends=True) if line.startswith('    if: '))
            self.reject(block, block.replace(condition, '    if: false\n', 1))
            if name != 'verify':
                self.assertEqual(self.current[name], self.original[name].replace(OLD_VERSION, VERSION))
            else:
                self.assertEqual(self.current[name].replace(OFFLINE_ADDITION, '', 1), self.original[name].replace(OLD_VERSION, VERSION))
        first = '  verify:\n'+self.current['verify']
        second = '  verify-continuation:\n'+self.current['verify-continuation']
        self.reject(first+second, second+first)
        with self.assertRaises(AssertionError): previous_workflow(self.workflow+'  extra:\n    runs-on: ubuntu-latest\n')
        for name, body in self.current.items():
            for line in body.splitlines(keepends=True):
                if ('common-identity-sha256:' in line or 'GITHUB_JOB' in line or
                    'common_identity.outputs.common-sha256' in line or
                    'JOB_RESULTS:' in line or 'github.sha' in line and 'ref:' in line):
                    if body.count(line) == 1:
                        self.reject(line, '', job=name)
                    else:
                        for step in steps(body):
                            if line in step:
                                self.assertEqual(step.count(line), 1)
                                self.reject(step, step.replace(line, '', 1), job=name)

    def test_existing_native_readiness_watchdogs_and_artifacts_are_preserved(self):
        for name, old in self.original.items():
            expected = old.replace(OLD_VERSION, VERSION)
            actual = self.current[name]
            if name == 'verify': actual = actual.replace(OFFLINE_ADDITION, '', 1)
            self.assertEqual(actual, expected, name)
            for step in steps(self.current[name]):
                if any(marker in step for marker in ('browser-', 'curl -fsS', 'timeout --signal=', 'upload-artifact@')):
                    self.reject(step, '', job=name)
                for line in step.splitlines(keepends=True):
                    if 'python scripts/browser-recycle-preview.py ' in line:
                        self.assertEqual(step.count(line), 1)
                        for suffix in (' || true\n', '; true\n', ' &\n'):
                            changed = step.replace(line, line.rstrip('\n')+suffix, 1)
                            self.reject(step, changed, job=name)
            if 'actions/upload-artifact@' in actual:
                self.assertIn('        if: always()\n', upload(actual))

    def test_all_release_bytes_dependencies_and_no_unknown_third_version_field(self):
        assert_release_transitions()
        self.assertEqual(len(RELEASE_FILES), 14)
        old = json.loads(baseline_bytes('package-lock.json'))
        old['version'] = old['packages']['']['version'] = VERSION
        from test_research_unlock_copy_gate import previous_release_bytes as successor_release_bytes, VERSION as CURRENT_VERSION
        self.assertEqual(json.loads(successor_release_bytes('package-lock.json')), old)
        for relative, count in RELEASE_FILES.items():
            target = ROOT/relative
            original = target.read_bytes()
            self.assertEqual(successor_release_bytes(relative).count(VERSION.encode()), count, relative)
            for changed in (original+b'\n', original.replace(CURRENT_VERSION.encode(), OLD_VERSION.encode(), 1),
                            original.replace(CURRENT_VERSION.encode(), b'0.6.29-alpha.2', 1)):
                with self.subTest(relative=relative), self.altered_read(target, changed):
                    with self.assertRaises(AssertionError): previous_workflow()
                    with self.assertRaises(AssertionError): previous_release_bytes(relative)
        for relative in ('package.json', 'package-lock.json'):
            target = ROOT/relative
            original = target.read_bytes()
            changed = original.replace(b'{\n', b'{\n  "unknownReleaseVersion": "'+VERSION.encode()+b'",\n', 1)
            with self.altered_read(target, changed), self.assertRaises(AssertionError): previous_workflow()
        target = ROOT/'package-lock.json'
        changed = target.read_bytes().replace(b'"version": "2.2.0"', b'"version": "0.0.0"', 1)
        with self.altered_read(target, changed), self.assertRaises(AssertionError): previous_workflow()

    def test_workflow_and_release_modes_and_symlinks_cannot_hide_behind_projection(self):
        original_stat, original_symlink = Path.stat, Path.is_symlink
        for relative in (WORKFLOW_PATH, *RELEASE_FILES):
            target = ROOT/relative
            def symlink(path): return path == target or original_symlink(path)
            with self.subTest(relative=relative), patch.object(Path, 'is_symlink', symlink), self.assertRaises(AssertionError):
                previous_workflow()
            def executable(path, *args, **kwargs):
                value = original_stat(path, *args, **kwargs)
                if path == target:
                    fields = list(value); fields[0] |= 0o100
                    return os.stat_result(fields)
                return value
            with patch.object(Path, 'stat', executable), self.assertRaises(AssertionError): previous_workflow()

    def test_frozen_recycle_seven_six_five_four_contracts_still_execute(self):
        from test_recycle_preview_gate import previous_workflow as recycle_previous, baseline_workflow as recycle_baseline
        from test_manual_unit_gate import previous_six_workflow, previous_workflow as five_previous, six_workflow, baseline_workflow as five_baseline
        from test_lab_blockers_gate import previous_workflow as four_previous, baseline_workflow as four_baseline
        self.assertEqual(recycle_previous(), recycle_baseline())
        self.assertEqual(previous_six_workflow(), six_workflow())
        self.assertEqual(five_previous(), five_baseline())
        self.assertEqual(four_previous(), four_baseline())

    def test_actual_aggregate_rejects_skipped_failed_missing_extra_and_mismatched_identity(self):
        from test_manual_unit_gate import aggregate_code
        names = tuple(name for name in JOB_BUDGETS if name != 'required-gates')
        base = {name:{'result':'success', 'outputs':{'common-identity-sha256':'a'*64}} for name in names}
        for name in ('verify','verify-continuation','npc-orbital'): base[name]['outputs']['orbital-identity-sha256'] = 'b'*64
        base['scout-rehearsal']['outputs']['scout-fixture-sha256'] = 'c'*64
        code = compile(aggregate_code(self.workflow), '<actual-fleet-seven-required-jobs>', 'exec')
        def execute(value):
            with patch.dict(os.environ, {'JOB_RESULTS':json.dumps(value)}), contextlib.redirect_stdout(io.StringIO()): exec(code, {})
        execute(base)
        for name in names:
            for result in ('failure','cancelled','skipped','in_progress','',None):
                bad = copy.deepcopy(base); bad[name]['result'] = result
                with self.assertRaises(AssertionError): execute(bad)
            bad = copy.deepcopy(base); del bad[name]
            with self.assertRaises(AssertionError): execute(bad)
            for identity in ('', 'd'*64, 'g'*64):
                bad = copy.deepcopy(base); bad[name]['outputs']['common-identity-sha256'] = identity
                with self.assertRaises(AssertionError): execute(bad)
            bad = copy.deepcopy(base); del bad[name]['outputs']['common-identity-sha256']
            with self.assertRaises(AssertionError): execute(bad)
        bad = copy.deepcopy(base); bad['fleet-row'] = copy.deepcopy(base['verify'])
        with self.assertRaises(AssertionError): execute(bad)


if __name__ == '__main__': unittest.main()
