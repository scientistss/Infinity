"""Pure Python negatives for the additional native solar gate; no Node/browser."""
import ast
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import energy_challenge_solar_census as S
from test_energy_challenge_native import SPECIMEN
from test_native_frame_trace import FakeCDP,URL

ROOT=Path(__file__).resolve().parents[1]
RUNNER=(ROOT/'scripts/browser-energy-challenge-solar.py').read_text()

def native_trace():
    p=S.prepare_trace(URL,SPECIMEN.encode(),S.C.sha(SPECIMEN));cdp=FakeCDP(SPECIMEN);observer=S.T.NativeFrameTrace(cdp,p);observer.install();sources=[]
    for i in range(23):
        cdp.execute(observer,context=i+3,script='s'+str(i));observer.verify_executed(SPECIMEN.encode())
        cdp.record(observer,{'kind':'source-read','raw':'synthetic','constructorNow':1000,'documentId':f'00000000-0000-0000-0000-{i:012x}'},context=i+3)
        sources.append({'file':'assets/index-native.js','scriptId':'s'+str(i),'executionContextId':i+3,'http':SPECIMEN.encode(),'v8':SPECIMEN.encode()})
    return observer.snapshot(),sources,{'files':{'assets/index-native.js':S.C.sha(SPECIMEN)}}

def storage_chain():
    first=json.dumps({'version':9,'revision':16,'savedAt':1000,'lastTickAt':1000,'state':{'counter':0}});current=first;events=[];receipts=[]
    for i in range(23):
        context=i+3;now=1000
        events.extend([{'kind':'source-read','raw':current,'executionContextId':context,'constructorNow':now},
                       {'kind':'ready','primaryRaw':current,'backupRaw':None,'mode':'ready','executionContextId':context,
                        'state':{'counter':i},'startupClock':{'wallAt':now,'frameAt':0},'lastTickAt':now,'loaded':{'rawSeconds':0,'appliedSeconds':0}}])
        state={'counter':i+1};new=json.dumps({'version':9,'revision':16,'savedAt':now,'lastTickAt':now,'state':state})
        events.extend([{'kind':'save-input','expectedRaw':current,'state':state,'executionContextId':context,'mode':'ready','savedAt':now,'lastTickAt':now},
                       {'kind':'save-result','ok':True,'mode':'ready','candidateRaw':new,'expectedRaw':new,'primaryRaw':new,'backupRaw':None,'executionContextId':context,'savedAt':now,'lastTickAt':now}])
        receipts.append({'kind':'updated','storageId':{'securityOrigin':'https://example.invalid','isLocalStorage':True},'key':S.C.KEY,'oldValue':current,'newValue':new});current=new
    return first,events,receipts,current

