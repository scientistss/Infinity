#!/usr/bin/env python3
"""Same-Chrome, isolated-domain solar reference and independent artifact checks.

Only the frozen action tape enters the reference context. No observed native
state, wallet, quote, or checkpoint is an input. Reference script execution is
explicitly confined to the closed preparatory context, never the native UI.
"""
from collections import Counter
from copy import deepcopy
from fractions import Fraction
import importlib.util
import json
import math
import posixpath
from pathlib import Path
import re
import time
import uuid
import energy_challenge_census as C

PREPARATION_BUDGET=60
SCHEMA='infinity-energy-challenge-solar-same-browser-reference-v1'
REPLAY_SCHEMA='infinity-energy-challenge-solar-browser-replay-v1'
FIXED={'createInitialState':1,'checkpoint':22,'enqueue':149,'tick':4201,'enqueueResearch':4,'challengeCandidate':2,'reject':4}
TAPE_SHA256='8aa4f1042249670115af3c9de4436e147a32c94e2670bcd80ba68a2aec6a9f2f'
EPOCH=1791849600000
SEED=20261013
STAGES={'first-curvature','challenge-proof','challenge-growth','reward-building','reward-research'}
PROVENANCE={'inputStateAdoptions':0,'nativeObservationAdoptions':0,'nativeObservationsAvailable':False,
            'input':'fixed-action-only-tape','initialStateConstructor':'createInitialState(20261013,20261013)',
            'onlyAdoptions':'locally generated SaveSession write/readback at the original 22 checkpoints',
            'nativeInjectionScope':'only pristine new-game envelope before first native navigation',
            'referenceBundleScope':'isolated reference context closed before native context creation'}


def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
CHECKER=module('solar_reference_shape','check-energy-challenge-solar-oracle.py')
NATURAL=module('solar_reference_price','check-energy-challenge-natural.py')
decode=CHECKER.decode

def same(a,b):return C.canonical(a)==C.canonical(b)

def exact(value,keys,label):
    assert type(value) is dict and set(value)==set(keys), 'Exact '+label+' fields required'

def validate_tape(tape,events=None):
    assert type(tape) is list and len(tape)==4383, 'Fixed 4383-action tape required'
    for index,row in enumerate(tape,1):
        exact(row,('index','stage','api','request'),'action-only tape row')
        assert type(row['index']) is int and row['index']==index
        assert row['stage'] in STAGES and row['api'] in FIXED
        req=row['request'];api=row['api']
        if api=='createInitialState':
            assert index==1 and same(req,{'worldSeed':SEED,'arcadeSeed':SEED})
        elif api=='tick':
            exact(req,('dt','mode','reason'),'tick request')
            assert type(req['dt']) is int and req['dt']==1 and req['mode']=='live' and type(req['reason']) is str
        elif api in ('enqueue','enqueueResearch'):
            exact(req,('target','source','count','label'),'payment action request')
            assert req['source']=='manual' and req['count'] is None and type(req['target']) is str
            assert req['label'] in (None,'third-building-proof','third-research-proof')
        elif api=='checkpoint':
            exact(req,('name','file','appliedSeconds','adoptsReader'),'checkpoint action request')
            assert type(req['name']) is str and req['file']=='solar/'+req['name']+'.json'
            assert type(req['appliedSeconds']) is int and req['appliedSeconds']==0 and req['adoptsReader'] is True
        elif api=='challengeCandidate':
            exact(req,('action',),'challenge request');assert req['action'] in ('enter','finish')
        else:
            assert type(req) is dict and req.get('api') in ('enqueue','enqueueResearch','enterEnergyChallenge','finishEnergyChallenge')
            if req['api']=='enqueue':exact(req,('api','building','fourth'),'rejection request');assert req['fourth'] is True
            elif req['api']=='enqueueResearch':exact(req,('api','tech','fourth'),'rejection request');assert req['fourth'] is True
            else:exact(req,('api','freshQuote'),'rejection request');assert req['freshQuote'] is True
    assert dict(Counter(row['api'] for row in tape))==FIXED
    assert C.sha(C.canonical(tape))==TAPE_SHA256, 'Frozen action chronology cannot change'
    if events is not None:
        assert same(tape,[{key:event[key] for key in ('index','stage','api','request')} for event in events]), 'Action tape differs from original natural chronology'
    return tape


