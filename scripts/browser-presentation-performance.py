"""Paired actual browser CPU/presentation measurements, separate from controlled correctness.

Real HTTP bundles and anonymous native localStorage. Date, performance, RAF,
intervals, visibility and Storage are NEVER replaced. CDP Performance metrics and
PerformanceObserver records are observations, not application hooks. Frame gaps
are NOT claimed as CPU time. Slow EventTiming entries measure native interaction
latency; double-RAF observations are explicitly paint-opportunity bounds only.
"""
import argparse
import hashlib
import json
import math
import platform
import re
import shutil
import statistics
import time
from pathlib import Path
from urllib.parse import urlparse, urljoin
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--before-url', required=True)
parser.add_argument('--after-url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', required=True)
parser.add_argument('--moderate-fixture')
parser.add_argument('--output', default='presentation-performance-evidence')
parser.add_argument('--chromium')
parser.add_argument('--repetitions', type=int, default=3)
parser.add_argument('--sample-ms', type=int, default=1500)
parser.add_argument('--warmup-ms', type=int, default=600)
parser.add_argument('--tabs', default='overview,orders,fleet')
args = parser.parse_args()
if args.repetitions < 2 or args.sample_ms < 500 or args.warmup_ms < 100:
    parser.error('At least two paired repetitions, 500ms samples and 100ms warmup are required')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report = {
    'completed': False, 'classification': 'actual native browser timings / HTTP / native localStorage / unmodified clocks, RAF and timers',
    'beforeUrl': args.before_url, 'afterUrl': args.after_url,
    'design': 'Sequential isolated AB/BA repetitions with identical source fixture state payloads. Only savedAt/lastTickAt are rebased at document start using native Date.now to exclude unrelated offline catch-up; every exact seeded envelope hash is recorded. No concurrent game page is kept running.',
    'limits': ['Headless foreground Chromium; not OS-hidden, mobile or display-hardware performance.',
               'CPU ScriptDuration and TaskDuration are actual CDP metrics; frame intervals are separate presentation observations.',
               'EventTiming duration is browser-measured input-to-next-paint latency, quantized by the browser; events below 16ms may be absent and are never invented.',
               'Double-RAF input bounds end after a first paint opportunity; they are not compositor completion timestamps.',
               'Absolute milliseconds are recorded, not used as CI pass/fail thresholds. Long-task observer overhead is common to both variants.',
               'Native storage seed/save/backup failures are reported as genuine workload blockers, never replaced with memory storage.'],
    'parameters': vars(args), 'runs': [], 'checks': [], 'errors': [], 'profiles': [],
}

def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def check(name, passed, detail=None):
    row = {'name': name, 'passed': bool(passed)}
    if detail is not None: row['detail'] = detail
    report['checks'].append(row)
    if not passed: raise AssertionError(name)


def summary(values):
    values = [float(value) for value in values if value is not None and math.isfinite(value)]
    if not values: return {'n': 0, 'median': None, 'p95': None, 'min': None, 'max': None}
    ordered = sorted(values)
    return {'n':len(values), 'median':statistics.median(values),
            'p95':ordered[max(0,math.ceil(len(ordered)*.95)-1)], 'min':ordered[0], 'max':ordered[-1]}


