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

 def test_capture_guard_exits_before_playwright_and_first_migration_remains_exact(self):
  guarded=next(n for n in ast.walk(TREE) if isinstance(n,ast.With) and any(isinstance(i.context_expr,ast.Call) and isinstance(i.context_expr.func,ast.Name) and i.context_expr.func.id=='sync_playwright' for i in n.items))
  self.assertEqual([ast.unparse(i.context_expr) for i in guarded.items],['sync_playwright()','capture_live_failure()'])
  checks={n.args[0].value:n for n in ast.walk(TREE) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='check' and isinstance(n.args[0],ast.Constant)}
  self.assertEqual(ast.unparse(checks['all old r9 fields, scalar types and array positions match the fixed old-reader oracle'].args[1]),"exact_json(committed['state'], expected)")
  first=checks['r9 migration is current and independently validates every new grant field']
  self.assertEqual(ast.unparse(first.args[1]),"committed['revision'] == CURRENT_REVISION and assert_zero_grant_metadata(committed['state'], source, grant_job_floor=floor, npc_elapsed=0)")
  self.assertNotIn('native reload retains original bytes and fixed grant metadata despite normal native time',checks)
  calls=[n for n in ast.walk(TREE) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name)]
  captures=[n for n in calls if n.func.id=='capture_reload_evidence']
  replay=next(n for n in calls if n.func.id=='complete_r9_native_replay')
  self.assertEqual(len(captures),2);self.assertTrue(all(n.lineno<replay.lineno for n in captures))
  self.assertIn('wallAt:nativeWall(),performanceAt:nativePerformance(),...event',SCRIPT.read_text())