def validate_payment(event,previous,state):
    payment=event['payment'];req=event['request'];building=event['api']=='enqueue'
    exact(payment,('kind','target','targetLevel','jobId','cost','actualJob','stage','logicalSeconds','beforeWallet','afterWallet','label'),'full payment receipt')
    assert payment['kind']==('building' if building else 'research') and payment['target']==req['target']
    assert payment['stage']==event['stage'] and payment['label']==req['label'] and payment['logicalSeconds']==event['before']['logicalSeconds']
    assert payment['cost']==NATURAL.price(payment), 'Independent exact ordinary price differs'
    assert type(payment['jobId']) is int and payment['jobId']==previous['orders']['nextJobId']
    assert state['orders']['nextJobId']==payment['jobId']+1
    old=previous['planets'][0]['buildQueue'] if building else previous['research']['queue']
    new=state['planets'][0]['buildQueue'] if building else state['research']['queue']
    assert len(new)==len(old)+1 and same(new[:-1],old)
    job=new[-1];assert job['jobId']==payment['jobId'] and job['targetLevel']==payment['targetLevel']
    assert job['source']=='manual' and job['taskId'] is None and same(job['paid'],payment['cost'])
    assert job['building' if building else 'tech']==req['target']
    actual={**job,'kind':'building' if building else 'research'}
    if building:actual['planetId']='homeworld'
    assert same(actual,payment['actualJob']), 'Complete paid job differs'
    assert same(previous['planets'][0]['resources'],payment['beforeWallet']), 'Exact before wallet differs'
    assert same(state['planets'][0]['resources'],payment['afterWallet']), 'Exact after wallet differs'
    for resource in NATURAL.RES:
        before,after,cost=(Fraction(payment[key][resource]) for key in ('beforeWallet','afterWallet','cost'))
        assert before>=cost and after>=0
        # Same existing natural-checker representation bound, independently evaluated
        # as exact rationals. This additional amount check never relaxes any full
        # native/reference state, wallet, payment, job or raw-string equality.
        assert abs((before-after)-cost)<=max(abs(before),Fraction(1))*Fraction('1e-14'), 'Independent natural wallet debit bound differs'


def validate_quote(event,previous,candidate):
    quote=event['quote'];action=event['request']['action'];challenge=previous['energyChallenge'];active=challenge['active']
    exact(quote,('action','expected','ok','reason','gain','disabledPrestigeSlots'),'complete quote')
    exact(quote['expected'],('nextAttemptId','attemptId','universeSeed','entryJobFloor'),'quote expected identity')
    assert quote['action']==action and quote['ok'] is True and quote['reason']=='' and quote['gain']=='1' and quote['disabledPrestigeSlots']==[]
    assert quote['expected']=={'nextAttemptId':challenge['nextAttemptId'],'attemptId':active['attemptId'] if active else None,
                              'universeSeed':previous['universe']['seed'],'entryJobFloor':active['entryJobFloor'] if active else previous['orders']['nextJobId']}
    assert type(quote['expected']['nextAttemptId']) is int and type(quote['expected']['entryJobFloor']) is int
    assert quote['expected']['attemptId'] is None or type(quote['expected']['attemptId']) is int
    assert event['replayRejected'] is True
    assert candidate['stats']['launches']==previous['stats']['launches']+1
    assert Fraction(candidate['warpCores'])-Fraction(previous['warpCores'])==1


def validate_proofs(state,payments,completed):
    challenge=state['energyChallenge'];exact(challenge,('model','nextAttemptId','active','completion'),'challenge')
    assert challenge['model']=='energy-tightening-v1'
    completion=challenge['completion']
    if completion is not None:
        exact(completion,('attempt','finish'),'completion')
        exact(completion['finish'],('jobCeiling','finishedAt','ordinaryGain','homeLevels'),'finish')
        exact(completion['finish']['homeLevels'],NATURAL.PROOFS,'finish home levels')
        assert completion['finish']['ordinaryGain']=='1' and all(v>=1 for v in completion['finish']['homeLevels'].values())
    attempt=challenge['active'] or (completion['attempt'] if completion else None)
    if attempt is None:return
    exact(attempt,('attemptId','universeSeed','homeworldId','entryJobFloor','enteredAt','scoreUnits','proofs'),'attempt')
    exact(attempt['proofs'],NATURAL.PROOFS,'proof set')
    assert attempt['universeSeed']==SEED and attempt['homeworldId']=='homeworld' and 0<=int(attempt['scoreUnits'])<=NATURAL.GOAL
    for target,proof in attempt['proofs'].items():
        if proof is None:continue
        exact(proof,('jobId','targetLevel','source','taskId','paid'),'paid proof')
        assert proof['source']=='manual' and proof['taskId'] is None
        assert type(proof['jobId']) is int and proof['jobId'] in payments, 'Proof lacks actual paid identity'
        payment=payments[proof['jobId']]
        assert attempt['entryJobFloor']<=proof['jobId'] and proof['jobId'] in completed
        assert payment['kind']=='building' and payment['target']==target and proof['targetLevel']==payment['targetLevel']==1
        assert same(proof['paid'],payment['cost']), 'Proof cost differs from independent actual payment'
        if completion:assert proof['jobId']<completion['finish']['jobCeiling']


