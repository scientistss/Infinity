#!/usr/bin/env python3
"""Same-7ab/r14 fleet row-lookup A/B evidence, never a migration comparison.

Native timing and controlled-clock equality are separate modes/contexts. Timing
uses original clocks, RAF, timers, storage and DOM methods. No CPU sampler,
Tracing or DOMStorage domain is enabled. A tiny exact-source observer records
native frame timestamps and long tasks; these are not input-to-paint measures.
Run the browser modes only in the authorized native CI environment.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import re
import shutil
import signal
import statistics
import subprocess
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

BASELINE_SHA = '7ab569045996a1a6ad8ce1aee477092144dfad74'
BASELINE_RELEASE = 'c9411d7c952c217feb5c796d8c0653877ae650caa67fdc17941cfa2ce6c92e6f'
FIXTURES = {
    'moderate': {'fixture': '4947a1e9fcbb007edc52a2f2ebf0bddc4f4842eeefffd248a4af0c641cb38096',
                 'save': 'e88523176db7ff86949de409dfd046552ab39cc69c3a6d4c287cceaea4e0fd1f', 'fleets': 1, 'planets': 2},
    'combined': {'fixture': '51175269239ac45ac76b1ea8fc1f1bb3d6e9f42da58709b9ecdf6a171e680a98',
                 'save': '27e53db00f583e45db975d5b4421991de58a776d633c81da3efddca933340301', 'fleets': 1000, 'planets': 100},
}
DURATION_METRICS = ('ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration')
COUNT_METRICS = ('LayoutCount', 'RecalcStyleCount')
BODY_SECONDS, CLEANUP_SECONDS, OUTER_SECONDS = 560, 5, 590
EQUIVALENCE_BODY_SECONDS, EQUIVALENCE_OUTER_SECONDS = 75, 100
OBSERVER_URL = 'infinity-diagnostic://fleet-row/native-observer-v1.js'
OBSERVER_SOURCE = r'''(() => {
 if (Object.hasOwn(window, '__fleetRowObservation')) throw Error('Duplicate observer');
 const record = {active:false,start:null,end:null,frames:[],longTasks:[],visibility:[],focus:[],navigation:[]};
 Object.defineProperty(window, '__fleetRowObservation', {value:record});
 function frame(at) { if(record.active) record.frames.push(at); requestAnimationFrame(frame); }
 requestAnimationFrame(frame);
 const observer = new PerformanceObserver(list => {
   if(record.active) for(const entry of list.getEntries()) record.longTasks.push(entry.toJSON());
 });
 observer.observe({type:'longtask',buffered:false});
 document.addEventListener('visibilitychange', () => record.visibility.push(document.visibilityState));
 window.addEventListener('blur', () => record.focus.push('blur'));
 window.addEventListener('focus', () => record.focus.push('focus'));
 document.addEventListener('click', event => {
   const tab = event.target instanceof Element ? event.target.closest('[data-tab]') : null;
   if(tab) record.navigation.push({tab:tab.dataset.tab,trusted:event.isTrusted});
 }, true);
 record.begin = () => {
   record.frames=[]; record.longTasks=[]; record.end=null;
   record.start=performance.now(); record.active=true;
   return record.start;
 };
 record.endWindow = () => {
   record.end=performance.now(); record.active=false;
   for(const entry of observer.takeRecords()) record.longTasks.push(entry.toJSON());
   return {start:record.start,end:record.end,frames:record.frames,longTasks:record.longTasks};
 };
})();'''
SEED = r'''({key,raw}) => {
 const save=JSON.parse(raw), now=Date.now();
 save.savedAt=save.lastTickAt=now;
 const seeded=JSON.stringify(save,null,2);
 localStorage.setItem(key,seeded); localStorage.setItem('infinity.ui.tab','overview');
 if(localStorage.getItem(key)!==seeded) throw Error('Native seed readback failed');
 return {raw:seeded,now};
}'''
SNAPSHOT = r'''key => {
 const native=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 const p=window.__fleetRowObservation;
 const status=document.querySelector('[data-bind="status"]')?.textContent||'';
 const notice=document.querySelector('[data-bind="notice-text"]')?.textContent||'';
 return {wallAt:Date.now(),monotonicAt:performance.now(),hidden:document.hidden,
  viewport:{width:window.innerWidth,height:window.innerHeight,deviceScaleFactor:window.devicePixelRatio},
  reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
  focused:document.hasFocus(),visibility:document.visibilityState,
  panels:[...document.querySelectorAll('[data-tab-panel]')].filter(e=>!e.hidden).map(e=>e.dataset.tabPanel),
  fleetRows:document.querySelectorAll('#space-fleets [data-flight]').length,
  firstFleetTime:document.querySelector('#space-fleets .flight-time')?.textContent||null,
  status,notice,protected:/受保护|自动保存暂停|已暂停写入|本地存储不可用|临时初始画面/.test(status+notice),
  raw:localStorage.getItem(key),backupKeys:Object.keys(localStorage).filter(k=>k.startsWith(key+'.backup')).sort(),
  native:{date:native(Date.now),performance:native(performance.now),raf:native(requestAnimationFrame),
   interval:native(setInterval),timeout:native(setTimeout),get:native(Storage.prototype.getItem),
   set:native(Storage.prototype.setItem),selector:native(Element.prototype.querySelector),
   selectors:native(Element.prototype.querySelectorAll)},
  observation:p?{visibility:p.visibility,focus:p.focus,navigation:p.navigation}:null};
}'''
CONTROLLED_SOURCE = r'''(() => {
 const epoch=1792000000000; let at=0,id=0; const frames=new Map(),intervals=new Map();
 Date.now=()=>epoch+at; Object.defineProperty(performance,'now',{value:()=>at});
 window.requestAnimationFrame=fn=>{const n=++id;frames.set(n,fn);return n;};
 window.cancelAnimationFrame=n=>frames.delete(n);
 window.setInterval=(fn,ms,...args)=>{const n=++id;intervals.set(n,{fn,ms,args});return n;};
 window.clearInterval=n=>intervals.delete(n);
 const events=[]; for(const type of ['click','input','change','keydown']) document.addEventListener(type,event=>events.push({type,trusted:event.isTrusted,target:event.target.id||event.target.dataset?.tab||event.target.dataset?.action||event.target.tagName}),true);
 window.__fleetRowClock={events,advance:value=>{if(value<at)throw Error('Clock backwards');at=value;},
  frame:()=>{const due=[...frames.values()];frames.clear();for(const fn of due)fn(at);return due.length;},
  at:()=>at};
})();'''
DOM_SNAPSHOT = r'''key => {
 const path=e=>{const p=[];for(;e&&e!==document;e=e.parentElement){
   if(!e.parentElement){p.push(e.tagName);break;}
   p.push(e.tagName+':'+[...e.parentElement.children].indexOf(e));}return p.reverse().join('/');};
 return {at:window.__fleetRowClock.at(),events:window.__fleetRowClock.events,html:document.body.outerHTML,
  viewport:{width:window.innerWidth,height:window.innerHeight,deviceScaleFactor:window.devicePixelRatio},
  reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
  focus:path(document.activeElement),focused:document.hasFocus(),
  fields:[...document.querySelectorAll('input,select,textarea,button,details')].map(e=>({
   path:path(e),value:e.value??null,checked:e.checked??null,disabled:e.disabled??null,
   open:e.open??null,selectionStart:e.selectionStart??null,selectionEnd:e.selectionEnd??null,
   selected:e instanceof HTMLSelectElement?[...e.options].map(o=>o.selected):null})),
  raw:localStorage.getItem(key),storage:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))};
}'''


def require(ok, message):
    if not ok:
        raise AssertionError(message)


def digest(raw):
    return hashlib.sha256(raw.encode() if isinstance(raw, str) else raw).hexdigest()


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def strict_equal(a, b):
    return json.dumps(a, sort_keys=True, ensure_ascii=False, allow_nan=False) == json.dumps(b, sort_keys=True, ensure_ascii=False, allow_nan=False)


def exclusive_bytes(path, raw):
    with Path(path).open('xb') as handle:
        handle.write(raw)


def exclusive_json(path, value):
    exclusive_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n').encode())


def persist_json(path, value):
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n')
    temp.replace(path)


def asset_path(dist, relative):
    path=Path(relative)
    require(not path.is_absolute() and '..' not in path.parts and '\\' not in relative, 'Unsafe asset path')
    resolved=(dist/path).resolve()
    require(resolved.is_relative_to(dist.resolve()) and resolved.is_file() and not (dist/path).is_symlink(), 'Missing/escaping asset')
    return resolved


def workload(path, profile, directory=None):
    raw=path.read_bytes(); expected=FIXTURES[profile]
    require(digest(raw)==expected['fixture'], 'Wrong original '+profile+' fixture file')
    source=json.loads(raw); pair=source['pairedNative']; save=pair['afterSave']; ready=json.loads(save)
    require(pair['sourceSha']=='4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b', 'Wrong fixture ancestry')
    require(pair['currentRevision']==14 and pair['afterSha256']==digest(save)==expected['save'], 'Wrong immutable current-r14 afterSave')
    require(type(ready['revision']) is int and ready['revision']==14 and type(ready['version']) is int and ready['version']==9, 'Wrong same-version save envelope')
    require(source['key']=='infinity.original-p4.save.v1', 'Wrong native storage key')
    require(len(ready['state']['fleets'])==expected['fleets'] and len(ready['state']['planets'])==expected['planets'], 'Wrong workload populations')
    if directory:
        exclusive_bytes(directory/(profile+'-original-fixture.json'),raw)
        exclusive_bytes(directory/(profile+'-original-afterSave.json'),save.encode())
    return {'profile':profile,'key':source['key'],'raw':save,'ready':ready,'fixtureSha256':digest(raw),'afterSaveSha256':digest(save),
            'fleets':expected['fleets'],'planets':expected['planets']}


def qualify_seed(seeded, work):
    require(type(seeded['now']) is int, 'Native seed timestamp must be integer')
    expected=dict(work['ready']); expected['savedAt']=expected['lastTickAt']=seeded['now']
    require(strict_equal(json.loads(seeded['raw']),expected), 'Seed changed beyond the two envelope timestamps')


class References(HTMLParser):
    def __init__(self):
        super().__init__(); self.scripts=[]; self.styles=[]
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if tag=='script':
            require(attrs.get('type')=='module' and attrs.get('src'), 'Unexpected inline/non-module script')
            self.scripts.append(attrs['src'])
        if tag=='link' and attrs.get('rel')=='stylesheet': self.styles.append(attrs.get('href'))


def relative_asset(url, base):
    a,b=urlparse(url),urlparse(base)
    require((a.scheme,a.netloc)==(b.scheme,b.netloc) and a.path.startswith(b.path) and not a.query and not a.fragment, 'Unexpected asset URL')
    relative=a.path[len(b.path):]
    require(relative and '..' not in Path(relative).parts and '%' not in relative, 'Ambiguous asset URL')
    return relative


def release_identity(dist, expected_sha, baseline=False):
    raw=(dist/'release.json').read_bytes(); release=json.loads(raw)
    if baseline: require(digest(raw)==BASELINE_RELEASE and expected_sha==BASELINE_SHA, 'Baseline is not exact published 7ab')
    require(re.fullmatch('[a-f0-9]{40}',expected_sha) and release['sourceSha']==expected_sha, 'Wrong release source SHA')
    require(release['version']=='0.6.27-alpha.1' and type(release['saveRevision']) is int and release['saveRevision']==14
            and type(release['saveVersion']) is int and release['saveVersion']==9, 'Not the same package/save version')
    files=release['files']; actual={str(p.relative_to(dist)):digest(p.read_bytes()) for p in dist.rglob('*') if p.is_file()}
    require(not any(p.is_symlink() for p in dist.rglob('*')), 'Symlink in release')
    require(len(files)==62 and actual=={**files,'release.json':digest(raw)}, 'Release asset inventory/content differs')
    for path,sha in files.items(): require(digest(asset_path(dist,path).read_bytes())==sha,'Asset mismatch')
    refs=References(); refs.feed((dist/'index.html').read_text())
    scripts={k:v for k,v in files.items() if k.endswith('.js')}; styles={k:v for k,v in files.items() if k.endswith('.css')}
    base='http://127.0.0.1/Infinity/'
    require(len(refs.scripts)==len(set(refs.scripts))==len(scripts)==1 and
            {relative_asset(urljoin(base,x),base) for x in refs.scripts}==set(scripts),'Nonunique/current JS references')
    require(len(refs.styles)==len(set(refs.styles))==len(styles)==1 and
            {relative_asset(urljoin(base,x),base) for x in refs.styles}==set(styles),'Nonunique/current CSS references')
    return {'manifest':release,'raw':raw,'scripts':scripts,'styles':styles,'releaseSha256':digest(raw)}


def qualify_release_pair(a,b):
    before=a['manifest']; after=b['manifest']
    require({k:v for k,v in before.items() if k not in ('sourceSha','files')}==
            {k:v for k,v in after.items() if k not in ('sourceSha','files')}, 'Release metadata changed')
    stable=lambda f:{k:v for k,v in f.items() if k!='index.html' and not k.endswith('.js')}
    require(stable(before['files'])==stable(after['files']), 'CSS/static assets changed')
    require(a['scripts']!=b['scripts'], 'No distinct candidate JavaScript')


def verify_http(request, variant, directory):
    release=variant['release']; observations=[]
    for relative,sha in sorted({**release['manifest']['files'],'release.json':release['releaseSha256']}.items()):
        response=request.get(urljoin(variant['url'],relative),timeout=15000); raw=response.body()
        row={'path':relative,'url':response.url,'status':response.status,'sha256':digest(raw),'bytes':len(raw)}
        observations.append(row)
        require(response.url==urljoin(variant['url'],relative) and response.status==200 and digest(raw)==sha
                and raw==asset_path(variant['dist'],relative).read_bytes(),'HTTP/local release asset mismatch: '+relative)
    exclusive_json(directory/'http-asset-bindings.json',observations)
    exclusive_bytes(directory/'release.json',release['raw'])


def verify_scripts(cdp, parsed, responses, variant, directory):
    expected=variant['release']['scripts']; bodies={}; identities={}
    for response in responses:
        url=response.url; relative=relative_asset(url,variant['url']); raw=response.body()
        require(url not in bodies,'Duplicate production script HTTP response')
        require(response.status==200 and relative in expected and digest(raw)==expected[relative]
                and raw==asset_path(variant['dist'],relative).read_bytes(),'HTTP production source mismatch')
        bodies[url]=raw; exclusive_bytes(directory/('http-'+Path(relative).name),raw)
    require({relative_asset(url,variant['url']) for url in bodies}==set(expected),'Incomplete HTTP script set')
    seen_urls=set()
    for script in parsed:
        url=script.get('url','')
        if not url: continue # Playwright/native bootstrap source, outside timing.
        require(url in bodies and url not in seen_urls,'Unknown/duplicate executed production script')
        script_id=script.get('scriptId'); require(isinstance(script_id,str) and script_id.isdigit() and script_id not in identities,'Invalid/duplicate script ID')
        source=cdp.send('Debugger.getScriptSource',{'scriptId':script_id})['scriptSource']
        exclusive_bytes(directory/('v8-script-'+script_id+'.js'),source.encode())
        require(source.encode()==bodies[url],'Executed source differs from bound HTTP bytes')
        seen_urls.add(url); identities[script_id]={'url':url,'sha256':digest(source),'kind':'production'}
    require(seen_urls==set(bodies),'Incomplete executed script identity')
    return identities


def register_observer(cdp, directory):
    result=cdp.send('Runtime.compileScript',{'expression':OBSERVER_SOURCE,'sourceURL':OBSERVER_URL,'persistScript':True})
    require('exceptionDetails' not in result and result.get('scriptId'),'Observer compilation failed')
    script_id=result['scriptId']; actual=cdp.send('Debugger.getScriptSource',{'scriptId':script_id})['scriptSource']
    exclusive_bytes(directory/'registered-observer.js',actual.encode())
    require(actual==OBSERVER_SOURCE,'Registered observer source changed')
    result=cdp.send('Runtime.runScript',{'scriptId':script_id,'returnByValue':True})
    require('exceptionDetails' not in result,'Observer execution failed')
    return {'scriptId':script_id,'url':OBSERVER_URL,'sha256':digest(actual),'kind':'read-only-native-observer'}


def metrics(cdp, path=None):
    result=cdp.send('Performance.getMetrics')
    if path is not None: exclusive_json(path,result)
    values={item['name']:item['value'] for item in result['metrics']}
    require(len(values)==len(result['metrics']),'Duplicate raw CDP metric')
    require(all(key in values and finite(values[key]) for key in ('Timestamp',*DURATION_METRICS,*COUNT_METRICS)),'Missing/nonfinite metric')
    return result


def metric_delta(before,after):
    a={x['name']:x['value'] for x in before['metrics']}; b={x['name']:x['value'] for x in after['metrics']}
    keys=('Timestamp',*DURATION_METRICS,*COUNT_METRICS)
    require(all(key in x and finite(x[key]) for x in (a,b) for key in keys),'Missing/nonfinite CDP value')
    require(b['Timestamp']>a['Timestamp'],'Nonpositive CDP window')
    require(all(b[k]>=a[k] for k in (*DURATION_METRICS,*COUNT_METRICS)),'Negative cumulative CDP delta')
    elapsed=(b['Timestamp']-a['Timestamp'])*1000
    duration={k:(b[k]-a[k])*1000 for k in DURATION_METRICS}
    require(finite(elapsed) and elapsed>0 and all(finite(v) for v in duration.values()),'Nonfinite derived CDP delta')
    rates={k:v*1000/elapsed for k,v in duration.items()}
    require(all(finite(v) for v in rates.values()),'Nonfinite derived CDP rate')
    return {'elapsedMs':elapsed,'durationMs':duration,'durationMsPerSecond':rates,
            'counts':{k:b[k]-a[k] for k in COUNT_METRICS}}


def observed_window(raw):
    start,end=raw['start'],raw['end']; frames=raw['frames']; tasks=raw['longTasks']
    require(finite(start) and finite(end) and end>start and finite(end-start),'Invalid observer window')
    require(len(frames)>=2 and all(finite(x) for x in frames),'Missing/invalid native frames')
    require(all(b>a and finite(b-a) for a,b in zip(frames,frames[1:])),'Nonincreasing/nonfinite native frames')
    inside=[x for x in frames if start<=x<=end]
    require(len(inside)>=2,'Insufficient complete frame intervals')
    gaps=[b-a for a,b in zip(inside,inside[1:])]
    require(all(type(x) is dict and finite(x.get('startTime')) and finite(x.get('duration')) and x['duration']>=0 for x in tasks),'Invalid long-task observation')
    included=[x for x in tasks if x['startTime']>=start and x['startTime']+x['duration']<=end]
    boundary=[x for x in tasks if x not in included]
    return {'elapsedMs':end-start,'frameCount':len(frames),'frameGapP95Ms':sorted(gaps)[math.ceil(.95*len(gaps))-1],
            'frameGapsMs':gaps,'boundaryFrameTimestamps':[x for x in frames if not start<=x<=end],'longTaskCount':len(included),'longTaskDurationMs':sum(x['duration'] for x in included),
            'boundaryLongTasks':boundary,'scope':'Observer outer interval surrounds CDP interval; native RAF gaps are not paint or CPU time. Boundary long tasks retained separately.'}


def qualify_snapshot(value,work):
    require(value['visibility']=='visible' and not value['hidden'] and value['focused'],'Page not visible/focused')
    require(strict_equal(value['viewport'],{'width':1440,'height':1100,'deviceScaleFactor':1}),'Actual viewport/DPR differs from the fixed configuration')
    require(value['reducedMotion'] is True,'Actual reduced-motion preference differs')
    require(value['panels']==['fleet'] and value['fleetRows']==work['fleets'],'Wrong fleet DOM workload')
    require(all(value['native'].values()) and not value['protected'] and not value['backupKeys'],'Native primitive/session qualification failed')
    observer=value['observation']; require(observer is not None and not observer['visibility'] and 'blur' not in observer['focus'],'Observed focus/visibility change')
    require([x['tab'] for x in observer['navigation']]==['overview','orders','fleet'] and all(x['trusted'] for x in observer['navigation']),'Wrong/untrusted warmup navigation')


def schedule():
    return [{'profile':profile,'block':block+1,'position':pos+1,'side':side,'pair':block*2+pos//2+1,
             'case':f'{profile}-b{block+1}-{pos+1}-{side}'}
            for profile in ('moderate','combined') for block in range(2) for pos,side in enumerate(('baseline','candidate','candidate','baseline'))]


def comparisons(runs):
    planned=schedule()
    require(len(runs)==len(planned),'Incomplete fixed ABBA schedule')
    require(all(strict_equal({key:run.get(key) for key in plan},plan) for run,plan in zip(runs,planned)),
            'Altered fixed ABBA plan identity: case/profile/block/position/side/pair must all match')
    require(all(r.get('valid') and r.get('cleanupComplete') and len(r.get('windows',[]))==3
                and all(w.get('valid') for w in r['windows']) for r in runs),'Incomplete/invalid context; no selective summary')
    require(all(strict_equal([w.get('number') for w in r['windows']],[1,2,3]) for r in runs),'Altered or duplicate window identities')
    require(all(finite(w['metrics']['durationMsPerSecond'][k]) and w['metrics']['durationMsPerSecond'][k]>=0
                for r in runs for w in r['windows'] for k in DURATION_METRICS),'Nonfinite/negative raw window value')
    result={}
    for profile in ('moderate','combined'):
        pairs=[]
        for number in range(1,5):
            pair={r['side']:r for r in runs if r['profile']==profile and r['pair']==number}
            require(set(pair)=={'baseline','candidate'},'Broken pair identity')
            row={'pair':number,'cases':{k:v['case'] for k,v in pair.items()},'metrics':{}}
            for metric in DURATION_METRICS:
                medians={side:statistics.median(w['metrics']['durationMsPerSecond'][metric] for w in run['windows']) for side,run in pair.items()}
                require(all(finite(x) and x>=0 for x in medians.values()),'Nonfinite/negative paired value')
                a,b=medians['baseline'],medians['candidate']
                require(a==0 or finite(b/a),'Nonfinite paired ratio')
                row['metrics'][metric]={'baselineMedianMsPerSecond':a,'candidateMedianMsPerSecond':b,'candidateMinusBaselineMsPerSecond':b-a,
                                        'candidateOverBaseline':b/a if a>0 else None}
            pairs.append(row)
        aggregate={metric:{'medianPairedDifferenceMsPerSecond':statistics.median(p['metrics'][metric]['candidateMinusBaselineMsPerSecond'] for p in pairs),
                           'medianPairedRatio':statistics.median(p['metrics'][metric]['candidateOverBaseline'] for p in pairs)
                           if all(p['metrics'][metric]['candidateOverBaseline'] is not None for p in pairs) else None} for metric in DURATION_METRICS}
        result[profile]={'pairs':pairs,'aggregate':aggregate,'scope':'Four adjacent AB/BA pairs, medians of all three windows per context. No outlier deletion, performance pass threshold, confidence interval, or universal speedup claim.'}
    return result


def navigate(page,tab):
    page.locator('[data-tab="'+tab+'"]').click(timeout=15000)
    page.locator('[data-tab-panel="'+tab+'"]').wait_for(state='visible',timeout=15000)


def bounded_close(context, row, directory, deadline):
    cleanup={'required':context is not None,'completed':False}
    try:
        signal.setitimer(signal.ITIMER_REAL,CLEANUP_SECONDS)
        if context is not None: context.close()
        row['cleanupComplete']=cleanup['completed']=True
    except BaseException as error:
        row['valid']=False; row['cleanupComplete']=False
        cleanup['error']={'type':type(error).__name__,'message':str(error)[:1000]}
        row['cleanupError']=cleanup['error']
    finally:
        exclusive_json(directory/'cleanup.json',cleanup)
        exclusive_json(directory/'case-result.json',row)
        signal.setitimer(signal.ITIMER_REAL,max(.001,deadline-time.monotonic()))


def archive_snapshot(directory,label,value):
    """Preserve every received snapshot, including a null/missing storage slot."""
    raw=value.pop('raw',None)
    if isinstance(raw,str):
        exclusive_bytes(directory/(label+'-current.json'),raw.encode())
        value['currentSha256']=digest(raw)
        value['currentReadback']={'type':'string','file':label+'-current.json'}
    else:
        value['currentSha256']=None
        value['currentReadback']={'type':'null' if raw is None else type(raw).__name__,'value':raw}
    exclusive_json(directory/(label+'-snapshot.json'),value)
    return raw


def run_native(browser,plan,work,variant,output,report,persist,deadline):
    directory=output/plan['case']; directory.mkdir()
    row={**plan,'valid':False,'cleanupComplete':False,'windows':[]}; report['runs'].append(row); persist()
    context=None; parsed=[]; responses=[]; errors=[]
    try:
        context=browser.new_context(viewport={'width':1440,'height':1100},device_scale_factor=1,reduced_motion='reduce',service_workers='block')
        page=context.new_page(); page.set_default_timeout(15000); page.set_default_navigation_timeout(20000)
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('requestfailed',lambda request:errors.append(str(request.url)+': '+str(request.failure)))
        page.on('response',lambda response:responses.append(response) if response.request.resource_type=='script' else None)
        cdp=context.new_cdp_session(page); cdp.send('Runtime.enable'); cdp.send('Performance.enable',{'timeDomain':'timeTicks'})
        cdp.on('Debugger.scriptParsed',lambda event:parsed.append(event)); cdp.send('Debugger.enable')
        response=page.goto(urljoin(variant['url'],'release.json'),wait_until='load')
        require(response and response.status==200 and response.body()==variant['release']['raw'],'Seed origin release mismatch')
        seeded=page.evaluate(SEED,{'key':work['key'],'raw':work['raw']}); qualify_seed(seeded,work)
        exclusive_bytes(directory/'seeded-current.json',seeded['raw'].encode()); row['seed']={'sha256':digest(seeded['raw']),'nativeNow':seeded['now'],'inputAfterSaveSha256':work['afterSaveSha256']}
        # Discard identities from the non-application seed document.
        parsed.clear(); responses.clear()
        response=page.goto(variant['url'],wait_until='domcontentloaded')
        require(response and response.status==200 and digest(response.body())==variant['release']['manifest']['files']['index.html'],'Application HTML mismatch')
        page.locator('[data-bind="energy-chip"]').wait_for(); page.wait_for_load_state('networkidle'); page.bring_to_front()
        require(not page.locator('[data-bind="offline-modal"]').is_visible(),'Unexpected offline modal')
        row['productionScripts']=verify_scripts(cdp,parsed,responses,variant,directory)
        row['observer']=register_observer(cdp,directory)
        exclusive_json(directory/'initial-script-inventory.json',parsed)
        cdp.send('Debugger.disable')
        row['inspectorState']={'Debugger':'disabled before warmup','Profiler':'never enabled','Tracing':'never started','DOMStorage':'never enabled',
                               'Runtime':'no evaluation inside CDP windows','Performance':'boundary reads only'}
        for tab in ('overview','orders','fleet'):
            navigate(page,tab); page.wait_for_timeout(600); page.wait_for_timeout(1500)
        for number in range(1,4):
            row['phase']=f'window-{number}-before-snapshot'
            before=page.evaluate(SNAPSHOT,work['key'])
            old_raw=archive_snapshot(directory,f'window-{number}-before',before)
            qualify_snapshot(before,work)
            require(isinstance(old_raw,str),'Native pre-window current save is missing/non-string')
            row['phase']=f'window-{number}-observer-start'
            observer_start=page.evaluate('window.__fleetRowObservation.begin()')
            exclusive_json(directory/f'window-{number}-observer-start.json',{'start':observer_start})
            row['phase']=f'window-{number}-metrics-before'
            raw_before=metrics(cdp,directory/f'window-{number}-metrics-before.json'); start=time.monotonic()
            row['phase']=f'window-{number}-native-wait'
            page.wait_for_timeout(1500)
            row['phase']=f'window-{number}-metrics-after'
            raw_after=metrics(cdp,directory/f'window-{number}-metrics-after.json'); host_ms=(time.monotonic()-start)*1000
            row['phase']=f'window-{number}-observer-end'
            observed=page.evaluate('window.__fleetRowObservation.endWindow()')
            exclusive_json(directory/f'window-{number}-observer.json',observed)
            row['phase']=f'window-{number}-after-snapshot'
            after=page.evaluate(SNAPSHOT,work['key'])
            new_raw=archive_snapshot(directory,f'window-{number}-after',after)
            window={'number':number,'rawMetricsBefore':raw_before,'rawMetricsAfter':raw_after,'observerRaw':observed,
                    'before':before,'after':after,'hostWaitAndAfterMetricMs':host_ms,'valid':False}
            row['windows'].append(window); exclusive_json(directory/f'window-{number}-raw.json',window)
            window['metrics']=metric_delta(raw_before,raw_after); window['framesAndLongTasks']=observed_window(observed)
            qualify_snapshot(after,work)
            require(old_raw==new_raw==seeded['raw'],'Persistence occurred during native steady measurement')
            require(before['firstFleetTime']!=after['firstFleetTime'],'Native fleet countdown did not advance')
            require(after['monotonicAt']-before['monotonicAt']>=1500,'Native window too short')
            require(not errors,'Page/runtime/request error')
            window['valid']=True; exclusive_json(directory/f'window-{number}-result.json',window); persist()
        require(len(responses)==len(variant['release']['scripts']),'Additional script loaded after source binding')
        row['valid']=True
    except BaseException as error:
        row['error']={'type':type(error).__name__,'message':str(error)[:2400]}
    finally:
        exclusive_json(directory/'page-errors.json',errors)
        bounded_close(context,row,directory,deadline); persist()
    return row


def run_equivalence(browser,work,variant,output,deadline):
    directory=output/(work['profile']+'-'+variant['side']); directory.mkdir()
    row={'profile':work['profile'],'side':variant['side'],'valid':False,'cleanupComplete':False,'snapshots':{}}
    context=None; errors=[]; parsed=[]; responses=[]
    try:
        context=browser.new_context(viewport={'width':1440,'height':1100},device_scale_factor=1,reduced_motion='reduce',service_workers='block')
        context.add_init_script(CONTROLLED_SOURCE)
        page=context.new_page(); page.set_default_timeout(15000); page.set_default_navigation_timeout(20000)
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('requestfailed',lambda request:errors.append(str(request.url)+': '+str(request.failure)))
        page.on('response',lambda response:responses.append(response) if response.request.resource_type=='script' else None)
        cdp=context.new_cdp_session(page); cdp.on('Debugger.scriptParsed',lambda event:parsed.append(event)); cdp.send('Debugger.enable')
        page.goto(urljoin(variant['url'],'release.json'),wait_until='load')
        seeded=page.evaluate(SEED,{'key':work['key'],'raw':work['raw']}); qualify_seed(seeded,work)
        exclusive_bytes(directory/'seeded-current.json',seeded['raw'].encode())
        parsed.clear(); responses.clear()
        response=page.goto(variant['url'],wait_until='domcontentloaded')
        require(response and response.status==200 and digest(response.body())==variant['release']['manifest']['files']['index.html'],'Controlled HTML mismatch')
        page.locator('[data-bind="energy-chip"]').wait_for(); page.wait_for_load_state('networkidle'); page.bring_to_front()
        # The intentional controlled init script is anonymous, so all named HTTP
        # sources remain checked by the exact same production binding routine.
        row['productionScripts']=verify_scripts(cdp,parsed,responses,variant,directory); cdp.send('Debugger.disable')
        def frame(at):
            page.evaluate('at=>{window.__fleetRowClock.advance(at);window.__fleetRowClock.frame();}',at)
        def snap(name):
            value=page.evaluate(DOM_SNAPSHOT,work['key'])
            exclusive_json(directory/(name+'.json'),value)
            row['snapshots'][name]={'file':str((directory/(name+'.json')).relative_to(output)),'sha256':digest((directory/(name+'.json')).read_bytes()),'at':value['at']}
            require(value['focused'] and all(e['trusted'] for e in value['events']),'Controlled input was not trusted/focused')
            require(strict_equal(value['viewport'],{'width':1440,'height':1100,'deviceScaleFactor':1}),'Controlled actual viewport/DPR differs')
            require(value['reducedMotion'] is True,'Controlled actual reduced-motion preference differs')
        def click(selector):
            # Coordinates avoid Playwright's actionability RAF dependency under
            # the labeled controlled clock. Input is still trusted CDP mouse.
            hit=page.locator(selector).evaluate('e=>{e.scrollIntoView({block:"center",behavior:"instant"});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const h=document.elementFromPoint(x,y);return {x,y,ok:!e.disabled&&(h===e||e.contains(h))};}')
            require(hit['ok'],'Controlled trusted click target unavailable')
            page.mouse.click(hit['x'],hit['y'])
        frame(0); snap('initial')
        for tab in ('overview','orders','fleet'):
            click('[data-tab="'+tab+'"]'); frame(0); snap('tab-'+tab)
        click('#flight-galaxy'); page.keyboard.press('ControlOrMeta+A'); page.keyboard.type('4'); frame(0); snap('focused-draft')
        for at in (250,750,1500): frame(at); snap('fleet-'+str(at))
        require(page.locator('#flight-galaxy').evaluate('e=>document.activeElement===e&&e.value==="4"'),'Focused draft was lost')
        click('[data-tab="save"]'); frame(1500); click('[data-action="save"]'); frame(1500); snap('manual-save')
        saved=json.loads(json.loads((output/row['snapshots']['manual-save']['file']).read_text())['raw'])
        require(saved['revision']==14 and saved['version']==9 and saved['savedAt']==1792000001500,'Controlled native save failed')
        require(not errors,'Controlled browser errors')
        require(len(responses)==len(variant['release']['scripts']),'Additional script loaded after source binding')
        row['valid']=True
    except BaseException as error:
        row['error']={'type':type(error).__name__,'message':str(error)[:2400]}
    finally:
        exclusive_json(directory/'page-errors.json',errors); bounded_close(context,row,directory,deadline)
    return row


def body(args):
    body_seconds=EQUIVALENCE_BODY_SECONDS if args.equivalence_only else BODY_SECONDS
    outer_seconds=EQUIVALENCE_OUTER_SECONDS if args.equivalence_only else OUTER_SECONDS
    output=args.output; report={'completed':False,'mode':'controlled-equivalence' if args.equivalence_only else 'native-timing',
        'baselineSourceSha':BASELINE_SHA,'candidateSourceSha':args.candidate_sha,'runs':[],'errors':[],'globalCleanupComplete':False,
        'scope':('Same current-r14 bytes; four separate controlled-clock contexts, exact whole-body DOM/focus/forms/native-storage equality. Never timing evidence.' if args.equivalence_only else 'Same current-r14 bytes; sixteen fresh foreground native contexts, fixed ABBA twice per workload. Separate controlled equality and existing native gates remain required.'),
        'settings':{'bodySeconds':body_seconds,'outerSeconds':outer_seconds,'windowsPerContext':3,'windowMs':1500,'warmupMs':600,
                    'priorSteadyMs':1500,'viewport':{'width':1440,'height':1100},'deviceScaleFactor':1,'reducedMotion':'reduce','playwright':'1.57.0'},
        'limitations':['CDP inspector and minimal observer overhead remain; no production-method replacements.',
                      'Frame intervals are RAF callback gaps, not compositor paint or interaction latency.',
                      'CPU metrics overlap and are not exclusive callsite attribution. No sampler-derived durations.',
                      'Finite paired medians include regressions; no numerical pass threshold or outlier exclusion.',
                      'Existing seven native acceptance gates remain independently required.']}
    def persist(): persist_json(output/'report.json',report)
    deadline=time.monotonic()+body_seconds
    def expire(signum,frame): raise TimeoutError('Bounded benchmark body/cleanup deadline exceeded')
    signal.signal(signal.SIGALRM,expire); signal.alarm(body_seconds)
    playwright=browser=request=None; persist()
    try:
        require(importlib.metadata.version('playwright')=='1.57.0','Playwright must be pinned 1.57.0')
        chrome=args.chromium or shutil.which('google-chrome') or shutil.which('google-chrome-stable')
        require(chrome and Path(chrome).is_file(),'Official CI Chrome executable missing')
        variants={side:{'side':side,'dist':getattr(args,side+'_dist'),'url':getattr(args,side+'_url'),
                        'release':release_identity(getattr(args,side+'_dist'),BASELINE_SHA if side=='baseline' else args.candidate_sha,side=='baseline')}
                  for side in ('baseline','candidate')}
        qualify_release_pair(variants['baseline']['release'],variants['candidate']['release'])
        workloads={name:workload(getattr(args,name+'_fixture'),name,output) for name in FIXTURES}
        report['fixtures']={name:{k:v for k,v in work.items() if k not in ('ready','raw')} for name,work in workloads.items()}
        from playwright.sync_api import sync_playwright
        playwright=sync_playwright().start(); request=playwright.request.new_context()
        for side,variant in variants.items():
            directory=output/(side+'-release'); directory.mkdir(); verify_http(request,variant,directory)
        request.dispose(); request=None
        browser=playwright.chromium.launch(executable_path=chrome,headless=True,timeout=20000,args=['--no-sandbox'])
        report['environment']={'browser':browser.version,'playwright':importlib.metadata.version('playwright'),'python':platform.python_version(),
                               'platform':platform.platform(),'executable':chrome,'headless':True}
        persist()
        if args.equivalence_only:
            exclusive_bytes(output/'controlled-clock-source.js',CONTROLLED_SOURCE.encode())
            for profile,work in workloads.items():
                for side,variant in variants.items():
                    require(time.monotonic()<deadline,'Body deadline exhausted')
                    report['runs'].append(run_equivalence(browser,work,variant,output,deadline)); persist()
            require(len(report['runs'])==4 and all(r['valid'] and r['cleanupComplete'] for r in report['runs']),'Controlled contexts incomplete')
            report['equivalence']={}
            for profile in workloads:
                a,b=[r for r in report['runs'] if r['profile']==profile]
                require(list(a['snapshots'])==list(b['snapshots']),'Controlled step sequence differs')
                equal=all(strict_equal(json.loads((output/a['snapshots'][step]['file']).read_text()),json.loads((output/b['snapshots'][step]['file']).read_text())) for step in a['snapshots'])
                report['equivalence'][profile]={'equal':equal,'snapshots':list(a['snapshots']),'normalization':'none; whole body DOM, focus, field properties, all native storage bytes'}
                require(equal,'Whole DOM/focus/state mismatch: '+profile)
        else:
            report['plannedCases']=schedule(); persist()
            for plan in schedule():
                require(time.monotonic()<deadline,'Body deadline exhausted')
                run_native(browser,plan,workloads[plan['profile']],variants[plan['side']],output,report,persist,deadline)
            report['comparisons']=comparisons(report['runs'])
        report['observationsComplete']=True
    except BaseException as error:
        report['errors'].append({'type':type(error).__name__,'message':str(error)[:2400]})
    finally:
        cleanup_ok=True
        for label,closer in [('request',request.dispose if request else None),('browser',browser.close if browser else None),('playwright',playwright.stop if playwright else None)]:
            if closer:
                signal.alarm(CLEANUP_SECONDS)
                try: closer()
                except BaseException as error:
                    cleanup_ok=False; report['errors'].append({'phase':'cleanup-'+label,'type':type(error).__name__,'message':str(error)[:1000]})
        signal.alarm(0); report['globalCleanupComplete']=cleanup_ok
        report['completed']=bool(report.get('observationsComplete') and cleanup_ok and not report['errors'])
        if not report['completed']: report.pop('comparisons',None)
        persist()
    return 0 if report['completed'] else 1


def process_identity(pid):
    try:
        fields=Path(f'/proc/{pid}/stat').read_text().split(') ',1)[1].split()
        return {'pid':pid,'parent':int(fields[1]),'start':fields[19],'state':fields[0]}
    except (OSError,ValueError,IndexError): return None


def track_descendants(root, owned):
    # Inspect only public PID ownership metadata, never cmdline or environment.
    records={}
    for entry in Path('/proc').iterdir():
        if entry.name.isdecimal():
            ident=process_identity(int(entry.name))
            if ident: records[ident['pid']]=ident
    trusted={pid for pid,ident in records.items() if pid in owned and ident['start']==owned[pid]['start']}
    if root in records and (root not in owned or records[root]['start']==owned[root]['start']):
        trusted.add(root); owned[root]=records[root]
    changed=True
    while changed:
        changed=False
        for pid,ident in records.items():
            if pid not in trusted and ident['parent'] in trusted and (pid not in owned or owned[pid]['start']==ident['start']):
                trusted.add(pid); owned[pid]=ident; changed=True


def live_owned(owned):
    result=[]
    for pid,old in owned.items():
        current=process_identity(pid)
        if current and current['start']==old['start'] and current['state']!='Z': result.append(pid)
    return result


def supervise(args):
    """Outer watchdog tracks only this worker and observed owned descendants."""
    args.output.mkdir(parents=True,exist_ok=True)
    exclusive_bytes(args.output/'.fleet-row-owner',b'Exclusive evidence writer; use a new output directory for every invocation.\n')
    command=[sys.executable,str(Path(__file__).resolve()),*sys.argv[1:],'--worker']
    previous_term=signal.getsignal(signal.SIGTERM)
    def interrupted(signum,frame): raise InterruptedError('Supervisor received SIGTERM; bounded owned cleanup required')
    signal.signal(signal.SIGTERM,interrupted)
    started=time.monotonic(); process=subprocess.Popen(command,start_new_session=True)
    outer_seconds=EQUIVALENCE_OUTER_SECONDS if args.equivalence_only else OUTER_SECONDS
    timed_out=False; owned={}; code=1; supervisor_error=None
    try:
        while process.poll() is None:
            track_descendants(process.pid,owned)
            if time.monotonic()-started>=outer_seconds:
                timed_out=True; break
            time.sleep(.2)
        code=124 if timed_out else process.returncode
    except BaseException as error:
        supervisor_error={'type':type(error).__name__,'message':str(error)[:1000]}
    finally:
        # A second termination request must not interrupt owned cleanup and the
        # final watchdog record. External kill-after remains the last boundary.
        signal.signal(signal.SIGTERM,signal.SIG_IGN)
        for sig in (signal.SIGTERM,signal.SIGKILL):
            track_descendants(process.pid,owned)
            # Start-time checks prevent signaling a reused unrelated PID. Never
            # broad killall/pkill; track detached Chrome descendants separately.
            if process.pid in live_owned(owned):
                try: os.killpg(process.pid,sig)
                except ProcessLookupError: pass
            for pid in live_owned(owned):
                try: os.kill(pid,sig)
                except ProcessLookupError: pass
            try: process.wait(timeout=1)
            except subprocess.TimeoutExpired: pass
            until=time.monotonic()+.5
            while live_owned(owned) and time.monotonic()<until: time.sleep(.02)
    remaining=live_owned(owned)
    result={'workerExitCode':code,'outerDeadlineSeconds':outer_seconds,'timedOut':timed_out,'elapsedSeconds':time.monotonic()-started,'ownedProcessGroup':process.pid,
            'observedOwnedPids':sorted(owned),'remainingLiveOwnedPids':remaining,'noObservedLiveOwnedDescendants':not remaining,
            'error':supervisor_error,'scope':'Observed Linux PID/start-time ancestry; cannot prove absence of never-observed reparented processes.'}
    exclusive_json(args.output/'watchdog.json',result)
    path=args.output/'report.json'
    if path.exists():
        report=json.loads(path.read_text()); report['supervisor']=result
        report['completed']=bool(report.get('completed') and code==0 and not timed_out and not remaining and not supervisor_error)
        if not report['completed']: report.pop('comparisons',None)
        persist_json(path,report)
    signal.signal(signal.SIGTERM,previous_term)
    return code if code else (1 if remaining or supervisor_error else 0)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for side in ('baseline','candidate'):
        parser.add_argument('--'+side+'-dist',required=True,type=Path)
        parser.add_argument('--'+side+'-url',required=True)
    parser.add_argument('--candidate-sha',required=True)
    parser.add_argument('--moderate-fixture',required=True,type=Path)
    parser.add_argument('--combined-fixture',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--chromium')
    parser.add_argument('--equivalence-only',action='store_true')
    parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    require(re.fullmatch('[a-f0-9]{40}',args.candidate_sha) and args.candidate_sha!=BASELINE_SHA,'Distinct exact candidate SHA required')
    for url in (args.baseline_url,args.candidate_url):
        parsed=urlparse(url)
        require(parsed.scheme=='http' and parsed.hostname in ('127.0.0.1','localhost') and parsed.path=='/Infinity/'
                and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,'Use actual local /Infinity/ HTTP origins')
    require(args.baseline_url!=args.candidate_url,'Baseline/candidate origins must differ')
    return body(args) if args.worker else supervise(args)


if __name__=='__main__':
    sys.exit(main())
