"""Offline diagnostic contracts only; never imports executable browser acceptance."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from r12_compatibility import exact_json, lift_r10_state_to_r12, lift_r11_state_to_r12, npc_elapsed_from_segments

SCRIPT = Path(__file__).with_name('browser-save-session.py')
TREE = ast.parse(SCRIPT.read_text(encoding='utf-8'))


def helpers():
    names = {'migration_differences', 'capture_startup_migration'}
    nodes = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {'json': json, 'hashlib': hashlib, 'lift_r10_state_to_r12': lift_r10_state_to_r12}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), namespace)
    return namespace


class MigrationDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.helper = helpers()
        self.source = {'schema': 'test', 'revision': 10, 'version': 9, 'savedAt': 1000, 'lastTickAt': 1000,
                       'state': {'totalTime': '0', 'orders': {'nextJobId': 1},
                                 'planets': [{'id': 'homeworld', 'buildQueue': [], 'resources': {'metal': '500'}}]}}
        self.first = {**copy.deepcopy(self.source), 'revision': 12, 'savedAt': 1125, 'lastTickAt': 1125,
                      'state': lift_r10_state_to_r12(self.source['state'])}
        self.first['state']['npcEconomy']['elapsedSeconds'] = 0.125
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
            self.assertEqual([row['path'] for row in report['fullStateDifferencesFromZeroAgeNullSlotLift']],
                             ['$state.npcEconomy.elapsedSeconds', '$state.planets[0].resources.metal', '$state.totalTime'])
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
            self.assertNotIn('fullStateDifferencesFromZeroAgeNullSlotLift', report)

    def test_complete_evidence_precedes_strict_full_envelope_oracle_assertion(self):
        calls = [node for node in ast.walk(TREE) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)]
        capture = next(node for node in calls if node.func.id == 'capture_startup_migration')
        exact = next(node for node in calls if node.func.id == 'check' and isinstance(node.args[0], ast.Constant) and
                     node.args[0].value == 'actual r10 startup preserves exact fixed-reader catch-up semantics plus null demolition and independently adopted NPC time')
        self.assertLess(capture.lineno, exact.lineno)
        self.assertEqual(ast.unparse(exact.args[1]), "exact_json(migrated_file, run_r10_startup_oracle(legacy_raw, migrated_file))")
        body = ast.unparse(next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'capture_startup_migration'))
        for forbidden in ('setItem', 'Date.now', 'performance', 'catchUp', 'tick('):
            self.assertNotIn(forbidden, body)


class OracleContracts(unittest.TestCase):
 def setUp(self):
  def check(name,ok):
   if not ok:raise AssertionError(name)
  self.ns=dict(json=json,hashlib=hashlib,exact_json=exact_json,lift_r10_state_to_r12=lift_r10_state_to_r12,CURRENT_REVISION=12,npc_elapsed_from_segments=npc_elapsed_from_segments,check=check)
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='expected_r10_startup')
  exec(compile(ast.Module(body=[node],type_ignores=[]),'prepared-helper','exec'),self.ns)
  self.old={'schema':'infinity-original-p4','version':9,'revision':10,'savedAt':1000,'lastTickAt':1000,'state':{'offlineBonusHours':0,'totalTime':'0','orders':{'nextJobId':1},'planets':[{'id':'homeworld','buildQueue':[],'resources':{'metal':'500'}}]}}
  self.raw=json.dumps(self.old)
  self.observed={'schema':'infinity-fixed-r10-startup-oracle-v1','sourceSha':'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a','inputRawSha256':hashlib.sha256(self.raw.encode()).hexdigest(),'sourceSavedAt':1000,'sourceLastTickAt':1000,'constructorNow':1125,'gapMilliseconds':125,'capSeconds':7200,'appliedSeconds':.125,'capped':False,'state':copy.deepcopy(self.old['state'])}
  self.observed['state']['totalTime']='0.125';self.observed['state']['planets'][0]['resources']['metal']='500.001'
  self.observed['dependencyIdentity']={'breakInfinity':{'version':'2.2.0','commonSha256':'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06','esmSha256':'1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a'},'padEnd':{'version':'1.0.2','entrySha256':'063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330'}}
  self.observed.update(adoptedSegmentsSeconds=[0.125],npcElapsedSeconds=0.125,adoptedTimeObservation='old-totalTime-add; full unobserved old-state equivalence verified')
  self.candidate={**self.old,'revision':12,'savedAt':1125,'lastTickAt':1125,'state':lift_r10_state_to_r12(self.observed['state'],npc_elapsed=0.125)}
 def test_full_envelope_has_only_true_old_elapsed_semantics_and_null(self):
  self.assertTrue(exact_json(self.ns['expected_r10_startup'](self.raw,self.candidate,self.observed),self.candidate))
 def test_every_claimed_metadata_mutation_is_rejected(self):
  for key in self.observed:
   if key=='state':continue
   mutant=copy.deepcopy(self.observed);v=mutant[key];mutant[key]=[-1] if isinstance(v,list) else {} if isinstance(v,dict) else not v if isinstance(v,bool) else v+1 if isinstance(v,(int,float)) else v+'x'
   with self.subTest(key=key),self.assertRaises(AssertionError):self.ns['expected_r10_startup'](self.raw,self.candidate,mutant)
 def test_wallet_time_identity_and_missing_null_never_gain_tolerance(self):
  mutants=[]
  for path,value in [('wallet','500.00100000001'),('time','0.126'),('id',2),('slot','missing'),('npcAge',0),('npcAge',0.12500000000000003),('npcModel','wrong'),('npcExtra',True)]:
   mutant=copy.deepcopy(self.candidate)
   if path=='wallet':mutant['state']['planets'][0]['resources']['metal']=value
   if path=='time':mutant['state']['totalTime']=value
   if path=='id':mutant['state']['orders']['nextJobId']=value
   if path=='slot':del mutant['state']['planets'][0]['demolition']
   if path=='npcAge':mutant['state']['npcEconomy']['elapsedSeconds']=value
   if path=='npcModel':mutant['state']['npcEconomy']['model']=value
   if path=='npcExtra':mutant['state']['npcEconomy']['extra']=value
   mutants.append(mutant)
  for mutant in mutants:
   with self.subTest(mutant=mutant):self.assertFalse(exact_json(self.ns['expected_r10_startup'](self.raw,mutant,self.observed),mutant))
 def test_integral_applied_seconds_use_native_json_number_spelling(self):
  candidate=copy.deepcopy(self.candidate);observed=copy.deepcopy(self.observed)
  candidate['savedAt']=candidate['lastTickAt']=2000
  candidate['state']['npcEconomy']['elapsedSeconds']=1
  observed.update(constructorNow=2000,gapMilliseconds=1000,appliedSeconds=1,adoptedSegmentsSeconds=[1],npcElapsedSeconds=1)
  if 'rawSeconds' in observed:observed['rawSeconds']=1
  self.assertTrue(exact_json(self.ns['expected_r10_startup'](self.raw,candidate,observed),candidate))
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


class Ca5OracleContracts(OracleContracts):
 def setUp(self):
  super().setUp()
  self.old['revision']=11
  self.old['state']['planets'][0]['demolition']=None
  self.raw=json.dumps(self.old)
  self.observed['schema']='infinity-fixed-r11-startup-oracle-v1'
  self.observed['sourceSha']='ca5ef0c769856f2c4c8925e76a5c7d322822fe1b'
  self.observed['inputRawSha256']=hashlib.sha256(self.raw.encode()).hexdigest()
  self.observed['state']['planets'][0]['demolition']=None
  self.observed.update(sourceRevision=11,sourceEnvelope={k:v for k,v in self.old.items() if k!='state'},rawSeconds=.125,oldObservedAndUnobservedStateEqual=True)
  self.candidate={**self.old,'revision':12,'savedAt':1125,'lastTickAt':1125,'state':lift_r11_state_to_r12(self.observed['state'],npc_elapsed=.125)}
  self.ns['lift_r11_state_to_r12']=lift_r11_state_to_r12
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='expected_r11_startup')
  exec(compile(ast.Module(body=[node],type_ignores=[]),'prepared-ca5-helper','exec'),self.ns)
  # Reuse all exact full-state/metadata mutation obligations from the r10 contract.
  self.ns['expected_r10_startup']=self.ns['expected_r11_startup']

 def test_ca5_subprocess_request_cannot_receive_candidate_state_or_nominal_age(self):
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='run_r11_startup_oracle')
  assignment=next(n for n in node.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='request' for t in n.targets))
  self.assertEqual(ast.unparse(assignment.value),"{'originalRaw': original, 'constructorNow': candidate['savedAt']}")
  self.assertNotIn('startup_npc_elapsed',{n.name for n in TREE.body if isinstance(n,ast.FunctionDef)})

 def test_ca5_exact_fractional_segmentation_can_differ_from_nominal_interval(self):
  candidate=copy.deepcopy(self.candidate); observed=copy.deepcopy(self.observed)
  candidate['savedAt']=candidate['lastTickAt']=1300
  candidate['state']['npcEconomy']['elapsedSeconds']=.1+.2
  observed.update(constructorNow=1300,gapMilliseconds=300,rawSeconds=.3,appliedSeconds=.3,
                  adoptedSegmentsSeconds=[.1,.2],npcElapsedSeconds=.1+.2)
  expected=self.ns['expected_r11_startup'](self.raw,candidate,observed)
  self.assertTrue(exact_json(expected,candidate))
  candidate['state']['npcEconomy']['elapsedSeconds']=.3
  self.assertFalse(exact_json(expected,candidate))

 def test_ca5_native_json_integral_interval_and_empty_zero_interval_remain_exact(self):
  for now,seconds,segments in ((1000,0,[]),(2000,1,[1]),(3000,2,[1,1])):
   candidate=copy.deepcopy(self.candidate); observed=copy.deepcopy(self.observed)
   candidate['savedAt']=candidate['lastTickAt']=now
   candidate['state']['npcEconomy']['elapsedSeconds']=seconds
   observed.update(constructorNow=now,gapMilliseconds=now-1000,rawSeconds=seconds,appliedSeconds=seconds,
                   adoptedSegmentsSeconds=segments,npcElapsedSeconds=seconds)
   with self.subTest(seconds=seconds):
    self.assertTrue(exact_json(self.ns['expected_r11_startup'](self.raw,candidate,observed),candidate))

 def test_ca5_oracle_cannot_claim_matching_output_without_the_unobserved_comparison(self):
  for value in (False,1,'true',None):
   observed=copy.deepcopy(self.observed);observed['oldObservedAndUnobservedStateEqual']=value
   with self.subTest(value=value),self.assertRaises(AssertionError):
    self.ns['expected_r11_startup'](self.raw,self.candidate,observed)


class ReloadEvidenceTests(unittest.TestCase):
 def helpers(self):
  from contextlib import contextmanager
  import traceback
  names={'capture_reload_evidence','capture_failure','capture_live_failure','migration_differences','observe_reload_storage'}
  nodes=[n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name in names]
  class Clock:
   @staticmethod
   def time_ns():return 123456
  ns=dict(json=json,copy=copy,hashlib=hashlib,time=Clock,contextmanager=contextmanager,traceback=traceback,
          KEY='current',BACKUP='backup',case='offline reload diagnostic',failure=None)
  exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SCRIPT),'exec'),ns)
  return ns

 def test_full_reload_bytes_first_reads_writes_and_all_differences_are_retained(self):
  ns=self.helpers()
  original=' {"revision":9,"state":{}}\n'
  prior={'revision':12,'savedAt':1000,'lastTickAt':1000,'state':{'npcEconomy':{'model':'fixed-production-v1','elapsedSeconds':0},'wallet':'10'}}
  current=copy.deepcopy(prior);current.update(savedAt=1500,lastTickAt=1450)
  current['state']['npcEconomy']['elapsedSeconds']=.45;current['state']['wallet']='10.01'
  before=json.dumps(prior);after=json.dumps(current)
  audit=[{'operation':'read','key':'current','value':after,'wallAt':1600,'performanceAt':1.25},
         {'operation':'write-return','key':'current','value':after,'wallAt':1601,'performanceAt':2.25}]
  snap={'wallAt':1700,'performanceAt':3.25,'current':after,'backup':original,'audit':audit}
  class Page:
   def evaluate(self,source):
    self.source=source
    return copy.deepcopy(snap)
  page=Page()
  observer={'events':[{'eventName':'domStorageItemUpdated','hostReceivedNanoseconds':123,'event':{'key':'current','oldValue':before,'newValue':after}}]}
  frozen=copy.deepcopy(observer)
  with tempfile.TemporaryDirectory() as directory:
   ns['out']=Path(directory)
   report=ns['capture_reload_evidence'](page,'zero',original,before,phase='after',observer=observer)
   for label,raw in [('original',original),('migration-committed',before),('current',after),('backup',original)]:
    self.assertEqual((Path(directory)/f'r9-zero-reload-after-{label}.json').read_bytes(),raw.encode())
   self.assertEqual(report['firstCurrentRead'],audit[0]);self.assertEqual(report['firstCurrentWriteReturn'],audit[1])
   self.assertEqual(report['firstCrossDocumentCurrentUpdate'],observer['events'][0])
   self.assertTrue(report['backupEqualsOriginal']);self.assertFalse(report['currentEqualsMigrationCommit'])
   self.assertEqual([r['path'] for r in report['completeEnvelopeDifferencesFromMigrationCommit']],
                    ['$save.lastTickAt','$save.savedAt','$save.state.npcEconomy.elapsedSeconds','$save.state.wallet'])
   self.assertEqual(json.loads((Path(directory)/report['completeAuditFile']).read_text()),audit)
   self.assertEqual(json.loads((Path(directory)/report['nativeStorageEventsFile']).read_text()),observer['events'])
  self.assertEqual(observer,frozen)
  for forbidden in ('setItem','Date.now=','performance.now=','tick(','catchUp('):self.assertNotIn(forbidden,page.source)

 def test_missing_current_write_or_backup_is_reported_without_invention(self):
  ns=self.helpers()
  class Page:
   def evaluate(self,source):return {'wallAt':2,'performanceAt':1,'current':None,'backup':None,'audit':[]}
  with tempfile.TemporaryDirectory() as directory:
   ns['out']=Path(directory)
   report=ns['capture_reload_evidence'](Page(),'zero','original','{}',phase='after')
   self.assertEqual(report['artifacts']['current'],{'missing':True})
   self.assertEqual(report['artifacts']['backup'],{'missing':True})
   self.assertIsNone(report['firstCurrentRead']);self.assertIsNone(report['firstCurrentWriteReturn'])
   self.assertIsNone(report['firstCrossDocumentCurrentUpdate'])
   self.assertNotIn('completeEnvelopeDifferencesFromMigrationCommit',report)

 def test_failure_artifacts_are_independent_and_original_error_survives(self):
  for broken in ('current','backup','audit','summary','dom','screenshot'):
   ns=self.helpers();calls=[]
   def fail_if(name):
    calls.append(name)
    if name==broken:raise RuntimeError('capture '+name)
   class Page:
    def evaluate(self,source,key):fail_if(key);return ' raw '+key+'\n'
    def content(self):fail_if('dom');return '<html>original</html>'
   def events(page):fail_if('audit');return [{'operation':'read','value':'full bytes'}]
   ns.update(active_page=Page(),events=events,capture_audit=lambda p,l:fail_if('summary'),screenshot=lambda p,f:fail_if('screenshot'))
   with tempfile.TemporaryDirectory() as directory:
    ns['out']=Path(directory);original=AssertionError('native assertion must survive')
    with self.assertRaises(AssertionError) as caught:
     with ns['capture_live_failure']():raise original
    self.assertIs(caught.exception,original)
    self.assertEqual(calls,['current','backup','audit','summary','dom','screenshot'])
    report=json.loads((Path(directory)/'failure-diagnostic.json').read_text())
    self.assertEqual(len(report['captureErrors']),1)
    self.assertEqual(report['error'],repr(original))

 def test_cdp_observes_only_native_storage_events_without_mutating_storage(self):
  ns=self.helpers()
  class CDP:
   def __init__(self):self.callbacks={};self.sent=[]
   def on(self,name,callback):self.callbacks[name]=callback
   def send(self,name):self.sent.append(name)
  cdp=CDP()
  class Context:
   def new_cdp_session(self,page):return cdp
  class Page:context=Context()
  observer=ns['observe_reload_storage'](Page())
  self.assertEqual(cdp.sent,['DOMStorage.enable'])
  self.assertEqual(set(cdp.callbacks),{'DOMStorage.'+name for name in ('domStorageItemAdded','domStorageItemUpdated','domStorageItemRemoved','domStorageItemsCleared')})
  event={'storageId':{'isLocalStorage':True},'key':'current','oldValue':' before ','newValue':' after '}
  cdp.callbacks['DOMStorage.domStorageItemUpdated'](event)
  event['newValue']='later mutation'
  self.assertEqual(observer['events'][0]['event']['newValue'],' after ')
  for ignored in ({'storageId':{'isLocalStorage':False},'key':'current'}, {'storageId':{'isLocalStorage':True},'key':'unrelated'}):
   cdp.callbacks['DOMStorage.domStorageItemUpdated'](ignored)
  self.assertEqual(len(observer['events']),1)
  self.assertIs(observer['session'],cdp)
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='observe_reload_storage')
  text=ast.unparse(node)
  for forbidden in ('setItem','removeItem','evaluate','Runtime.','Debugger.'):self.assertNotIn(forbidden,text)

 def test_capture_guard_exits_before_playwright_and_all_original_reload_conditions_remain(self):
  guarded=next(n for n in ast.walk(TREE) if isinstance(n,ast.With) and any(isinstance(i.context_expr,ast.Call) and isinstance(i.context_expr.func,ast.Name) and i.context_expr.func.id=='sync_playwright' for i in n.items))
  self.assertEqual([ast.unparse(i.context_expr) for i in guarded.items],['sync_playwright()','capture_live_failure()'])
  condition=next(n for n in ast.walk(TREE) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='check' and isinstance(n.args[0],ast.Constant) and n.args[0].value=='native reload retains original bytes and fixed grant metadata despite normal native time')
  self.assertEqual(ast.unparse(condition.args[1]),"raw(page, BACKUP) == source_raw and raw(page) == committed_raw and assert_zero_grant_metadata(json.loads(raw(page))['state'], source, grant_job_floor=floor, npc_elapsed=0)")
  captures=[n for n in ast.walk(TREE) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='capture_reload_evidence']
  self.assertEqual(len(captures),2)
  self.assertTrue(all(n.lineno<condition.lineno for n in captures))
  audit=SCRIPT.read_text()
  self.assertIn('wallAt:nativeWall(),performanceAt:nativePerformance(),...event',audit)


if __name__ == '__main__':
    unittest.main()