def validate_tick(event,previous,state,payments,completed,seconds):
    exact(event['log'],('completedBuilds','completedResearch','completedUnits'),'complete tick log')
    assert type(event['completed']) is list
    old=[('building',job) for job in previous['planets'][0]['buildQueue']]+[('research',job) for job in previous['research']['queue']]
    remaining={job['jobId'] for job in [*state['planets'][0]['buildQueue'],*state['research']['queue']]}
    expected=[];builds=[];research=[]
    for kind,job in old:
        if job['jobId'] in remaining:continue
        assert type(job['jobId']) is int and job['jobId'] in payments and job['jobId'] not in completed
        payment=payments[job['jobId']];target=job['building' if kind=='building' else 'tech']
        assert payment['kind']==kind and payment['target']==target and payment['targetLevel']==job['targetLevel']
        expected.append({'kind':kind,'jobId':job['jobId'],'target':target,'targetLevel':job['targetLevel'],'stage':event['stage'],'logicalSeconds':seconds})
        (builds if kind=='building' else research).append({('building' if kind=='building' else 'tech'):target,'level':job['targetLevel']})
        completed.add(job['jobId'])
    assert same(event['completed'],expected), 'Complete paid completion identities differ from actual queues'
    assert same(event['log'],{'completedBuilds':builds,'completedResearch':research,'completedUnits':[]}), 'Complete tick log differs from actual completed jobs'
    for kind,key in [('building','buildings'),('research','levels')]:
        before=previous['planets'][0][key] if kind=='building' else previous['research'][key]
        after=state['planets'][0][key] if kind=='building' else state['research'][key]
        expected_levels=deepcopy(before)
        for job in expected:
            if job['kind']==kind:expected_levels[job['target']]=job['targetLevel']
        assert same(after,expected_levels), 'Level change must match actual paid completion'


def validate_replay(result,tape,initial,legacy_events):
    exact(result,('schema','receipts','expectedStates','initial','checkpoints','rows','logicalSeconds','finalState','finalStateSha256'),'browser replay output')
    assert result['schema']==REPLAY_SCHEMA and result['rows']==4383 and result['logicalSeconds']==4201
    assert type(result['initial']) is str and result['initial'].encode()==initial, 'Only independently constructed pristine initial bytes'
    states=result['expectedStates'];receipts=result['receipts'];checkpoints=result['checkpoints']
    assert len(states)==len(receipts)==4383
    validate_tape(tape,legacy_events)
    assert set(checkpoints)=={row['request']['name'] for row in tape if row['api']=='checkpoint'} and len(checkpoints)==22
    originals={name:cp['raw'].encode() for name,cp in checkpoints.items()}
    initial_state=decode(initial)['state'];previous=pending=None;seconds=0;payments={};completed=set();score_upper=0;score_ticks=0
    before=None
    for action,event,row,legacy in zip(tape,receipts,states,legacy_events):
        exact(event,legacy.keys(),'complete reference receipt')
        assert same({k:event[k] for k in action},action)
        assert same(event['before'],before), 'Own full receipt chain broken'
        CHECKER.scaffold(legacy['after'],event['after'],'receipt.after')
        if 'candidate' in event:CHECKER.scaffold(legacy['candidate'],event['candidate'],'receipt.candidate')
        if action['api']=='tick':seconds+=1
        state,pending=CHECKER.validate_row(row,event,initial_state,previous,pending,originals,seconds)
        if action['api'] in ('enqueue','enqueueResearch'):
            validate_payment(event,previous,state);payments[event['payment']['jobId']]=event['payment']
        elif action['api']=='challengeCandidate':validate_quote(event,previous,row['candidate'])
        elif action['api']=='checkpoint':
            cp=checkpoints[action['request']['name']]
            exact(cp,('file','raw','sha256','stateSha256','logicalSeconds','totalTime','eventIndex','summary','schema'),'checkpoint output')
            assert cp['file']==action['request']['file'] and cp['raw']==row['raw'] and C.sha(cp['raw'])==cp['sha256']
            assert cp['eventIndex']==row['index'] and cp['logicalSeconds']==seconds and cp['totalTime']==state['totalTime']
            assert cp['stateSha256']==event['stateSha256']==C.sha(C.canonical(state)) and same(cp['summary'],event['after'])
            assert cp['schema']=={'version':9,'revision':16}
        elif action['api']=='tick':
            validate_tick(event,previous,state,payments,completed,seconds)
            if previous['energyChallenge']['active'] is not None:
                delta=0
                for resource,weight in zip(NATURAL.RES,NATURAL.WEIGHTS):
                    gain=Fraction(state['planets'][0]['resources'][resource])-Fraction(previous['planets'][0]['resources'][resource])
                    assert gain>=0;delta+=gain*weight*10**12//1
                score_upper+=delta;score_ticks+=1;score=int(state['energyChallenge']['active']['scoreUnits'])
                assert min(NATURAL.GOAL,score_upper-score_ticks*798)<=score<=min(NATURAL.GOAL,score_upper), 'Independent Fraction production bound differs'
        validate_proofs(state,payments,completed)
        if 'candidate' in row:validate_proofs(row['candidate'],payments,completed)
        previous=state;before=event['after']
    assert pending is None and seconds==4201 and same(result['finalState'],states[-1]['state'])
    assert result['finalStateSha256']==C.sha(C.canonical(result['finalState']))
    assert list(payments)==list(range(1,154)) and len(completed)==153
    return receipts,states


