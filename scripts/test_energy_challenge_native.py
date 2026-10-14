"""Pure Python native contract tests. Never starts JavaScript or a browser."""
import ast
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import energy_challenge_census as census
import energy_challenge_trace as trace
from test_native_frame_trace import SOURCE, R12, HANDLER_R11, URL, SAVE, FakeCDP
from test_ring_protection_observer import R14_CURRENT
from test_energy_challenge_native_branches import boundary as boundary_state

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('energy_browser',ROOT/'scripts/browser-energy-challenge.py')
browser=importlib.util.module_from_spec(spec);spec.loader.exec_module(browser)
R16=R14_CURRENT.replace('sd(e,!1);const t=od(e.messages);','sd(e,!1),rejectEnergy(e,!1);const challenge=readEnergy(e.energyChallenge);validateEnergy(e,challenge);const t=od(e.messages);').replace('return{npcEconomy:','return{energyChallenge:challenge,npcEconomy:')
HANDLER='async function energyAction(e){var i;["import-text","import-file","reset","prestige"].includes(e.type)&&(view.retireNpcRehearsal(),view.retireManualUnits(),view.retireBuildingTemplateBatch(),view.retireEnergyChallenge()),ge.cancelPendingImport();const t=["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"].includes(e.type);if(ge.mode!=="ready"&&!t){status=ge.message,render();return}const n=j,r=j.unlocked;'
WRITE='writeCandidate(e,t){if(!this.store)return this.blocked();try{if(this.expectedRaw===void 0&&(this.expectedRaw=this.store.getItem(KEY),this.protectedRaw=this.expectedRaw),this.compareCurrent(),t&&this.expectedRaw!==null){const n=preserve(this.store,this.expectedRaw);if(this.store.getItem(n)!==this.expectedRaw)throw new Error("原存档备份校验失败")}if(this.compareCurrent(),e!==this.expectedRaw&&this.store.setItem(KEY,e),this.store.getItem(KEY)!==e)throw new Error("当前存档写入后校验失败");return this.expectedRaw=e,this.protectedRaw=null,this.mode="ready",this.notice=null,this.message="已保存到本地",{ok:!0}}catch(n){return n instanceof Conflict?this.conflict():this.protect(n)}}'
SPECIMEN=SOURCE.replace(R12,R16).replace(HANDLER_R11,HANDLER).replace(SAVE,SAVE+WRITE)


def trace_plan(source=SPECIMEN):
    raw=source.encode();return trace.prepare_plan(URL,raw,census.sha(raw),browser.production_action_handlers,browser.production_serializers)


def realclock_receipts():
    """Synthetic grammar specimen, never a native acceptance artifact."""
    old={'totalTime':'90','untouched':['all','prior','fields']}
    start={**deepcopy(old),'totalTime':'100','energyChallenge':deepcopy(census.DEFAULT_CHALLENGE)}
    end={**deepcopy(start),'totalTime':'100.01025'}
    source=json.dumps({'revision':14,'savedAt':900,'lastTickAt':900,'state':old})
    first=json.dumps({'revision':16,'savedAt':1000,'lastTickAt':1000,'state':start})
    final=json.dumps({'revision':16,'savedAt':1040,'lastTickAt':1010.25,'state':end})
    loaded={'rawSeconds':.1,'appliedSeconds':.1,'gains':{'metal':'0','crystal':'0','deuterium':'0'}}
    rows=[{'kind':'source-read','raw':source,'constructorNow':1000},
          {'kind':'ready','startupClock':{'wallAt':1000,'frameAt':10.25},'mode':'ready','lastTickAt':1000,
           'state':start,'loaded':loaded,'primaryRaw':first,'backupRaw':source},
          {'kind':'frame','now':20.5,'gapSeconds':.01025,'mode':'ready','lastTickAtBefore':1000},
          {'kind':'frame-end','now':20.5,'mode':'ready','lastTickAt':1010.25},
          {'kind':'action','actionType':'save','mode':'ready'},
          {'kind':'persist-input','nextStatus':'已保存到本地','background':False,'mode':'ready'},
          {'kind':'save-input','savedAt':1040,'lastTickAt':1010.25,'mode':'ready','state':end,'expectedRaw':first},
          {'kind':'save-result','savedAt':1040,'lastTickAt':1010.25,'mode':'ready','ok':True,
           'candidateRaw':final,'expectedRaw':final,'primaryRaw':final,'backupRaw':source,'visibleState':end}]
    cdp=FakeCDP(SPECIMEN);observer=trace.NativeFrameTrace(cdp,trace_plan());observer.install()
    cdp.execute(observer);observer.verify_executed(SPECIMEN.encode())
    for row in rows:cdp.record(observer,row)
    storage_id={'securityOrigin':'https://example.invalid','isLocalStorage':True}
    storage=[{'kind':'added','storageId':storage_id,'key':browser.KEY+'.backup','newValue':source},
             {'kind':'updated','storageId':storage_id,'key':browser.KEY,'oldValue':source,'newValue':first},
             {'kind':'updated','storageId':storage_id,'key':browser.KEY,'oldValue':first,'newValue':final}]
    return cdp,observer,storage


