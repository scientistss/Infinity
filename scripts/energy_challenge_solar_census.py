#!/usr/bin/env python3
"""Additional fixed uninterrupted solar proof; never changes the original 68 cases."""
import argparse
from collections import Counter
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal
import importlib.util
import io
import json
import math
from pathlib import Path
import re
import zipfile
from urllib.parse import urljoin, urlparse
import energy_challenge_census as C
import energy_challenge_trace as T
import energy_challenge_solar_reference as R

SCHEMA='infinity-energy-challenge-solar-native-v1'
CENSUS_SCHEMA='infinity-energy-challenge-solar-native-census-v1'
CASE_ID='continuous-solar-newgame-to-third-queues'
BUDGET=600
FIXED={'createInitialState':1,'checkpoint':22,'enqueue':149,'tick':4201,'enqueueResearch':4,'challengeCandidate':2,'reject':4}
EPOCH=1791849600000
SEED=20261013
TAB_KEY='infinity.ui.tab'
def same_state(left,right):return C.canonical(left)==C.canonical(right)
def decode(raw):
    def unique(pairs):
        result={}
        for key,value in pairs:
            assert key not in result, 'Duplicate original JSON key'
            result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda value:(_ for _ in ()).throw(AssertionError('Nonfinite original JSON')))

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
BASE=module('solar_browser_base','browser-energy-challenge.py')
NATURAL=module('solar_natural_checker','check-energy-challenge-natural.py')

def prepare_trace(url,body,digest):
    plan=T.prepare_plan(url,body,digest,BASE.production_action_handlers,BASE.production_serializers)
    handler=BASE.production_action_handlers(plan.source)[0];serializer=BASE.production_serializers(plan.source)[0].group('name')
    frame=next(p for p in plan.probes if p.kind=='frame')
    gap=re.search(r'gapSeconds:([A-Za-z_$][A-Za-z0-9_$]*)',frame.payload).group(1)
    tail=(f',state:({gap}>0||globalThis.__solarObserve?{serializer}({handler.group("state")}):null)'
          ',observationRequested:globalThis.__solarObserve===true,observationReset:(globalThis.__solarObserve=false)')
    return replace(plan,probes=tuple(replace(p,payload=p.payload+(tail if p.kind=='frame-end' else '')+',documentId:globalThis.__ecWitness.documentId') for p in plan.probes))