def runtime_identity(browser):
    """Read the actual running browser executable, process birth and V8 version."""
    session=browser.new_browser_cdp_session()
    try:
        version=session.send('Browser.getVersion')
        processes=session.send('SystemInfo.getProcessInfo')['processInfo']
        process,=[row for row in processes if row['type']=='browser']
        pid=process['id'];proc=Path('/proc')/str(pid);executable=(proc/'exe').resolve(strict=True)
        stat=(proc/'stat').read_text();start=stat[stat.rindex(')')+2:].split()[19]
        raw=C.original(executable)
        return {'version':version,'pid':pid,'processStart':start,'executable':str(executable),'executableSha256':C.sha(raw),'executableBytes':len(raw)}
    finally:session.detach()


def context_identity(context,page):
    session=context.new_cdp_session(page)
    try:
        info=session.send('Target.getTargetInfo')['targetInfo']
        return {'browserContextId':info['browserContextId'],'targetId':info['targetId']}
    finally:session.detach()


def browser_contexts(browser):
    session=browser.new_browser_cdp_session()
    try:return session.send('Target.getBrowserContexts')['browserContextIds']
    finally:session.detach()


def chronology_append(chronology,kind,**detail):
    chronology.append({'sequence':len(chronology),'kind':kind,'monotonic':time.monotonic(),**detail})


def validate_chronology(rows,reference_context,native_context):
    expected=['reference-context-created','reference-bundle-executed','reference-output-sealed','reference-context-closed','native-context-created','native-navigation-start']
    assert len(rows)==len(expected) and [row['kind'] for row in rows]==expected
    for index,row in enumerate(rows):
        exact(row,{'sequence','kind','monotonic','context'}|({'manifestSha256','outputSha256'} if index==2 else {'closed','browserContextIds'} if index==3 else {'browserContextIds'} if index in (0,4) else set()),'context chronology')
        assert type(row['sequence']) is int
    exact(reference_context,('browserContextId','targetId'),'reference context identity')
    exact(native_context,('browserContextId','targetId'),'native context identity')
    assert all(type(value) is str and value for context in (reference_context,native_context) for value in context.values())
    assert [row['sequence'] for row in rows]==list(range(len(rows)))
    times=[row['monotonic'] for row in rows]
    assert all(type(value) in (int,float) and math.isfinite(value) for value in times) and all(a<b for a,b in zip(times,times[1:]))
    assert reference_context['browserContextId']!=native_context['browserContextId'] and reference_context['targetId']!=native_context['targetId']
    for row in rows[:4]:assert row['context']==reference_context
    for row in rows[4:]:assert row['context']==native_context
    assert rows[0]['browserContextIds']==[reference_context['browserContextId']]
    assert rows[3]['closed'] is True and rows[3]['browserContextIds']==[]
    assert rows[4]['browserContextIds']==[native_context['browserContextId']]


