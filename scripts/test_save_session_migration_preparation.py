"""Offline diagnostic contracts only; never imports executable browser acceptance."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from r11_compatibility import lift_r10_state_to_r11

SCRIPT = Path(__file__).with_name('browser-save-session.py')
TREE = ast.parse(SCRIPT.read_text(encoding='utf-8'))


def helpers():
    names = {'migration_differences', 'capture_startup_migration'}
    nodes = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {'json': json, 'hashlib': hashlib, 'lift_r10_state_to_r11': lift_r10_state_to_r11}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), namespace)
    return namespace


class MigrationDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.helper = helpers()
        self.source = {'schema': 'test', 'revision': 10, 'version': 9, 'savedAt': 1000, 'lastTickAt': 1000,
                       'state': {'totalTime': '0', 'orders': {'nextJobId': 1},
                                 'planets': [{'id': 'homeworld', 'buildQueue': [], 'resources': {'metal': '500'}}]}}
        self.first = {**copy.deepcopy(self.source), 'revision': 11, 'savedAt': 1125, 'lastTickAt': 1125,
                      'state': lift_r10_state_to_r11(self.source['state'])}
        self.first['state']['totalTime'] = '0.125'
        self.first['state']['planets'][0]['resources']['metal'] = '500.001'

    def test_every_field_and_scalar_type_difference_is_retained(self):
        diff = self.helper['migration_differences']({'a': 1, 'b': [False], 'c': None}, {'a': '1', 'b': [0], 'd': None})
        self.assertEqual([row['path'] for row in diff], ['$state.a', '$state.b[0]', '$state.c', '$state.d'])
        self.assertFalse(diff[2]['actualPresent'])
        self.assertFalse(diff[3]['expectedPresent'])

    def test_complete_actual_source_first_write_current_backup_and_audit_are_saved(self):
        original = json.dumps(self.source, ensure_ascii=False, indent=2)
        first = json.dumps(self.first, ensure_ascii=False, indent=2)
        current = first + '\n'  # Diagnose a later differing current without hiding it.
        rows = [{'operation': 'read', 'key': 'current', 'value': original},
                {'operation': 'write-return', 'key': 'backup', 'value': original},
                {'operation': 'write-return', 'key': 'current', 'value': first},
                {'operation': 'ui-status', 'text': 'success', 'current': first}]
        untouched = copy.deepcopy(rows)
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            self.helper.update(out=out, KEY='current', BACKUP='backup', case='synthetic offline diagnostic',
                               raw=lambda page, key='current': original if key == 'backup' else current,
                               events=lambda page: copy.deepcopy(rows))
            self.helper['capture_startup_migration'](None, original, 10)
            for label, expected in [('original', original), ('first-current', first), ('current', current), ('backup', original)]:
                self.assertEqual((out / f'r10-startup-{label}.json').read_bytes(), expected.encode())
            self.assertEqual(json.loads((out / 'r10-startup-complete-audit.json').read_text()), rows)
            report = json.loads((out / 'r10-startup-diagnostic.json').read_text())
            self.assertEqual(report['clock']['constructorGapMilliseconds'], 125)
            self.assertFalse(report['firstCommitEqualsCurrent'])
            self.assertTrue(report['originalEqualsBackup'])
            self.assertEqual([row['path'] for row in report['fullStateDifferencesFromNullOnlyLift']],
                             ['$state.planets[0].resources.metal', '$state.totalTime'])
            self.assertEqual(report['artifacts']['first-current']['sha256'], hashlib.sha256(first.encode()).hexdigest())
        self.assertEqual(rows, untouched)

    def test_missing_first_write_is_reported_without_fabricating_an_envelope(self):
        original = json.dumps(self.source)
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            self.helper.update(out=out, KEY='current', BACKUP='backup', case='no observed commit',
                               raw=lambda page, key='current': original if key == 'current' else None,
                               events=lambda page: [])
            self.helper['capture_startup_migration'](None, original, 10)
            report = json.loads((out / 'r10-startup-diagnostic.json').read_text())
            self.assertEqual(report['artifacts']['first-current'], {'missing': True})
            self.assertEqual(report['artifacts']['backup'], {'missing': True})
            self.assertNotIn('clock', report)
            self.assertNotIn('fullStateDifferencesFromNullOnlyLift', report)

    def test_complete_evidence_precedes_unchanged_full_state_assertion(self):
        calls = [node for node in ast.walk(TREE) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)]
        capture = next(node for node in calls if node.func.id == 'capture_startup_migration')
        exact = next(node for node in calls if node.func.id == 'check' and isinstance(node.args[0], ast.Constant) and
                     node.args[0].value == 'actual r10 migration preserves every prior field and adds only empty demolition slots')
        self.assertLess(capture.lineno, exact.lineno)
        self.assertEqual(ast.unparse(exact.args[1]), "exact_json(migrated_file['state'], lift_r10_state_to_r11(legacy_state))")
        body = ast.unparse(next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'capture_startup_migration'))
        for forbidden in ('setItem', 'Date.now', 'performance', 'catchUp', 'tick('):
            self.assertNotIn(forbidden, body)


if __name__ == '__main__':
    unittest.main()