PROBE = r"""(() => {
 const key=__KEY__, source=__SAVE__;
 const native=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 const p={native:{date:native(Date.now),performance:native(performance.now),raf:native(requestAnimationFrame),
   timeout:native(setTimeout),interval:native(setInterval),get:native(Storage.prototype.getItem),set:native(Storage.prototype.setItem),
   storage:localStorage instanceof Storage}, frames:[],longTasks:[],events:[],inputs:[],errors:[],started:performance.now(),
   supported:PerformanceObserver.supportedEntryTypes,seedError:null};
 const seedStart=performance.now(), value=JSON.parse(source), now=Date.now();
 value.savedAt=value.lastTickAt=now;
 p.seeded=JSON.stringify(value,null,2); p.seededAt=now;
 try { localStorage.setItem(key,p.seeded);localStorage.setItem('infinity.ui.tab','overview'); }
 catch(error){p.seedError={name:error.name,message:error.message};}
 p.seedMs=performance.now()-seedStart;
 let previous=null;
 function frame(at){if(previous!==null)p.frames.push({at,interval:at-previous});previous=at;requestAnimationFrame(frame);}
 requestAnimationFrame(frame);
 if(p.supported.includes('longtask'))new PerformanceObserver(list=>{
   for(const e of list.getEntries())p.longTasks.push({start:e.startTime,duration:e.duration,name:e.name});
 }).observe({type:'longtask',buffered:true});
 if(p.supported.includes('event'))new PerformanceObserver(list=>{
   for(const e of list.getEntries())p.events.push({name:e.name,start:e.startTime,duration:e.duration,
    processingStart:e.processingStart,processingEnd:e.processingEnd,interactionId:e.interactionId});
 }).observe({type:'event',buffered:true,durationThreshold:16});
 document.addEventListener('click',event=>{
  const row={trusted:event.isTrusted,target:event.target.closest?.('[data-tab]')?.dataset.tab??event.target.id,
   start:performance.now(),eventTimestamp:event.timeStamp,firstRAF:null,afterPaintOpportunity:null};p.inputs.push(row);
  requestAnimationFrame(first=>{row.firstRAF=first;requestAnimationFrame(second=>{row.afterPaintOpportunity=second;});});
 },true);
 window.addEventListener('error',event=>p.errors.push(String(event.message)));
 window.__nativePresentationProbe={snapshot:(full=true)=>{
   const status=document.querySelector('[data-bind="status"]')?.textContent??null;
   const notice=document.querySelector('[data-bind="notice-text"]')?.textContent??'';
   const protectedState=/受保护|自动保存暂停|已暂停写入|本地存储不可用|临时初始画面/.test((status??'')+notice);
   return {...(full?p:{}),now:performance.now(),hidden:document.hidden,visibility:document.visibilityState,
    ready:!!document.querySelector('[data-bind="energy-chip"]'),status,notice,protectedState,
    ...(full?{currentRaw:localStorage.getItem(key)}:{frameCount:p.frames.length,longTaskCount:p.longTasks.length})};
 }};
})();"""


def snapshot(page, full=True):
    return page.evaluate('full=>window.__nativePresentationProbe.snapshot(full)', full)


def metrics(cdp):
    return {item['name']:item['value'] for item in cdp.send('Performance.getMetrics')['metrics']}


def delta(before, after):
    names = ('ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount')
    return {name: (after[name]-before[name]) * (1000 if name.endswith('Duration') else 1)
            for name in names if name in before and name in after}


def native_click(page, selector):
    # Genuine browser pointer dispatch; no element.click or synthetic event.
    page.locator(selector).click(timeout=30000)


def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible(): native_click(page,'[data-action="dismiss-offline"]')
    native_click(page,f'[data-tab="{name}"]')
    page.locator(f'[data-tab-panel="{name}"]').wait_for(state='visible')


def collect_sample(page, cdp, name):
    tab(page,name); page.wait_for_timeout(args.warmup_ms)
    before_probe=snapshot(page,False); before=metrics(cdp); host_start=time.perf_counter()
    page.wait_for_timeout(args.sample_ms)
    after=metrics(cdp); after_probe=snapshot(page,False)
    host_elapsed_ms=(time.perf_counter()-host_start)*1000
    observations=snapshot(page)  # Bulk records and native Storage are read outside the measured window.
    start,end=before_probe['now'],after_probe['now']
    frames=[row['interval'] for row in observations['frames'] if start<row['at']<=end]
    longs=[row for row in observations['longTasks'] if start<=row['start']<end]
    result={'tab':name,'startMs':start,'endMs':end,'nativeElapsedMs':end-start,
            'hostElapsedMs':host_elapsed_ms,'cpu':delta(before,after),
            'rawMetricsBefore':before,'rawMetricsAfter':after,'frameIntervalsMs':frames,
            'frameIntervalSummaryMs':summary(frames),'longTasks':longs,'longTaskDurationMs':sum(row['duration'] for row in longs),
            'visibilityBefore':before_probe['visibility'],'visibilityAfter':after_probe['visibility'],
            'protectedDuringSample':before_probe['protectedState'] or after_probe['protectedState'],
            'statusBefore':before_probe['status'],'statusAfter':after_probe['status'],
            'noticeBefore':before_probe['notice'],'noticeAfter':after_probe['notice']}
    check('sample remains genuinely visible',not before_probe['hidden'] and not after_probe['hidden'],{'tab':name})
    return result