def validate_runtime(reference,native,browser_version):
    keys=('version','pid','processStart','executable','executableSha256','executableBytes')
    exact(reference,keys,'reference browser runtime');exact(native,keys,'native browser runtime')
    assert same(reference,native), 'Reference and native must use the same actual browser launch and V8'
    exact(reference['version'],('protocolVersion','product','revision','userAgent','jsVersion'),'actual CDP browser version')
    assert reference['version']['product'].endswith('/'+browser_version) and reference['version']['jsVersion']
    assert type(reference['pid']) is int and reference['pid']>0 and re.fullmatch(r'\d+',reference['processStart'])
    assert Path(reference['executable']).is_absolute() and re.fullmatch('[0-9a-f]{64}',reference['executableSha256']) and type(reference['executableBytes']) is int and reference['executableBytes']>0


def execute_reference(browser,build,initial,legacy_events,dump,chronology):
    """Execute only the bound bundle in a brand-new context, then close it."""
    manifest,bundle,tape=build['manifest'],build['bundle'],build['tape']
    runtime=runtime_identity(browser)
    context=browser.new_context(service_workers='block');page=None;context_id=None
    try:
        assert context.storage_state()=={'cookies':[],'origins':[]}, 'Reference context must be pristine'
        nonce=uuid.uuid4().hex;base='http://localhost/__solar_reference__/'+nonce+'/'
        document_url=base+'index.html';bundle_url=base+'browser-reference.js'
        document=b'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script src="browser-reference.js"></script>'
        requests=[];unexpected=[];scripts=[]
        def serve(route):
            request=route.request;requests.append({'url':request.url,'method':request.method,'postData':request.post_data})
            if request.method=='GET' and request.url in (document_url,bundle_url):
                route.fulfill(status=200,body=document if request.url==document_url else bundle,
                              content_type='text/html; charset=utf-8' if request.url==document_url else 'application/javascript; charset=utf-8')
            else:unexpected.append(request.url);route.abort()
        context.route('**/*',serve)
        page=context.new_page();context_id=context_identity(context,page)
        chronology_append(chronology,'reference-context-created',context=context_id,browserContextIds=browser_contexts(browser))
        session=context.new_cdp_session(page);session.send('Debugger.enable')
        session.on('Debugger.scriptParsed',lambda row:scripts.append(row) if row.get('url')==bundle_url else None)
        response=page.goto(document_url,wait_until='load',timeout=15000)
        assert response.status==200 and len(scripts)==1 and not unexpected
        script=scripts[0];executed=session.send('Debugger.getScriptSource',{'scriptId':script['scriptId']})['scriptSource'].encode()
        assert executed==bundle, 'Executed reference source must equal exact sealed test bundle'
        chronology_append(chronology,'reference-bundle-executed',context=context_id)
        # This is the only reference computation input. No expected states or receipts cross into the page.
        invocation='async tape => JSON.stringify(await InfinitySolarReference.replay(tape))'
        result_raw=page.evaluate(invocation,tape).encode()
        assert len(result_raw)<=256*1024*1024 and not unexpected
        assert requests==[{'url':url,'method':'GET','postData':None} for url in (document_url,bundle_url)]
        assert context.storage_state()=={'cookies':[],'origins':[]}, 'Reference domain must not persist browser storage'
        result=decode(result_raw);receipts,states=validate_replay(result,tape,initial,legacy_events)
        output=dump('browser-reference-output-original.json',result_raw)
        report={'schema':SCHEMA,'classification':'same-Chrome-isolated-domain-reference-not-native-evidence',
                'runtime':runtime,'context':context_id,'sourceSha':manifest['sourceSha'],'sourceTree':manifest['sourceTree'],
                'actionTapeSha256':C.sha(C.canonical(tape)),'output':output,
                'executedSource':{'url':bundle_url,'scriptId':script['scriptId'],'executionContextId':script['executionContextId'],
                                  'v8Original':dump('browser-reference-executed-v8.js',executed)},
                'document':dump('browser-reference-document.html',document),'requests':requests,
                'invocation':invocation,'provenance':deepcopy(PROVENANCE),
                'initialStorage':{'cookies':[],'origins':[]},'finalStorage':{'cookies':[],'origins':[]}}
        report_ref=dump('browser-reference-sealed-manifest.json',C.canonical(report))
        # Verify immutable disk outputs before closing the reference context and creating the native context.
        assert C.resolve_reference(build['outputRoot'],output)==result_raw
        assert decode(C.resolve_reference(build['outputRoot'],report_ref))==report
        chronology_append(chronology,'reference-output-sealed',context=context_id,manifestSha256=report_ref['sha256'],outputSha256=output['sha256'])
        context.close();context=None
        chronology_append(chronology,'reference-context-closed',context=context_id,closed=True,browserContextIds=browser_contexts(browser))
        assert chronology[-1]['browserContextIds']==[], 'Reference context must actually be absent before native starts'
        return report_ref,receipts,states,runtime
    finally:
        if context is not None:context.close()