class NativeReplayWiringTests(unittest.TestCase):
 def setUp(self):
  import re
  from types import SimpleNamespace
  from urllib.parse import urljoin, urlparse
  self.SimpleNamespace=SimpleNamespace
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  def check(label,condition):
   if not condition:raise AssertionError(label)
  self.ns=dict(json=json,hashlib=hashlib,re=re,urljoin=urljoin,urlparse=urlparse,copy=copy,Path=Path,
               exact_json=exact_json,lift_r11_state_to_r12=lift_r11_state_to_r12,npc_elapsed_from_segments=npc_elapsed_from_segments,
               CURRENT_REVISION=12,KEY='current',case='offline navigation test',out=Path(self.temp.name),check=check,args=SimpleNamespace(url='https://example.invalid/Infinity/',expected_sha='a'*40))
  names={'prepare_r9_trace_plan','capture_r9_navigation_evidence','start_r9_native_trace','verify_r9_trace_navigation','verify_r9_native_storage','verify_r9_native_readbacks','verify_r9_replay_result'}
  nodes=[n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name in names]
  exec(compile(ast.Module(body=nodes,type_ignores=[]),'r9-wiring-helpers','exec'),self.ns)

 def http_fixture(self):
  base=self.ns['args'].url; html=b'<html>unmodified production</html>'; js=b'complete production source'
  release={'sourceSha':'a'*40,'saveRevision':12,'saveVersion':9,'files':{'index.html':hashlib.sha256(html).hexdigest(),'assets/index-test.js':hashlib.sha256(js).hexdigest()}}
  self_outer=self
  class Response:
   status=200
   status_text='OK';headers={};from_service_worker=False
   def __init__(self,url,body):
    self.url=url;self.data=body
    self.request=self_outer.SimpleNamespace(url=url,method='GET',resource_type='script' if url.endswith('.js') else 'document',headers={},failure=None,timing={},redirected_from=None)
   def body(self):return self.data
   def json(self):return json.loads(self.data)
  responses={base:Response(base,html),base+'assets/index-test.js':Response(base+'assets/index-test.js',js),base+'release.json':Response(base+'release.json',json.dumps(release).encode())}
  self.disposed=False;self.requested=[]
  def get(url,timeout):self.requested.append(url);return responses[url]
  def dispose():self.disposed=True
  request=self.SimpleNamespace(get=get,dispose=dispose)
  playwright=self.SimpleNamespace(request=self.SimpleNamespace(new_context=lambda:request))
  def prepare(url,data,digest):
   self.assertEqual(hashlib.sha256(data).hexdigest(),digest)
   return self.SimpleNamespace(url=url,http_bytes=data)
  self.ns['prepare_plan']=prepare
  return playwright,responses,release

 def test_exact_http_release_document_asset_identity_and_artifacts(self):
  playwright,responses,release=self.http_fixture()
  with tempfile.TemporaryDirectory() as directory:
   self.ns['out']=Path(directory)
   plan=self.ns['prepare_r9_trace_plan'](playwright)
   self.assertEqual(plan.http_bytes,responses[plan.url].body())
   self.assertEqual(self.ns['native_release_metadata'],release)
   self.assertEqual((Path(directory)/'r9-native-http-production.js').read_bytes(),plan.http_bytes)
  self.assertTrue(self.disposed);self.assertEqual(len(self.requested),3)

 def test_release_wrong_sha_schema_duplicate_script_redirect_or_document_hash_rejected(self):
  for mutant in ('sha','schema','duplicate','redirect','document','javascript'):
   playwright,responses,release=self.http_fixture();base=self.ns['args'].url
   if mutant=='sha':release['sourceSha']='b'*40
   if mutant=='schema':release['saveRevision']=11
   if mutant=='duplicate':release['files']['assets/extra.js']='0'*64
   if mutant=='redirect':responses[base+'release.json'].url=base+'moved.json'
   if mutant=='document':responses[base].data+=b' changed'
   if mutant=='javascript':responses[base+'assets/index-test.js'].data+=b' changed'
   responses[base+'release.json'].data=json.dumps(release).encode()
   with self.subTest(mutant=mutant),tempfile.TemporaryDirectory() as directory,self.assertRaises(AssertionError):
    self.ns['out']=Path(directory);self.ns['prepare_r9_trace_plan'](playwright)
   self.assertTrue(self.disposed)

 def test_navigation_requires_real_script_response_and_executed_source_identity(self):
  playwright,responses,release=self.http_fixture();base=self.ns['args'].url
  script=responses[base+'assets/index-test.js']
  self.ns['native_release_metadata']=release
  verified=[]
  def verify(body):
   self.assertEqual(body,b'complete production source');verified.append(body);return {'actual-script':{'executionContextId':8}}
  trace=self.SimpleNamespace(plan=self.SimpleNamespace(url=script.url),verify_executed=verify,snapshot=lambda:{'events':[],'failures':[]})
  capture={'trace':trace,'responses':[script],'navigations':[]}
  self.ns['verify_r9_trace_navigation'](capture,responses[base]);self.assertEqual(len(verified),1)
  self.assertEqual(capture['responses'],[]);self.assertEqual(len(capture['navigations']),1)
  for script_list in ([],[script,script]):
   with self.assertRaises(AssertionError):self.ns['verify_r9_trace_navigation']({'trace':trace,'responses':script_list,'navigations':[]},responses[base])
  script.data+=b' changed'
  with self.assertRaises(AssertionError):self.ns['verify_r9_trace_navigation']({'trace':trace,'responses':[script],'navigations':[]},responses[base])

 def test_failed_navigation_retains_all_http_facts_body_redirects_cache_and_v8_before_original_assertion(self):
  playwright,responses,release=self.http_fixture();base=self.ns['args'].url
  script=responses[base+'assets/index-test.js'];script.status=304;script.status_text='Not Modified'
  previous=self.SimpleNamespace(url=base+'redirect.js',method='GET',resource_type='script',headers={'accept':'*/*'},failure=None,timing={},redirected_from=None,response=lambda:self.SimpleNamespace(status=302,url=base+'redirect.js'))
  script.request.redirected_from=previous
  trace=self.SimpleNamespace(plan=self.SimpleNamespace(url=script.url),snapshot=lambda:{'events':[{'kind':'source-read'}],'failures':[]},scripts=[{'scriptId':'actual-second'}],resolutions=[{'breakpointId':'actual-probe'}])
  capture={'trace':trace,'responses':[script],'navigations':[],'allResponses':[responses[base],script],
           'requests':[script.request],'requestFailures':[],'pageErrors':['actual page error'],
           'preparation':{'networkCacheDisabled':True},'networkEvents':[{'eventName':'responseReceived','event':{'response':{'url':script.url,'status':304,'fromDiskCache':True,'fromServiceWorker':False}}}]}
  self.ns['native_release_metadata']=release
  with self.assertRaisesRegex(AssertionError,'single pinned production script'):
   self.ns['verify_r9_trace_navigation'](capture,responses[base])
  paths=list(Path(self.temp.name).glob('*before-assertion.json'));self.assertEqual(len(paths),1)
  report=json.loads(paths[0].read_text())
  self.assertEqual(report['scriptResponseCount'],1);self.assertEqual(report['matchingScriptResponseCount'],1)
  self.assertEqual(report['matchingCdpResponseCount'],1)
  self.assertEqual(report['scriptResponses'][0]['status'],304)
  self.assertEqual(report['scriptResponses'][0]['redirectChain'][0]['responseStatus'],302)
  self.assertTrue(report['networkEvents'][0]['event']['response']['fromDiskCache'])
  self.assertEqual(report['parsedScripts'],trace.scripts);self.assertEqual(report['resolvedProbes'],trace.resolutions)
  self.assertEqual((Path(self.temp.name)/report['documentResponse']['body']['file']).read_bytes(),responses[base].body())
  self.assertEqual(report['pageErrors'],['actual page error']);self.assertEqual(report['captureErrors'],[])

 def test_diagnostic_body_failure_preserves_other_http_and_v8_evidence(self):
  _,responses,_=self.http_fixture();base=self.ns['args'].url;script=responses[base+'assets/index-test.js']
  def broken():
   metadata=json.loads(next(Path(self.temp.name).glob('*before-assertion.json')).read_text())
   self.assertEqual(metadata['scriptResponses'][0]['status'],200)
   self.assertIn('before body or V8',metadata['capturePhase'])
   raise RuntimeError('body unavailable')
  script.body=broken
  capture={'trace':self.SimpleNamespace(plan=self.SimpleNamespace(url=script.url),snapshot=lambda:{'failures':['observer failure']}),
           'responses':[script],'navigations':[],'captureCase':'earlier r9 case'}
  report=self.ns['capture_r9_navigation_evidence'](capture,responses[base])
  self.assertEqual(report['scriptResponses'][0]['status'],200)
  self.assertFalse(report['belongsToCurrentCase']);self.assertEqual(report['case'],'earlier r9 case')
  self.assertEqual(report['v8Trace'],{'failures':['observer failure']})
  self.assertEqual(report['captureErrors'][0]['part'],'script-0.body')
  self.assertIn('body',report['documentResponse'])

 def test_cold_cache_preparation_is_read_only_r9_scope_before_trace_install(self):
  calls=[];listeners={};network={}
  class CDP:
   def send(self,name,arguments=None):calls.append((name,arguments));return {}
   def on(self,name,callback):network[name]=callback
  cdp=CDP()
  class Trace:
   def __init__(self,received,plan):self.cdp=received;self.plan=plan
   def install(self):calls.append(('trace.install',None))
  page=self.SimpleNamespace(context=self.SimpleNamespace(new_cdp_session=lambda page:cdp),on=lambda name,callback:listeners.update({name:callback}))
  self.ns.update(NativeFrameTrace=Trace,observe_reload_storage=lambda page:{'events':[]},time=self.SimpleNamespace(time_ns=lambda:123))
  capture=self.ns['start_r9_native_trace'](page,self.SimpleNamespace(url='https://example.invalid/pinned.js'))
  self.assertEqual(calls,[('Network.enable',None),('Network.setCacheDisabled',{'cacheDisabled':True}),('trace.install',None)])
  network['Network.responseReceived']({'response':{'fromDiskCache':False,'fromServiceWorker':False}})
  self.assertEqual(capture['networkEvents'][0]['event']['response'],{'fromDiskCache':False,'fromServiceWorker':False})
  self.assertTrue(capture['preparation']['installedBeforeGoto'])
  self.assertEqual(capture['captureCase'],'offline navigation test');self.assertEqual(capture['createdHostNanoseconds'],123)
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='start_r9_native_trace')
  for forbidden in ('route(', 'setItem', 'Date.now', 'requestAnimationFrame', 'setCPUThrottlingRate'):
   self.assertNotIn(forbidden,ast.unparse(node))

 def test_navigation_assertion_remains_exact_and_failure_guard_retains_navigation_snapshot(self):
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='verify_r9_trace_navigation')
  checks=[n for n in ast.walk(node) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='check']
  self.assertEqual(ast.unparse(checks[1].args[1]),"len(scripts) == 1 and scripts[0].status == 200 and (scripts[0].url == scripts[0].request.url == capture['trace'].plan.url)")
  text=ast.unparse(node);self.assertLess(text.index('capture_r9_navigation_evidence('),text.index('check('))
  guard=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='capture_failure')
  self.assertIn("attempt('native-navigation'",ast.unparse(guard));self.assertIn("suffix='failure'",ast.unparse(guard))

 def storage_fixture(self):
  epochs=[{'migrationRaw':'A','events':[{'kind':'save','raw':'B1'},{'kind':'save','raw':'B2'}]},
          {'events':[{'kind':'save','raw':'C'},{'kind':'save','raw':'C'}]}]
  rows=[{'eventName':'domStorageItemUpdated','event':{'key':'current','oldValue':old,'newValue':new,'storageId':{'securityOrigin':'https://example.invalid'}}}
        for old,new in [('original','A'),('A','B1'),('B1','B2'),('B2','C')]]
  return epochs,rows

 def test_all_successful_lifecycle_writes_and_manual_c_have_exact_native_byte_order(self):
  epochs,rows=self.storage_fixture();frozen=copy.deepcopy((epochs,rows))
  self.ns['verify_r9_native_storage']('original',epochs,rows)
  self.assertEqual((epochs,rows),frozen)

 def test_missing_extra_reordered_wrong_old_new_origin_and_removed_native_writes_fail(self):
  for mutation in ('missing','extra-before-c','order','old','new','origin','remove','clear'):
   epochs,rows=self.storage_fixture()
   if mutation=='missing':rows.pop(2)
   if mutation=='extra-before-c':rows.insert(2,copy.deepcopy(rows[1]))
   if mutation=='order':rows[1],rows[2]=rows[2],rows[1]
   if mutation=='old':rows[2]['event']['oldValue']='A'
   if mutation=='new':rows[2]['event']['newValue']='candidate guessed'
   if mutation=='origin':rows[2]['event']['storageId']['securityOrigin']='https://other.invalid'
   if mutation=='remove':rows[2]['eventName']='domStorageItemRemoved'
   if mutation=='clear':rows[2]['eventName']='domStorageItemsCleared';rows[2]['event'].pop('key')
   with self.subTest(mutation=mutation),self.assertRaises(AssertionError):self.ns['verify_r9_native_storage']('original',epochs,rows)

 def test_only_missing_native_notifications_may_wait_and_received_mismatch_fails_immediately(self):
  epochs,rows=self.storage_fixture()
  partial=self.ns['verify_r9_native_storage']('original',epochs,rows[:2],require_complete=False)
  self.assertFalse(partial['complete']);self.assertEqual(partial['throughC'],rows[:2])
  rows[1]['event']['newValue']='wrong already received'
  with self.assertRaises(AssertionError):self.ns['verify_r9_native_storage']('original',epochs,rows[:2],require_complete=False)

 def test_later_autosave_is_recorded_separately_and_c_is_unchanged(self):
  epochs,rows=self.storage_fixture()
  later=copy.deepcopy(rows[-1]);later['event'].update(oldValue='C',newValue='later autosave');rows.append(later)
  evidence=self.ns['verify_r9_native_storage']('original',epochs,rows)
  self.assertEqual(evidence['throughC'][-1]['event']['newValue'],'C')
  self.assertEqual(evidence['afterC'],[later])

 def test_native_readback_prefix_binds_each_save_including_noops_and_retains_later_writes(self):
  epoch={'sourceRaw':'B','events':[{'kind':'save','raw':'C1'},{'kind':'save','raw':'C1'},{'kind':'save','raw':'C'}]}
  audit=[{'operation':'read','key':'current','value':'B'}];prior='B'
  for value in ('C1','C1','C','later autosave'):
   audit.extend([{'operation':'read','key':'current','value':prior} for _ in range(2)])
   if value!=prior:audit.append({'operation':'write-return','key':'current','value':value})
   audit.append({'operation':'read','key':'current','value':value});prior=value
  evidence=self.ns['verify_r9_native_readbacks'](epoch,audit)
  self.assertEqual(evidence['throughCReadback'],audit[:12]);self.assertEqual(evidence['afterCReadback'],audit[12:])
  for index in range(12):
   mutant=copy.deepcopy(audit);mutant[index]['value']='wrong'
   with self.subTest(index=index),self.assertRaises(AssertionError):self.ns['verify_r9_native_readbacks'](epoch,mutant)

 def test_only_trusted_marked_between_save_listener_reads_are_allowed(self):
  epoch={'sourceRaw':'B','events':[{'kind':'save','raw':'C1'},{'kind':'save','raw':'C'}]}
  def read(value):return {'operation':'read','key':'current','value':value}
  first=[read('B'),read('B'),{'operation':'write-return','key':'current','value':'C1'},read('C1')]
  second=[read('C1'),read('C1'),{'operation':'write-return','key':'current','value':'C'},read('C')]
  for key in ('current',None):
   marker={'operation':'storage-event','key':key,'trusted':True,'value':'C1'}
   audit=[read('B'),*first,marker,read('C1'),*second]
   with self.subTest(key=key):
    evidence=self.ns['verify_r9_native_readbacks'](epoch,audit)
    self.assertEqual(evidence['storageListenerReads'],[{'eventIndex':5,'readIndex':6,'expectedRaw':'C1'}])
  pre={'operation':'storage-event','key':'current','trusted':True,'value':'B'}
  evidence=self.ns['verify_r9_native_readbacks'](epoch,[pre,read('B'),*first,*second])
  self.assertEqual(evidence['storageListenerReads'],[])
  marker={'operation':'storage-event','key':'current','trusted':True,'value':'C1'}
  invalids={
   'unmarked':[read('C1')],
   'wrong raw':[marker,read('wrong')],
   'extra write':[marker,{'operation':'write-return','key':'current','value':'C1'},read('C1')],
   'untrusted':[{**marker,'trusted':False},read('C1')],
   'other key':[{**marker,'key':'unrelated'},read('C1')],
   'not adjacent':[marker,{'operation':'ui-status','text':'intervening'},read('C1')],
   'two reads':[marker,read('C1'),read('C1')],
  }
  for label,extra in invalids.items():
   with self.subTest(label=label),self.assertRaises(AssertionError):
    self.ns['verify_r9_native_readbacks'](epoch,[read('B'),*first,*extra,*second])
  with self.assertRaises(AssertionError):
   self.ns['verify_r9_native_readbacks'](epoch,[read('B'),*first,*second[:1],marker,read('C1'),*second[1:]])

 def replay_fixture(self):
  old={'wallet':'500','planets':[]};source={'revision':9,'savedAt':2000,'lastTickAt':2000,'state':old};original=json.dumps(source)
  def raw(age,saved,watermark):return json.dumps({'revision':12,'savedAt':saved,'lastTickAt':watermark,'state':lift_r11_state_to_r12(old,npc_elapsed=age)})
  a,b1,b2,c=raw(0,1000,1000),raw(.1,1102,1100),raw(.1,1108,1100),raw(.1+.1+.1,1302,1300)
  def save(value,reason):return {'kind':'save','raw':value,'reason':reason}
  epochs=[{'constructorNow':1000,'sourceRaw':original,'migrationRaw':a,'events':[{'kind':'frame','gapSeconds':.1},save(b1,'beforeunload'),save(b2,'visibility-hidden')]},
          {'constructorNow':1200,'sourceRaw':b2,'events':[{'kind':'frame','gapSeconds':.1},save(c,'manual')]}]
  request={'schema':'infinity-native-frame-replay-input-v1','originalRaw':original,'epochs':epochs}
  dependencies={'breakInfinity':{'version':'2.2.0','commonSha256':'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06','esmSha256':'1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a'},'padEnd':{'version':'1.0.2','entrySha256':'063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330'}}
  saves=[]
  for epoch,index,reason,value in [(0,-1,'migration',a),(0,1,'beforeunload',b1),(0,2,'visibility-hidden',b2),(1,1,'manual',c)]:
   envelope=json.loads(value);saves.append({'epochIndex':epoch,'eventIndex':index,'reason':reason,'rawSha256':hashlib.sha256(value.encode()).hexdigest(),'expectedEnvelope':envelope,'npcElapsedSeconds':envelope['state']['npcEconomy']['elapsedSeconds']})
  adoptions=[]
  for epoch,index,kind,gap,before,steps in [(0,-1,'catchUp',-1,0,[]),(0,0,'tick',.1,0,[.1]),(1,-1,'catchUp',.1,.1,[.1]),(1,0,'tick',.1,.2,[.1])]:
   adoptions.append({'epochIndex':epoch,'eventIndex':index,'kind':kind,'gapSeconds':gap,'ageBefore':before,'adoptedSegmentsSeconds':steps,'npcElapsedSeconds':npc_elapsed_from_segments([before,*steps]),'oldObservedAndUnobservedStateEqual':True})
  result={'schema':'infinity-fixed-r11-native-replay-oracle-v1','sourceSha':'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b','inputRawSha256':hashlib.sha256(original.encode()).hexdigest(),'sourceRevision':9,'oldObservedAndUnobservedStateEqual':True,'dependencyIdentity':dependencies,'epochs':[{'npcElapsedSeconds':.1},{'npcElapsedSeconds':.1+.1+.1}],'saves':saves,'adoptions':adoptions,'npcElapsedSeconds':.1+.1+.1,'state':old}
  return original,request,result

 def test_complete_result_has_exact_first_zero_and_continued_b_c_ages(self):
  original,request,result=self.replay_fixture();frozen=copy.deepcopy((request,result))
  self.assertIs(self.ns['verify_r9_replay_result'](original,request,result),result)
  self.assertEqual((request,result),frozen)
  self.assertEqual(result['saves'][0]['npcElapsedSeconds'],0);self.assertEqual(result['npcElapsedSeconds'],.30000000000000004)

 def test_result_source_dependency_call_boundaries_whole_state_and_age_mutations_fail(self):
  for mutation in ('source','dependency','unobserved','omit-save','omit-frame','gap','age-before','age-after','age-reset','npc-extra','wallet','raw-hash','autosave-c'):
   original,request,result=self.replay_fixture()
   if mutation=='source':result['sourceSha']='wrong'
   if mutation=='dependency':result['dependencyIdentity']['padEnd']['version']='wrong'
   if mutation=='unobserved':result['adoptions'][1]['oldObservedAndUnobservedStateEqual']=False
   if mutation=='omit-save':result['saves'].pop(1)
   if mutation=='omit-frame':result['adoptions'].pop(1)
   if mutation=='gap':result['adoptions'][1]['gapSeconds']+=.00000000001
   if mutation=='age-before':result['adoptions'][2]['ageBefore']=0
   if mutation=='age-after':result['adoptions'][1]['npcElapsedSeconds']+=.00000000001
   if mutation=='age-reset':result['npcElapsedSeconds']=.2
   if mutation=='npc-extra':result['saves'][-1]['expectedEnvelope']['state']['npcEconomy']['extra']=True
   if mutation=='wallet':result['saves'][-1]['expectedEnvelope']['state']['wallet']='500.00000000001'
   if mutation=='raw-hash':result['saves'][-1]['rawSha256']='wrong'
   if mutation=='autosave-c':result['saves'][-1]['reason']='autosave';request['epochs'][-1]['events'][-1]['reason']='autosave'
   with self.subTest(mutation=mutation),self.assertRaises(AssertionError):self.ns['verify_r9_replay_result'](original,request,result)

 def test_boot_observes_before_goto_and_c_is_frozen_before_node_with_all_gates_present(self):
  boot=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='boot')
  text=ast.unparse(boot)
  self.assertLess(text.index('start_r9_native_trace('),text.index('page.goto('))
  node=next(n for n in TREE.body if isinstance(n,ast.FunctionDef) and n.name=='complete_r9_native_replay')
  text=ast.unparse(node)
  self.assertIn("current_c = epochs[1]['events'][-1]['raw']",text)
  self.assertNotIn('current_c = page.evaluate',text)
  self.assertNotIn('boundary_b',text)
  self.assertLess(text.index('through_manual_save('),text.index('subprocess.run('))
  self.assertLess(text.index('verify_r9_native_storage('),text.index('subprocess.run('))
  self.assertIn("'originalRaw': original",text);self.assertNotIn('npc_elapsed=0',text)
  workflow=(SCRIPT.parent.parent/'.github/workflows/p4-original-verify.yml').read_text()
  for required in ('test_native_frame_trace.py','test_save_session_migration_preparation.py','node --import tsx --test scripts/test-r12-native-replay-oracle.mjs','--expected-sha "$GITHUB_SHA"'):
   self.assertIn(required,workflow)




if __name__ == '__main__':
    unittest.main()