def load_inputs(natural_dir,oracle_path,expected_sha):
    natural_dir=Path(natural_dir);oracle_path=Path(oracle_path)
    report=decode(C.original(natural_dir/'report.json'))
    assert report['schema']=='energy-challenge-natural-v1' and report['status']=='passed'
    assert report['sourceSha']==expected_sha and report['sourceClassification']=='clean-candidate-source' and report['dirtyPaths']==[]
    assert report['sourceInput']=={'kind':'createInitialState','worldSeed':SEED,'arcadeSeed':SEED,'importedSaves':[],'importedReports':[],'stockGrants':[],'directStatePatches':[]}
    route=next(r for r in report['routes'] if r['policy']=='solar');NATURAL.check_route(natural_dir,route)
    events=decode(NATURAL.verified_file(natural_dir,route['receipts']))
    assert len(events)==4383 and dict(Counter(e['api'] for e in events))==FIXED
    assert [e['index'] for e in events]==list(range(1,4384))
    assert sum(e['request']['dt'] for e in events if e['api']=='tick')==4201
    assert all(type(e['request']['dt']) is int and e['request']=={'dt':1,'mode':'live','reason':e['request']['reason']} for e in events if e['api']=='tick')
    assert [e['request']['action'] for e in events if e['api']=='challengeCandidate']==['enter','finish']
    oracle=decode(C.original(oracle_path));assert oracle['schema']=='infinity-energy-challenge-solar-oracle-v1' and oracle['status']=='prepared'
    assert oracle['classification']=='fixed-fresh-seed-domain-replay-expected-states-not-native-evidence'
    assert oracle['sourceClassification']=='clean-candidate-source' and oracle['dirtyPaths']==[]
    assert oracle['census']==FIXED and oracle['rows']==4383 and oracle['logicalSeconds']==4201
    assert oracle['producer']['path']=='scripts/energy-challenge-solar-oracle.mjs'
    assert oracle['sourceSha']==expected_sha and oracle['sourceTree']==report['sourceTree']
    assert oracle['runtimeNode']==report['nodeVersion'] and re.fullmatch(r'v22\.\d+\.\d+',oracle['runtimeNode'])
    for key,raw in [('naturalReport',C.original(natural_dir/'report.json')),('receipts',NATURAL.verified_file(natural_dir,route['receipts'])),('initial',NATURAL.verified_file(natural_dir,route['checkpoints']['initial']))]:
        assert C.resolve_reference(oracle_path.parent,oracle[key],external=True)==raw
    assert type(oracle['expectedStates']['bytes']) is int and 0<oracle['expectedStates']['bytes']<=256*1024*1024
    lines=C.resolve_reference(oracle_path.parent,oracle['expectedStates'],external=True).splitlines()
    assert len(lines)==4383 and all(0<len(line)<=2*1024*1024 for line in lines)
    states=[decode(line) for line in lines]
    assert len(states)==4383 and [s['index'] for s in states]==list(range(1,4384))
    for event,row in zip(events,states):
        assert set(row)=={'index','state'}|({'candidate'} if event['api']=='challengeCandidate' else set())|({'raw'} if event['api']=='checkpoint' else set())
        assert type(row['index']) is int
        assert type(row['state']) is dict
        assert ('candidate' in row)==(event['api']=='challengeCandidate')
        assert ('raw' in row)==(event['api']=='checkpoint')
        if event['api']=='checkpoint':
            raw=NATURAL.verified_file(natural_dir,route['checkpoints'][event['request']['name']])
            assert row['raw'].encode()==raw and same_state(decode(raw)['state'],row['state'])
    initial=NATURAL.verified_file(natural_dir,route['checkpoints']['initial'])
    envelope=decode(initial);state=envelope['state']
    assert envelope['savedAt']==envelope['lastTickAt']==EPOCH and envelope['revision']==16 and envelope['version']==9
    assert same_state(state,states[0]['state']) and state['totalTime']=='0' and state['warpCores']=='0'
    assert state['energyChallenge']==C.DEFAULT_CHALLENGE and state['orders']['nextJobId']==1 and state['stats']['launches']==0
    assert state['planets'][0]['resources']=={'metal':'500','crystal':'500','deuterium':'0'}
    assert all(v==0 for v in state['planets'][0]['buildings'].values()) and all(v==0 for v in state['research']['levels'].values())
    assert not state['planets'][0]['buildQueue'] and not state['research']['queue'] and not state['fleets'] and state['manualClicks']==0
    return report,route,events,oracle,states,initial