def replay_result(request):
    """Synthetic result envelope used only to test fail-closed linkage."""
    manifest={'publicSource':{'commit':census.PUBLIC_SHA,'tree':census.PUBLIC_TREE},
              'dependencyIdentity':deepcopy(census.PUBLIC_DEPENDENCIES),'producer':{'sha256':'a'*64},
              'nativeInputs':[{'id':'migrate-r14','sourceSha256':census.sha(request['startup']['sourceRaw']),'provenance':{'testOnly':'synthetic'}}]}
    startup=request['startup'];epoch=request['epoch'];old=json.loads(startup['sourceRaw'])
    final=json.loads(request['finalPrimaryRaw'])
    saves=[(-1,'migration',startup['primaryRaw'])]+[(i,row['reason'],row['raw']) for i,row in enumerate(epoch['events']) if row['kind']=='save']
    result={'schema':'infinity-energy-challenge-public-r14-native-replay-v1','status':'passed',**deepcopy(manifest),
        'inputProvenance':{'testOnly':'synthetic'},'producerSha256':'a'*64,'sourceRevision':14,'inputRawSha256':census.sha(startup['sourceRaw']),
        'constructorNow':epoch['constructorNow'],'startupClock':epoch['startupClock'],
        'allowedAddedStateFields':['energyChallenge'],'excludedPriorFields':[],'nativeProvenanceClaimed':False,
        'startupState':{key:value for key,value in startup['state'].items() if key!='energyChallenge'},
        'startupVerification':{'schema':'infinity-energy-challenge-migration-verification-v1','status':'passed',
            'publicSourceSha':census.PUBLIC_SHA,'inputRawSha256':census.sha(startup['sourceRaw']),
            'constructorNow':epoch['constructorNow'],'adoptedLastTickAt':epoch['constructorNow'],
            'sourceSavedAt':old['savedAt'],'sourceLastTickAt':old['lastTickAt'],'excludedPriorFields':[],'nativeProvenanceClaimed':False},
        'saves':[{'eventIndex':i,'reason':reason,'savedAt':json.loads(raw)['savedAt'],'lastTickAt':json.loads(raw)['lastTickAt'],
                  'rawSha256':census.sha(raw),'expectedEnvelope':json.loads(raw)} for i,reason,raw in saves],
        'positiveNativeFrames':1,'primaryWriteRawSha256s':[census.sha(raw) for raw in request['nativePrimaryWrites']],
        'finalPrimaryRawSha256':census.sha(request['finalPrimaryRaw']),'backupRawSha256':census.sha(request['finalBackupRaw']),
        'lastTickAt':final['lastTickAt'],'expectedState':final['state'],
        'state':{key:value for key,value in final['state'].items() if key!='energyChallenge'}}
    return manifest,result


