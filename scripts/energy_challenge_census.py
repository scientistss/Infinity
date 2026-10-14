#!/usr/bin/env python3
"""Independent, fixed native-energy acceptance census and raw-artifact verifier.

This is deliberately not an acceptance flag reader. Every result is reopened
from its original, exclusively-created artifact, including each actual state,
expected producer state, native event stream, HTTP response and full V8 source.
The three lanes are mandatory and disjoint. A plan is preparation, never proof.
"""
import argparse
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import zipfile
from urllib.parse import urljoin, urlparse

WIDTHS = (320, 390, 768, 1440)
POLICIES = ('solar', 'satellite', 'throttle')
ACTIONS = ('enter', 'abandon', 'finish')
RETIREMENTS = ('clone', 'detach', 'ancestor-aba', 'hide-show', 'tab-aba',
               'active-planet-aba', 'world-import-aba', 'cancelled-import', 'invalid-import')
CONTROLS = (
    *(f'natural-{policy}' for policy in POLICIES),
    'paid-proof-score', 'paid-job-cancel', 'paid-job-accelerate',
    *(f'responsive-{width}' for width in WIDTHS),
    *(f'dialog-cancel-{action}' for action in ACTIONS),
    'auto-card-disable-config', 'active-auto-guard', 'completion-reload',
    'receipt-ordinary-curvature', 'new-game-clear',
)
LIFECYCLE = (
    *(f'{action}-{reason}' for action in ACTIONS for reason in RETIREMENTS),
    *(f'{action}-{fault}' for action in ACTIONS for fault in ('storage-write-failure', 'storage-readback-failure')),
    'external-storage-protection', 'external-r16-misplaced-authority',
)
MIGRATIONS = (*(f'migrate-r{revision}' for revision in range(2, 15)),
              'unknown-r15', 'malformed-r16-completion')
LANES = {'controls': CONTROLS, 'lifecycle': LIFECYCLE, 'migrations': MIGRATIONS}
BUDGETS = {'controls': 420, 'lifecycle': 420, 'migrations': 240}
SCENARIOS = (*CONTROLS, *LIFECYCLE, *MIGRATIONS)
SCHEMA = 'infinity-energy-challenge-native-v1'
PLAN_SCHEMA = 'infinity-energy-challenge-native-plan-v1'
DEFAULT_CHALLENGE = {'model':'energy-tightening-v1','nextAttemptId':1,'active':None,'completion':None}
KEY = 'infinity.original-p4.save.v1'
PUBLIC_SHA = '64176f94a43564be73c64ce21968d36e2ae329a3'
PUBLIC_TREE = 'f623daf62bb673f88f25705670f53100387c5038'
PUBLIC_DEPENDENCIES = {
    'breakInfinity': {'version':'2.2.0','commonSha256':'f3be0918a5ed463a887e5b622574de81dd035c393021af7db9485f34400bda06',
                      'esmSha256':'1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a'},
    'padEnd': {'version':'1.0.2','entrySha256':'063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330'},
}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw.encode() if isinstance(raw, str) else raw).hexdigest()


def original(path):
    path = Path(path)
    assert path.is_file() and not path.is_symlink(), ('missing/nonordinary original', str(path))
    return path.read_bytes()


def reference(path, root=None):
    path = Path(path).resolve(); raw = original(path)
    name = str(path.relative_to(Path(root).resolve())) if root is not None else str(path)
    return {'file': name, 'sha256': sha(raw), 'bytes': len(raw)}


def resolve_reference(root, ref, *, external=False):
    assert type(ref) is dict and set(ref) >= {'file', 'sha256', 'bytes'}
    name = ref['file']; assert type(name) is str and name and '..' not in Path(name).parts
    assert re.fullmatch(r'[0-9a-f]{64}', ref['sha256']) and type(ref['bytes']) is int and ref['bytes'] >= 0
    path = Path(name) if Path(name).is_absolute() else Path(root) / name
    if not external:
        assert not Path(name).is_absolute() and path.resolve().is_relative_to(Path(root).resolve())
    raw = original(path)
    assert len(raw) == ref['bytes'] and sha(raw) == ref['sha256'], ('changed original', name)
    return raw


def state_from(raw):
    value = json.loads(raw)
    return value['state'] if 'state' in value else value


