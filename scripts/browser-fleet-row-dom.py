#!/usr/bin/env python3
"""Independent, bounded real-DOM semantics for exact 535 versus original 7ab.

These are deliberate DOM-tampering diagnostics, not ordinary player actions or
performance evidence. Only the real, HTTP/V8-bound app's queued RAF renders.
Run browser/build/strict-reader modes in the authorized native CI environment.
"""
import argparse
import importlib.util
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import time
from urllib.parse import urljoin, urlparse


def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


P=module('fleet_row_original_evidence','browser-fleet-row-performance.py')
C=module('fleet_row_original_contract','check-fleet-row-experiment.py')
TARGET='5359676473c3b55e09acce33487ffd5f3ce8925a'
BODY_SECONDS,CLEANUP_SECONDS,OUTER_SECONDS=120,5,150
ADDITIONS={'.github/workflows/fleet-row-dom.yml','scripts/browser-fleet-row-dom.py',
           'scripts/test_fleet_row_dom.py','docs/FLEET_ROW_DOM_DIAGNOSTIC.md'}
SCENARIOS=('ordinary','nested-duplicate','raw-id-root','removed-duplicate',
           'removed-last-match','missing-child','remount-old-handles','hidden-list')
SECOND_PHASE={'nested-duplicate','raw-id-root','remount-old-handles','hidden-list'}
require,digest,exact=P.require,P.digest,P.strict_equal

# No helper/renderer copies, new Function, script injection, business API calls,
# synthetic events or prototype replacement. This releases the real app frame.
FRAME=r'''at => {
 window.__fleetRowClock.advance(at);
 try {return {at,callbacks:window.__fleetRowClock.frame(),error:null};}
 catch(error) {return {at,callbacks:null,error:{name:error.name,message:error.message,stack:error.stack}};}
}'''
MUTATE=r'''scenario => {
 const list=document.querySelector('#space-fleets'), rows=[...list.querySelectorAll('[data-flight]')];
 if(rows.length!==1000) throw Error('Wrong real fleet population');
 const [first,second,third]=rows, refs={list,first,second,third}, ids=rows.slice(0,3).map(e=>e.getAttribute('data-flight'));
 const poison=(row,label)=>{for(const name of ['title','route','time','detail'])row.querySelector('.flight-'+name).textContent='DOM-DIAGNOSTIC:'+label+':'+name;row.querySelector('.flight-progress').style.width='0.123%';};
 window.__fleetRowDom={refs,ids,scenario,poison};
 if(scenario==='ordinary') return {scenario,ids};
 poison(first,'first');poison(second,'second');poison(third,'third');
 if(scenario==='nested-duplicate') {
   const duplicate=document.createElement('article');duplicate.setAttribute('data-flight',ids[0]);
   for(const child of first.childNodes)duplicate.append(child.cloneNode(true));poison(duplicate,'duplicate');
   const wrapper=document.createElement('section');wrapper.append(duplicate);list.prepend(wrapper);
   Object.assign(refs,{duplicate,wrapper});
 } else if(scenario==='raw-id-root') {
   list.setAttribute('data-flight',ids[0]);
   const leading=first.cloneNode(true),decimal=first.cloneNode(true);
   leading.setAttribute('data-flight','0'+ids[0]);decimal.setAttribute('data-flight',ids[0]+'.0');
   poison(leading,'leading');poison(decimal,'decimal');list.prepend(leading,decimal);
   Object.assign(refs,{leading,decimal});
 } else if(scenario==='removed-duplicate') {
   const duplicate=second.cloneNode(true);poison(duplicate,'duplicate');
   first.querySelector('.flight-title').append(duplicate);refs.duplicate=duplicate;
 } else if(scenario==='removed-last-match') {
   first.querySelector('.flight-title').append(second);
 } else if(scenario==='missing-child') {
   refs.missing=second.querySelector('.flight-progress');refs.missing.remove();
 } else if(scenario==='remount-old-handles') {
   const replacement=list.cloneNode(true);list.replaceWith(replacement);
   refs.replacement=replacement;refs.newFirst=replacement.querySelector('[data-flight]');
   refs.oldButton=first.querySelector('button');
 } else if(scenario==='hidden-list') {
   list.hidden=true;
 } else throw Error('Unknown DOM scenario');
 return {scenario,ids};
}'''
SECOND_MUTATION=r'''() => {
 const d=window.__fleetRowDom,r=d.refs;
 if(d.scenario==='nested-duplicate') {
   d.poison(r.first,'reordered-first');d.poison(r.duplicate,'reordered-duplicate');r.list.append(r.wrapper);
 } else if(d.scenario==='raw-id-root') {
   r.first.remove();
 } else if(d.scenario==='remount-old-handles') {
   const replacement=r.newFirst.cloneNode(true);d.poison(replacement,'replacement-row');
   r.newFirst.replaceWith(replacement);r.newestFirst=replacement;
 } else if(d.scenario==='hidden-list') {
   r.list.hidden=false;d.poison(r.first,'visible-again');
 } else throw Error('No second mutation for this scenario');
 return {scenario:d.scenario,ids:d.ids};
}'''
HANDLES=r'''() => {
 const d=window.__fleetRowDom;if(!d)return null;
 const fields=root=>[root,...root.querySelectorAll('input,select,textarea,button,details')].map(e=>({
   tag:e.tagName,value:e.value??null,checked:e.checked??null,disabled:e.disabled??null,
   open:e.open??null,selectionStart:e.selectionStart??null,selectionEnd:e.selectionEnd??null,
   selected:e instanceof HTMLSelectElement?[...e.options].map(o=>o.selected):null}));
 return {scenario:d.scenario,ids:d.ids,refs:Object.fromEntries(Object.entries(d.refs).map(([name,e])=>[name,{
   html:e.outerHTML,connected:e.isConnected,inCurrentList:document.querySelector('#space-fleets')?.contains(e)??false,
   active:document.activeElement===e,hidden:e.hidden??null,fields:fields(e),
   title:e.querySelector('.flight-title')?.textContent??null,progress:e.querySelector('.flight-progress')?.style.width??null
 }]))};
}'''