def validate_trace(snapshot,sources,release,url):
    assert snapshot['schema']==T.BASE.SCHEMA and snapshot['observationOnly'] is True and snapshot['notForCpuMeasurement'] is True and snapshot['failures']==[]
    plans={}
    for row in sources:
        assert row['http']==row['v8'] and C.sha(row['http'])==release['files'][row['file']]
        if BASE.production_action_handlers(row['http'].decode()):plans[row['file']]=prepare_trace(urljoin(url,row['file']),row['http'],C.sha(row['http']))
    assert len(plans)==1;plan=next(iter(plans.values()))
    assert snapshot['url']==plan.url and snapshot['releaseSha256']==plan.release_sha256
    assert re.fullmatch('__infinityNativeTrace_[0-9a-f]{32}',snapshot['bindingName'])
    bindings=snapshot['probeBindings'];assert len(bindings)==len(plan.probes) and len({b['breakpointId'] for b in bindings})==len(bindings)
    for binding,probe in zip(bindings,plan.probes):
        condition=f'globalThis[{json.dumps(snapshot["bindingName"])}](JSON.stringify({{kind:{json.dumps(probe.kind)},{probe.payload}}})),false'
        assert binding['kind']==probe.kind and binding['request']=={'url':plan.url,**T.location(plan.source,probe.start),'condition':condition}
    scripts=snapshot['scriptParsed'];verified=snapshot['executedScripts']
    assert len(scripts)==len(verified)==23 and len({s['executionContextId'] for s in scripts})==23
    for script in scripts:
        record=verified[script['scriptId']]
        assert script['url']==plan.url and record['sha256']==plan.release_sha256 and record['bytes']==len(plan.http_bytes)
        assert record['executionContextId']==script['executionContextId']
        assert len(record['locations'])==len(plan.probes)
        originals=[r for r in sources if r['scriptId']==script['scriptId']]
        assert len(originals)==1 and originals[0]['executionContextId']==script['executionContextId']
        for binding,probe,observed in zip(bindings,plan.probes,record['locations']):
            matching=[r['location'] for r in snapshot['resolutions'] if r['breakpointId']==binding['breakpointId'] and r['location']['scriptId']==script['scriptId']]
            assert len(matching)==1 and observed=={'kind':probe.kind,'location':matching[0]}
            offset=T.source_offset(plan.source,matching[0]['lineNumber'],matching[0]['columnNumber']);assert probe.start<=offset<probe.end
    events=snapshot['events'];contexts={s['executionContextId'] for s in scripts}
    assert [e['sequence'] for e in events]==list(range(len(events))) and all(type(e['sequence']) is int for e in events)
    assert all(type(e['executionContextId']) is int and e['executionContextId'] in contexts and e['kind'] in {p.kind for p in plan.probes} for e in events)
    documents={}
    for event in events:
        context=event['executionContextId'];document=event['documentId']
        assert re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',document)
        assert documents.setdefault(context,document)==document
    assert len(documents)==len(set(documents.values()))==23
    return events

def navigation_schedule(plan):
    """Every trusted tab click, plus the one initial native default selection."""
    tabs=['facilities']
    for event in plan:
        api=event['api'];request=event['request']
        if api=='enqueue':tabs.append('facilities')
        elif api=='enqueueResearch':tabs.append('research')
        elif api=='challengeCandidate':tabs.append('curvature')
        elif api=='checkpoint':tabs.append('save')
        elif api=='reject':tabs.append('facilities' if request['api']=='enqueue' else 'research' if request['api']=='enqueueResearch' else 'curvature')
    return [*tabs,'save']  # Final export navigation.