class SolarContract(unittest.TestCase):
    def test_new_fixed_gate_keeps_original_census_and_budget_unchanged(self):
        self.assertEqual({k:len(v) for k,v in S.C.LANES.items()},{'controls':18,'lifecycle':35,'migrations':15})
        self.assertEqual(len(S.C.SCENARIOS),68)
        self.assertEqual(S.FIXED,{'createInitialState':1,'checkpoint':22,'enqueue':149,'tick':4201,'enqueueResearch':4,'challengeCandidate':2,'reject':4})
        self.assertEqual(sum(S.FIXED.values()),4383);self.assertEqual(S.BUDGET,600)
        self.assertEqual(S.SEED,20261013);self.assertEqual(S.EPOCH,1791849600000)

    def test_full_state_observer_only_extends_original_frame_end_payload(self):
        base=S.T.prepare_plan(URL,SPECIMEN.encode(),S.C.sha(SPECIMEN),S.BASE.production_action_handlers,S.BASE.production_serializers)
        plan=S.prepare_trace(URL,SPECIMEN.encode(),S.C.sha(SPECIMEN))
        self.assertEqual(len(plan.probes),8)
        for old,new in zip(base.probes,plan.probes):
            self.assertEqual((old.kind,old.start,old.end),(new.kind,new.start,new.end))
            if old.kind=='frame-end':
                self.assertTrue(new.payload.startswith(old.payload));self.assertIn('state:(t>0||globalThis.__solarObserve?gl(j):null)',new.payload)
                self.assertIn('observationReset:(globalThis.__solarObserve=false)',new.payload)
            else:self.assertEqual(new.payload,old.payload+',documentId:globalThis.__ecWitness.documentId')
        for forbidden in ('j=','tick(','setItem(','Date.now=','requestAnimationFrame='):
            self.assertNotIn(forbidden,''.join(p.payload for p in plan.probes))

    def test_rederive_every_source_binding_for_all_23_original_documents(self):
        snapshot,sources,release=native_trace();S.validate_trace(snapshot,sources,release,'https://example.invalid/Infinity/')
        mutations=[lambda t:t['probeBindings'][3]['request'].update(condition='false'),lambda t:t['scriptParsed'].pop(),
                   lambda t:t['events'][0].update(executionContextId=99),lambda t:t['events'][0].update(sequence=2),
                   lambda t:t['executedScripts']['s0'].update(bytes=1),lambda t:t['resolutions'][0]['location'].update(columnNumber=0),
                   lambda t:t['scriptParsed'][1].update(executionContextId=3),lambda t:t['probeBindings'].pop(),
                   lambda t:t['events'][1].update(documentId=t['events'][0]['documentId'])]
        for mutate in mutations:
            bad=deepcopy(snapshot);mutate(bad)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):S.validate_trace(bad,sources,release,'https://example.invalid/Infinity/')
        for change in ('http','v8'):
            bad=deepcopy(sources);bad[0][change]+=b' '
            with self.assertRaises(AssertionError):S.validate_trace(snapshot,bad,release,'https://example.invalid/Infinity/')

    def test_complete_raw_storage_chain_rejects_missing_extra_fitted_or_wrong_origin(self):
        first,events,receipts,last=storage_chain()
        self.assertEqual(S.validate_storage(events,receipts,first,'https://example.invalid/Infinity/'),last)
        mutations=[lambda e,r:r.pop(),lambda e,r:r.pop(0),lambda e,r:r.append(deepcopy(r[-1])),
                   lambda e,r:r[0].update(oldValue='changed'),lambda e,r:r[0].update(newValue='changed'),
                   lambda e,r:r[0]['storageId'].update(securityOrigin='https://other.invalid'),
                   lambda e,r:r[0].update(kind='added'),lambda e,r:r[0].update(key='other-key'),
                   lambda e,r:e[4].update(raw='reseeded'),lambda e,r:e[3].update(ok=False),
                   lambda e,r:e[3].update(backupRaw='unexpected-backup'),lambda e,r:e[2]['state'].update(counter=9),
                   lambda e,r:e[2].update(savedAt=1001),lambda e,r:e[3].update(lastTickAt=999),
                   lambda e,r:e.insert(3,{'kind':'frame-end','executionContextId':3,'lastTickAt':1000})]
        for mutate in mutations:
            e,r=deepcopy(events),deepcopy(receipts);mutate(e,r)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):S.validate_storage(e,r,first,'https://example.invalid/Infinity/')

    def test_exact_4201_original_frames_no_resampling_or_extra_time(self):
        events=[{'kind':'ready','lastTickAt':0,'startupClock':{'frameAt':0},'executionContextId':3}];records=[]
        for i in range(4201):
            events.extend([{'kind':'frame','sequence':i*2+1,'now':(i+1)*1000,'gapSeconds':1,'lastTickAtBefore':i*1000,'mode':'ready','executionContextId':3},
                           {'kind':'frame-end','sequence':i*2+2,'now':(i+1)*1000,'lastTickAt':(i+1)*1000,'state':{'tick':i+1},'mode':'ready','executionContextId':3}])
            records.append({'api':'tick','observationSequence':i*2+2})
        S.validate_timing(events,records)
        mutations=[lambda e,r:e[1].update(gapSeconds=1.00000001),lambda e,r:e[1].update(gapSeconds=True),
                   lambda e,r:e[2].update(lastTickAt=999.999),lambda e,r:e[2].update(state=None),
                   lambda e,r:r.pop(),lambda e,r:e.pop(),lambda e,r:r[0].update(observationSequence=3),
                   lambda e,r:e[2].update(executionContextId=4),lambda e,r:e[1].update(mode='protected'),lambda e,r:e[1].update(now=float('nan')),
                   lambda e,r:e[3].update(lastTickAtBefore=0),lambda e,r:e[3].update(now=1000)]
        for mutate in mutations:
            e,r=deepcopy(events),deepcopy(records);mutate(e,r)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):S.validate_timing(e,r)

    def test_every_source_read_requires_its_own_unique_ready_without_offline_progress(self):
        first,events,receipts,last=storage_chain()
        mutations=[lambda e:e.__setitem__(slice(None),[x for x in e if x['kind']!='ready']),
                   lambda e:e.pop(1),lambda e:e.insert(2,deepcopy(e[1])),
                   lambda e:e[1].update(executionContextId=4),lambda e:e[5].update(executionContextId=3),
                   lambda e:e[1]['state'].update(counter=False),lambda e:e[1]['loaded'].update(appliedSeconds=1),
                   lambda e:e[1]['loaded'].update(rawSeconds=1),lambda e:e[1]['startupClock'].update(frameAt=1),
                   lambda e:e[1].update(lastTickAt=1001),lambda e:e[2].update(executionContextId=4)]
        for mutate in mutations:
            bad=deepcopy(events);mutate(bad)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):S.validate_storage(bad,receipts,first,'https://example.invalid/Infinity/')

    def test_record_intervals_reject_reuse_overlap_outside_observation_and_boolean_indices(self):
        events=[{'kind':'frame-end','mode':'ready','executionContextId':3,'sequence':i} for i in range(8)]
        record={'index':2,'api':'tick','traceStart':3,'traceEnd':6,'observationSequence':5}
        S.record_scope(record,events,3,2)
        for patch in ({'index':True},{'traceStart':False},{'traceEnd':True},{'observationSequence':False},
                      {'traceStart':2},{'traceEnd':9},{'observationSequence':2},{'observationSequence':6},
                      {'traceStart':6},{'traceEnd':5}):
            with self.subTest(patch=patch),self.assertRaises(AssertionError):S.record_scope({**record,**patch},events,3,2)
        bad=deepcopy(events);bad[4]['executionContextId']=4
        with self.assertRaises(AssertionError):S.record_scope(record,bad,3,2)

    def test_transaction_cannot_borrow_events_outside_its_interval_or_document(self):
        events=[{'kind':kind,'mode':'ready','executionContextId':3,'sequence':i} for i,kind in enumerate(
            ['action','persist-input','save-input','save-result','frame','frame-end'])]
        events[0]['actionType']='enqueue';record={'index':1,'api':'enqueue','traceStart':0,'traceEnd':6,'observationSequence':5}
        kinds=['persist-input','save-input','save-result']
        S.action_transaction(record,events,events,events[5],'enqueue',kinds)
        for patch in ({'traceEnd':3},{'observationSequence':3},{'traceStart':1}):
            with self.subTest(patch=patch),self.assertRaises(AssertionError):S.action_transaction({**record,**patch},events,events,events[5],'enqueue',kinds)
        for at in (0,1,2,3,5):
            bad=deepcopy(events);bad[at]['executionContextId']=4
            with self.subTest(at=at),self.assertRaises(AssertionError):S.action_transaction(record,bad,bad,bad[5],'enqueue',kinds)

    def test_full_state_comparison_preserves_json_types_and_last_digit(self):
        self.assertTrue(S.same_state({'x':1,'y':'2'},{'y':'2','x':1}))
        for a,b in [(False,0),(True,1),(1,1.0),(1.00000000000001,1.0),('1',1)]:self.assertFalse(S.same_state({'x':a},{'x':b}))
        for raw in ('{"x":0,"x":1}','{"x":NaN}','{"x":Infinity}'):
            with self.subTest(raw=raw),self.assertRaises(AssertionError):S.decode(raw)

    def test_tab_preference_is_a_complete_exact_separate_native_storage_chain(self):
        first,events,receipts,last=storage_chain();origin={'securityOrigin':'https://example.invalid','isLocalStorage':True}
        tabs=['facilities','facilities','research','save','save','curvature','save']
        preference=[];old=None
        for tab in tabs:
            if old!=tab:
                row={'kind':'added' if old is None else 'updated','storageId':deepcopy(origin),'key':S.TAB_KEY,'newValue':tab}
                if old is not None:row['oldValue']=old
                preference.append(row);old=tab
        combined=[preference[0],*receipts[:8],*preference[1:3],*receipts[8:],*preference[3:]]
        self.assertEqual(S.validate_storage(events,combined,first,'https://example.invalid/Infinity/',tabs),last)
        for mutate in (lambda rows:rows.pop(0),lambda rows:rows[0].update(newValue='save'),
                       lambda rows:rows[9].update(oldValue='invented'),lambda rows:rows.append(deepcopy(rows[-1])),
                       lambda rows:rows[-1].update(key='ignored-ui-preference')):
            bad=deepcopy(combined);mutate(bad)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):S.validate_storage(events,bad,first,'https://example.invalid/Infinity/',tabs)
        with self.assertRaises(AssertionError):S.validate_storage(events,combined,first,'https://example.invalid/Infinity/')
        plan=[{'api':api,'request':request} for api,request in [
            ('createInitialState',{}),('enqueue',{}),('enqueueResearch',{}),('challengeCandidate',{}),
            ('checkpoint',{}),('reject',{'api':'enqueue'}),('reject',{'api':'enqueueResearch'}),('reject',{'api':'finishEnergyChallenge'})]]
        self.assertEqual(S.navigation_schedule(plan),['facilities','facilities','research','curvature','save','facilities','research','curvature','save'])

    def test_only_pristine_context_seed_no_midjourney_import_or_injection(self):
        tree=ast.parse(RUNNER);worker=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='worker')
        context_calls=[n for n in ast.walk(worker) if isinstance(n,ast.Call) and getattr(n.func,'attr',None)=='new_context' and any(k.arg=='storage_state' for k in n.keywords)]
        self.assertEqual(len(context_calls),1)
        self.assertIn("'value': initial.decode()",ast.unparse(context_calls[0]))
        self.assertNotRegex(RUNNER,r"\['state'\]\s*=(?!=)")
        for bad in ('localStorage.setItem(','import_file(','.set_input_files(','.route(','.add_script_tag(','.add_style_tag(','Debugger.evaluateOnCallFrame'):
            self.assertNotIn(bad,RUNNER)
        self.assertIn(".replace('__STARTUP__','')",RUNNER)
        self.assertIn("page.reload(wait_until='networkidle')",RUNNER)
        self.assertIn("persisted==expect['raw']",RUNNER)
        self.assertIn("S.same_state(observed['state'],target)",RUNNER)
        self.assertIn("button.click()",RUNNER)
        self.assertIn("confirm.click()",RUNNER)
        self.assertNotIn("subprocess.run(",RUNNER)

    def test_bounded_supervisor_and_native_failure_capture(self):
        for required in ("current['start'] == observed['start']",'marker.encode()',"BUDGETS[args.lane]+20",'fresh empty directory',"'inside-live-playwright'","'storage-events'",'start_new_session=True'):
            self.assertIn(required,RUNNER)
        self.assertNotIn('pkill',RUNNER);self.assertNotIn('killall',RUNNER)
        tree=ast.parse(RUNNER);worker=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='worker')
        scope=next(n for n in ast.walk(worker) if isinstance(n,ast.With) and any(isinstance(i.context_expr,ast.Call) and getattr(i.context_expr.func,'id',None)=='sync_playwright' for i in n.items))
        self.assertIsInstance(scope.body[0],ast.Try)
        self.assertTrue(scope.body[0].handlers)

    def test_supervisor_reserves_termination_waits_inside_total_620_seconds(self):
        tree=ast.parse(RUNNER);supervisor=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='supervise')
        assignment=next(n for n in ast.walk(supervisor) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='deadline' for t in n.targets))
        start=1000
        deadline=eval(compile(ast.Expression(assignment.value),'<actual supervisor deadline>','eval'),
                      {'time':SimpleNamespace(monotonic=lambda:start),'BUDGETS':{'solar':S.BUDGET},'args':SimpleNamespace(lane='solar')})
        waits=[next(k.value.value for k in n.keywords if k.arg=='timeout') for n in ast.walk(supervisor)
               if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='wait' and any(k.arg=='timeout' for k in n.keywords)]
        self.assertEqual(waits,[2,2]);self.assertEqual(deadline-start,616)
        self.assertEqual(deadline-start+sum(waits),S.BUDGET+20)
        self.assertEqual(S.BUDGET,600)

if __name__=='__main__':unittest.main()
