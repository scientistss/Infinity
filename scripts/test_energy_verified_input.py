"""Python/Git-only sealed-input regressions; these are not native acceptance."""
from dataclasses import FrozenInstanceError, replace
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import MappingProxyType
import unittest
from unittest.mock import patch

import energy_verified_input as inputs


class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='verified-input-tests-')
        self.root = Path(self.temp.name).resolve()
        self.env = inputs.clean_environment()
        self.git('init', '--quiet')
        for area in inputs.SOURCE_AREAS:
            path = self.root/area/'source.txt'
            path.parent.mkdir()
            path.write_bytes((area+' exact source\n').encode())
        self.git('add', '.')
        self.git('-c', 'user.name=Offline experiment', '-c', 'user.email=offline@example.invalid',
                 'commit', '-qm', 'Synthetic verified-input fixture')
        self.head = self.git('rev-parse', 'HEAD').decode().strip()
        self.requests = {self.head: {'src/source.txt'}}

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], env=self.env, stderr=subprocess.PIPE)

    def capture(self):
        return inputs.capture(self.root, self.requests)

    def test_positive_captures_full_tree_bytes_and_no_cross_call_input_cache(self):
        one, two = self.capture(), self.capture()
        self.assertIsNot(one, two)
        self.assertEqual(one.digest, two.digest)
        self.assertEqual(len(one.files), 5)
        self.assertEqual(one.historical(self.head, 'src/source.txt'), b'src exact source\n')
        with self.assertRaises(TypeError):
            one.files['src/source.txt'] = b'changed'
        with self.assertRaises(FrozenInstanceError):
            one.candidate = 'a'*40

    def test_post_capture_changes_do_not_change_sealed_input_but_next_call_rejects(self):
        value = self.capture()
        (self.root/'src/source.txt').write_bytes(b'after sealing')
        with patch.object(subprocess, 'check_output', side_effect=AssertionError('Unexpected Git IO')), \
             patch.object(Path, 'read_bytes', side_effect=AssertionError('Unexpected path IO')):
            value.verify_seal()
            self.assertEqual(value.historical(self.head, 'src/source.txt'), b'src exact source\n')
        with self.assertRaises(AssertionError):
            self.capture()

    def test_mid_capture_file_change_is_rejected(self):
        original = inputs.scan_current
        reads = []
        def scan(*args):
            result = original(*args)
            reads.append(True)
            if len(reads) == 1:
                (self.root/'src/source.txt').write_bytes(b'mid capture')
            return result
        with patch.object(inputs, 'scan_current', scan), self.assertRaises(AssertionError):
            self.capture()

    def test_observable_aba_metadata_change_is_rejected(self):
        original = inputs.scan_current
        reads = []
        def scan(*args):
            result = original(*args)
            reads.append(True)
            if len(reads) == 1:
                path = self.root/'src/source.txt'
                path.write_bytes(b'temporary')
                path.write_bytes(b'src exact source\n')
            return result
        with patch.object(inputs, 'scan_current', scan), self.assertRaises(AssertionError):
            self.capture()

    def test_mid_capture_config_metadata_or_replacement_change_is_rejected(self):
        original = inputs.scan_current
        for fault in ('config', 'replace'):
            with self.subTest(fault=fault):
                reads = []
                def scan(*args):
                    result = original(*args)
                    reads.append(True)
                    if len(reads) == 1:
                        if fault == 'config':
                            with (self.root/'.git/config').open('a') as file:
                                file.write('\n# synthetic capture-time configuration change\n')
                        else:
                            self.git('update-ref', 'refs/replace/'+self.head, self.head)
                    return result
                with patch.object(inputs, 'scan_current', scan), self.assertRaises(AssertionError):
                    self.capture()
                if fault == 'replace':
                    self.git('update-ref', '-d', 'refs/replace/'+self.head)

    def test_mid_capture_missing_object_is_rejected(self):
        original = inputs.scan_current
        reads = []
        blob = self.git('rev-parse', self.head+':src/source.txt').decode().strip()
        def scan(*args):
            result = original(*args)
            reads.append(True)
            if len(reads) == 1:
                (self.root/'.git/objects'/blob[:2]/blob[2:]).unlink()
            return result
        with patch.object(inputs, 'scan_current', scan), self.assertRaises((AssertionError, subprocess.CalledProcessError)):
            self.capture()

    def test_fixed_control_symlinks_and_dangling_symlinks_are_rejected(self):
        git_dir = self.root/'.git'
        for relative in ('config', 'config.worktree', 'objects/info/alternates'):
            control = git_dir/relative
            before = control.read_bytes() if control.exists() else None
            target = self.root/'external-control'
            for dangling in (False, True):
                with self.subTest(control=relative, dangling=dangling):
                    if control.exists():
                        control.unlink()
                    control.parent.mkdir(parents=True, exist_ok=True)
                    if not dangling:
                        target.write_bytes(before or b'')
                    control.symlink_to(target)
                    try:
                        with self.assertRaisesRegex(AssertionError, 'Control file symlink forbidden'):
                            self.capture()
                    finally:
                        control.unlink()
                        if target.exists():
                            target.unlink()
                        if before is not None:
                            control.write_bytes(before)

    def test_mid_capture_control_symlink_is_rejected(self):
        original = inputs.scan_current
        reads = []
        def scan(*args):
            result = original(*args)
            reads.append(True)
            if len(reads) == 1:
                (self.root/'.git/config.worktree').symlink_to(self.root/'missing-control')
            return result
        with patch.object(inputs, 'scan_current', scan), self.assertRaisesRegex(AssertionError, 'Control file symlink forbidden'):
            self.capture()

    def test_control_inspection_reads_only_metadata(self):
        with patch.object(Path, 'read_bytes', side_effect=AssertionError('Control contents must not be read')), \
             patch.object(Path, 'read_text', side_effect=AssertionError('Control contents must not be read')):
            values = inputs.controls(self.root)
            self.assertTrue(values[-1])
            for path, metadata in values[-1]:
                self.assertEqual(metadata, inputs.control_stamp(Path(path)))

    def test_included_config_contents_are_outside_observed_metadata_contract(self):
        # A harmless include edit does not change the observed repository identity.
        # RawStore still binds all accepted raw bytes to their requested OIDs.
        included = self.root/'included-config'
        included.write_text('[core]\n\tlogAllRefUpdates = true\n')
        with (self.root/'.git/config').open('a') as file:
            file.write('\n[include]\n\tpath = '+str(included)+'\n')
        original = inputs.scan_current
        reads = []
        def scan(*args):
            result = original(*args)
            reads.append(True)
            if len(reads) == 1:
                included.write_text('[core]\n\tlogAllRefUpdates = false\n')
            return result
        with patch.object(inputs, 'scan_current', scan):
            value = self.capture()
        value.verify_seal()
        self.assertEqual(value.historical(self.head, 'src/source.txt'), b'src exact source\n')

    def test_path_mode_symlink_new_file_and_argument_faults_reject(self):
        path = self.root/'src/source.txt'
        for kind in ('mode', 'symlink', 'new', 'new_pyc', 'missing'):
            with self.subTest(kind=kind):
                if kind == 'mode': path.chmod(0o755)
                elif kind == 'symlink':
                    path.unlink(); path.symlink_to('../public/source.txt')
                elif kind == 'new': (self.root/'src/new.txt').write_bytes(b'unknown')
                elif kind == 'new_pyc': (self.root/'src/new.pyc').write_bytes(b'unknown')
                else: path.unlink()
                with self.assertRaises((AssertionError, FileNotFoundError)):
                    self.capture()
                if kind == 'mode': path.chmod(0o644)
                elif kind == 'symlink': path.unlink(); path.write_bytes(b'src exact source\n')
                elif kind == 'new': (self.root/'src/new.txt').unlink()
                elif kind == 'new_pyc': (self.root/'src/new.pyc').unlink()
                else: path.write_bytes(b'src exact source\n')
        with self.assertRaises(AssertionError): inputs.capture(self.root, self.requests, self.head[:7])
        with self.assertRaises(AssertionError): inputs.capture(self.root/'src/..', self.requests)
        with self.assertRaises(AssertionError): inputs.capture(self.root, {self.head: {'src/unknown'}})
        with self.assertRaises(AssertionError): inputs.capture(self.root, {'a'*40: {'src/source.txt'}})

    def test_stable_read_fault_after_success_rejects_and_error_is_not_retained(self):
        self.capture()
        original = Path.read_bytes
        target = self.root/'src/source.txt'
        def bad(path):
            return b'wrong stable bytes' if path == target else original(path)
        with patch.object(Path, 'read_bytes', bad), self.assertRaises(AssertionError):
            self.capture()
        with patch.object(Path, 'read_bytes', side_effect=OSError('synthetic read failure')), self.assertRaises(OSError):
            self.capture()
        self.capture().verify_seal()

    def test_inherited_git_environment_is_isolated(self):
        with patch.dict(os.environ, {'GIT_DIR': '/nonexistent', 'GIT_WORK_TREE': '/nonexistent',
                                    'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'core.repositoryformatversion',
                                    'GIT_CONFIG_VALUE_0': '999',
                                    'GIT_ALTERNATE_OBJECT_DIRECTORIES': '/nonexistent',
                                    'GIT_OBJECT_DIRECTORY': '/nonexistent',
                                    'GIT_REPLACE_REF_BASE': 'refs/other/',
                                    'GIT_CONFIG_PARAMETERS': "'core.repositoryformatversion=999'",
                                    'GIT_NAMESPACE': 'synthetic'}):
            self.capture().verify_seal()

    def test_existing_replacement_ref_and_nested_untracked_symlink_reject(self):
        self.git('update-ref', 'refs/replace/'+self.head, self.head)
        with self.assertRaisesRegex(AssertionError, 'Replacement refs forbidden during capture'):
            self.capture()
        self.git('update-ref', '-d', 'refs/replace/'+self.head)
        (self.root/'scripts/unknown-link').symlink_to('../public', target_is_directory=True)
        with self.assertRaisesRegex(AssertionError, 'Source symlink'):
            self.capture()

    def test_mid_capture_inventory_mode_deletion_and_head_changes_reject(self):
        original = inputs.scan_current
        source = self.root/'scripts/source.txt'
        tree = self.git('rev-parse', 'HEAD^{tree}').decode().strip()
        successor = self.git('-c', 'user.name=Offline fixture', '-c', 'user.email=offline@example.invalid',
                             'commit-tree', tree, '-p', self.head, '-m', 'Same bytes new commit').decode().strip()
        for fault in ('new', 'new_pyc', 'mode', 'delete', 'head'):
            with self.subTest(fault=fault):
                reads = []
                def scan(*args):
                    result = original(*args)
                    reads.append(True)
                    if len(reads) == 1:
                        if fault == 'new': (self.root/'tests/new.py').write_bytes(b'unknown')
                        elif fault == 'new_pyc': (self.root/'src/extra.pyc').write_bytes(b'unknown')
                        elif fault == 'mode': source.chmod(0o755)
                        elif fault == 'delete': source.unlink()
                        else: self.git('update-ref', 'HEAD', successor)
                    return result
                try:
                    with patch.object(inputs, 'scan_current', scan), self.assertRaises((AssertionError, FileNotFoundError)):
                        self.capture()
                finally:
                    if fault == 'new': (self.root/'tests/new.py').unlink()
                    elif fault == 'new_pyc': (self.root/'src/extra.pyc').unlink()
                    elif fault == 'mode': source.chmod(0o644)
                    elif fault == 'delete': source.write_bytes(b'scripts exact source\n')
                    else: self.git('update-ref', 'HEAD', self.head)

    def test_raw_reader_rejects_oid_blob_type_and_length_substitution(self):
        store = inputs.RawStore(str(self.root/'.git/objects'))
        try:
            raw = b'exact blob'
            oid = inputs.object_oid('blob', raw)
            for response in (
                f'{oid} blob {len(raw)}\n'.encode()+b'wrong blob\n',
                f'{oid} tree {len(raw)}\n'.encode()+raw+b'\n',
                f'{"a"*40} blob {len(raw)}\n'.encode()+raw+b'\n',
                f'{oid} missing\n'.encode(),
                f'{oid} blob 999\n'.encode()+raw+b'\n',
            ):
                with self.subTest(response=response[:55]), patch.object(subprocess, 'check_output', return_value=response), self.assertRaises((AssertionError, ValueError)):
                    store.read([oid])
        finally:
            store.close()

    def test_seal_rejects_path_mode_and_byte_tampering(self):
        value = self.capture()
        files = dict(value.files); files['src/source.txt'] = b'substituted'
        with self.assertRaises(AssertionError): replace(value, files=MappingProxyType(files)).verify_seal()
        histories = {ref: dict(rows) for ref, rows in value.histories.items()}
        mode, oid = histories[self.head]['src/source.txt']
        histories[self.head]['src/source.txt'] = ('100755', oid)
        with self.assertRaises(AssertionError): replace(value, histories=histories).verify_seal()
        histories[self.head]['src/source.txt'] = (mode, histories[self.head]['public/source.txt'][1])
        forged = replace(value, histories=histories)
        # Even a recomputed package digest cannot substitute the committed path.
        forged = replace(forged, digest=inputs.sha(inputs.canonical(inputs.manifest(
            forged.candidate, forged.trees, forged.files, forged.objects, forged.histories))))
        with self.assertRaises(AssertionError): forged.verify_seal()


class RealProjectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import energy_verified_gate_projection as gates
        cls.gates = gates
        cls.root = Path(__file__).resolve().parents[1]

    def test_six_entry_outputs_match_exact_public_ancestors_without_io(self):
        gates = self.gates
        value = gates.prepare(self.root)
        expected = {
            'manual_six': value.historical(gates.manual.SIX_BASE_SHA, gates.energy.WORKFLOW_PATH).decode(),
            'manual_workflow': value.historical(gates.manual.BASE_SHA, gates.energy.WORKFLOW_PATH).decode(),
            'lab_workflow': value.historical(gates.lab.BASE_SHA, gates.energy.WORKFLOW_PATH).decode(),
            'lab_transitions': None,
        }
        with patch.object(subprocess, 'check_output', side_effect=AssertionError('Pure projection attempted Git IO')), \
             patch.object(Path, 'read_bytes', side_effect=AssertionError('Pure projection attempted file IO')):
            for operation, output in expected.items():
                self.assertEqual(gates.project(value, operation), output)
            for operation, stage in (('manual_release', gates.manual), ('lab_release', gates.lab)):
                for path in stage.RELEASE_FILES:
                    self.assertEqual(gates.project(value, operation, path), value.historical(stage.BASE_SHA, path))

    def test_committed_new_support_bytes_modes_and_unknown_paths_reject(self):
        gates = self.gates
        with tempfile.TemporaryDirectory(prefix='verified-input-pinned-support-') as directory:
            root = Path(directory)/'candidate'
            env = inputs.clean_environment()
            env['PYTHONDONTWRITEBYTECODE'] = '1'
            def git(*args):
                return subprocess.check_output(['git', '-C', str(root), *args], env=env, stderr=subprocess.PIPE)
            subprocess.check_call(['git', 'clone', '--quiet', '--shared', str(self.root), str(root)], env=env)
            head = git('rev-parse', 'HEAD').decode().strip()
            gates.project(gates.prepare(root), 'manual_workflow')
            faults = [(path, fault) for path in sorted(gates.NEW_PATHS) for fault in ('bytes', 'mode')]
            faults.append(('scripts/unknown-support.py', 'unknown'))
            for path, fault in faults:
                with self.subTest(path=path, fault=fault):
                    local = root/path
                    if fault == 'mode':
                        local.chmod(0o755)
                        expected = 'Ordinary pinned support source required'
                    else:
                        local.write_bytes((local.read_bytes() if local.exists() else b'')+b'\n# unapproved support source\n')
                        expected = 'Exact adopted support bytes required' if fault == 'bytes' else 'Exact adopted file inventory required'
                    git('add', path)
                    git('-c', 'user.name=Offline rejection fixture', '-c', 'user.email=offline@example.invalid',
                        'commit', '-qm', 'Unapproved support witness')
                    try:
                        with self.assertRaisesRegex(AssertionError, expected):
                            gates.project(gates.prepare(root), 'manual_workflow')
                    finally:
                        git('reset', '--hard', '--quiet', head)

    def test_legacy_argument_type_rejections_happen_before_capture(self):
        gates = self.gates
        bad_workflows = (b'bytes', Path('workflow.yml'), 7, True, [], {})
        bad_paths = (None, b'package.json', Path('package.json'), 7, True, [], {})
        with patch.object(gates, 'prepare', side_effect=RuntimeError('Invalid arguments must not capture')) as capture:
            for argument in bad_workflows:
                for entry in (gates.manual.previous_six_workflow, gates.manual.previous_workflow,
                              gates.lab.previous_workflow):
                    with self.subTest(entry=entry.__name__, argument=argument), self.assertRaises(AssertionError):
                        entry(argument)
            for argument in bad_paths:
                for entry in (gates.manual.previous_release_bytes, gates.lab.previous_release_bytes):
                    with self.subTest(entry=entry.__name__, argument=argument), self.assertRaises((AssertionError, TypeError)):
                        entry(argument)
            capture.assert_not_called()

    def test_explicit_bad_workflow_and_unknown_parameters_reject(self):
        gates = self.gates
        original = gates.prepare
        with patch.object(gates, 'prepare', wraps=original) as fresh:
            for operation in ('manual_six', 'manual_workflow', 'lab_workflow'):
                with self.subTest(operation=operation), self.assertRaises(AssertionError):
                    gates.call(operation, self.root, 'altered workflow')
            self.assertEqual(fresh.call_count, 3)
        for operation, argument in (('unknown', None), ('manual_release', 'src/main.ts'),
                                    ('lab_release', '../package.json'), ('manual_workflow', b'bytes'),
                                    ('lab_transitions', 'unexpected')):
            with self.subTest(operation=operation), self.assertRaises(AssertionError):
                gates.call(operation, self.root, argument)

    def test_original_and_capture_first_errors_are_preserved_explicitly(self):
        # Execute the actual public old helpers in an isolated interpreter. Do
        # not alter the old test methods or replace their expected exceptions.
        baselines = (
            ('bb7fc33f1b51c5e27324c9df7df2a27a357802ff', 'Unapproved energy eleven-job workflow drift'),
            (self.gates.PREDECESSOR, 'Exact additive twelve-job workflow required'),
        )
        probe = r'''
from pathlib import Path
from unittest.mock import patch
import importlib, json, sys
root, current = map(Path, sys.argv[1:])
sys.path.insert(0, str(root/'scripts'))
import test_manual_unit_gate as old
for name in ('test_recycle_preview_gate', 'test_fleet_row_gate',
             'test_research_unlock_copy_gate', 'test_building_batch_gate',
             'test_energy_challenge_gate', 'test_energy_challenge_provenance',
             'test_lab_blockers_gate'):
    assert importlib.import_module(name).ROOT == root
assert old.ROOT == root
import energy_challenge_source_pins as old_pins
import energy_challenge_workflow as old_workflow
assert Path(old_pins.__file__).resolve() == root/'scripts/energy_challenge_source_pins.py'
assert old_workflow.ROOT == root
if (root/'scripts/energy_challenge_solar_workflow.py').is_file():
    import energy_challenge_solar_workflow as old_solar
    assert old_solar.ROOT == root
    assert Path(old_solar.__file__).resolve() == root/'scripts/energy_challenge_solar_workflow.py'
sys.path.insert(0, str(current/'scripts'))
import energy_verified_gate_projection as new
read = Path.read_bytes
workflow = root/new.energy.WORKFLOW_PATH
diagnostic = root/'.github/workflows/manual-unit-old-proof.yml'
package, lock = root/'package.json', root/'package-lock.json'
rows = []
for label, targets in (
    ('workflow_newline', {workflow: read(workflow)+b'\n'}),
    ('package_newline', {package: read(package)+b'\n'}),
    ('lock_dependency_bytes', {lock: read(lock).replace(b'break_infinity.js', b'break_infinity.xx', 1)}),
    ('workflow_and_diagnostic_priority', {workflow: read(workflow)+b'\n', diagnostic: read(diagnostic)+b'\n'}),
):
    row = {'input': label}
    def altered(path): return targets[path] if path in targets else read(path)
    for name, call in (('old', old.previous_workflow),
                       ('new', lambda: new.call('manual_workflow', root))):
        try:
            with patch.object(Path, 'read_bytes', altered): call()
        except Exception as error:
            row[name] = [type(error).__name__, str(error)]
        else:
            raise AssertionError((label, name, 'Unexpected acceptance'))
    rows.append(row)
print(json.dumps(rows))
'''
        for baseline, workflow_error in baselines:
            with tempfile.TemporaryDirectory(prefix='verified-input-old-errors-') as directory:
                old_root = Path(directory)/'baseline'
                env = inputs.clean_environment()
                env['PYTHONDONTWRITEBYTECODE'] = '1'
                subprocess.check_call(['git', 'clone', '--quiet', '--shared', '--no-checkout',
                                       str(self.root), str(old_root)], env=env)
                subprocess.check_call(['git', '-C', str(old_root), 'checkout', '--quiet', '--detach', baseline], env=env)
                rows = json.loads(subprocess.check_output([sys.executable, '-c', probe, str(old_root), str(self.root)], env=env))
            expected = (
                ('workflow_newline', workflow_error, '.github/workflows/p4-original-verify.yml'),
                ('package_newline', "('Unapproved energy support bytes', 'package.json')", 'package.json'),
                ('lock_dependency_bytes', "('Unapproved energy support bytes', 'package-lock.json')", 'package-lock.json'),
                ('workflow_and_diagnostic_priority', workflow_error, '.github/workflows/manual-unit-old-proof.yml'),
            )
            self.assertEqual(len(rows), len(expected))
            for row, (label, old_error, path) in zip(rows, expected):
                with self.subTest(baseline=baseline, input=label):
                    self.assertEqual(row['input'], label)
                    self.assertEqual(row['old'], ['AssertionError', old_error])
                    self.assertEqual(row['new'], ['AssertionError', str(('Current bytes differ from committed object', path))])


if __name__ == '__main__':
    unittest.main()