def preframe_autosave_wall(events,records,index,accounted):
    """Prove the one fixed-clock advance before its original RAF consumes it.

    __ecAdvance increments Date.now before awaiting native RAF. The unchanged
    real setInterval may save in that interval; saving must not consume time.
    Require the exact original background transaction and its own frozen tick
    record, rather than accepting a numeric clock tolerance or any future frame.
    """
    assert records is not None and 2<=index and index+3<len(events)
    assert [r['index'] for r in records]==list(range(1,len(records)+1))
    before,persist,save,result,frame,end=events[index-2:index+4]
    assert [e['kind'] for e in (before,persist,save,result,frame,end)]==[
        'frame-end','persist-input','save-input','save-result','frame','frame-end']
    assert [e['sequence'] for e in (before,persist,save,result,frame,end)]==list(range(index-2,index+4))
    assert all(e['executionContextId']==save['executionContextId'] and e['documentId']==save['documentId']
               and e['mode']=='ready' for e in (before,persist,save,result,frame,end))
    assert persist['background'] is True and persist['nextStatus']=='已自动保存'
    owners=[r for r in records if r['traceStart']<=index<r['traceEnd']]
    assert len(owners)==1;record=owners[0];position=record['index']-1
    assert record['api']=='tick' and position>0
    previous=records[position-1]
    scope,observed=record_scope(record,events,previous['traceEnd'],previous['observationSequence'])
    assert record['traceStart']<=persist['sequence'] and observed['sequence']==end['sequence']
    assert sum(e['kind']=='frame' and e['gapSeconds']>0 for e in scope)==1
    assert [e['kind'] for e in scope if e['sequence']<=end['sequence']].count('frame')==1
    previous_state=events[previous['observationSequence']]
    assert previous_state['kind']=='frame-end' and previous_state['executionContextId']==save['executionContextId']
    assert previous_state['documentId']==save['documentId'] and same_state(save['state'],previous_state['state'])
    assert same_state(result['visibleState'],save['state'])
    # The expected write time comes only from the immutable one-second action
    # chronology, never from a saved envelope or observed state.
    expected=EPOCH+1000*sum(r['api']=='tick' for r in records[:position+1])
    assert type(save['savedAt']) is int and save['savedAt']==expected
    assert type(save['lastTickAt']) is int and save['lastTickAt']==accounted==expected-1000
    assert before['lastTickAt']==accounted and frame['lastTickAtBefore']==accounted
    assert type(frame['gapSeconds']) in (int,float) and frame['gapSeconds']==1
    assert frame['now']-before['now']==1000 and end['now']==frame['now']
    assert end['lastTickAt']==expected and end['state'] is not None
    return expected


def validate_storage(events,receipts,initial,url,tabs=None,records=None):
    durable=initial;expected=[];pending=None;source_reads=0;ready_count=0;contexts=set();context=None;awaiting_ready=False;constructor_now=None;wall=None
    for index,event in enumerate(events):
        if pending is not None:assert event['kind']=='save-result'
        if event['kind']=='source-read':
            assert pending is None and not awaiting_ready and event['executionContextId'] not in contexts
            context=event['executionContextId'];contexts.add(context);awaiting_ready=True;constructor_now=event['constructorNow']
            assert event['raw']==durable;source_reads+=1
        elif event['kind']=='ready':
            assert awaiting_ready and event['executionContextId']==context
            assert event['primaryRaw']==durable and event['backupRaw'] is None and event['mode']=='ready'
            assert same_state(event['state'],decode(durable)['state'])
            assert event['startupClock']=={'wallAt':constructor_now,'frameAt':0}
            assert event['lastTickAt']==constructor_now==decode(durable)['lastTickAt']
            assert event['loaded']['rawSeconds']==event['loaded']['appliedSeconds']==0
            awaiting_ready=False;ready_count+=1;wall=event['lastTickAt']
        else:assert not awaiting_ready and event['executionContextId']==context
        if event['kind']=='frame-end':wall=event['lastTickAt']
        if event['kind']=='save-input':
            assert pending is None and event['expectedRaw']==durable and event['mode']=='ready'
            assert event['lastTickAt']==wall
            saved_at=wall if event['savedAt']==wall else preframe_autosave_wall(events,records,index,wall)
            assert event['savedAt']==saved_at;pending=event
        elif event['kind']=='save-result':
            assert pending is not None and event['ok'] is True and event['mode']=='ready'
            raw=event['candidateRaw'];assert raw==event['expectedRaw']==event['primaryRaw'] and event['backupRaw'] is None
            envelope=decode(raw)
            assert envelope['version']==9 and envelope['revision']==16
            assert envelope['savedAt']==event['savedAt']==pending['savedAt']==saved_at
            assert envelope['lastTickAt']==event['lastTickAt']==pending['lastTickAt']==wall
            assert same_state(envelope['state'],pending['state'])
            if raw!=durable:expected.append((durable,raw))
            durable=raw;pending=None
    assert pending is None and not awaiting_ready and source_reads==ready_count==len(contexts)==23
    origin=urlparse(url);origin=f'{origin.scheme}://{origin.netloc}'
    tab_changes=[];old=None
    for tab in tabs or []:
        if tab!=old:tab_changes.append((old,tab));old=tab
    assert len(receipts)==len(expected)+len(tab_changes)
    positions={C.KEY:0,TAB_KEY:0};chains={C.KEY:expected,TAB_KEY:tab_changes}
    for row in receipts:
        assert row['storageId']['securityOrigin']==origin and row['storageId']['isLocalStorage'] is True
        key=row['key'];assert key in chains and positions[key]<len(chains[key]), 'Unknown or extra storage write'
        old,new=chains[key][positions[key]];positions[key]+=1
        assert row['newValue']==new
        if old is None:assert row['kind']=='added' and 'oldValue' not in row
        else:assert row['kind']=='updated' and row['oldValue']==old
    assert positions=={C.KEY:len(expected),TAB_KEY:len(tab_changes)}
    return durable