def steps(scenario):
    return ['ready','tampered','painted']+(['retampered','repainted'] if scenario in SECOND_PHASE else [])+['manual-save']


def error_expected(scenario,phase,ids):
    if scenario=='removed-last-match': return {'name':'Error','message':f'缺少界面节点 [data-flight="{ids[1]}"]'}
    if scenario=='missing-child': return {'name':'Error','message':'缺少界面节点 .flight-progress'}
    if scenario=='raw-id-root' and phase=='repainted': return {'name':'Error','message':f'缺少界面节点 [data-flight="{ids[0]}"]'}
    return None


def semantic_frame(raw):
    # Stack/source locations necessarily differ between distinct minified bundles.
    # Preserve them unmodified in frame-*.json; only Error name/message are semantic.
    return {**raw,'error':None if raw['error'] is None else {k:raw['error'][k] for k in ('name','message')}}


def qualify_snapshot(value,key):
    require(value['focused'] is True and all(e['trusted'] is True for e in value['events']),'Unfocused/untrusted ordinary input')
    require(exact(value['viewport'],{'width':1440,'height':1100,'deviceScaleFactor':1}) and value['reducedMotion'] is True,'Actual browser configuration differs')
    require(isinstance(value['raw'],str) and value['storage'].get(key)==value['raw'],'Missing/inconsistent whole native save')
    require(value['pageErrors']==[] and value['requestFailures']==[],'Unexpected native browser/request error')


def qualify_paint(scenario,phase,before,after,frame):
    ids=after['handles']['ids'];expected=error_expected(scenario,phase,ids)
    require(exact(frame['error'],expected),'Unexpected production RAF exception')
    require(frame['callbacks'] is None if expected else type(frame['callbacks']) is int and frame['callbacks']>=1,'Production RAF callback did not execute')
    a=after['handles']['refs'];b=before['handles']['refs']
    updated=lambda name:require(not a[name]['title'].startswith('DOM-DIAGNOSTIC:'),'Production fleet title was not painted: '+name)
    unchanged=lambda name:require(exact(a[name],b[name]),'Unexpected stale/non-first handle mutation: '+name)
    if scenario=='ordinary':
        require(a['first']['html']!=b['first']['html'],'Ordinary countdown/progress did not change')
    elif scenario=='nested-duplicate':
        updated('duplicate' if phase=='painted' else 'first');unchanged('first' if phase=='painted' else 'duplicate')
    elif scenario=='raw-id-root':
        unchanged('leading');unchanged('decimal')
        if phase=='painted':updated('first')
        else:unchanged('first')
    elif scenario=='removed-duplicate':
        updated('first');updated('second')
        require(a['duplicate']['connected'] is False and a['duplicate']['title']==b['duplicate']['title'],'Removed first duplicate was written after detachment')
    elif scenario=='removed-last-match':
        updated('first');require(a['second']['connected'] is False and a['second']['title']==b['second']['title'],'Removed last match mutated')
        unchanged('third')
    elif scenario=='missing-child':
        updated('first');updated('second');unchanged('third');unchanged('missing')
        require(a['second']['progress'] is None,'Missing child silently repaired')
    elif scenario=='remount-old-handles':
        unchanged('list');unchanged('first');unchanged('oldButton');updated('newFirst' if phase=='painted' else 'newestFirst')
        require(a['list']['connected'] is False and a['replacement']['connected'] is True,'List was not really remounted')
        if phase=='repainted':unchanged('newFirst')
    elif scenario=='hidden-list':
        updated('first');require(a['list']['hidden'] is (phase=='painted'),'Hidden list boundary not exercised')


