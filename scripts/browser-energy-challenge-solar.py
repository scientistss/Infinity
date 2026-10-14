#!/usr/bin/env python3
"""Fixed uninterrupted solar journey using trusted UI and original native RAF/tick.

Only the genuine zero-progress createInitialState envelope seeds native storage,
before first navigation. Thereafter there is no import, reseed or state injection.
Logical time is explicitly compressed into original one-second engine frames.
"""
import argparse
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback
import uuid
import zipfile
from urllib.parse import urljoin,urlparse,unquote
import energy_challenge_solar_census as S
import energy_challenge_solar_reference as R
from energy_challenge_census import canonical,original,reference,resolve_reference,sha
from energy_challenge_trace import NativeFrameTrace

ROOT=Path(__file__).resolve().parents[1]
BASE=S.BASE
KEY=S.C.KEY
BUDGETS={'solar':S.BUDGET}
process_identity=BASE.process_identity
exclusive_json=BASE.exclusive_json
CLOCK=BASE.CLOCK.replace('action:n.dataset.action||null','action:n.dataset.action||null,target:n.dataset.id||null')
assert CLOCK!=BASE.CLOCK


def copy_original(source,destination):
    raw=original(source);destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open('xb') as handle:handle.write(raw)
    return reference(destination)


def worker(args):
    from playwright.sync_api import sync_playwright
    out=Path(args.output);preparation_start=time.monotonic();start=preparation_start;native_started=False
    def deadline_expired(_signal,_frame):raise TimeoutError('Explicit solar phase budget expired')
    signal.signal(signal.SIGALRM,deadline_expired);signal.setitimer(signal.ITIMER_REAL,R.PREPARATION_BUDGET)
    natural_dir=Path(args.natural).resolve();oracle_path=Path(args.oracle).resolve()
    natural,route,plan,oracle,expected,initial=S.load_inputs(natural_dir,oracle_path,args.expected_sha)
    common_raw=original(args.common_identity);common=json.loads(common_raw);identity=common['identity']
    assert common['identitySha256']==sha(canonical(identity)) and identity['source']['sourceSha']==args.expected_sha
    assert identity['runtimeNode']==args.runtime_node==oracle['runtimeNode']
    assert natural['sourceTree']==identity['source']['fullTree']
    assert oracle['producer']['sha256']==identity['source']['sourceCode']['scripts/energy-challenge-solar-oracle.mjs']
    report={'schema':S.SCHEMA,'caseId':S.CASE_ID,'runId':args.run_id,'sourceSha':args.expected_sha,'runtimeNode':args.runtime_node,
            'version':args.expected_version,'applicationUrl':args.url,'budgetSeconds':S.BUDGET,'completed':False,'errors':[],
            'classification':'fixed-continuous-native-UI-with-compressed-one-second-original-RAF; not-human-elapsed-time',
            'checkCount':0,'_started':start,'assets':[],'executedSources':[],'documents':[],
            'preparationBudgetSeconds':R.PREPARATION_BUDGET,'contextChronology':[]}
    evidence=BASE.Evidence(out,report);evidence.scenario=S.CASE_ID;check=evidence.check;dump=evidence.dump
    report['commonIdentity']=dump('common-identity.json',common_raw)
    build=R.load_build(Path(args.browser_reference),identity,plan,source_root=ROOT)
    build=R.preserve_build(build,dump,out)
    report['browserReferenceBuild']=build['portableReference']
    copy_original(natural_dir/'report.json',out/'natural/report.json')
    refs=[route['receipts'],route['productionTrace'],*route['checkpoints'].values()]
    for name in sorted({r['file'] for r in refs}):
        assert not Path(name).is_absolute() and '..' not in Path(name).parts
        copy_original(natural_dir/name,out/'natural'/name)
    report['oracleOriginal']=dump('oracle-original-manifest.json',original(oracle_path))
    portable=deepcopy(oracle)
    (out/'oracle').mkdir()
    for key in ('naturalReport','receipts','initial','expectedStates'):
        raw=resolve_reference(oracle_path.parent,oracle[key],external=True)
        path=out/'oracle'/(key+('.jsonl' if key=='expectedStates' else '.json'))
        with path.open('xb') as handle:handle.write(raw)
        portable[key]=reference(path,out/'oracle')
    exclusive_json(out/'oracle/manifest.json',portable)
    records_path=out/'route-records.jsonl';records_handle=records_path.open('x',encoding='utf8')
    parsed=urlparse(args.url);assert parsed.scheme in ('http','https') and parsed.path.endswith('/') and not parsed.query and not parsed.fragment
    origin=f'{parsed.scheme}://{parsed.netloc}'
    page=None;context=None;cap=None;trace_plan=None;release=None;storage_events=[];documents_seen=set();elapsed=0;current_index=0
    def raw():return page.evaluate('(key)=>localStorage.getItem(key)',KEY)
    def clock(seconds=0):
        nonlocal elapsed
        assert seconds in (0,1)
        page.evaluate('window.__ecAdvance('+str(seconds*1000)+')');elapsed+=seconds
    def observe(label):
        mark=len(cap['trace'].events);page.evaluate('globalThis.__solarObserve=true');clock()
        matches=[r for r in cap['trace'].events[mark:] if r['kind']=='frame-end' and r.get('observationRequested')]
        check('one exact original-frame full-state observation: '+label,len(matches)==1 and matches[0]['state'] is not None)
        return matches[0]
    def tab(name):
        page.locator('[data-tab="'+name+'"]').click();clock()
    def document():
        witness=page.evaluate('window.__ecWitness')
        check('native document primitives remain genuine',witness['nativeStorage'] and witness['nativeFile'] and witness['nativeConfirm'])
        check('document witness is unique',witness['documentId'] not in documents_seen)
        documents_seen.add(witness['documentId']);report['documents'].append(dump('native-document.json',canonical(witness)))
    def seal_scripts():
        scripts=cap['executed'];check('native document executes source scripts',bool(scripts))
        for event in scripts:
            url=event['url'];name=unquote(urlparse(url).path).removeprefix(unquote(parsed.path))
            if not name.endswith('.js'):continue
            responses=[r for r in cap['responses'] if r.url==url]
            check('one fresh native HTTP200 source response',len(responses)==1 and responses[0].status==200)
            response=responses[0];body=response.body();code=cap['cdp'].send('Debugger.getScriptSource',{'scriptId':event['scriptId']})['scriptSource'].encode()
            check('native V8 full source equals HTTP release and common identity',code==body and sha(body)==release['files'][name]==identity['assets'][name])
            report['executedSources'].append({'file':name,'scriptId':event['scriptId'],'executionContextId':event['executionContextId'],
                'httpOriginal':dump('executed-http.js',body),'v8Original':dump('executed-v8.js',code),
                'response':dump('executed-http-response.json',canonical(BASE.http_response_evidence(response)))})
        main=next(r for r in cap['responses'] if r.url==trace_plan.url);cap['trace'].verify_executed(main.body())
    def reload():
        document();cap['responses'].clear();cap['executed'].clear()
        response=page.reload(wait_until='networkidle');check('native checkpoint reload HTTP200',response is not None and response.status==200)
        seal_scripts();clock()
    try:
        archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as zipper:
            for name,digest in sorted(identity['source']['sourceCode'].items()):
                assert not Path(name).is_absolute() and '..' not in Path(name).parts
                value=original(ROOT/name);check('exact source original: '+name,sha(value)==digest)
                info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.external_attr=int(identity['source']['sourceModes'][name],8)<<16
                zipper.writestr(info,value,compress_type=zipfile.ZIP_DEFLATED)
        report['fullSourceZip']=dump('full-source-originals.zip',archive.getvalue())
        with sync_playwright() as playwright:
            try:
                browser=playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox',args.owner_marker])
                report['browserVersion']=browser.version;request=playwright.request.new_context()
                response=request.get(urljoin(args.url,'release.json'),timeout=10000);release_raw=response.body();release=json.loads(release_raw)
                report['release']=dump('http-release-original.json',release_raw)
                check('exact release source version and 62-asset identity',response.status==200 and release['sourceSha']==args.expected_sha and release['version']==args.expected_version and release['saveVersion']==9 and release['saveRevision']==16 and len(release['files'])==62 and sha(release_raw)==identity['releaseSha256'])
                plans=[]
                for name,digest in sorted(release['files'].items()):
                    response=request.get(urljoin(args.url,name),timeout=10000);body=response.body()
                    check('exact native HTTP asset bytes',response.status==200 and response.url==urljoin(args.url,name) and sha(body)==digest==identity['assets'][name])
                    report['assets'].append({'file':name,'original':dump('http-'+name.replace('/','_'),body)})
                    if name.endswith('.js') and BASE.production_action_handlers(body.decode()):plans.append(S.prepare_trace(urljoin(args.url,name),body,digest))
                check('one exact source-derived solar observation plan',len(plans)==1);trace_plan=plans[0];request.dispose()
                report['browserReference'],plan,expected,reference_runtime=R.execute_reference(browser,build,initial,plan,dump,report['contextChronology'])
                report['preparationElapsedSeconds']=time.monotonic()-preparation_start
                check('bounded independent reference prep sealed and closed before native UI',report['preparationElapsedSeconds']<R.PREPARATION_BUDGET)
                signal.setitimer(signal.ITIMER_REAL,0)
                start=time.monotonic();native_started=True;report['_started']=start;report['nativeStartedMonotonic']=start
                signal.setitimer(signal.ITIMER_REAL,S.BUDGET)
                report['nativeBrowserRuntime']=R.runtime_identity(browser)
                R.validate_runtime(reference_runtime,report['nativeBrowserRuntime'],browser.version)
                context=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block',storage_state={
                    'cookies':[],'origins':[{'origin':origin,'localStorage':[{'name':KEY,'value':initial.decode()}]}]})
                context.add_init_script(CLOCK.replace('__ORIGIN__',json.dumps(origin)).replace('__EPOCH__',str(S.EPOCH)).replace('__STARTUP__',''))
                page=context.new_page();report['nativeContext']=R.context_identity(context,page)
                R.chronology_append(report['contextChronology'],'native-context-created',context=report['nativeContext'],browserContextIds=R.browser_contexts(browser))
                page.set_default_timeout(7000);page.set_default_navigation_timeout(10000)
                cap={'cdp':context.new_cdp_session(page),'executed':[],'responses':[]}
                cap['cdp'].send('Network.enable');cap['cdp'].send('Network.setCacheDisabled',{'cacheDisabled':True})
                cap['trace']=NativeFrameTrace(cap['cdp'],trace_plan);cap['trace'].install()
                cap['cdp'].on('Debugger.scriptParsed',lambda event:cap['executed'].append(event) if event.get('url','').startswith(args.url) else None)
                page.on('response',lambda response:cap['responses'].append(response) if urlparse(response.url).path.endswith('.js') else None)
                page.on('pageerror',lambda error:report['errors'].append(str(error)))
                cap['cdp'].send('DOMStorage.enable')
                def store_event(kind,row):
                    if row.get('storageId',{}).get('isLocalStorage') and row['storageId'].get('securityOrigin')==origin:
                        storage_events.append({'kind':kind,**deepcopy(row)})
                for method,kind in [('domStorageItemAdded','added'),('domStorageItemUpdated','updated'),('domStorageItemRemoved','removed'),('domStorageItemsCleared','cleared')]:
                    cap['cdp'].on('DOMStorage.'+method,lambda row,kind=kind:store_event(kind,row))
                R.chronology_append(report['contextChronology'],'native-navigation-start',context=report['nativeContext'])
                response=page.goto(args.url,wait_until='networkidle');check('initial native application HTTP200',response is not None and response.status==200);seal_scripts()
                check('first source read is exact pristine fixed-seed original',cap['trace'].events[0]['kind']=='source-read' and cap['trace'].events[0]['raw'].encode()==initial)
                for event,expect in zip(plan,expected):
                    current_index=event['index'];kind=event['api'];req=event['request'];record={'index':current_index,'api':kind,'traceStart':len(cap['trace'].events)}
                    if kind=='createInitialState':observed=observe('initial')
                    elif kind=='tick':
                        mark=len(cap['trace'].events);clock(1)
                        positive=[r for r in cap['trace'].events[mark:] if r['kind']=='frame' and r['gapSeconds']>0]
                        check('one original one-second production frame',len(positive)==1 and positive[0]['gapSeconds']==1)
                        ends=[r for r in cap['trace'].events[mark:] if r['kind']=='frame-end' and r.get('state') is not None]
                        check('one full original positive-frame state',len(ends)==1);observed=ends[0]
                    elif kind in ('enqueue','enqueueResearch'):
                        tab('facilities' if kind=='enqueue' else 'research')
                        selector='[data-action="'+('enqueue' if kind=='enqueue' else 'research')+'"][data-id="'+req['target']+'"]'
                        button=page.locator(selector);check('frozen paid action naturally affordable and enabled',button.is_enabled())
                        button.click();observed=observe('paid-'+str(current_index))
                    elif kind=='challengeCandidate':
                        before=observe('before-'+req['action']);tab('curvature')
                        button=page.locator('#energy-challenge-'+req['action']);check('ordinary challenge gate is actually enabled',button.is_enabled());button.click();clock()
                        confirm=page.locator('#energy-challenge-confirm');check('current review has enabled native confirm',confirm.is_enabled());dialogs=[]
                        def answer(dialog):
                            valid=dialog.type=='confirm' and '能源紧缩' in dialog.message
                            dialogs.append({'type':dialog.type,'message':dialog.message,'accepted':valid})
                            dialog.accept() if valid else dialog.dismiss()
                        page.once('dialog',answer);record['traceStart']=len(cap['trace'].events);confirm.click();observed=observe('after-'+req['action'])
                        check('one native challenge confirmation',len(dialogs)==1 and dialogs[0]['accepted']);record['dialog']=dialogs[0]
                        record['beforeSequence']=before['sequence'];record['persisted']=dump('challenge-durable-primary.json',raw())
                    elif kind=='checkpoint':
                        tab('save');page.locator('[data-action="save"]').click();clock()
                        persisted=raw();check('native manual save exactly matches independent checkpoint original',persisted==expect['raw'])
                        record['persisted']=dump('checkpoint-native-primary.json',persisted)
                        reload();check('native reload preserved checkpoint original bytes',raw()==persisted);observed=observe('checkpoint-'+req['name'])
                    elif kind=='reject':
                        if req['api']=='enqueue':tab('facilities');button=page.locator('[data-action="enqueue"][data-id="'+req['building']+'"]')
                        elif req['api']=='enqueueResearch':tab('research');button=page.locator('[data-action="research"][data-id="'+req['tech']+'"]')
                        else:tab('curvature');button=page.locator('#energy-challenge-'+('enter' if req['api']=='enterEnergyChallenge' else 'finish'))
                        check('duplicate/fourth ordinary admission unavailable to trusted UI',button.count()==0 or not button.is_visible() or button.is_disabled())
                        observed=observe('refusal-'+str(current_index))
                    else:raise AssertionError('Unsupported frozen event '+kind)
                    target=expect.get('candidate',expect['state'])
                    check('complete native state equals independent full expected event '+str(current_index),S.same_state(observed['state'],target),
                          {'index':current_index,'api':kind,'observationSequence':observed['sequence']})
                    check('native SaveSession remains ready',observed['mode']=='ready')
                    record.update(observationSequence=observed['sequence'],traceEnd=len(cap['trace'].events))
                    records_handle.write(json.dumps(record,separators=(',',':'))+'\n');records_handle.flush()
                check('fixed complete uninterrupted event census',current_index==4383 and elapsed==4201)
                tab('save');page.locator('[data-action="export"]').click();clock()
                exported=page.locator('[data-bind="transfer"]').input_value();check('native export is full final state',S.same_state(json.loads(exported)['state'],expected[-1]['state']))
                report['export']=dump('final-native-export.json',exported)
                terminal=observe('terminal');snapshot=cap['trace'].snapshot();snapshot['events']=snapshot['events'][:terminal['sequence']+1]
                final=raw();report['finalPrimary']=dump('final-native-primary.json',final)
                deadline=min(time.monotonic()+7,start+S.BUDGET-5)
                needed=sum(e['kind']=='save-result' and e['candidateRaw']!=next((p['expectedRaw'] for p in reversed(snapshot['events'][:e['sequence']]) if p['kind']=='save-input'),None) for e in snapshot['events'])
                while sum(e.get('key')==KEY for e in storage_events)<needed and time.monotonic()<deadline:page.wait_for_timeout(10)
                completed_records=[S.decode(line) for line in original(records_path).splitlines()]
                S.validate_timing(snapshot['events'],completed_records)
                S.validate_storage(snapshot['events'],storage_events,initial.decode(),args.url,S.navigation_schedule(plan),completed_records)
                report['trace']=dump('complete-native-trace.json',canonical(snapshot));report['storageEvents']=dump('native-storage-events.json',canonical(storage_events))
                report['finalStorage']=dump('final-complete-native-storage.json',canonical(page.evaluate('Object.fromEntries(Object.entries(localStorage))')))
                document();check('all 23 native document lifecycles retained',len(report['documents'])==23)
                check('no original trace or application errors',not cap['trace'].failures and report['errors']==[])
                report['completed']=True;context.close();page=None;browser.close()
            except BaseException as error:
                report['failure']={'error':repr(error),'traceback':traceback.format_exc(),'eventIndex':current_index,'captureStatus':'inside-live-playwright'}
                if page is not None:
                    for name,operation in [('dom',lambda:page.content()),('primary',raw),('trace',lambda:canonical(cap['trace'].snapshot())),('storage-events',lambda:canonical(storage_events)),('screenshot',lambda:page.screenshot(full_page=True))]:
                        try:report['failure'][name]=dump('failure-'+name+('.png' if name=='screenshot' else '.html' if name=='dom' else '.json'),operation())
                        except BaseException as caught:report['failure'].setdefault('captureErrors',{})[name]=repr(caught)
                raise
    except BaseException as error:
        report.setdefault('failure',{'error':repr(error),'traceback':traceback.format_exc(),'eventIndex':current_index,'captureStatus':'outside-live-playwright'})
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)
        records_handle.close();report['records']=reference(records_path,out);evidence.journal.close()
        report.pop('_started');report['workerElapsedSeconds']=time.monotonic()-preparation_start
        report['hostElapsedSeconds']=time.monotonic()-start if native_started else 0
        report.setdefault('preparationElapsedSeconds',report['workerElapsedSeconds'])
        if report['preparationElapsedSeconds']>=R.PREPARATION_BUDGET:
            report['completed']=False
            report.setdefault('failure',{'error':'Explicit 60-second preparation budget expired','eventIndex':current_index})
        if report['hostElapsedSeconds']>=S.BUDGET:
            report['completed']=False
            report.setdefault('failure',{'error':'Fixed 600-second worker budget expired','eventIndex':current_index})
        exclusive_json(out/'report.json',report)
    return 0 if report['completed'] else 1