def validate_timing(events,records):
    tick_ends=[];pending_frame=None;last_tick=None;prior_now=None;context=None
    for event in events:
        if event['kind']=='ready':
            assert pending_frame is None
            last_tick=event['lastTickAt'];prior_now=event['startupClock']['frameAt'];context=event['executionContextId']
        if event['kind']=='frame':
            assert pending_frame is None and event['mode']=='ready'
            assert type(event['gapSeconds']) in (int,float) and event['gapSeconds'] in (0,1)
            assert type(event['now']) in (int,float) and math.isfinite(event['now']) and event['now']>=0
            assert context==event['executionContextId'] and event['lastTickAtBefore']==last_tick
            assert event['now']>=prior_now and event['gapSeconds']==(event['now']-prior_now)/1000
            pending_frame=event
        if event['kind']=='frame-end':
            assert pending_frame is not None and event['now']==pending_frame['now'] and event['mode']=='ready'
            assert event['executionContextId']==pending_frame['executionContextId']
            if pending_frame['gapSeconds']>0:
                assert type(pending_frame['gapSeconds']) in (int,float) and pending_frame['gapSeconds']==1 and event['lastTickAt']-pending_frame['lastTickAtBefore']==1000
                assert event['state'] is not None;tick_ends.append(event['sequence'])
            else:assert event['lastTickAt']==pending_frame['lastTickAtBefore']
            last_tick=event['lastTickAt'];prior_now=event['now']
            pending_frame=None
    assert pending_frame is None and len(tick_ends)==4201
    assert [r['observationSequence'] for r in records if r['api']=='tick']==tick_ends

def record_scope(record,events,prior_end,prior_observation):
    assert all(type(record[key]) is int for key in ('index','traceStart','traceEnd','observationSequence'))
    assert prior_end<=record['traceStart']<=record['observationSequence']<record['traceEnd']<=len(events)
    assert record['observationSequence']>prior_observation
    scope=events[record['traceStart']:record['traceEnd']];observed=events[record['observationSequence']]
    assert observed['kind']=='frame-end' and observed['mode']=='ready'
    if record['api']!='checkpoint':assert all(e['executionContextId']==observed['executionContextId'] for e in scope)
    return scope,observed

def action_transaction(record,events,scope,observed,action_type,kinds,reloads=False):
    actions=[e for e in scope if e['kind']=='action'];assert len(actions)==1 and actions[0]['actionType']==action_type
    action=actions[0];end=action['sequence']+1+len(kinds)
    assert record['traceStart']<=action['sequence']<end<=record['traceEnd'] and end<=record['observationSequence']
    transaction=events[action['sequence']+1:end]
    assert [e['kind'] for e in transaction]==kinds
    assert all(e['executionContextId']==action['executionContextId'] for e in transaction)
    if not reloads:assert action['executionContextId']==observed['executionContextId']
    return action,transaction


