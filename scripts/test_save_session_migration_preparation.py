"""Offline diagnostic contracts only; never imports executable browser acceptance."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from r11_compatibility import exact_json, lift_r10_state_to_r11

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

    def test_complete_evidence_precedes_strict_full_envelope_oracle_assertion(self):
        calls = [node for node in ast.walk(TREE) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)]
        capture = next(node for node in calls if node.func.id == 'capture_startup_migration')
        exact = next(node for node in calls if node.func.id == 'check' and isinstance(node.args[0], ast.Constant) and
                     node.args[0].value == 'actual r10 startup preserves exact fixed-reader catch-up semantics and adds only empty demolition slots')
        self.assertLess(capture.lineno, exact.lineno)
        self.assertEqual(ast.unparse(exact.args[1]), "exact_json(migrated_file, run_r10_startup_oracle(legacy_raw, migrated_file))")
        body = ast.unparse(next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'capture_startup_migration'))
        for forbidden in ('setItem', 'Date.now', 'performance', 'catchUp', 'tick('):
            self.assertNotIn(forbidden, body)


class OracleContracts(unittest.TestCase):
 def setUp(self):
  def check(name,ok):
   if not ok:raise AssertionError(name)
  self.ns=dict(json=json,hashlib=hashlib,exact_json=exact_json,lift_r10_state_to_r11=lift_r10_state_to_r11,CURRENT_REVISION=11,check=check)
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='expected_r10_startup')
  exec(compile(ast.Module(body=[node],type_ignores=[]),'prepared-helper','exec'),self.ns)
  self.old={'schema':'infinity-original-p4','version':9,'revision':10,'savedAt':1000,'lastTickAt':1000,'state':{'offlineBonusHours':0,'totalTime':'0','orders':{'nextJobId':1},'planets':[{'id':'homeworld','buildQueue':[],'resources':{'metal':'500'}}]}}
  self.raw=json.dumps(self.old)
  self.observed={'schema':'infinity-fixed-r10-startup-oracle-v1','sourceSha':'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a','inputRawSha256':hashlib.sha256(self.raw.encode()).hexdigest(),'sourceSavedAt':1000,'sourceLastTickAt':1000,'constructorNow':1125,'gapMilliseconds':125,'capSeconds':7200,'appliedSeconds':.125,'capped':False,'state':copy.deepcopy(self.old['state'])}
  self.observed['state']['totalTime']='0.125';self.observed['state']['planets'][0]['resources']['metal']='500.001'
  self.observed['dependencyIdentity']={'breakInfinity':{'version':'2.2.0','commonSha256':'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06','esmSha256':'1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a'},'padEnd':{'version':'1.0.2','entrySha256':'063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330'}}
  self.candidate={**self.old,'revision':11,'savedAt':1125,'lastTickAt':1125,'state':lift_r10_state_to_r11(self.observed['state'])}
 def test_full_envelope_has_only_true_old_elapsed_semantics_and_null(self):
  self.assertTrue(exact_json(self.ns['expected_r10_startup'](self.raw,self.candidate,self.observed),self.candidate))
 def test_every_claimed_metadata_mutation_is_rejected(self):
  for key in self.observed:
   if key=='state':continue
   mutant=copy.deepcopy(self.observed);v=mutant[key];mutant[key]={} if isinstance(v,dict) else not v if isinstance(v,bool) else v+1 if isinstance(v,(int,float)) else v+'x'
   with self.subTest(key=key),self.assertRaises(AssertionError):self.ns['expected_r10_startup'](self.raw,self.candidate,mutant)
 def test_wallet_time_identity_and_missing_null_never_gain_tolerance(self):
  mutants=[]
  for path,value in [('wallet','500.00100000001'),('time','0.126'),('id',2),('slot','missing')]:
   mutant=copy.deepcopy(self.candidate)
   if path=='wallet':mutant['state']['planets'][0]['resources']['metal']=value
   if path=='time':mutant['state']['totalTime']=value
   if path=='id':mutant['state']['orders']['nextJobId']=value
   if path=='slot':del mutant['state']['planets'][0]['demolition']
   mutants.append(mutant)
  for mutant in mutants:
   with self.subTest(mutant=mutant):self.assertFalse(exact_json(self.ns['expected_r10_startup'](self.raw,mutant,self.observed),mutant))
 def test_candidate_cannot_forge_paired_clock_or_revision(self):
  for key,value in [('revision',10),('lastTickAt',1124),('savedAt',True)]:
   mutant=copy.deepcopy(self.candidate);mutant[key]=value
   with self.subTest(key=key),self.assertRaises(AssertionError):self.ns['expected_r10_startup'](self.raw,mutant,self.observed)
 def test_subprocess_request_cannot_receive_candidate_state(self):
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='run_r10_startup_oracle')
  assignment=next(n for n in node.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='request' for t in n.targets))
  self.assertEqual(ast.unparse(assignment.value),"{'originalRaw': original, 'constructorNow': candidate['savedAt']}")
  helper=Path(__file__).with_name('r10-startup-oracle.mjs').read_text()
  self.assertNotIn('/infinity-demolition/src',helper)
  self.assertIn("assert.deepEqual(Object.keys(input).sort(),['constructorNow','originalRaw'])",helper)


if __name__ == '__main__':
    unittest.main()