def click(page,selector):
    # Trusted CDP mouse, without Playwright's RAF-dependent actionability wait.
    hit=page.locator(selector).evaluate('e=>{e.scrollIntoView({block:"center",behavior:"instant"});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,ok:!e.disabled&&(h===e||e.contains(h))};}')
    require(hit['ok'],'Trusted click target unavailable: '+selector);page.mouse.click(hit['x'],hit['y'])


def run_case(browser,scenario,work,variant,output,deadline):
    directory=output/(scenario+'-'+variant['side']);directory.mkdir()
    row={'scenario':scenario,'side':variant['side'],'case':directory.name,'valid':False,'cleanupComplete':False,'snapshots':{},'frames':{}}
    context=page=None;errors=[];failures=[];parsed=[];responses=[]
    try:
        context=browser.new_context(viewport={'width':1440,'height':1100},device_scale_factor=1,reduced_motion='reduce',service_workers='block')
        context.add_init_script(P.CONTROLLED_SOURCE)
        page=context.new_page();page.set_default_timeout(8000);page.set_default_navigation_timeout(10000)
        page.on('pageerror',lambda e:errors.append({'name':e.name,'message':e.message,'stack':e.stack}))
        page.on('requestfailed',lambda r:failures.append({'url':r.url,'failure':r.failure}))
        page.on('response',lambda r:responses.append(r) if r.request.resource_type=='script' else None)
        cdp=context.new_cdp_session(page);cdp.on('Debugger.scriptParsed',lambda e:parsed.append(e));cdp.send('Debugger.enable')
        response=page.goto(urljoin(variant['url'],'release.json'),wait_until='load')
        require(response and response.status==200 and response.body()==variant['release']['raw'],'Seed origin mismatch')
        seeded=page.evaluate(P.SEED,{'key':work['key'],'raw':work['raw']});P.qualify_seed(seeded,work)
        P.exclusive_bytes(directory/'seeded-current.json',seeded['raw'].encode());parsed.clear();responses.clear()
        response=page.goto(variant['url'],wait_until='domcontentloaded')
        require(response and response.status==200 and digest(response.body())==variant['release']['manifest']['files']['index.html'],'App HTML mismatch')
        page.locator('[data-bind="energy-chip"]').wait_for();page.wait_for_load_state('networkidle');page.bring_to_front()
        row['productionScripts']=P.verify_scripts(cdp,parsed,responses,variant,directory)
        P.exclusive_json(directory/'initial-script-inventory.json',parsed);cdp.send('Debugger.disable')
        def frame(label,at):
            value=page.evaluate(FRAME,at);P.exclusive_json(directory/('frame-'+label+'.json'),value)
            result=semantic_frame(value);row['frames'][label]=result;return result
        def snap(label):
            value=page.evaluate(P.DOM_SNAPSHOT,work['key']);value.update(handles=page.evaluate(HANDLES),pageErrors=list(errors),requestFailures=list(failures),frames=dict(row['frames']))
            path=directory/(label+'.json');P.exclusive_json(path,value)
            row['snapshots'][label]={'file':str(path.relative_to(output)),'sha256':digest(path.read_bytes())}
            qualify_snapshot(value,work['key']);return value
        require(frame('initial',0)['error'] is None,'Initial app RAF failed')
        for tab in ('overview','orders','fleet'):
            click(page,'[data-tab="'+tab+'"]');require(frame('tab-'+tab,0)['error'] is None,'Navigation RAF failed')
        click(page,'#flight-galaxy');page.keyboard.press('ControlOrMeta+A');page.keyboard.type('4')
        require(frame('draft',0)['error'] is None,'Focused draft RAF failed');snap('ready')
        mutation=page.evaluate(MUTATE,scenario);P.exclusive_json(directory/'mutation.json',mutation)
        before=snap('tampered');paint=frame('painted',250);after=snap('painted')
        qualify_paint(scenario,'painted',before,after,paint)
        require(page.locator('#flight-galaxy').evaluate('e=>document.activeElement===e&&e.value==="4"'),'Focused native draft was lost')
        if scenario in SECOND_PHASE:
            P.exclusive_json(directory/'second-mutation.json',page.evaluate(SECOND_MUTATION))
            before=snap('retampered');paint=frame('repainted',500);after=snap('repainted')
            qualify_paint(scenario,'repainted',before,after,paint)
        # The poisoned frame may have thrown before requeueing RAF. Save still
        # uses the real tab and native Save handler; no manual frame rearming.
        click(page,'[data-tab="save"]');click(page,'[data-action="save"]')
        saved=snap('manual-save');raw=json.loads(saved['raw'])
        require(raw['savedAt']==raw['lastTickAt']==1792000000000+saved['at'],'Native Save did not persist the accounted full state')
        require(raw['version']==9 and raw['revision']==14 and len(raw['state']['fleets'])==1000 and len(raw['state']['planets'])==100,'Full fixture economy changed populations')
        require(saved['raw']!=seeded['raw'],'Native Save did not advance the whole envelope')
        require(any(e['type']=='click' and e['target']=='save' for e in saved['events']),'Native Save click missing')
        require(len(responses)==len(variant['release']['scripts']),'Additional script loaded after binding')
        require(list(row['snapshots'])==steps(scenario),'Incomplete checkpoint sequence');row['valid']=True
    except BaseException as error:
        row['error']={'type':type(error).__name__,'message':str(error)[:2400]}
        # Even unexpected failures preserve the original visible and detached DOM
        # before context teardown. No acceptance assertion precedes this archive.
        if page is not None:
            try:
                signal.setitimer(signal.ITIMER_REAL,CLEANUP_SECONDS)
                value=page.evaluate(P.DOM_SNAPSHOT,work['key']);value['handles']=page.evaluate(HANDLES)
                P.exclusive_json(directory/'failure-dom.json',value)
            except BaseException as capture:row['failureCaptureError']={'type':type(capture).__name__,'message':str(capture)}
    finally:
        P.exclusive_json(directory/'page-errors.json',errors);P.exclusive_json(directory/'request-failures.json',failures)
        P.bounded_close(context,row,directory,deadline)
    return row