def validate_reference(root,report,build,initial,legacy_events):
    reference=decode(C.resolve_reference(root,report['browserReference']))
    exact(reference,('schema','classification','runtime','context','sourceSha','sourceTree','actionTapeSha256','output','executedSource','document','requests','invocation','provenance','initialStorage','finalStorage'),'sealed browser reference')
    assert reference['schema']==SCHEMA and reference['classification']=='same-Chrome-isolated-domain-reference-not-native-evidence'
    assert reference['sourceSha']==report['sourceSha']==build['manifest']['sourceSha'] and reference['sourceTree']==build['manifest']['sourceTree']
    assert same(reference['provenance'],PROVENANCE)
    assert reference['initialStorage']==reference['finalStorage']=={'cookies':[],'origins':[]}
    validate_runtime(reference['runtime'],report['nativeBrowserRuntime'],report['browserVersion'])
    assert reference['actionTapeSha256']==C.sha(C.canonical(build['tape']))==TAPE_SHA256
    executed=reference['executedSource'];exact(executed,('url','scriptId','executionContextId','v8Original'),'reference V8 source')
    assert re.fullmatch(r'http://localhost/__solar_reference__/[0-9a-f]{32}/browser-reference\.js',executed['url'])
    assert type(executed['executionContextId']) is int and type(executed['scriptId']) is str
    assert C.resolve_reference(root,executed['v8Original'])==build['bundle']
    document=b'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script src="browser-reference.js"></script>'
    assert C.resolve_reference(root,reference['document'])==document
    assert reference['requests']==[{'url':executed['url'].removesuffix('browser-reference.js')+file,'method':'GET','postData':None} for file in ('index.html','browser-reference.js')]
    assert reference['invocation']=='async tape => JSON.stringify(await InfinitySolarReference.replay(tape))'
    chronology=report['contextChronology'];validate_chronology(chronology,reference['context'],report['nativeContext'])
    assert chronology[2]['manifestSha256']==report['browserReference']['sha256'] and chronology[2]['outputSha256']==reference['output']['sha256']
    assert chronology[3]['monotonic']<=report['nativeStartedMonotonic']<chronology[4]['monotonic']
    result=decode(C.resolve_reference(root,reference['output']))
    return validate_replay(result,build['tape'],initial,legacy_events)


OPTIONS={'entryPoints':['scripts/energy-challenge-solar-browser-reference.ts'],'outfile':'browser-reference.js','bundle':True,
         'platform':'browser','format':'iife','globalName':'InfinitySolarReference','target':'es2022','minify':False,'sourcemap':False,
         'sourcesContent':False,'legalComments':'none','charset':'utf8','treeShaking':True,'preserveSymlinks':True,'metafile':True,'write':False,'logLevel':'silent','tsconfigRaw':{'compilerOptions':{'useDefineForClassFields':True}}}
BUILD_PROVENANCE={'browserInput':'only strict original index/stage/api/request action projection','expectedStateInputs':0,'quoteInputs':0,
                  'paymentInputs':0,'checkpointInputs':0,'initialStateConstructor':'createInitialState(20261013,20261013)',
                  'onlyAdoptions':'22 own Map-backed SaveSession write/readbacks','productionImportsReference':False,'sourceMathUnchanged':True,
                  'runtimeExecution':'required later in a separate context of the exact native browser before native UI starts'}
ARTIFACT_KEYS=('bundle','metafile','actionTape','naturalReport','naturalReceipts','naturalInitial')
TOOL_PATHS=('node_modules/esbuild/package.json','node_modules/esbuild/lib/main.js','node_modules/@esbuild/linux-x64/package.json','node_modules/@esbuild/linux-x64/bin/esbuild')
DEPENDENCY='node_modules/break_infinity.js/dist/break_infinity.esm.js'
DEPENDENCIES={DEPENDENCY:C.PUBLIC_DEPENDENCIES['breakInfinity']['esmSha256'],'node_modules/pad-end/index.js':C.PUBLIC_DEPENDENCIES['padEnd']['entrySha256']}