def supervise(args):
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()): raise ValueError('Native output must be a fresh empty directory')
    run_id = uuid.uuid4().hex; marker = '--energy-challenge-owner=' + run_id
    owned, signals = {}, []
    def collect(root):
        pending = [root, *owned]
        for entry in Path('/proc').iterdir():
            if entry.name.isdigit():
                try:
                    if marker.encode() in (entry / 'cmdline').read_bytes().split(b'\0'): pending.append(int(entry.name))
                except OSError: pass
        seen = set()
        while pending:
            pid = pending.pop()
            if pid in seen: continue
            seen.add(pid); current = process_identity(pid)
            if not current or (pid in owned and current['start'] != owned[pid]['start']): continue
            owned[pid] = current
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try: pending.extend(map(int, children.read_text().split()))
                except OSError: pass
    def terminate(signum):
        for pid, observed in reversed(list(owned.items())):
            current = process_identity(pid)
            if current and current['start'] == observed['start'] and current['state'] != 'Z':
                try:
                    os.kill(pid, signum); signals.append({'pid':pid,'start':current['start'],'signal':signum})
                except ProcessLookupError: pass
    def interrupted(signum, _frame): raise KeyboardInterrupt(f'Signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    expired, error, code = False, None, 1
    with (out / 'worker.log').open('x') as log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:],
            '--worker', '--run-id='+run_id, '--owner-marker='+marker], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        # The two bounded termination waits below consume the final four seconds.
        deadline=time.monotonic()+BUDGETS[args.lane]+R.PREPARATION_BUDGET+20-4
        try:
            while child.poll() is None:
                collect(child.pid)
                if time.monotonic() >= deadline: expired=True; break
                time.sleep(.2)
            code=child.poll() if child.poll() is not None else 1
        except BaseException as caught: error=repr(caught)
        finally:
            collect(child.pid); terminate(signal.SIGTERM)
            try: child.wait(timeout=2)
            except subprocess.TimeoutExpired: pass
            collect(child.pid); terminate(signal.SIGKILL); child.wait(timeout=2)
    survivors=[process_identity(pid) for pid,known in owned.items() if process_identity(pid)
               and process_identity(pid)['start']==known['start'] and process_identity(pid)['state']!='Z']
    exclusive_json(out/'supervisor.json',{'runId':run_id,'budgetSeconds':BUDGETS[args.lane]+R.PREPARATION_BUDGET+20,
        'preparationBudgetSeconds':R.PREPARATION_BUDGET,'nativeBudgetSeconds':BUDGETS[args.lane],'cleanupBudgetSeconds':20,'expired':expired,
        'error':error,'workerExitCode':code,'ownedProcesses':list(owned.values()),'signals':signals,'survivors':survivors})
    files=[]
    for path in sorted(out.rglob('*')):
        if path.is_file(): files.append(reference(path,out))
        assert not path.is_symlink(), path
    exclusive_json(out/'seal.json',{'schema':'infinity-energy-challenge-artifact-seal-v1','runId':run_id,'files':files})
    print(json.dumps({'lane':args.lane,'completed':code==0 and not expired and not error and not survivors,'output':str(out)}))
    return 0 if code==0 and not expired and not error and not survivors else 1

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('url','expected-sha','expected-version','runtime-node','common-identity','natural','oracle','browser-reference','output'):p.add_argument('--'+key,required=True)
    p.add_argument('--node',default='node');p.add_argument('--chromium');p.add_argument('--worker',action='store_true');p.add_argument('--run-id');p.add_argument('--owner-marker')
    args=p.parse_args();args.lane='solar'
    return worker(args) if args.worker else supervise(args)

if __name__=="__main__":raise SystemExit(main())