class NativeContract(unittest.TestCase):
    def test_fixed_complete_disjoint_census(self):
        self.assertEqual({key:len(value) for key,value in census.LANES.items()},{'controls':18,'lifecycle':35,'migrations':15})
        self.assertEqual(len(census.SCENARIOS),len(set(census.SCENARIOS)))
        self.assertEqual(len(census.SCENARIOS),68)
        self.assertEqual(census.WIDTHS,(320,390,768,1440))
        self.assertEqual(census.BUDGETS,{'controls':420,'lifecycle':420,'migrations':240})
        self.assertIn('external-r16-misplaced-authority',census.LIFECYCLE)
        self.assertNotIn('unknown-r15',census.LIFECYCLE)
        self.assertEqual(census.SCENARIOS.count('unknown-r15'),1)

    def test_complete_r16_parser_and_exact_field_rejection(self):
        self.assertEqual(len(browser.production_serializers(R16)),1)
        self.assertEqual(len(browser.production_action_handlers(HANDLER)),1)
        for old,new in [('energyChallenge:challenge,',''),('validateEnergy(e,challenge)','sideEffect(e,changed)'),('activePlanetId:e.activePlanetId,',''),('e.orders.nextJobId','e.orders.nextTaskId'),('sd(e,!1),rejectEnergy(e,!1);','rejectEnergy(e,!1);'),('validateEnergy(e,challenge);const t','validateEnergy(e,challenge),sd(e,!1);const t')]:
            self.assertEqual(browser.production_serializers(R16.replace(old,new,1)),[],old)
        self.assertEqual(len(browser.production_serializers(R16+R16)),2)
        self.assertEqual(browser.production_action_handlers(HANDLER.replace('view.retireEnergyChallenge()','other.retireEnergyChallenge()')),[])

    def test_original_native_trace_and_save_before_adoption(self):
        plan=trace_plan()
        probes={probe.kind:probe for probe in plan.probes}
        self.assertEqual(len(plan.probes),8)
        self.assertIn('visibleState:gl(j)',probes['save-result'].payload)
        self.assertIn('primaryRaw:localStorage.getItem',probes['save-result'].payload)
        self.assertIn('loaded:',probes['ready'].payload)
        self.assertIn('backupRaw:',probes['ready'].payload)
        for old,new in [('this.store.getItem(KEY)!==e','this.store.getItem(KEY)===e'),('this.store.setItem(KEY,e)','this.store.setItem(KEY,changed)'),('this.expectedRaw=e','this.expectedRaw=other'),('this.protectedRaw=null','this.protectedRaw=e')]:
            with self.assertRaises(AssertionError,msg=old):trace_plan(SPECIMEN.replace(old,new,1))
        with self.assertRaises(AssertionError):trace_plan(SPECIMEN+WRITE)
        with self.assertRaises(AssertionError):trace_plan(SPECIMEN.replace(WRITE,'')+'class Unrelated{'+WRITE+'}')

    def test_executed_probe_identity_is_rederived_from_complete_source(self):
        _,observer,_=realclock_receipts();snapshot=observer.snapshot()
        sources=[{'file':'assets/index-native.js','http':SPECIMEN.encode(),'v8':SPECIMEN.encode()}]
        release={'files':{'assets/index-native.js':census.sha(SPECIMEN)}}
        census.validate_trace_identity(snapshot,sources,release,'https://example.invalid/Infinity/')
        mutations=[lambda s:s.update(url='https://other.invalid/Infinity/assets/index-native.js'),
            lambda s:s.update(releaseSha256='b'*64),
            lambda s:s['probeBindings'][0]['request'].update(condition='false'),
            lambda s:s['probeBindings'].pop(),
            lambda s:s['executedScripts']['s1'].update(executionContextId=7),
            lambda s:s['resolutions'][0]['location'].update(columnNumber=0),
            lambda s:s['events'][0].update(sequence=4),
            lambda s:s['events'][0].update(executionContextId=99),
            lambda s:s['scriptParsed'][0].update(url='https://other.invalid/script.js')]
        for mutate in mutations:
            bad=deepcopy(snapshot);mutate(bad)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):
                census.validate_trace_identity(bad,sources,release,'https://example.invalid/Infinity/')

    def test_realclock_request_is_derived_from_exact_trace_and_native_write_chain(self):
        _,observer,storage=realclock_receipts();snapshot=observer.snapshot()
        request=census.derive_realclock_request(snapshot,storage,3,'https://example.invalid/Infinity/')
        self.assertEqual(request['nativePrimaryWrites'],[storage[1]['newValue'],storage[2]['newValue']])
        self.assertEqual(request['finalPrimaryRaw'],snapshot['events'][-1]['candidateRaw'])
        self.assertEqual(request['epoch'],trace.to_replay_epoch(snapshot['events']))
        mutations=[lambda s,w:s['events'][0].update(constructorNow=1001),
            lambda s,w:s['events'][1].update(primaryRaw='{}'),
            lambda s,w:s['events'][2].update(gapSeconds=1),
            lambda s,w:s['events'][-1].update(backupRaw='altered'),
            lambda s,w:s['events'][-1].update(primaryRaw='altered'),
            lambda s,w:s['events'][-1]['visibleState'].update(totalTime='invented'),
            lambda s,w:w.pop(0),lambda s,w:w.pop(),
            lambda s,w:w[1].update(oldValue='changed-source'),
            lambda s,w:w[1]['storageId'].update(securityOrigin='https://other.invalid'),
            lambda s,w:w.append(deepcopy(w[-1])),
            lambda s,w:w.append({'kind':'cleared','storageId':deepcopy(w[0]['storageId'])})]
        for mutate in mutations:
            bad,changed=deepcopy(snapshot),deepcopy(storage);mutate(bad,changed)
            with self.subTest(mutation=mutate),self.assertRaises((AssertionError,ValueError,KeyError)):
                census.derive_realclock_request(bad,changed,3,'https://example.invalid/Infinity/')

    def test_realclock_two_ui_preferences_require_exact_trusted_navigation_and_full_save_chain(self):
        _,observer,storage=realclock_receipts();snapshot=observer.snapshot();original=census.derive_realclock_request(snapshot,storage,3,'https://example.invalid/Infinity/')
        storage_id=deepcopy(storage[0]['storageId']);key='infinity.ui.tab'
        events=storage[:2]+[{'kind':'added','storageId':storage_id,'key':key,'newValue':'facilities'},
            {'kind':'updated','storageId':storage_id,'key':key,'oldValue':'facilities','newValue':'save'}]+storage[2:]
        first=storage[1]['newValue'];source=storage[0]['newValue']
        before={'documentId':'same-native-document','navigationSequence':1,'events':[],
            'storage':{browser.KEY:first,browser.KEY+'.backup':source,key:'facilities'},
            'wallAt':1020,'frameAt':20,'origin':'https://example.invalid','traceSequence':2,'storageCount':3}
        after=deepcopy(before);after.update(wallAt=1030,frameAt=30,traceSequence=3,storageCount=4)
        after['storage'][key]='save';after['events']=[{'kind':'click','trusted':True,'id':'','tab':'save','action':None}]
        manual=deepcopy(after);manual.update(wallAt=1041,frameAt=41,traceSequence=7,storageCount=5)
        manual['storage'][browser.KEY]=storage[-1]['newValue']
        manual['events'].append({'kind':'click','trusted':True,'id':'','tab':None,'action':'save'})
        witness={'before':before,'after':after,'manual':manual};saved=deepcopy((events,witness))
        self.assertEqual(census.derive_realclock_request(snapshot,events,3,'https://example.invalid/Infinity/',witness),original)
        self.assertEqual((events,witness),saved)
        boundary=browser.ManualStorageBoundary('https://example.invalid/Infinity/');boundary.ui_navigation=deepcopy(witness)
        for row in events:boundary.record(row['kind'],{k:v for k,v in row.items() if k!='kind'})
        boundary.capture(observer,3);self.assertEqual(boundary.result['writes'],original['nativePrimaryWrites'])
        mutations=[lambda e,w:e.pop(2),lambda e,w:e.insert(3,deepcopy(e[2])),
            lambda e,w:e.__setitem__(slice(2,4),list(reversed(e[2:4]))),
            lambda e,w:e[2].update(newValue='research'),lambda e,w:e[3].update(oldValue='research'),
            lambda e,w:e[3].update(newValue='curvature'),lambda e,w:e[2].update(oldValue=''),
            lambda e,w:e[3].update(key='other-key'),lambda e,w:e[3]['storageId'].update(securityOrigin='https://other.invalid'),
            lambda e,w:e.append({'kind':'added','storageId':storage_id,'key':'unknown','newValue':'x'}),
            lambda e,w:w['after']['events'][0].update(trusted=False),lambda e,w:w['after']['events'][0].update(trusted=1),
            lambda e,w:w['after']['events'].append(deepcopy(w['after']['events'][0])),
            lambda e,w:w['after'].update(documentId='another-document'),lambda e,w:w['after'].update(navigationSequence=True),
            lambda e,w:w['after'].update(wallAt=999),lambda e,w:w['before'].update(frameAt=float('nan')),
            lambda e,w:w['before']['storage'].update(extra='x'),lambda e,w:w['after']['storage'].__setitem__(key,'facilities'),
            lambda e,w:w['before']['storage'].__setitem__(browser.KEY,storage[-1]['newValue']),
            lambda e,w:e.pop(0),lambda e,w:e[-1].update(oldValue='changed-original'),
            lambda e,w:e.__setitem__(slice(3,5),list(reversed(e[3:5]))),
            lambda e,w:e.__setitem__(slice(None),[e[0],e[1],e[-1],e[2],e[3]]),
            lambda e,w:w['before'].update(frameAt=0),lambda e,w:w['after'].update(frameAt=1e15),
            lambda e,w:w['after'].update(traceSequence=7),lambda e,w:w['before'].update(storageCount=2),
            lambda e,w:w['after'].update(storageCount=5),lambda e,w:w['manual']['events'].pop(),
            lambda e,w:w['manual']['events'][-1].update(trusted=False)]
        for mutate in mutations:
            changed,seen=deepcopy(events),deepcopy(witness);mutate(changed,seen)
            with self.subTest(mutation=mutate),self.assertRaises((AssertionError,ValueError,KeyError)):
                census.derive_realclock_request(snapshot,changed,3,'https://example.invalid/Infinity/',seen)
        with self.assertRaises(AssertionError):census.derive_realclock_request(snapshot,events,3,'https://example.invalid/Infinity/')
        with self.assertRaises(AssertionError):census.derive_realclock_request(snapshot,storage,3,'https://example.invalid/Infinity/',witness)

    def test_manual_boundary_freezes_host_copies_without_freezing_browser(self):
        cdp,observer,storage=realclock_receipts()
        frozen=trace.freeze_manual_boundary(observer,storage,3);original=deepcopy(frozen)
        cdp.record(observer,{'kind':'action','actionType':'export','mode':'ready'})
        storage.append(deepcopy(storage[-1]));storage[0]['newValue']='later mutable host value'
        self.assertEqual(frozen,original)
        self.assertNotEqual(frozen['trace']['events'],observer.events)
        with self.assertRaises(AssertionError):trace.freeze_manual_boundary(observer,storage,3)

    def test_manual_storage_boundary_joins_either_delivery_order_without_replay(self):
        for final_receipt_first in (False,True):
            with self.subTest(final_receipt_first=final_receipt_first):
                cdp,observer,storage=realclock_receipts()
                boundary=browser.ManualStorageBoundary('https://example.invalid/Infinity/')
                first=storage if final_receipt_first else storage[:-1]
                for event in first:boundary.record(event['kind'],{k:v for k,v in event.items() if k!='kind'})
                self.assertIsNone(boundary.result)
                boundary.capture(observer,3)
                if not final_receipt_first:
                    self.assertIsNone(boundary.result)
                    frozen=deepcopy(boundary.frozen)
                    cdp.record(observer,{'kind':'action','actionType':'export','mode':'ready'})
                    event=storage[-1];boundary.record(event['kind'],{k:v for k,v in event.items() if k!='kind'})
                    self.assertEqual(boundary.frozen,frozen)
                self.assertEqual(boundary.result['writes'],[storage[1]['newValue'],storage[2]['newValue']])
                self.assertEqual(boundary.result['storageEvents'],storage)
                self.assertEqual(boundary.result['trace']['events'][-1]['kind'],'save-result')
                original=deepcopy(boundary.result)
                event=deepcopy(storage[-1]);event['newValue']='subsequent event outside captured prefix'
                boundary.record(event['kind'],{k:v for k,v in event.items() if k!='kind'})
                self.assertEqual(boundary.result,original)
                with self.assertRaises(AssertionError):boundary.capture(observer,3)

    def test_manual_storage_boundary_does_not_invent_missing_receipts(self):
        _,observer,storage=realclock_receipts()
        boundary=browser.ManualStorageBoundary('https://example.invalid/Infinity/')
        boundary.capture(observer,3)
        for event in storage[:-1]:boundary.record(event['kind'],{k:v for k,v in event.items() if k!='kind'})
        self.assertIsNone(boundary.result)
        self.assertEqual(boundary.frozen['writes'],[])
        self.assertEqual(len(boundary.events),2)

    def test_manual_storage_boundary_rejects_altered_missing_extra_receipts(self):
        mutations=[lambda rows:rows.pop(0),lambda rows:rows.pop(1),
                   lambda rows:rows[2].update(oldValue='changed-primary'),
                   lambda rows:rows.insert(2,deepcopy(rows[1])),
                   lambda rows:rows[0].update(newValue='changed-backup'),
                   lambda rows:rows[1]['storageId'].update(securityOrigin='https://other.invalid')]
        for mutate in mutations:
            _,observer,storage=realclock_receipts();mutate(storage)
            boundary=browser.ManualStorageBoundary('https://example.invalid/Infinity/')
            boundary.capture(observer,3)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):
                for event in storage:boundary.record(event['kind'],{k:v for k,v in event.items() if k!='kind'})
            self.assertIsNone(boundary.result)

    def test_raw_storage_receipts_preserve_complete_unfiltered_rows(self):
        _,observer,storage=realclock_receipts()
        with tempfile.TemporaryDirectory() as directory:
            out=Path(directory);evidence=browser.Evidence(out,{'checkCount':0})
            cap={'trace':observer,'rawStorageReceipts':[],'rawStorageReceiptRefs':[]}
            for number,event in enumerate(storage):
                row={k:deepcopy(v) for k,v in event.items() if k!='kind'}
                row['unrecognizedMetadata']={'literal':['retain',number]}
                row['storageId']['securityOrigin']='https://unrelated.invalid'
                original=deepcopy(row)
                browser.preserve_native_storage_receipt(cap,event['kind'],row,evidence.dump)
                receipt=json.loads(census.resolve_reference(out,cap['rawStorageReceiptRefs'][-1]))
                self.assertEqual(receipt,{'deliverySequence':number,'kind':event['kind'],'row':original,
                    'traceEventCount':len(observer.events),'traceLastSequence':observer.events[-1]['sequence']})
                row['unrecognizedMetadata']['literal'].append('later mutation')
                self.assertEqual(cap['rawStorageReceipts'][-1],receipt)
            self.assertEqual([row['deliverySequence'] for row in cap['rawStorageReceipts']],[0,1,2])
            evidence.journal.close()
        tree=ast.parse((ROOT/'scripts/browser-energy-challenge.py').read_text())
        callback=next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name=='storage_event')
        self.assertEqual(ast.unparse(callback.body[0]),'preserve_native_storage_receipt(cap, kind, row, dump)')
        self.assertIsInstance(callback.body[1],ast.If)

    def test_unknown_storage_key_is_preserved_before_strict_rejection_in_either_order(self):
        for receipts_first in (False,True):
            with self.subTest(receipts_first=receipts_first),tempfile.TemporaryDirectory() as directory:
                _,observer,storage=realclock_receipts()
                unknown={'kind':'added','storageId':deepcopy(storage[0]['storageId']),
                         'key':'unrecognized-native-key','newValue':'complete literal raw value',
                         'extraNativeMetadata':{'keep':['all','fields']}}
                storage.insert(2,unknown)
                out=Path(directory);evidence=browser.Evidence(out,{'checkCount':0});saved={}
                cap={'trace':observer,'rawStorageReceipts':[],'rawStorageReceiptRefs':[]}
                def preserve(frozen,receipts):
                    saved['trace']=evidence.dump('boundary.json',census.canonical(frozen['trace']))
                    saved['storage']=evidence.dump('storage.json',census.canonical(receipts))
                boundary=browser.ManualStorageBoundary('https://example.invalid/Infinity/',preserve)
                def validate(snapshot,receipts,marker,url):
                    self.assertEqual(json.loads(census.resolve_reference(out,saved['trace'])),snapshot)
                    self.assertEqual(json.loads(census.resolve_reference(out,saved['storage'])),storage)
                    raw=[json.loads(census.resolve_reference(out,ref)) for ref in cap['rawStorageReceiptRefs']]
                    self.assertEqual([r['deliverySequence'] for r in raw],list(range(4)))
                    self.assertEqual(raw[2]['row'],{k:v for k,v in unknown.items() if k!='kind'})
                    return census.derive_realclock_request(snapshot,receipts,marker,url)
                with patch.object(browser,'derive_realclock_request',side_effect=validate) as derive:
                    if not receipts_first:boundary.capture(observer,3)
                    with self.assertRaisesRegex(AssertionError,'unrecognized-native-key') as error:
                        for event in storage:
                            row={k:v for k,v in event.items() if k!='kind'}
                            browser.preserve_native_storage_receipt(cap,event['kind'],row,evidence.dump)
                            boundary.record(event['kind'],row)
                        if receipts_first:boundary.capture(observer,3)
                    self.assertEqual(error.exception.args[0],('Unexpected real-clock native storage receipt',2,'added','unrecognized-native-key'))
                    self.assertEqual(derive.call_count,1)
                self.assertIsNone(boundary.result)
                self.assertEqual(json.loads(census.resolve_reference(out,saved['storage']))[2],unknown)
                evidence.journal.close()

    def test_storage_failure_host_snapshots_survive_all_browser_capture_errors(self):
        _,observer,storage=realclock_receipts()
        boundary=browser.ManualStorageBoundary('https://example.invalid/Infinity/')
        boundary.capture(observer,3)
        for row in storage[:-1]:boundary.record(row['kind'],{k:v for k,v in row.items() if k!='kind'})
        tree=ast.parse((ROOT/'scripts/browser-energy-challenge.py').read_text())
        capture=next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name=='capture_failure')
        module=ast.Module(body=[capture],type_ignores=[])
        class BrokenPage:
            def content(self):order.append('browser-read');raise RuntimeError('closed during capture')
            def evaluate(self,*args):raise RuntimeError('closed during capture')
            def screenshot(self,**kwargs):raise RuntimeError('closed during capture')
        class BrokenTrace:
            def snapshot(self):raise RuntimeError('no trace snapshot available')
        for absent_snapshot in (False,True):
            with self.subTest(absent_snapshot=absent_snapshot),tempfile.TemporaryDirectory() as directory:
                if absent_snapshot:boundary.frozen=None
                cap={'trace':BrokenTrace() if absent_snapshot else observer,'storageBoundary':boundary,
                     'rawStorageReceipts':[{'complete':'raw receipt'}]}
                out=Path(directory);report={'checkCount':0};evidence=browser.Evidence(out,report);order=[]
                def dump(label,value):order.append(label);return evidence.dump(label,value)
                env={'report':report,'current':{'id':'migrate-r14'},'active_page':BrokenPage(),'capture':cap,
                     'dump':dump,'canonical':census.canonical,'raw':lambda page:page.evaluate('primary'),
                     'traceback':browser.traceback}
                exec(compile(module,'<actual capture_failure>','exec'),env)
                env['capture_failure'](AssertionError('receipt rejected'))
                failure=report['failure']
                for name,expected in [('raw-storage-receipts',cap['rawStorageReceipts']),
                                      ('storage-events',boundary.events),('manual-boundary',boundary.frozen)]:
                    self.assertEqual(json.loads(census.resolve_reference(out,failure[name])),expected)
                self.assertEqual(order[:4],['failure-raw-storage-receipts.json','failure-storage-events.json','failure-manual-boundary.json','browser-read'])
                self.assertEqual(set(failure['captureErrors']),{'dom','primary','events','screenshot'}|({'trace'} if absent_snapshot else set()))
                self.assertEqual(failure['captureStatus'],'inside-live-playwright')
                evidence.journal.close()

    def test_replay_success_flag_cannot_replace_source_state_and_write_bindings(self):
        _,observer,storage=realclock_receipts()
        request=census.derive_realclock_request(observer.snapshot(),storage,3,'https://example.invalid/Infinity/')
        manifest,result=replay_result(request);census.validate_realclock_result(result,request,manifest,'a'*64)
        mutations=[lambda r:r.update(status='passed',producerSha256='b'*64),
            lambda r:r['publicSource'].update(commit='b'*40),
            lambda r:r['dependencyIdentity']['breakInfinity'].update(version='different'),
            lambda r:r.update(constructorNow=1001),lambda r:r.update(positiveNativeFrames=0),
            lambda r:r.update(primaryWriteRawSha256s=[]),lambda r:r.update(finalPrimaryRawSha256='b'*64),
            lambda r:r['saves'][-1].update(lastTickAt=1040),
            lambda r:r['saves'][-1]['expectedEnvelope']['state'].update(totalTime='99'),
            lambda r:r['startupVerification'].update(sourceLastTickAt=901),
            lambda r:r['state'].update(unrelated='omitted-public-field'),
            lambda r:r.update(allowedAddedStateFields=['energyChallenge','unrelated'])]
        for mutate in mutations:
            bad=deepcopy(result);mutate(bad)
            with self.subTest(mutation=mutate),self.assertRaises(AssertionError):
                census.validate_realclock_result(bad,request,manifest,'a'*64)

    def test_reset_oracle_binds_seed_only_template_and_step(self):
        checker=census.load_boundary_checker();state=boundary_state()
        state['energyChallenge']=deepcopy(census.DEFAULT_CHALLENGE);state['totalTime']='0';state['orders']['nextJobId']=1
        state=checker.pristine_reset_expected(state,20261013)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);browser.exclusive_json(root/'template.json',state)
            browser.exclusive_json(root/'pristine.json',{'state':state})
            oracle={'kind':'pristine-template-from-observed-seed-v1','template':census.reference(root/'template.json',root),
                    'pristineSource':census.reference(root/'pristine.json',root),'fixedTemplateSeed':20261013,'permittedSeedPaths':checker.SEED_PATHS}
            case={'id':'new-game-clear','resetOracle':oracle,'steps':[{'kind':'reset','resetOracle':deepcopy(oracle)}]}
            census.validate_reset_oracle(case,root)
            for key in ('template','pristineSource'):
                clone=root/(key+'-portable-copy.json');clone.write_bytes((root/oracle[key]['file']).read_bytes())
                case['steps'][0]['resetOracle'][key]=census.reference(clone,root)
            self.assertNotEqual(case['steps'][0]['resetOracle'],oracle)
            census.validate_reset_oracle(case,root)
            for mutate in (lambda c:c['resetOracle'].update(fixedTemplateSeed=1),
                           lambda c:c['steps'][0]['resetOracle'].update(permittedSeedPaths=['all']),
                           lambda c:c.update(finalExpected=oracle['template']),
                           lambda c:c['steps'][0]['resetOracle']['template'].update(sha256='a'*64),
                           lambda c:c['steps'][0]['resetOracle']['template'].update(file='missing.json'),
                           lambda c:c['steps'][0]['resetOracle']['template'].update(file=oracle['pristineSource']['file']),
                           lambda c:c['steps'].append(deepcopy(c['steps'][0]))):
                bad=deepcopy(case);mutate(bad)
                with self.assertRaises(AssertionError):census.validate_reset_oracle(bad,root)

    def test_aggregate_binds_all_eleven_successes_and_reopened_censuses(self):
        names=('verify','verify-continuation','npc-orbital','scout-rehearsal','lab-blockers',
               'manual-unit-payments','manual-unit-authority','building-batch',
               'energy-controls','energy-lifecycle','energy-migration')
        with tempfile.TemporaryDirectory() as directory:
            roots=[];results=[];jobs={name:{'result':'success','outputs':{'common-identity-sha256':'a'*64}} for name in names}
            for index,lane in enumerate(census.LANES):
                root=Path(directory)/lane;root.mkdir();roots.append(root/'energy-evidence')
                result={'lane':lane,'commonIdentitySha256':'a'*64,'caseCount':len(census.LANES[lane])};results.append(result)
                browser.exclusive_json(root/'energy-census.json',result)
                jobs[names[index+8]]['outputs'].update({'energy-census-sha256':census.sha(census.canonical(result)),
                                                      'energy-case-count':str(result['caseCount'])})
            census.verify_job_results(roots,results,jobs)
            for name in names:
                for status in ('failure','cancelled','skipped','in_progress'):
                    bad=deepcopy(jobs);bad[name]['result']=status
                    with self.subTest(name=name,status=status),self.assertRaises(AssertionError):census.verify_job_results(roots,results,bad)
                bad=deepcopy(jobs);bad.pop(name)
                with self.assertRaises(AssertionError):census.verify_job_results(roots,results,bad)
                bad=deepcopy(jobs);bad[name]['outputs']['common-identity-sha256']='b'*64
                with self.assertRaises(AssertionError):census.verify_job_results(roots,results,bad)
            for field in ('energy-census-sha256','energy-case-count'):
                bad=deepcopy(jobs);bad['energy-controls']['outputs'][field]='wrong'
                with self.assertRaises(AssertionError):census.verify_job_results(roots,results,bad)
            (roots[0].parent/'energy-census.json').write_text('{}')
            with self.assertRaises(AssertionError):census.verify_job_results(roots,results,jobs)

    def test_realclock_witness_never_substitutes_native_time_or_economy(self):
        witness=browser.REALCLOCK_WITNESS
        for banned in ('Date.now=','performance,','requestAnimationFrame=','setItem(','__ecAdvance','Math.random=','tick(','catchUp('):
            self.assertNotIn(banned,witness)
        self.assertIn('nativeClocks:',witness)
        source=(ROOT/'scripts/browser-energy-challenge.py').read_text()
        self.assertIn('DOMStorage.domStorage',source.replace("'DOMStorage.'+method","'DOMStorage.domStorage'"))
        self.assertIn('through_manual_save(cap[\'trace\'].events,marker)',source)
        self.assertIn("'nativePrimaryWrites':writes",source)
        self.assertIn("['replay']",repr(['replay']))
        for banned in ('page.route(','.add_script_tag(','.add_style_tag(','Debugger.evaluateOnCallFrame'):
            self.assertNotIn(banned,source)
        tree=ast.parse(source)
        real=next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name=='real_clock_migration')
        init=[node for node in ast.walk(real) if isinstance(node,ast.Call) and getattr(node.func,'attr',None)=='add_init_script']
        self.assertEqual(len(init),1)
        self.assertEqual(ast.unparse(init[0].args[0]),"REALCLOCK_WITNESS.replace('__ORIGIN__', json.dumps(origin))")
        calls=[node for node in ast.walk(real) if isinstance(node,ast.Call)]
        self.assertFalse(any(getattr(node.func,'id',None)=='advance' for node in calls))
        self.assertIn("canonical(boundary['storageEvents'])",ast.get_source_segment(source,real))
        self.assertIn("canonical(boundary['trace'])",ast.get_source_segment(source,real))

    def test_failure_capture_nested_inside_live_playwright(self):
        tree=ast.parse((ROOT/'scripts/browser-energy-challenge.py').read_text())
        worker=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='worker')
        scope=next(node for node in ast.walk(worker) if isinstance(node,ast.With) and any(isinstance(item.context_expr,ast.Call) and getattr(item.context_expr.func,'id',None)=='sync_playwright' for item in node.items))
        inside=scope.body[0]
        self.assertIsInstance(inside,ast.Try)
        self.assertEqual(len(inside.handlers),1)
        calls=[node for node in ast.walk(inside.handlers[0]) if isinstance(node,ast.Call)]
        self.assertTrue(any(getattr(node.func,'id',None)=='capture_failure' for node in calls))
        capture=next(node for node in worker.body if isinstance(node,ast.FunctionDef) and node.name=='capture_failure')
        self.assertTrue(any(isinstance(node,ast.For) and any(isinstance(child,ast.Try) for child in node.body) for node in ast.walk(capture)))
        self.assertIn("'inside-live-playwright'",ast.unparse(capture))

    def test_exclusive_artifacts_and_immutable_seal(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);browser.exclusive_json(root/'a.json',{'one':1})
            with self.assertRaises(FileExistsError):browser.exclusive_json(root/'a.json',{'two':2})
            browser.exclusive_json(root/'seal.json',{'schema':'infinity-energy-challenge-artifact-seal-v1','runId':'1'*32,'files':[census.reference(root/'a.json',root)]})
            census.verify_seal(root)
            (root/'a.json').write_text('{}')
            with self.assertRaises(AssertionError):census.verify_seal(root)

    def test_no_hidden_process_or_budget_relaxation(self):
        source=(ROOT/'scripts/browser-energy-challenge.py').read_text()
        for required in ("current['start'] == observed['start']",'marker.encode()',"BUDGETS[args.lane]+20",'survivors',"open('xb')",'fresh empty directory'):
            self.assertIn(required,source)
        self.assertNotIn('pkill',source);self.assertNotIn('killall',source)
        self.assertIn("'action':step['action']",source)
        self.assertIn("transaction[1]['visibleState']==before['state']",source)

    def test_cold_reload_keeps_exact_native_source_gate_and_diagnostics(self):
        from types import SimpleNamespace
        first=SimpleNamespace(url='https://example.invalid/a.js',resource_type='script',redirected_from=None)
        final=SimpleNamespace(url='https://example.invalid/b.js',resource_type='script',redirected_from=first)
        response=SimpleNamespace(url=final.url,status=304,request=final,headers={'etag':'literal','unknown':'excluded'})
        result=browser.http_response_evidence(response)
        self.assertEqual(result['status'],304)
        self.assertEqual([row['url'] for row in result['requestChainFinalFirst']],[final.url,first.url])
        self.assertEqual(result['cacheHeaders'],{'etag':'literal'})
        first.redirected_from=final
        with self.assertRaises(AssertionError):browser.http_response_evidence(response)
        source=(ROOT/'scripts/browser-energy-challenge.py').read_text();tree=ast.parse(source)
        for name in ('boot','real_clock_migration'):
            node=next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name==name)
            body=ast.get_source_segment(source,node)
            self.assertLess(body.index("'Network.setCacheDisabled',{'cacheDisabled':True}"),body.index('page.goto('))
        seal=next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name=='seal_scripts')
        body=ast.get_source_segment(source,seal)
        self.assertLess(body.index("receipt=dump('http-response-identity.json'"),body.index("check('one real HTTP200 response"))
        self.assertIn("len(responses)==1 and responses[0].status==200",body)
        self.assertIn("sha(code)==sha(http)==release['files'][name]",body)


if __name__=='__main__':unittest.main()