def check_bytes(ref,raw):
    assert type(ref['bytes']) is int and 0<=ref['bytes']<=256*1024*1024
    assert len(raw)==ref['bytes'] and C.sha(raw)==ref['sha256'], 'Changed sealed reference input'


def validate_build(manifest,artifacts,files,identity,events):
    exact(manifest,('schema','status','classification','sourceSha','sourceTree','sourceClassification','dirtyPaths','producer','entry',
                    'naturalReport','naturalReceipts','naturalInitial','actionTape','actionTapeSha256','census','rows','logicalSeconds','seed','epoch',
                    'bundle','metafile','inputs','inputManifestSha256','options','optionsSha256','toolchain','provenance'),'reference package manifest')
    assert manifest['schema']=='infinity-energy-challenge-solar-browser-reference-package-v1' and manifest['status']=='prepared'
    assert manifest['classification']=='test-only-same-browser-domain-reference-not-native-evidence'
    assert manifest['sourceSha']==identity['source']['sourceSha'] and manifest['sourceTree']==identity['source']['fullTree']
    assert manifest['sourceClassification']=='clean-candidate-source' and manifest['dirtyPaths']==[] and same(manifest['provenance'],BUILD_PROVENANCE)
    assert manifest['census']==FIXED and manifest['rows']==4383 and manifest['logicalSeconds']==4201 and manifest['seed']==SEED and manifest['epoch']==EPOCH
    assert same(manifest['options'],OPTIONS) and C.sha(C.canonical(OPTIONS))==manifest['optionsSha256']
    assert set(artifacts)==set(ARTIFACT_KEYS)
    for key,raw in artifacts.items():
        exact(manifest[key],('file','sha256','bytes'),'package artifact reference');check_bytes(manifest[key],raw)
    tape=validate_tape(decode(artifacts['actionTape']),events)
    assert artifacts['actionTape']==C.canonical(tape) and manifest['actionTapeSha256']==TAPE_SHA256
    natural=decode(artifacts['naturalReport']);natural_receipts=decode(artifacts['naturalReceipts'])
    assert same(natural_receipts,events) and natural['sourceSha']==manifest['sourceSha'] and natural['sourceTree']==manifest['sourceTree']
    route,=[row for row in natural['routes'] if row['policy']=='solar']
    assert C.sha(artifacts['naturalReceipts'])==route['receipts']['sha256'] and C.sha(artifacts['naturalInitial'])==route['checkpoints']['initial']['sha256']
    inventory=identity['source']['sourceCode'];inputs=manifest['inputs'];meta=decode(artifacts['metafile'])
    assert type(inputs) is list and C.sha(C.canonical(inputs))==manifest['inputManifestSha256']
    assert [row['path'] for row in inputs]==sorted(meta['inputs']) and len({row['path'] for row in inputs})==len(inputs)
    expected_files={'package-lock.json',*TOOL_PATHS,'node_modules/break_infinity.js/package.json','node_modules/pad-end/package.json'}
    for row in inputs:
        exact(row,('path','sha256','bytes','kind'),'metafile input identity');path=row['path']
        assert type(path) is str and not Path(path).is_absolute() and '..' not in Path(path).parts
        assert path in meta['inputs'] and row['bytes']==meta['inputs'][path]['bytes'];check_bytes(row,files[path]);expected_files.add(path)
        if row['kind']=='source':assert (path.startswith('src/') or path==OPTIONS['entryPoints'][0]) and inventory[path]==row['sha256']
        else:assert row['kind']=='dependency' and path in DEPENDENCIES and row['sha256']==DEPENDENCIES[path]
        for imported in meta['inputs'][path]['imports']:
            erased_local=(imported.get('external',False) and imported['kind']=='import-statement' and imported['path'].startswith('.')
                          and posixpath.normpath(posixpath.join(posixpath.dirname(path),imported['path']+'.ts')) in meta['inputs'])
            assert erased_local or (not imported.get('external',False) and imported['path'] in meta['inputs']), 'Unbound reference bundle import'
    assert OPTIONS['entryPoints'][0] in meta['inputs'] and set(DEPENDENCIES)<=set(meta['inputs'])
    assert set(meta['outputs'])=={'browser-reference.js'}
    output=meta['outputs']['browser-reference.js'];assert output['bytes']==len(artifacts['bundle']) and output['imports']==[]
    assert output['entryPoint']==OPTIONS['entryPoints'][0] and set(output['inputs'])<=set(meta['inputs'])
    for key,path in [('producer','scripts/energy-challenge-solar-browser-reference.mjs'),('entry',OPTIONS['entryPoints'][0])]:
        exact(manifest[key],('file','sha256','bytes'),'producer source reference')
        assert manifest[key]['file']==path and manifest[key]['sha256']==inventory[path];check_bytes(manifest[key],files[path]);expected_files.add(path)
    tool=manifest['toolchain'];exact(tool,('node','platform','arch','esbuild','packageLock','files','lockedPackages','dependencyPackages'),'toolchain')
    assert tool['node']==identity['runtimeNode']==natural['nodeVersion'] and tool['platform']=='linux' and tool['arch']=='x64'
    exact(tool['packageLock'],('file','sha256','bytes'),'package lock original')
    assert tool['packageLock']['file']=='package-lock.json' and tool['packageLock']['sha256']==inventory['package-lock.json']
    check_bytes(tool['packageLock'],files['package-lock.json']);lock=decode(files['package-lock.json'])
    assert set(tool['lockedPackages'])=={'node_modules/esbuild','node_modules/@esbuild/linux-x64','node_modules/break_infinity.js','node_modules/pad-end'}
    assert tool['lockedPackages']=={key:lock['packages'][key] for key in tool['lockedPackages']}
    assert [row['path'] for row in tool['files']]==list(TOOL_PATHS)
    assert [row['path'] for row in tool['dependencyPackages']]==['node_modules/break_infinity.js/package.json','node_modules/pad-end/package.json']
    for row in [*tool['files'],*tool['dependencyPackages']]:
        exact(row,('path','file','sha256','bytes'),'tool original');assert row['path']==row['file'];check_bytes(row,files[row['path']])
    for path in ('node_modules/esbuild','node_modules/@esbuild/linux-x64'):
        assert decode(files[path+'/package.json'])['version']==tool['esbuild']==lock['packages'][path]['version']
    assert decode(files['node_modules/break_infinity.js/package.json'])['version']==lock['packages']['node_modules/break_infinity.js']['version']==C.PUBLIC_DEPENDENCIES['breakInfinity']['version']
    assert decode(files['node_modules/pad-end/package.json'])['version']==lock['packages']['node_modules/pad-end']['version']==C.PUBLIC_DEPENDENCIES['padEnd']['version']
    assert set(files)==expected_files
    return {'manifest':manifest,'bundle':artifacts['bundle'],'tape':tape,'artifacts':artifacts,'files':files}