def compare_runs(report,output):
    planned=[(s,side) for s in SCENARIOS for side in ('baseline','candidate')]
    require([(r['scenario'],r['side']) for r in report['runs']]==planned,'Incomplete/reordered real-DOM schedule')
    result={}
    for scenario in SCENARIOS:
        a,b=[r for r in report['runs'] if r['scenario']==scenario]
        require(all(r['valid'] is True and r['cleanupComplete'] is True and list(r['snapshots'])==steps(scenario) for r in (a,b)),'Invalid/incomplete real-DOM context: '+scenario)
        checks={}
        for step in steps(scenario):
            values=[]
            for row in (a,b):
                record=row['snapshots'][step];require(record['file']==row['case']+'/'+step+'.json','Unexpected checkpoint path')
                path=output/record['file'];require(not path.is_symlink() and path.resolve().is_relative_to(output.resolve()),'Unsafe checkpoint path')
                raw=path.read_bytes();require(digest(raw)==record['sha256'],'Changed checkpoint bytes');values.append(json.loads(raw))
            checks[step]=exact(*values)
        result[scenario]={'checkpoints':checks,'equal':all(checks.values())}
    report['comparison']=result
    require(all(c['equal'] for c in result.values()),'Real-DOM semantic mismatch; inspect complete original snapshots before any production change')
    return result