def run(browser, profile, variant, repetition, order):
    url=args.before_url if variant=='before' else args.after_url
    parsed=urlparse(url)
    check('benchmark bundle is HTTP(S)',parsed.scheme in ('http','https'))
    context=browser.new_context(viewport={'width':1440,'height':1100},reduced_motion='reduce',accept_downloads=True)
    context.add_init_script(PROBE.replace('__KEY__',json.dumps(profile['key'])).replace('__SAVE__',json.dumps(profile['save'])))
    page=context.new_page();page.set_default_timeout(30000)
    run={'profile':profile['profile'],'variant':variant,'repetition':repetition,'pairOrder':order,'url':url,
         'sourceSaveSha256':digest(profile['save']),'sourceStateSha256':profile['stateSha256'],'samples':[],
         'pageErrors':[],'failedRequests':[],'qualified':False}
    report['runs'].append(run)
    page.on('pageerror',lambda error:run['pageErrors'].append(str(error)))
    page.on('requestfailed',lambda request:run['failedRequests'].append(request.url))
    cdp=context.new_cdp_session(page);cdp.send('Performance.enable')
    before=metrics(cdp);host=time.perf_counter()
    try:
        response=page.goto(url,wait_until='domcontentloaded',timeout=60000)
        check('actual production HTTP response',response is not None and response.status==200,{'url':url})
        page.locator('[data-bind="energy-chip"]').wait_for(timeout=60000)
        initialized=snapshot(page);after=metrics(cdp)
        run['initialization']={'hostToReadyMs':(time.perf_counter()-host)*1000,'documentToReadyMs':initialized['now'],
            'nativeSeedMs':initialized['seedMs'],'cpu':delta(before,after),'rawMetricsBefore':before,'rawMetricsAfter':after,
            'longTasks':initialized['longTasks'],'seededAt':initialized['seededAt'],'seededSaveSha256':digest(initialized['seeded']),
            'seededUtf8Bytes':len(initialized['seeded'].encode()),'seededStringChars':len(initialized['seeded'].encode('utf-16-le'))//2}
        run['nativeAPIs']=initialized['native'];run['seedError']=initialized['seedError']
        check('all measured clock, timer, RAF and Storage APIs are native',all(initialized['native'].values()))
        if initialized['seedError']:
            run['blocker']='Genuine native localStorage could not seed this profile; no ready-performance claim.'
            return
        seeded=json.loads(initialized['seeded'])
        check('only envelope timestamps changed from source fixture',seeded['state']==profile['ready']['state'])
        if initialized['currentRaw'] != initialized['seeded']:
            # A native startup may legitimately settle time and save; retain full
            # status and hashes rather than silently considering it the seed.
            run['startupStoredSha256']=digest(initialized['currentRaw'] or '')
        run['startupStatus']=initialized['status'];run['startupProtected']=initialized['protectedState']
        if run['startupProtected']:
            run['blocker']='Native save session is protected at startup; excluded from ready-gameplay comparison.'
            return
        page.wait_for_load_state('networkidle')
        for name in args.tabs.split(','): run['samples'].append(collect_sample(page,cdp,name.strip()))
        # Alternate actual nav targets to capture native input dispatch and paint.
        start=snapshot(page,False)['now']
        for name in ('overview','orders','fleet','overview','fleet','orders'):
            tab(page,name);page.wait_for_timeout(150)
        end=snapshot(page)
        run['interactions']={'startedMs':start,'events':[row for row in end['events'] if row['start']>=start],
            'paintOpportunityBounds':[row for row in end['inputs'] if row['start']>=start],
            'nativeEventTimingSupported':'event' in end['supported']}
        check('measured navigation inputs are genuine trusted events',all(row['trusted'] for row in run['interactions']['paintOpportunityBounds']))
        # Native persistence qualification happens AFTER CPU samples. Imported
        # replacement intentionally exercises genuine current+backup capacity.
        tab(page,'save');native_click(page,'[data-action="save"]')
        saved=snapshot(page)
        run['nativePersistence']={'manualSaveStatus':saved['status'],'currentChars':len((saved['currentRaw'] or '').encode('utf-16-le'))//2}
        page.locator('#transfer').fill(initialized['seeded']);before_replacement=snapshot(page)
        native_click(page,'[data-action="import-text"]')
        page.wait_for_timeout(50)
        replacement=snapshot(page)
        run['nativePersistence']['replacementStatus']=replacement['status']
        backups=page.evaluate('(key)=>Object.keys(localStorage).filter(k=>k.startsWith(key+".backup")).map(key=>({key,value:localStorage.getItem(key)}))',profile['key'])
        run['nativePersistence']['backups']=[{'key':row['key'],'sha256':digest(row['value'] or ''),
            'stringChars':len((row['value'] or '').encode('utf-16-le'))//2,
            'matchesPreImportNativeRead':row['value']==before_replacement['currentRaw'],
            'matchesManualSaveNativeRead':row['value']==saved['currentRaw']} for row in backups]
        run['nativePersistence']['manualSavedSha256']=digest(saved['currentRaw'] or '')
        run['nativePersistence']['preImportNativeReadSha256']=digest(before_replacement['currentRaw'] or '')
        run['nativePersistence']['postImportNativeReadSha256']=digest(replacement['currentRaw'] or '')
        run['nativePersistence']['currentCharsAfterReplacement']=len((replacement['currentRaw'] or '').encode('utf-16-le'))//2
        run['nativePersistence']['protectedAfterManualSave']=saved['protectedState']
        run['nativePersistence']['protectedAfterReplacement']=replacement['protectedState']
        run['nativePersistence']['manualSaveSucceeded']=saved['status']=='已保存到本地' and bool(saved['currentRaw']) and not saved['protectedState']
        run['nativePersistence']['replacementSucceeded']=replacement['status']=='已导入并存入本地' and bool(replacement['currentRaw']) and not replacement['protectedState']
        run['nativePersistence']['verifiedPreservedNativeBytes']=any(row['matchesPreImportNativeRead'] or row['matchesManualSaveNativeRead'] for row in run['nativePersistence']['backups'])
        run['nativePersistence']['qualified']=run['nativePersistence']['manualSaveSucceeded'] and run['nativePersistence']['replacementSucceeded'] and run['nativePersistence']['verifiedPreservedNativeBytes']
        run['readyDuringSamples']=not run['startupProtected'] and not any(sample['protectedDuringSample'] for sample in run['samples'])
        run['qualified']=run['readyDuringSamples'] and not run['pageErrors'] and not run['failedRequests']
        if not run['readyDuringSamples']:run['blocker']='Native save protection arose during timing; excluded from ready-gameplay aggregates.'
        check('native measurement has no production page errors or failed requests',not run['pageErrors'] and not run['failedRequests'],run['pageErrors'])
    finally:
        cdp.detach();context.close()


def served_identity(request, url):
    response=request.get(url,timeout=30000)
    check('identity document HTTP response',response.status==200,{'url':url})
    html=response.body();text=html.decode('utf-8')
    identity={'url':url,'htmlSha256':hashlib.sha256(html).hexdigest(),'assets':[]}
    release=request.get(urljoin(url,'release.json'),timeout=30000)
    identity['release']=release.json() if release.status==200 else {'httpStatus':release.status}
    for path in sorted(set(re.findall(r'(?:src|href)=[\"\']([^\"\']+\.(?:js|css))(?:[\"\'])',text))):
        asset_url=urljoin(url,path);asset=request.get(asset_url,timeout=30000)
        check('served bundle identity asset HTTP response',asset.status==200,{'url':asset_url})
        body=asset.body();sha=hashlib.sha256(body).hexdigest()
        release_path=urlparse(asset_url).path.removeprefix(urlparse(url).path)
        expected=identity['release'].get('files',{}).get(release_path)
        identity['assets'].append({'url':asset_url,'sha256':sha,'bytes':len(body),'releaseExpectedSha256':expected})
        if expected:check('served asset matches release manifest hash',sha==expected,{'url':asset_url})
    check('served JavaScript identity recorded',any(urlparse(item['url']).path.endswith('.js') for item in identity['assets']))
    return identity


def aggregate():
    grouped={}
    for run in report['runs']:
        if not run['qualified']:continue
        key=(run['profile'],run['variant'])
        bucket=grouped.setdefault(key,{'startupScriptMs':[],'startupTaskMs':[],'startupHostMs':[],'tabs':{},'eventLatencyMs':[],'paintOpportunityBoundMs':[]})
        bucket['startupScriptMs'].append(run['initialization']['cpu'].get('ScriptDuration'))
        bucket['startupTaskMs'].append(run['initialization']['cpu'].get('TaskDuration'))
        bucket['startupHostMs'].append(run['initialization']['hostToReadyMs'])
        for sample in run['samples']:
            tab_group=bucket['tabs'].setdefault(sample['tab'],{'scriptMs':[],'taskMs':[],'scriptMsPerSecond':[],'taskMsPerSecond':[],'longTaskMs':[],'frameIntervalsMs':[]})
            for metric,name in [('ScriptDuration','scriptMs'),('TaskDuration','taskMs')]:
                value=sample['cpu'].get(metric);tab_group[name].append(value)
                tab_group[name+'PerSecond'].append(None if value is None else value*1000/sample['nativeElapsedMs'])
            tab_group['longTaskMs'].append(sample['longTaskDurationMs']);tab_group['frameIntervalsMs'].extend(sample['frameIntervalsMs'])
        interactions={}
        for event in run['interactions']['events']:
            ident=event.get('interactionId')
            if ident:interactions[ident]=max(interactions.get(ident,0),event['duration'])
        bucket['eventLatencyMs'].extend(interactions.values())
        bucket['paintOpportunityBoundMs'].extend(row['afterPaintOpportunity']-row['start'] for row in run['interactions']['paintOpportunityBounds'] if row['afterPaintOpportunity'] is not None)
    results=[]
    for (profile,variant),bucket in grouped.items():
        results.append({'profile':profile,'variant':variant,**{key:summary(value) for key,value in bucket.items() if key!='tabs'},
                        'tabs':{tab:{metric:summary(values) for metric,values in metrics.items()} for tab,metrics in bucket['tabs'].items()}})
    report['summary']=results
    comparisons=[]
    for profile in {row['profile'] for row in results}:
        pair={row['variant']:row for row in results if row['profile']==profile}
        if set(pair)!={'before','after'}:continue
        for tab in pair['before']['tabs']:
            for metric in ('scriptMsPerSecond','taskMsPerSecond'):
                before=pair['before']['tabs'][tab][metric]['median'];after=pair['after']['tabs'][tab][metric]['median']
                comparisons.append({'profile':profile,'tab':tab,'metric':metric,'beforeMedian':before,'afterMedian':after,
                    'afterOverBefore':after/before if before else None,'relativeImprovement':1-after/before if before else None})
    report['comparisons']=comparisons


profiles=[]
for path,label in [(args.moderate_fixture,'moderate'),(args.fixture,'combined')]:
    if not path:continue
    source=json.loads(Path(path).read_text())
    ready=source.get('ready',source.get('base'))
    raw=source.get('save',json.dumps(ready,ensure_ascii=False,indent=2))
    profile={'profile':source.get('profile',label),'key':source['key'],'ready':ready,'save':raw,
             'stateSha256':digest(json.dumps(ready['state'],sort_keys=True,separators=(',',':'),ensure_ascii=False))}
    profiles.append(profile)
    report['profiles'].append({'profile':profile['profile'],'path':path,'description':source['description'],
        'sourceSaveSha256':digest(raw),'sourceStateSha256':profile['stateSha256'],'sourceUtf8Bytes':len(raw.encode()),
        'sourceStringChars':len(raw.encode('utf-16-le'))//2,'manifest':source.get('manifest')})
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    report['environment']={'platform':platform.platform(),'python':platform.python_version(),'browser':browser.version}
    try:
        request=playwright.request.new_context()
        try:report['servedBundles']={name:served_identity(request,url) for name,url in [('before',args.before_url),('after',args.after_url)]}
        finally:request.dispose()
        for profile in profiles:
            for repetition in range(args.repetitions):
                order=('before','after') if repetition%2==0 else ('after','before')
                for variant in order:run(browser,profile,variant,repetition,list(order))
        report['completed']=True
    except BaseException as error:
        report['errors'].append(str(error));raise
    finally:
        aggregate()
        (out/'presentation-performance-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps({'completed':report['completed'],'runs':len(report['runs']),'qualifiedRuns':sum(row['qualified'] for row in report['runs']),
            'comparisons':report.get('comparisons',[])},ensure_ascii=False))
        browser.close()