def load_build(path,identity,events,source_root):
    path=Path(path);raw=C.original(path);manifest=decode(raw)
    artifacts={key:C.resolve_reference(path.parent,manifest[key],external=key.startswith('natural')) for key in ARTIFACT_KEYS}
    paths={row['path'] for row in manifest['inputs']}|{row['path'] for row in manifest['toolchain']['files']}|{row['path'] for row in manifest['toolchain']['dependencyPackages']}|{'package-lock.json',manifest['producer']['file'],manifest['entry']['file']}
    assert all(not Path(name).is_absolute() and '..' not in Path(name).parts for name in paths)
    files={name:C.original(Path(source_root)/name) for name in paths}
    result=validate_build(manifest,artifacts,files,identity,events);result['manifestRaw']=raw;return result


def preserve_build(build,dump,root):
    value={'schema':'infinity-energy-challenge-solar-browser-package-originals-v1','manifest':dump('browser-package-manifest-original.json',build['manifestRaw']),
           'artifacts':{name:dump('browser-package-'+name,raw) for name,raw in build['artifacts'].items()},
           'inputs':{name:dump('browser-package-input-'+name,raw) for name,raw in sorted(build['files'].items())}}
    build['portableReference']=dump('browser-package-originals.json',C.canonical(value));build['outputRoot']=root
    return build


def load_preserved_build(root,reference,identity,events):
    value=decode(C.resolve_reference(root,reference));exact(value,('schema','manifest','artifacts','inputs'),'preserved package')
    assert value['schema']=='infinity-energy-challenge-solar-browser-package-originals-v1'
    manifest=decode(C.resolve_reference(root,value['manifest']))
    artifacts={key:C.resolve_reference(root,ref) for key,ref in value['artifacts'].items()}
    files={key:C.resolve_reference(root,ref) for key,ref in value['inputs'].items()}
    return validate_build(manifest,artifacts,files,identity,events)