def load_boundary_checker():
    import importlib.util
    spec=importlib.util.spec_from_file_location('energy_boundary_checker',Path(__file__).with_name('check-energy-challenge-native-branches.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def reference_identity(value):
    """Compare portable/external plans without treating paths as evidence."""
    if isinstance(value,dict):
        if set(value)>={'file','sha256','bytes'}:return {key:reference_identity(item) for key,item in value.items() if key!='file'}
        return {key:reference_identity(item) for key,item in value.items()}
    if isinstance(value,list):return list(map(reference_identity,value))
    return value


def validate_reset_oracle(case, directory):
    checker=load_boundary_checker();oracle=case['resetOracle']
    assert oracle['kind']=='pristine-template-from-observed-seed-v1'
    assert oracle['fixedTemplateSeed']==20261013 and oracle['permittedSeedPaths']==checker.SEED_PATHS
    assert case['steps']==[{'kind':'reset','resetOracle':oracle}]
    assert not case.get('finalExpected'), 'Random native reset cannot have a pregenerated final state'
    template=state_from(resolve_reference(directory,oracle['template'],external=True))
    pristine=state_from(resolve_reference(directory,oracle['pristineSource'],external=True))
    assert template==pristine==checker.pristine_reset_expected(template,20261013)
    assert template['orders']['nextJobId']==1 and template['planets'][0]['resources']=={'metal':'500','crystal':'500','deuterium':'0'}
    return oracle,template


def validate_trace_identity(snapshot, sources, release, application_url):
    """Re-derive every safe original probe from full executed HTTP/V8 bytes."""
    import importlib.util
    import energy_challenge_trace as native
    spec=importlib.util.spec_from_file_location('energy_browser_identity',Path(__file__).with_name('browser-energy-challenge.py'))
    browser=importlib.util.module_from_spec(spec);spec.loader.exec_module(browser)
    assert snapshot['schema']==native.BASE.SCHEMA and snapshot['observationOnly'] is True
    assert snapshot['notForCpuMeasurement'] is True and snapshot['failures']==[]
    plans=[]
    for row in sources:
        body=row['http'];assert body==row['v8'] and sha(body)==release['files'][row['file']]
        if browser.production_action_handlers(body.decode()):
            plans.append(native.prepare_plan(urljoin(application_url,row['file']),body,sha(body),
                         browser.production_action_handlers,browser.production_serializers))
    assert len(plans)==1;plan=plans[0]
    assert snapshot['url']==plan.url and snapshot['releaseSha256']==plan.release_sha256
    assert re.fullmatch('__infinityNativeTrace_[0-9a-f]{32}',snapshot['bindingName'])
    bindings=snapshot['probeBindings'];assert len(bindings)==len(plan.probes)
    assert len({row['breakpointId'] for row in bindings})==len(bindings)
    for binding,probe in zip(bindings,plan.probes):
        condition=(f'globalThis[{json.dumps(snapshot["bindingName"])}](JSON.stringify('
                   f'{{kind:{json.dumps(probe.kind)},{probe.payload}}})),false')
        assert binding['kind']==probe.kind
        assert binding['request']=={'url':plan.url,**native.location(plan.source,probe.start),'condition':condition}
    scripts=snapshot['scriptParsed'];verified=snapshot['executedScripts']
    assert scripts and len(scripts)==len(verified)
    assert len({row['scriptId'] for row in scripts})==len(scripts)
    assert len({row['executionContextId'] for row in scripts})==len(scripts)
    for script in scripts:
        assert script['url']==plan.url
        record=verified[script['scriptId']]
        assert record['sha256']==plan.release_sha256 and record['bytes']==len(plan.http_bytes)
        assert record['executionContextId']==script['executionContextId']
        assert len(record['locations'])==len(plan.probes)
        for binding,probe,observed in zip(bindings,plan.probes,record['locations']):
            matching=[row['location'] for row in snapshot['resolutions']
                      if row['breakpointId']==binding['breakpointId'] and row['location']['scriptId']==script['scriptId']]
            assert len(matching)==1 and observed=={'kind':probe.kind,'location':matching[0]}
            position=matching[0];offset=native.source_offset(plan.source,position['lineNumber'],position['columnNumber'])
            assert probe.start<=offset<probe.end, ('resolved probe escaped original statement',probe.kind)
    contexts={row['executionContextId'] for row in scripts}
    assert snapshot['events'] and [row['sequence'] for row in snapshot['events']]==list(range(len(snapshot['events'])))
    assert all(row['executionContextId'] in contexts and row['kind'] in {p.kind for p in plan.probes} for row in snapshot['events'])
    return plan


def derive_realclock_request(snapshot, storage_events, marker, application_url):
    """Derive the entire oracle request from the immutable manual-boundary receipts."""
    from energy_challenge_trace import through_manual_save, to_replay_epoch
    events=snapshot['events'];prefix=through_manual_save(events,marker)
    assert prefix==events and events[-1]['kind']=='save-result'
    assert len({row['executionContextId'] for row in events})==1
    assert sum(row['kind']=='action' and row['actionType']=='save' for row in events)==1
    read=events[0];assert read['kind']=='source-read'
    ready=events[1];assert ready['kind']=='ready'
    startup={'sourceRaw':read['raw'],'constructorNow':read['constructorNow'],
             **{key:deepcopy(ready[key]) for key in ('mode','state','loaded','primaryRaw','backupRaw','lastTickAt')}}
    assert startup['backupRaw']==startup['sourceRaw'] and startup['mode']=='ready'
    assert json.loads(startup['sourceRaw'])['revision']==14
    assert json.loads(startup['primaryRaw'])['state']==startup['state']
    assert startup['state']['energyChallenge']==DEFAULT_CHALLENGE
    url=urlparse(application_url);origin=f'{url.scheme}://{url.netloc}'
    durable={KEY:startup['sourceRaw']};writes=[]
    assert storage_events
    for row in storage_events:
        assert row['storageId']['isLocalStorage'] is True and row['storageId']['securityOrigin']==origin
        assert row['kind'] in ('added','updated') and row['key'] in (KEY,KEY+'.backup')
        key=row['key'];new=row['newValue'];assert type(new) is str
        if row['kind']=='added':assert key not in durable
        else:assert key in durable and row['oldValue']==durable[key] and new!=durable[key]
        durable[key]=new
        if key==KEY:
            assert durable.get(KEY+'.backup')==startup['sourceRaw'], 'Recoverable original must precede migration adoption'
            writes.append(new)
        else:assert new==startup['sourceRaw']
    expected_writes=[startup['primaryRaw']];last_raw=startup['primaryRaw'];pending=None
    for event in events:
        if event['kind']=='save-input':
            assert pending is None and event['expectedRaw']==last_raw;pending=event
        elif event['kind']=='save-result':
            assert pending is not None and event['ok'] is True
            assert event['candidateRaw']==event['expectedRaw']==event['primaryRaw']
            assert event['backupRaw']==startup['sourceRaw']
            assert json.loads(event['candidateRaw'])['state']==pending['state']==event['visibleState']
            if event['candidateRaw']!=last_raw:expected_writes.append(event['candidateRaw'])
            last_raw=event['candidateRaw'];pending=None
    assert pending is None and writes==expected_writes
    assert durable=={KEY:last_raw,KEY+'.backup':startup['sourceRaw']}
    return {'epoch':to_replay_epoch(events),'startup':startup,'nativePrimaryWrites':writes,
            'finalPrimaryRaw':events[-1]['primaryRaw'],'finalBackupRaw':events[-1]['backupRaw']}


def validate_realclock_result(result, request, manifest, producer_sha):
    """Result metadata and every claimed save bind to separately derived raw input."""
    assert result['schema']=='infinity-energy-challenge-public-r14-native-replay-v1' and result['status']=='passed'
    public=manifest['publicSource'];assert public['commit']==PUBLIC_SHA and public['tree']==PUBLIC_TREE
    assert result['publicSource']==public and result['dependencyIdentity']==manifest['dependencyIdentity']==PUBLIC_DEPENDENCIES
    assert result['producerSha256']==manifest['producer']['sha256']==producer_sha
    assert result['sourceRevision']==14 and result['inputRawSha256']==sha(request['startup']['sourceRaw'])
    native_input=next(row for row in manifest['nativeInputs'] if row['id']=='migrate-r14')
    assert result['inputRawSha256']==native_input['sourceSha256']
    assert result['inputProvenance']==native_input['provenance']
    assert result['constructorNow']==request['epoch']['constructorNow'] and result['startupClock']==request['epoch']['startupClock']
    assert result['allowedAddedStateFields']==['energyChallenge'] and result['excludedPriorFields']==[] and result['nativeProvenanceClaimed'] is False
    epoch=request['epoch'];source=json.loads(request['startup']['sourceRaw'])
    assert result['startupState']=={key:value for key,value in request['startup']['state'].items() if key!='energyChallenge'}
    verification=result['startupVerification']
    assert verification['schema']=='infinity-energy-challenge-migration-verification-v1' and verification['status']=='passed'
    assert verification['publicSourceSha']==PUBLIC_SHA and verification['inputRawSha256']==result['inputRawSha256']
    assert verification['constructorNow']==epoch['constructorNow']==verification['adoptedLastTickAt']
    assert verification['sourceSavedAt']==source['savedAt'] and verification['sourceLastTickAt']==source['lastTickAt']
    assert verification['excludedPriorFields']==[] and verification['nativeProvenanceClaimed'] is False
    expected_saves=[(-1,'migration',request['startup']['primaryRaw'])]
    expected_saves.extend((i,row['reason'],row['raw']) for i,row in enumerate(epoch['events']) if row['kind']=='save')
    assert len(result['saves'])==len(expected_saves)
    for row,(index,reason,raw) in zip(result['saves'],expected_saves):
        envelope=json.loads(raw)
        assert row=={'eventIndex':index,'reason':reason,'savedAt':envelope['savedAt'],'lastTickAt':envelope['lastTickAt'],
                     'rawSha256':sha(raw),'expectedEnvelope':envelope}
    positive=[row for row in epoch['events'] if row['kind']=='frame' and row['gapSeconds']>0]
    assert result['positiveNativeFrames']==len(positive)>0
    assert result['primaryWriteRawSha256s']==[sha(raw) for raw in request['nativePrimaryWrites']]
    assert result['finalPrimaryRawSha256']==sha(request['finalPrimaryRaw']) and result['backupRawSha256']==sha(request['finalBackupRaw'])
    final=json.loads(request['finalPrimaryRaw'])
    assert result['lastTickAt']==final['lastTickAt']
    assert final['state']==result['expectedState']=={'energyChallenge':DEFAULT_CHALLENGE,**result['state']}
    assert 'energyChallenge' not in result['state']


def validate_migration_manifest(manifest, runtime):
    assert manifest['schema']=='infinity-energy-challenge-migration-fixtures-v2' and manifest['status']=='prepared'
    assert manifest['producer']['node']==runtime and re.fullmatch('[0-9a-f]{64}',manifest['producer']['sha256'])
    assert manifest['producer']['path']=='scripts/energy-challenge-migration-fixtures.mjs'
    assert manifest['publicSource']['commit']==PUBLIC_SHA and manifest['publicSource']['tree']==PUBLIC_TREE
    files=manifest['publicSource']['sourceFiles'];assert files and len({row['path'] for row in files})==len(files)
    for row in files:
        assert row['mode'] in ('100644','100755') and re.fullmatch('[0-9a-f]{40}',row['blob']) and re.fullmatch('[0-9a-f]{64}',row['sha256'])
        assert not Path(row['path']).is_absolute() and '..' not in Path(row['path']).parts
        assert row['path'].startswith('src/') or row['path'] in ('package.json','package-lock.json','tsconfig.json')
    assert {'src/game/save.ts','src/game/logic.ts','src/core/offline.ts','src/game/content.ts','package.json','package-lock.json','tsconfig.json'}<={row['path'] for row in files}
    assert manifest['dependencyIdentity']==PUBLIC_DEPENDENCIES
    assert manifest['missingArchivedInputs']==[] and manifest['allowedAddedStateFields']==['energyChallenge']
    assert manifest['excludedPriorStateFields']==[] and manifest['archivedRevisions']==list(range(2,14))
    assert manifest['generatedPublicSerializerRevisions']==[14]
    assert manifest['nativeInputCount']==len(manifest['nativeInputs'])==15
    assert [row['id'] for row in manifest['nativeInputs']]==list(MIGRATIONS)
    assert manifest['domainPreparationCaseCount']==len(manifest['cases'])==32
    assert len({row['id'] for row in manifest['cases']})==32
    for native in manifest['nativeInputs']:
        matches=[row for row in manifest['cases'] if row['id']==native['fixedPreparationCase']]
        assert len(matches)==1;row=matches[0]
        assert all(native[key]==row[key] for key in ('revision','sourceFile','sourceSha256','sourceBytes','expectedMode','provenance'))
        assert native['clockPolicy']==('REALCLOCK-actual-constructor-and-native-RAF' if native['id']=='migrate-r14' else 'separately-labeled-compressed-clock')
    return manifest


def validate_plan(plan, directory, lane=None):
    assert plan['schema'] == PLAN_SCHEMA
    assert re.fullmatch(r'[0-9a-f]{40}', plan['sourceSha'])
    assert re.fullmatch(r'v22\.\d+\.\d+', plan['runtimeNode'])
    assert plan['classification'] == 'compressed-logical-time-native-browser; not-whole-human-play'
    required = SCENARIOS if lane is None else LANES[lane]
    cases = plan['cases']; assert type(cases) is list
    names = [case['id'] for case in cases]
    assert len(set(names)) == len(names), 'Duplicate prepared case'
    assert set(names) <= set(SCENARIOS), 'Unknown case cannot extend the approved census'
    chosen = [case for case in cases if case['id'] in required]
    assert [case['id'] for case in chosen] == list(required), ('missing/out-of-order prepared cases', list(required), names)
    for kind in ('natural','supplements','migrations'):
        resolve_reference(directory,plan['producerOriginals'][kind],external=True)
    migrations=validate_migration_manifest(json.loads(resolve_reference(directory,plan['producerOriginals']['migrations'],external=True)),plan['runtimeNode'])
    for case in chosen:
        assert type(case['epoch']) in (int, float) and 0 < case['epoch'] <= 2**53-1
        assert case['classification'] in ('natural-producer-checkpoint-native-replay', 'explicit-synthetic-boundary',
                                           'explicit-adversarial-lifecycle', 'genuine-historical-migration', 'protected-malformed-input')
        resolve_reference(directory,case['input'],external=True)
        ident=case['id'];steps=case.get('steps',[])
        assert isinstance(steps,list)
        for key in ('initialExpected','finalExpected','faultExpected','invalidInput','externalInput','pristineTemplate','realClockInput'):
            if case.get(key):resolve_reference(directory,case[key],external=True)
        for step in steps:
            assert step['kind'] in ('challenge','review','cancel-review','import','build','research','advance','cancel-build','accelerate-build','reload','ordinary-prestige','reset','auto-toggle','auto-edit')
            assert not (set(step)&{'js','javascript','script','evaluate','expression','selector','function','code'}), 'No fixture-supplied executable code/selectors'
            if step.get('expected'):resolve_reference(directory,step['expected'],external=True)
            if step.get('input'):resolve_reference(directory,step['input'],external=True)
            if step['kind'] not in ('review','reset'):assert step.get('expected'), 'Every declared action needs a complete independent state'
            if step['kind']=='advance':assert type(step['seconds']) is int and 0<=step['seconds']<=1800
            if step['kind']=='challenge':assert step['action'] in ACTIONS and type(step.get('accept',True)) is bool
            if step['kind'] in ('build','research'):assert re.fullmatch('[a-z][a-z_]+',step['id'])
        if ident.startswith('natural-'):
            assert [row['action'] for row in steps if row['kind']=='challenge']==['enter','finish']
            assert {row['kind'] for row in steps if row.get('thirdQueue')}=={'build','research'}
            assert len([row for row in steps if row.get('thirdQueue')])==2
            assert sum(row['kind']=='build' and not row.get('thirdQueue') for row in steps)==4
            assert sum(row.get('seconds',0) for row in steps)>=4
        if ident=='paid-proof-score':assert [row['kind'] for row in steps]==['build','build','advance','advance','build','build','advance','advance']
        for suffix,required in [('paid-job-cancel','cancel-build'),('paid-job-accelerate','accelerate-build'),('completion-reload','reload'),('receipt-ordinary-curvature','ordinary-prestige'),('new-game-clear','reset')]:
            if ident==suffix:assert any(row['kind']==required for row in steps)
        if ident=='new-game-clear':
            validate_reset_oracle(case,directory)
        if ident=='active-auto-guard':assert {'auto-toggle','auto-edit'}<={row['kind'] for row in steps}
        if ident=='auto-card-disable-config':
            assert [row['action'] for row in steps if row['kind']=='challenge']==['enter','abandon']
            assert type(case['lockedAutoSlot']) is int and case['lockedAutoSlot']>=case['unlockedSlotCount']
        if ident.startswith('dialog-cancel-'):
            assert len(steps)==1 and steps[0]['kind']=='challenge' and steps[0]['action']==ident.removeprefix('dialog-cancel-') and steps[0]['accept'] is False
        if ident.startswith('responsive-'):
            assert case['width']==int(ident.split('-')[-1]) in WIDTHS
            assert [phase['action'] for phase in case['phases']]==list(ACTIONS)
            for phase in case['phases']:
                resolve_reference(directory,phase['input'],external=True);resolve_reference(directory,phase['expected'],external=True)
        if ident in LIFECYCLE:
            action=ident.split('-')[0]
            if action in ACTIONS:assert case['action']==action
            if ident.endswith('active-planet-aba'):
                assert len(case['planetSelections'])==2
                for selection in case['planetSelections']:resolve_reference(directory,selection['expected'],external=True)
            if ident.endswith('invalid-import'):assert case.get('invalidInput')
            if 'storage-' in ident and action in ACTIONS:assert case.get('faultExpected')
            if ident.startswith('external-'):assert case.get('externalInput')
        if ident.startswith('migrate-r'):
            envelope=json.loads(resolve_reference(directory,case['input'],external=True))
            assert case['revision']==int(ident.split('r')[-1])==envelope['revision']
            assert case['offlineSeconds']==(case['epoch']-envelope['lastTickAt'])/1000>0
            oracle=json.loads(resolve_reference(directory,case['historicalOracle'],external=True))
            assert oracle['schema']=='infinity-energy-challenge-public-r14-startup-oracle-v1'
            assert oracle['inputRawSha256']==case['input']['sha256'] and oracle['constructorNow']==case['epoch']
            assert oracle['sourceRevision']==case['revision'] and oracle['sourceSavedAt']==envelope['savedAt'] and oracle['sourceLastTickAt']==envelope['lastTickAt']
            assert oracle['expectedChallenge']==DEFAULT_CHALLENGE and oracle['allowedAddedStateFields']==['energyChallenge']
            expected=state_from(resolve_reference(directory,case['initialExpected'],external=True))
            assert expected=={'energyChallenge':DEFAULT_CHALLENGE,**oracle['state']}
            assert bool(case.get('realClockTrace'))==(ident=='migrate-r14')
        if ident in MIGRATIONS:
            native=next(row for row in migrations['nativeInputs'] if row['id']==ident)
            assert case['input']['sha256']==native['sourceSha256'] and case['input']['bytes']==native['sourceBytes']
            if ident.startswith('migrate-r'):
                row=next(row for row in migrations['cases'] if row['id']==native['fixedPreparationCase'])
                assert case['historicalOracle']['sha256']==row['oracleSha256'] and case['initialExpected']['sha256']==row['expectedStateSha256']
        if ident=='unknown-r15':assert json.loads(resolve_reference(directory,case['input'],external=True))['revision']==15
    return chosen


def verify_seal(directory):
    root = Path(directory); seal_raw = original(root / 'seal.json'); seal = json.loads(seal_raw)
    assert seal['schema'] == 'infinity-energy-challenge-artifact-seal-v1'
    assert re.fullmatch('[0-9a-f]{32}', seal['runId'])
    assert seal['files'] and len({r['file'] for r in seal['files']}) == len(seal['files'])
    files = {r['file'] for r in seal['files']}
    assert files == {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and p.name != 'seal.json'}
    for ref in seal['files']: resolve_reference(root, ref)
    return seal, seal_raw


def validate(directory, expected_sha, lane):
    root = Path(directory); seal, seal_raw = verify_seal(root)
    report = json.loads(original(root / 'report.json'))
    supervisor = json.loads(original(root / 'supervisor.json'))
    assert report['schema'] == SCHEMA and report['lane'] == lane
    original_plan=json.loads(resolve_reference(root,report['plan']))
    prepared=json.loads(resolve_reference(root,report['portablePlan']))
    assert reference_identity(original_plan)==reference_identity(prepared)
    validate_plan(prepared,root,lane)
    assert prepared['sourceSha']==expected_sha
    assert report['runId'] == seal['runId'] == supervisor['runId']
    assert report['completed'] is True and report['result'] == 'passed'
    assert report['sourceSha'] == expected_sha and re.fullmatch('[0-9a-f]{40}', expected_sha)
    assert report['classification'] == 'compressed-logical-time-native-browser; not-whole-human-play'
    assert report['budgetSeconds'] == BUDGETS[lane] and report['hostElapsedSeconds'] < BUDGETS[lane]
    assert supervisor['budgetSeconds'] == BUDGETS[lane] + 20
    assert supervisor['workerExitCode'] == 0 and not supervisor['expired'] and not supervisor['error'] and not supervisor['survivors']
    assert report['errors'] == [] and report['fixedScenarioCensus'] == list(LANES[lane])
    assert [r['id'] for r in report['scenarios']] == list(LANES[lane])
    checks = [json.loads(line) for line in original(root / 'checks.jsonl').splitlines()]
    assert checks and len(checks) == report['checkCount'] and all(check['passed'] is True for check in checks)
    assert [r['sequence'] for r in checks] == list(range(len(checks)))
    common = json.loads(resolve_reference(root, report['commonIdentity']))
    assert common['identitySha256'] == sha(canonical(common['identity']))
    identity = common['identity']; assert identity['source']['sourceSha'] == expected_sha
    assert report['runtimeNode'] == identity['runtimeNode'] and re.fullmatch(r'v22\.\d+\.\d+', report['runtimeNode'])
    assert len(report['sourceFiles']) == len(identity['source']['sourceCode'])
    assert {r['path']:r['sha256'] for r in report['sourceFiles']} == identity['source']['sourceCode']
    source_archive = json.loads(resolve_reference(root, report['sourceArchive']))
    assert source_archive == identity['source']['sourceCode']
    with zipfile.ZipFile(io.BytesIO(resolve_reference(root, report['fullSourceZip']))) as source_zip:
        assert len(source_zip.namelist()) == len(set(source_zip.namelist()))
        assert set(source_zip.namelist()) == set(source_archive)
        for name,digest in source_archive.items():
            assert sha(source_zip.read(name)) == digest
            assert source_zip.getinfo(name).external_attr >> 16 == int(identity['source']['sourceModes'][name],8)
    release_raw = resolve_reference(root, report['release']); release = json.loads(release_raw)
    assert sha(release_raw) == identity['releaseSha256']
    assert release['sourceSha'] == expected_sha and release['saveVersion'] == 9 and release['saveRevision'] == 16
    assert release['version'] == report['version'] and len(release['files']) == len(report['assets']) == 62
    application=urlparse(report['applicationUrl'])
    assert application.scheme in ('http','https') and application.netloc and application.path.endswith('/') and not application.query and not application.fragment
    assert {r['file']:r['sha256'] for r in report['assets']} == release['files']
    for asset in report['assets']:
        assert sha(resolve_reference(root, asset['httpOriginal'])) == asset['sha256'] == identity['assets'][asset['file']]
    documents = set()
    for case in report['scenarios']:
        assert case['completed'] is True
        own = [check for check in checks if check['scenario'] == case['id']]
        assert len(own) >= 8, ('insufficient actual checks', case['id'])
        assert case['eventScopes'] and case['comparisons']
        events = []
        for scope in case['eventScopes']:
            witness = json.loads(resolve_reference(root, scope['original']))
            assert witness['documentId'] not in documents; documents.add(witness['documentId'])
            assert witness['documentId'] == scope['documentId']
            assert witness['nativeStorage'] and witness['nativeFile'] and witness['nativeConfirm']
            assert scope['executedSources']
            native_trace=json.loads(resolve_reference(root,scope['trace']))
            assert native_trace['observationOnly'] is True and native_trace['failures']==[]
            assert native_trace['executedScripts'] and native_trace['events']
            source_rows=[]
            for script in scope['executedSources']:
                http = resolve_reference(root, script['httpOriginal']); v8 = resolve_reference(root, script['v8Original'])
                assert http == v8 and sha(http) == release['files'][script['file']]
                source_rows.append({'file':script['file'],'http':http,'v8':v8})
            validate_trace_identity(native_trace,source_rows,release,report['applicationUrl'])
            events.extend(witness['events'])
        for comparison in case['comparisons']:
            observation = json.loads(resolve_reference(root, comparison['actual']))
            assert observation['documentId'] in documents
            assert comparison['actual']['file'] != comparison['expected']['file']
            expected = state_from(resolve_reference(root, comparison['expected']))
            assert observation['state'] == expected, (case['id'], comparison['label'], 'full state mismatch')
            assert resolve_reference(root, comparison['storageBefore']) == resolve_reference(root, comparison['storageAfter'])
        for proof in case.get('noops', []):
            assert resolve_reference(root, proof['before']) == resolve_reference(root, proof['after'])
        for transition in case.get('transitions', []):
            old = state_from(resolve_reference(root, transition['before']))
            new = state_from(resolve_reference(root, transition['after']))
            action = transition['action']
            assert action in ACTIONS and transition['dialog']['accepted'] is True
            assert transition['dialog']['type'] == 'confirm' and transition['dialog']['message']
            transaction=json.loads(resolve_reference(root,transition['transaction']))
            assert [event['kind'] for event in transaction]==['save-input','save-result']
            assert transaction[0]['sequence']<transaction[1]['sequence']
            assert transaction[0]['state']==new and transaction[1]['visibleState']==old and transaction[1]['ok'] is True
            assert transition['savedState'] == new
            persisted = resolve_reference(root, transition['persisted'])
            assert state_from(persisted) == new
            assert transaction[1]['candidateRaw']==transaction[1]['expectedRaw']==transaction[1]['primaryRaw']==persisted.decode()
            actual_after = json.loads(resolve_reference(root, transition['after']))
            assert actual_after['expectedRaw'] == persisted.decode() and actual_after['protectedRaw'] is None
            if action == 'enter':
                assert old['energyChallenge']['active'] is None and new['energyChallenge']['active'] is not None
                assert new['energyChallenge']['active']['scoreUnits'] == '0'
            elif action == 'finish':
                assert old['energyChallenge']['active'] is not None and new['energyChallenge']['active'] is None
                assert new['energyChallenge']['completion'] is not None
            else:
                assert new['energyChallenge']['active'] is None and new['energyChallenge']['completion'] is None
        ident = case['id']
        if ident=='new-game-clear':
            reset=case['resetExpectation']
            prepared_case=next(row for row in prepared['cases'] if row['id']==ident)
            oracle,template=validate_reset_oracle(prepared_case,root)
            assert template==state_from(resolve_reference(root,reset['template']))
            assert reference_identity(reset['template'])==reference_identity(oracle['template'])
            expected=state_from(resolve_reference(root,reset['expected']))
            assert expected==load_boundary_checker().pristine_reset_expected(template,reset['observedSeed'])
            actual=json.loads(resolve_reference(root,reset['actual']))
            persisted=resolve_reference(root,reset['persisted'])
            assert actual['state']['universe']['seed']==reset['observedSeed'] and actual['state']==expected
            assert actual['mode']=='ready' and actual['protectedRaw'] is None and actual['expectedRaw']==persisted.decode()
            assert state_from(persisted)==expected
            linked=[row for row in case['comparisons'] if row['label']=='pristine-reset-full-state']
            assert len(linked)==1 and reference_identity(linked[0]['expected'])==reference_identity(reset['expected'])
        if ident.startswith('natural-'):
            assert [t['action'] for t in case['transitions']] == ['enter', 'finish']
            assert [row['kind'] for row in case['paidThirdQueues']]==['build','research']
            for row in case['paidThirdQueues']:
                assert row['beforeCount']==2 and row['afterCount']==3
                assert row['job']['paid'] and row['job']['jobId']>=1
        if ident.startswith('dialog-cancel-'):
            assert case.get('transitions',[])==[] and len(case['noops'])>=1
            assert len(case['dialogs'])==1 and case['dialogs'][0]['accepted'] is False
        if ident.startswith('responsive-'):
            assert case['width'] == int(ident.split('-')[-1])
            assert {r['control'] for r in case['visibility']} >= {'enter', 'cancel', 'abandon', 'finish', 'confirm'}
            for item in case['visibility']:
                assert item['visible'] and item['unoccluded'] and item['width'] == case['width']
                rect = item['rect']; assert rect['x'] >= -1 and rect['x'] + rect['width'] <= case['width'] + 1
                assert resolve_reference(root, item['screenshot']).startswith(b'\x89PNG\r\n\x1a\n')
        if any(ident == f'{action}-{retirement}' for action in ACTIONS for retirement in RETIREMENTS):
            assert case['replayCount'] == 3 and len(case['noops']) >= 3
            assert not case.get('transitions')
        if ident.startswith('migrate-r'):
            assert case['revision'] == int(ident.split('r')[-1])
            assert case['offline']['requestedSeconds'] == case['offline']['oracleRequestedSeconds']
            assert case['offline']['actualTotalTimeDelta'] == case['offline']['expectedTotalTimeDelta']
            assert case['backupOriginal']['sha256'] == case['startupOriginal']['sha256']
        if ident in ('unknown-r15', 'malformed-r16-completion'):
            assert resolve_reference(root, case['startupOriginal']) == resolve_reference(root, case['protectedOriginal'])
            assert case['primaryUnchanged'] is True
        trusted = [event for event in events if event.get('trusted')]
        assert trusted, ('no trusted native input', ident)
        assert any(event['kind'] == 'click' and event.get('action') == 'export' for event in trusted)
    if lane == 'migrations':
        case=next(c for c in report['scenarios'] if c['id']=='migrate-r14');real=case['realClock']
        assert real['nativeClockFunctions'] is True
        request=json.loads(resolve_reference(root,real['request']));result=json.loads(resolve_reference(root,real['result']))
        events=json.loads(resolve_reference(root,real['nativeStorageEvents']))
        trace=json.loads(resolve_reference(root,real['trace']))
        scopes=[scope for scope in case['eventScopes'] if scope['documentId']==real['documentId']]
        assert len(scopes)==1;scope=scopes[0]
        witness=json.loads(resolve_reference(root,scope['original']))
        assert witness['nativeClocks'] is True
        complete_trace=json.loads(resolve_reference(root,scope['trace']))
        assert trace=={**complete_trace,'events':complete_trace['events'][:real['manualEndSequence']+1]}
        assert trace['events'][-1]['sequence']==real['manualEndSequence'] and len(trace['executedScripts'])==1
        assert request==derive_realclock_request(trace,events,real['manualMarker'],report['applicationUrl'])
        prepared_case=next(row for row in prepared['cases'] if row['id']=='migrate-r14')
        assert request['startup']['sourceRaw'].encode()==resolve_reference(root,prepared_case.get('realClockInput',prepared_case['input']))
        migration_manifest=json.loads(resolve_reference(root,prepared['producerOriginals']['migrations']))
        validate_realclock_result(result,request,migration_manifest,identity['source']['sourceCode']['scripts/energy-challenge-migration-fixtures.mjs'])
        # Zero elapsed startup proves migration, but cannot be sold as offline
        # accounting acceptance. At least one genuine old-revision case must
        # use a positive old-reader/tick oracle and a full expected state.
        assert any(c.get('offline', {}).get('requestedSeconds', 0) > 0 for c in report['scenarios']), 'Missing positive genuine historical offline oracle'
    return {'lane':lane, 'sourceSha':expected_sha, 'runId':report['runId'], 'cases':list(LANES[lane]),
            'caseCount':len(LANES[lane]), 'checks':len(checks), 'documentIds':sorted(documents),
            'sealSha256':sha(seal_raw), 'commonIdentitySha256':common['identitySha256']}


def verify_job_results(directories, results, jobs):
    required={'verify','verify-continuation','npc-orbital','scout-rehearsal','lab-blockers',
              'manual-unit-payments','manual-unit-authority','building-batch',
              'energy-controls','energy-lifecycle','energy-migration'}
    assert set(jobs)==required and all(row['result']=='success' for row in jobs.values())
    identity=results[0]['commonIdentitySha256']
    assert all(row['outputs']['common-identity-sha256']==identity for row in jobs.values())
    for directory,result,job in zip(directories,results,('energy-controls','energy-lifecycle','energy-migration')):
        claimed_raw=original(Path(directory).parent/'energy-census.json');claimed=json.loads(claimed_raw)
        assert claimed==result
        outputs=jobs[job]['outputs']
        assert outputs['energy-census-sha256']==sha(canonical(result))
        assert outputs['energy-case-count']==str(result['caseCount'])


def aggregate(directories, expected_sha, jobs=None):
    assert len(directories) == 3
    results = [validate(directory, expected_sha, lane) for lane,directory in zip(LANES,directories)]
    assert len({r['runId'] for r in results}) == 3
    assert len({r['commonIdentitySha256'] for r in results}) == 1
    names = [name for result in results for name in result['cases']]
    assert names == list(SCENARIOS) and len(names) == len(set(names)) == 68
    documents = [doc for result in results for doc in result['documentIds']]
    assert len(documents) == len(set(documents)), 'Native documents reused between mandatory jobs'
    if jobs is not None:verify_job_results(directories,results,jobs)
    return {'schema':'infinity-energy-challenge-native-aggregate-v1','sourceSha':expected_sha,'caseCount':68,'lanes':results}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha',required=True)
    parser.add_argument('--lane',choices=LANES)
    parser.add_argument('directories',nargs='+',type=Path)
    args=parser.parse_args()
    result=validate(args.directories[0],args.expected_sha,args.lane) if args.lane else aggregate(args.directories,args.expected_sha,
        json.loads(os.environ['JOB_RESULTS']) if 'JOB_RESULTS' in os.environ else None)
    print(json.dumps(result,ensure_ascii=False))


if __name__ == '__main__': main()