def body(args):
    output=args.output;deadline=time.monotonic()+BODY_SECONDS
    report={'completed':False,'observationsComplete':False,'mode':'real-dom-boundaries','baselineSourceSha':P.BASELINE_SHA,'candidateSourceSha':TARGET,
            'driverSourceSha':args.driver_sha,'runs':[],'errors':[],'globalCleanupComplete':False,
            'settings':{'bodySeconds':BODY_SECONDS,'outerSeconds':OUTER_SECONDS,'playwright':'1.57.0'},
            'scope':'Controlled-clock DOM tampering; full body DOM, forms, focus, detached handles, error name/message and every native storage byte. Independent diagnostic, not release or timing evidence.',
            'limitations':['Error stacks retain differing production bundle URLs/offsets in raw frame files; semantic comparisons retain exact names/messages.',
                           'Document head assets are independently byte-bound to each release; body comparisons use no normalization.',
                           'No reentrant custom-element mutation or malicious business-API calls. Eight fixed finite scenarios do not prove arbitrary DOM equivalence.']}
    persist=lambda:P.persist_json(output/'report.json',report)
    def expire(signum,frame):raise TimeoutError('Real-DOM body/cleanup deadline exceeded')
    signal.signal(signal.SIGALRM,expire);signal.alarm(BODY_SECONDS);playwright=browser=request=None;persist()
    try:
        require(importlib.metadata.version('playwright')=='1.57.0','Wrong Playwright version')
        chrome=args.chromium or shutil.which('google-chrome') or shutil.which('google-chrome-stable');require(chrome and Path(chrome).is_file(),'Official Chrome missing')
        variants={side:{'side':side,'dist':getattr(args,side+'_dist'),'url':getattr(args,side+'_url'),
                       'release':P.release_identity(getattr(args,side+'_dist'),P.BASELINE_SHA if side=='baseline' else TARGET,side=='baseline')} for side in ('baseline','candidate')}
        P.qualify_release_pair(variants['baseline']['release'],variants['candidate']['release']);work=P.workload(args.combined_fixture,'combined',output)
        report['fixture']={k:v for k,v in work.items() if k not in ('ready','raw')}
        from playwright.sync_api import sync_playwright
        playwright=sync_playwright().start();request=playwright.request.new_context()
        for side,variant in variants.items():
            directory=output/(side+'-release');directory.mkdir();P.verify_http(request,variant,directory)
        request.dispose();request=None
        browser=playwright.chromium.launch(executable_path=chrome,headless=True,timeout=15000,args=['--no-sandbox'])
        report['environment']={'browser':browser.version,'python':platform.python_version(),'platform':platform.platform(),'executable':chrome,'headless':True}
        P.exclusive_bytes(output/'controlled-clock-source.js',P.CONTROLLED_SOURCE.encode())
        for scenario in SCENARIOS:
            for variant in variants.values():
                require(time.monotonic()<deadline,'Body deadline exhausted')
                report['runs'].append(run_case(browser,scenario,work,variant,output,deadline));persist()
        compare_runs(report,output);report['observationsComplete']=True
    except BaseException as error:report['errors'].append({'type':type(error).__name__,'message':str(error)[:2400]})
    finally:
        clean=True
        for name,closer in [('request',request.dispose if request else None),('browser',browser.close if browser else None),('playwright',playwright.stop if playwright else None)]:
            if closer:
                signal.alarm(CLEANUP_SECONDS)
                try:closer()
                except BaseException as error:clean=False;report['errors'].append({'phase':'cleanup-'+name,'type':type(error).__name__,'message':str(error)[:1000]})
        signal.alarm(0);report['globalCleanupComplete']=clean
        report['completed']=bool(report['observationsComplete'] and clean and not report['errors']);persist()
    return 0 if report['completed'] else 1


def supervise(args):
    """Reuse unchanged ownership/watchdog implementation with explicit parameters.

    It launches __file__ with current argv plus --worker. Rebinding only that
    module's supervisor configuration does not run/modify its old evidence modes.
    """
    previous=(P.__file__,P.EQUIVALENCE_OUTER_SECONDS)
    try:
        P.__file__=__file__;P.EQUIVALENCE_OUTER_SECONDS=OUTER_SECONDS
        args.equivalence_only=True
        return P.supervise(args)
    finally:P.__file__,P.EQUIVALENCE_OUTER_SECONDS=previous


def source(args):
    result={'completed':False,'driverSourceSha':args.driver_sha,'targetSourceSha':TARGET}
    try:
        require(C.git(args.driver,'rev-parse','HEAD').decode().strip()==args.driver_sha,'Wrong driver HEAD')
        require(C.git(args.target,'rev-parse','HEAD').decode().strip()==TARGET,'Wrong exact target HEAD')
        before=C.tree(args.target,TARGET);after=C.tree(args.driver,args.driver_sha)
        require(set(after)-set(before)==ADDITIONS and not(set(before)-set(after)),'Driver additions differ')
        require(all(after[p]==entry for p,entry in before.items()),'Existing 535 file changed in driver')
        require(not list(args.driver.glob('.env*')),'Unexpected driver environment file')
        result['allDriverFiles']=C.verify_files(args.driver,after)
        result['allTargetFiles']=C.verify_files(args.target,before);result['completed']=True
    finally:P.exclusive_json(args.output/'driver-source-check.json',result)