def validate(root,expected_sha):
    root=Path(root);seal,seal_raw=C.verify_seal(root);report=decode(C.original(root/'report.json'));supervisor=decode(C.original(root/'supervisor.json'))
    assert report['schema']==SCHEMA and report['caseId']==CASE_ID and report['sourceSha']==expected_sha
    assert report['runId']==seal['runId']==supervisor['runId'] and report['completed'] is True and report['errors']==[]
    assert report['budgetSeconds']==BUDGET and type(report['hostElapsedSeconds']) in (int,float) and 0<=report['hostElapsedSeconds']<BUDGET
    assert report['preparationBudgetSeconds']==R.PREPARATION_BUDGET and type(report['preparationElapsedSeconds']) in (int,float) and 0<=report['preparationElapsedSeconds']<R.PREPARATION_BUDGET
    assert type(report['workerElapsedSeconds']) in (int,float) and max(report['hostElapsedSeconds'],report['preparationElapsedSeconds'])<=report['workerElapsedSeconds']<BUDGET+R.PREPARATION_BUDGET
    assert supervisor['preparationBudgetSeconds']==R.PREPARATION_BUDGET and supervisor['nativeBudgetSeconds']==BUDGET and supervisor['cleanupBudgetSeconds']==20
    assert supervisor['budgetSeconds']==BUDGET+R.PREPARATION_BUDGET+20 and supervisor['workerExitCode']==0 and not supervisor['expired'] and not supervisor['error'] and not supervisor['survivors']
    checks=[decode(line) for line in C.original(root/'checks.jsonl').splitlines()]
    assert len(checks)==report['checkCount'] and [r['sequence'] for r in checks]==list(range(len(checks))) and all(r['passed'] is True for r in checks)
    common=decode(C.resolve_reference(root,report['commonIdentity']));identity=common['identity']
    assert common['identitySha256']==C.sha(C.canonical(identity)) and identity['source']['sourceSha']==expected_sha
    assert report['runtimeNode']==identity['runtimeNode']
    inventory=identity['source']['sourceCode'];archive=C.resolve_reference(root,report['fullSourceZip'])
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        assert len(z.namelist())==len(set(z.namelist())) and set(z.namelist())==set(inventory)
        for name,digest in inventory.items():assert C.sha(z.read(name))==digest and z.getinfo(name).external_attr>>16==int(identity['source']['sourceModes'][name],8)
    release_raw=C.resolve_reference(root,report['release']);release=decode(release_raw)
    assert C.sha(release_raw)==identity['releaseSha256'] and release['sourceSha']==expected_sha and release['saveVersion']==9 and release['saveRevision']==16
    assert report['version']==release['version'] and len(report['assets'])==len(release['files'])==62
    assert {asset['file'] for asset in report['assets']}==set(release['files'])
    assert identity['assets']=={**release['files'],'release.json':C.sha(release_raw)}
    for asset in report['assets']:assert C.sha(C.resolve_reference(root,asset['original']))==release['files'][asset['file']]==identity['assets'][asset['file']]
    natural,route,plan,oracle,states,initial=load_inputs(root/'natural',root/'oracle/manifest.json',expected_sha)
    assert natural['sourceTree']==identity['source']['fullTree'] and oracle['runtimeNode']==report['runtimeNode']
    assert C.reference_identity(decode(C.resolve_reference(root,report['oracleOriginal'])))==C.reference_identity(oracle)
    assert oracle['producer']['sha256']==inventory['scripts/energy-challenge-solar-oracle.mjs']
    build=R.load_preserved_build(root,report['browserReferenceBuild'],identity,plan)
    plan,states=R.validate_reference(root,report,build,initial,plan)
    sources=[]
    for row in report['executedSources']:
        response=decode(C.resolve_reference(root,row['response']))
        assert response['status']==200 and response['url']==urljoin(report['applicationUrl'],row['file'])
        sources.append({**row,'http':C.resolve_reference(root,row['httpOriginal']),'v8':C.resolve_reference(root,row['v8Original'])})
    trace=decode(C.resolve_reference(root,report['trace']));events=validate_trace(trace,sources,release,report['applicationUrl'])
    records=[decode(line) for line in C.resolve_reference(root,report['records']).splitlines()]
    assert len(records)==4383 and [r['index'] for r in records]==list(range(1,4384))
    validate_timing(events,records)
    paid=[];previous=states[0]['state'];transitions=[];prior_end=0;prior_observation=-1
    for record,event,expected in zip(records,plan,states):
        assert record['api']==event['api'] and record['index']==event['index']
        scope,observed=record_scope(record,events,prior_end,prior_observation)
        target=expected.get('candidate',expected['state'])
        assert same_state(observed['state'],target), ('whole-state mismatch',record['index'],record['api'])
        if event['api'] in ('enqueue','enqueueResearch'):
            payment=event['payment'];assert payment['cost']==NATURAL.price(payment)
            oldq=previous['planets'][0]['buildQueue'] if event['api']=='enqueue' else previous['research']['queue']
            newq=target['planets'][0]['buildQueue'] if event['api']=='enqueue' else target['research']['queue']
            added=[j for j in newq if j['jobId'] not in {j['jobId'] for j in oldq}]
            assert len(added)==1 and added[0]['jobId']==payment['jobId']==previous['orders']['nextJobId']
            assert target['orders']['nextJobId']==previous['orders']['nextJobId']+1
            assert added[0]['paid']==payment['cost'] and added[0]['source']=='manual' and added[0]['taskId'] is None
            assert previous['planets'][0]['resources']==payment['beforeWallet'] and target['planets'][0]['resources']==payment['afterWallet']
            _,transaction=action_transaction(record,events,scope,observed,event['api'],['persist-input','save-input','save-result'])
            assert transaction[0]['background'] is False and same_state(transaction[1]['state'],target) and transaction[2]['ok'] is True
            assert same_state(transaction[2]['visibleState'],target)
            paid.append(added[0]['jobId'])
        if event['api']=='challengeCandidate':
            _,transaction=action_transaction(record,events,scope,observed,'energy-challenge',['save-input','save-result'])
            assert same_state(transaction[0]['state'],target) and same_state(transaction[1]['visibleState'],previous) and transaction[1]['ok'] is True
            persisted=C.resolve_reference(root,record['persisted']).decode()
            assert transaction[1]['candidateRaw']==persisted and same_state(decode(persisted)['state'],target)
            assert type(record['beforeSequence']) is int and prior_observation<record['beforeSequence']<record['traceStart'] and same_state(events[record['beforeSequence']]['state'],previous)
            assert events[record['beforeSequence']]['kind']=='frame-end' and events[record['beforeSequence']]['executionContextId']==observed['executionContextId']
            assert record['dialog']['type']=='confirm' and record['dialog']['accepted'] is True and '能源紧缩' in record['dialog']['message']
            assert target['stats']['launches']==previous['stats']['launches']+1
            assert event['quote']['gain']=='1' and Decimal(target['warpCores'])-Decimal(previous['warpCores'])==Decimal(1)
            transitions.append(event['request']['action'])
        if event['api']=='checkpoint':
            persisted=C.resolve_reference(root,record['persisted']).decode();assert persisted==expected['raw']
            action,transaction=action_transaction(record,events,scope,observed,'save',['persist-input','save-input','save-result'],reloads=True)
            assert transaction[0]['background'] is False and transaction[2]['candidateRaw']==persisted
            reloaded=[e for e in scope if e['kind']=='source-read'];assert len(reloaded)==1 and reloaded[0]['raw']==persisted
            ready=[e for e in scope if e['kind']=='ready'];assert len(ready)==1 and ready[0]['executionContextId']==reloaded[0]['executionContextId']==observed['executionContextId']
            assert transaction[-1]['sequence']<reloaded[0]['sequence']<ready[0]['sequence'] and action['executionContextId']!=observed['executionContextId']
            assert ready[0]['sequence']<record['observationSequence'] and ready[0]['primaryRaw']==persisted
        previous=target;prior_end=record['traceEnd'];prior_observation=record['observationSequence']
    assert paid==list(range(1,154)) and transitions==['enter','finish']
    documents=[decode(C.resolve_reference(root,ref)) for ref in report['documents']]
    assert len(documents)==23 and len({d['documentId'] for d in documents})==23
    reads=[e for e in events if e['kind']=='source-read']
    assert [d['documentId'] for d in documents]==[e['documentId'] for e in reads]
    assert [d['navigationSequence'] for d in documents]==list(range(1,24)) and all(type(d['navigationSequence']) is int for d in documents)
    assert all(d['nativeStorage'] and d['nativeFile'] and d['nativeConfirm'] for d in documents)
    clicks=[e for d in documents for e in d['events'] if e['kind']=='click' and e['trusted']]
    tabs=navigation_schedule(plan)
    assert [e['tab'] for e in clicks if e.get('tab')]==tabs[1:]
    economic=[(e['action'],e['target']) for e in clicks if e.get('action') in ('enqueue','research')]
    assert economic==[('enqueue' if e['api']=='enqueue' else 'research',e['request']['target']) for e in plan if e['api'] in ('enqueue','enqueueResearch')]
    assert sum(e.get('id')=='energy-challenge-confirm' for e in clicks)==2
    actions=[e['actionType'] for e in events if e['kind']=='action']
    assert Counter(actions)==Counter({'enqueue':149,'enqueueResearch':4,'energy-challenge':2,'save':22,'export':1})
    receipts=decode(C.resolve_reference(root,report['storageEvents']));final=validate_storage(events,receipts,initial.decode(),report['applicationUrl'],tabs,records)
    assert C.resolve_reference(root,report['finalPrimary']).decode()==final
    assert decode(C.resolve_reference(root,report['finalStorage']))=={C.KEY:final,TAB_KEY:tabs[-1]}
    assert same_state(decode(final)['state'],states[-1]['state'])
    assert same_state(decode(C.resolve_reference(root,report['export']))['state'],states[-1]['state'])
    for kind,key in [('build','buildQueue'),('research','queue')]:
        before=route['checkpoints']['before-third-'+kind+'-paid'];after=route['checkpoints']['third-'+kind+'-paid']
        a=states[before['eventIndex']-1]['state'];b=states[after['eventIndex']-1]['state']
        aq=a['planets'][0][key] if kind=='build' else a['research'][key];bq=b['planets'][0][key] if kind=='build' else b['research'][key]
        assert len(aq)==2 and len(bq)==3
        for resource,amount in bq[-1]['paid'].items():assert Decimal(a['planets'][0]['resources'][resource])-Decimal(b['planets'][0]['resources'][resource])==Decimal(amount)
    return {'schema':CENSUS_SCHEMA,'sourceSha':expected_sha,'runId':report['runId'],'caseCount':1,'caseId':CASE_ID,'logicalSeconds':4201,
            'buildingPayments':149,'researchPayments':4,'challengeConfirmations':2,'checkpointCount':22,'documentCount':23,
            'documentIds':sorted(d['documentId'] for d in documents),
            'commonIdentitySha256':common['identitySha256'],'sealSha256':C.sha(seal_raw),'checks':len(checks),
            'browserReferenceSha256':report['browserReference']['sha256'],'referencePreparationBudgetSeconds':R.PREPARATION_BUDGET,
            'nativeBudgetSeconds':BUDGET,'runtimeKind':'same-Chrome-isolated-reference-before-native'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--expected-sha',required=True);p.add_argument('directory',type=Path);args=p.parse_args()
    print(json.dumps(validate(args.directory,args.expected_sha),ensure_ascii=False))
if __name__=='__main__':main()