def saves(args):
    result={'completed':False,'checks':[]}
    try:
        report=json.loads((args.output/'report.json').read_bytes());watch=json.loads((args.output/'watchdog.json').read_bytes())
        require(report['completed'] is True and report['observationsComplete'] is True and report['globalCleanupComplete'] is True and report['errors']==[],'Incomplete browser report')
        require(report['driverSourceSha']==args.driver_sha and report['candidateSourceSha']==TARGET and report['baselineSourceSha']==P.BASELINE_SHA,'Wrong report source identities')
        require(exact(watch,report['supervisor']) and type(watch['workerExitCode']) is int and watch['workerExitCode']==0 and watch['timedOut'] is False and watch['error'] is None
                and watch['remainingLiveOwnedPids']==[] and watch['noObservedLiveOwnedDescendants'] is True,'Incomplete owned-process cleanup')
        C.verify_sources(args.baseline,args.target,TARGET);compare_runs(report,args.output)
        items=[]
        def add(path):
            items.append({'path':str(path.resolve()),'relative':str(path.relative_to(args.output)),'planets':100,'fleets':1000,'sha256':digest(path.read_bytes())})
        work=P.workload(args.combined_fixture,'combined');original=args.output/'combined-original-afterSave.json'
        require(original.read_text()==work['raw'],'Original full fixture differs');add(original)
        for row in report['runs']:
            add(args.output/row['case']/'seeded-current.json')
            for step,record in row['snapshots'].items():
                value=json.loads((args.output/record['file']).read_bytes());qualify_snapshot(value,work['key'])
                path=args.output/'strict-snapshot-saves'/row['case']/(step+'.json');path.parent.mkdir(parents=True,exist_ok=True)
                P.exclusive_bytes(path,value['raw'].encode());add(path)
        require(len(items)==1+2*len(SCENARIOS)+2*sum(len(steps(s)) for s in SCENARIOS),'Incomplete whole-save inventory')
        inputs={'sources':[{'side':side,'module':str(root.resolve()/'src/game/save.ts')} for side,root in [('baseline',args.baseline),('candidate',args.target)]],'saves':items}
        checked=subprocess.run(['node','--import','tsx','--input-type=module','-e',C.STRICT_READERS],input=json.dumps(inputs),text=True,capture_output=True,cwd=args.target,timeout=75)
        result['readerStdout']=checked.stdout;result['readerStderr']=checked.stderr
        require(checked.returncode==0,'Actual dual whole-save readers/exporters failed')
        result['checks']=json.loads(checked.stdout);require(len(result['checks'])==2*len(items),'Incomplete dual-reader results')
        result.update(rawSaves=items,completed=True,scope='Both exact original source readers/exporters accept every complete snapshot envelope after owned browser cleanup.')
    finally:P.exclusive_json(args.output/'strict-saves-check.json',result)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=('source','browser','saves'))
    parser.add_argument('--driver-sha',required=True);parser.add_argument('--output',required=True,type=Path)
    for name in ('driver','target','baseline','candidate-dist','baseline-dist','combined-fixture'):parser.add_argument('--'+name,type=Path)
    for name in ('baseline-url','candidate-url','chromium'):parser.add_argument('--'+name)
    parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS);args=parser.parse_args()
    require(re.fullmatch('[a-f0-9]{40}',args.driver_sha) and args.driver_sha!=TARGET,'Exact separate diagnostic driver SHA required')
    args.output.mkdir(parents=True,exist_ok=True)
    if args.command=='source':source(args);return 0
    if args.command=='saves':saves(args);return 0
    for url in (args.baseline_url,args.candidate_url):
        p=urlparse(url);require(p.scheme=='http' and p.hostname in ('127.0.0.1','localhost') and p.path=='/Infinity/' and not p.username and not p.password and not p.query and not p.fragment,'Use exact loopback app origins')
    require(args.baseline_url!=args.candidate_url,'Distinct origins required')
    return body(args) if args.worker else supervise(args)


if __name__=='__main__':sys.exit(main())
