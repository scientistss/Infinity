"""Paired actual browser CPU/presentation measurements, separate from controlled correctness.

Real HTTP bundles and anonymous native localStorage. Date, performance, RAF,
intervals, visibility and Storage are NEVER replaced. CDP Performance metrics and
PerformanceObserver records are observations, not application hooks. Frame gaps
are NOT claimed as CPU time. Slow EventTiming entries measure native interaction
latency; double-RAF observations are explicitly paint-opportunity bounds only.
"""
import argparse
import faulthandler
import hashlib
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
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, urljoin

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--before-url')
parser.add_argument('--after-url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture')
parser.add_argument('--moderate-fixture')
parser.add_argument('--output', default='presentation-performance-evidence')
parser.add_argument('--chromium')
parser.add_argument('--repetitions', type=int, default=3)
parser.add_argument('--sample-ms', type=int, default=1500)
parser.add_argument('--warmup-ms', type=int, default=600)
parser.add_argument('--tabs', default='overview,orders,fleet')
parser.add_argument('--measurement-worker', action='store_true', help=argparse.SUPPRESS)
parser.add_argument('--invocation-id', help=argparse.SUPPRESS)
parser.add_argument('--watchdog-self-test', action='store_true', help='Run stdlib-only supervisor checks; no browser, server or fixture')
args = parser.parse_args()
REPORT_NAME = 'presentation-performance-browser-report.json'
PROGRESS_NAME = 'presentation-performance-progress.json'
PHASE_TIMEOUT_SECONDS = 90
WHOLE_TIMEOUT_SECONDS = 8 * 60


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.' + str(os.getpid()) + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)


def read_json(path):
    try: return json.loads(path.read_text())
    except (OSError, ValueError): return None


def process_identity(pid):
    try:
        fields=Path(f'/proc/{pid}/stat').read_text().split(') ',1)[1].split()
        return {'pid':pid,'parentPid':int(fields[1]),'processGroup':int(fields[2]),'session':int(fields[3]),'startTime':fields[19],'state':fields[0]}
    except (OSError,IndexError,ValueError):return None


PROCESS_TRACKING_METHODS=set()


def collect_owned_descendants(root_pid, owned):
    # PID + kernel start time prevents signaling a reused unrelated process.
    # Tracking ancestry also covers Chromium's detached process groups.
    pending=[root_pid,*owned]
    visited=set()
    needs_stat_fallback=False
    while pending:
        pid=pending.pop()
        if pid in visited:continue
        visited.add(pid)
        identity=process_identity(pid)
        if not identity or (pid in owned and identity['startTime']!=owned[pid]['startTime']):continue
        owned[pid]=identity
        try:thread_children=list(Path(f'/proc/{pid}/task').glob('*/children'))
        except OSError:thread_children=[]
        if not thread_children:needs_stat_fallback=True
        for path in thread_children:
            try:children=path.read_text().split()
            except OSError:
                needs_stat_fallback=True;continue
            PROCESS_TRACKING_METHODS.add('all-thread-children')
            pending.extend(int(child) for child in children)
    if not needs_stat_fallback:return
    # Some managed Linux environments expose stat/PPID but omit task/*/children.
    # Read only public ownership metadata, never cmdline or environ. Reconstruct
    # descendant edges from current PPIDs, anchored in already verified owners.
    PROCESS_TRACKING_METHODS.add('stat-ppid-fallback')
    try:entries=list(Path('/proc').iterdir())
    except OSError:return
    records={}
    for entry in entries:
        if not entry.name.isdecimal():continue
        identity=process_identity(int(entry.name))
        if identity:records[identity['pid']]=identity
    trusted={pid for pid,identity in records.items() if pid in owned and identity['startTime']==owned[pid]['startTime']}
    if root_pid in records and (root_pid not in owned or records[root_pid]['startTime']==owned[root_pid]['startTime']):
        trusted.add(root_pid);owned[root_pid]=records[root_pid]
    changed=True
    while changed:
        changed=False
        for pid,identity in records.items():
            if pid in trusted or identity['parentPid'] not in trusted:continue
            if pid in owned and identity['startTime']!=owned[pid]['startTime']:continue
            owned[pid]=identity;trusted.add(pid);changed=True


def live_owned(owned):
    result=[]
    for pid,original in owned.items():
        current=process_identity(pid)
        if current and current['startTime']==original['startTime'] and current['state']!='Z':result.append(pid)
    return result


def kill_owned_group(process, owned, dump_stack=False):
    # Never pkill/killall. The worker starts in its own group; detached browser
    # descendants are additionally limited to verified ancestry and start times.
    collect_owned_descendants(process.pid,owned)
    if dump_stack and process.poll() is None:
        try:os.kill(process.pid,signal.SIGUSR1)
        except ProcessLookupError:pass
        time.sleep(.1)
    collect_owned_descendants(process.pid,owned)
    signaled=[]
    for sig in (signal.SIGTERM,signal.SIGKILL):
        collect_owned_descendants(process.pid,owned)
        if process.pid in live_owned(owned):
            try:os.killpg(process.pid,sig)
            except ProcessLookupError:pass
        for pid in live_owned(owned):
            try:os.kill(pid,sig);signaled.append({'pid':pid,'signal':sig.name})
            except ProcessLookupError:pass
        try:process.wait(timeout=.5)
        except subprocess.TimeoutExpired:pass
        until=time.monotonic()+.5
        while live_owned(owned) and time.monotonic()<until:time.sleep(.02)
    remaining=live_owned(owned)
    return {'observedOwnedPids':sorted(owned),'signals':signaled,'remainingLiveOwnedPids':remaining,
            'noObservedLiveOwnedDescendants':not remaining,'observedTrackingMethods':sorted(PROCESS_TRACKING_METHODS),'tracking':'Observed Linux /proc all-thread children or stat PPID ancestry plus PID start time, including detached process groups; polling cannot prove absence of never-observed reparented processes'}


def supervise(command, directory, invocation, phase_timeout=PHASE_TIMEOUT_SECONDS, whole_timeout=WHOLE_TIMEOUT_SECONDS):
    directory.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    bootstrap = {'invocationId':invocation, 'phase':'worker.spawn', 'state':'before', 'monotonic':started, 'wallTime':time.time(), 'identity':{}}
    atomic_json(directory / PROGRESS_NAME, bootstrap)
    atomic_json(directory / REPORT_NAME, {'completed':False, 'invocationId':invocation, 'phase':bootstrap, 'runs':[], 'checks':[], 'errors':[]})
    print(json.dumps({'nativePerformance':'supervisor-start', 'invocationId':invocation,
        'phaseTimeoutSeconds':phase_timeout, 'wholeTimeoutSeconds':whole_timeout}), flush=True)
    process = None
    timeout_reason = None
    last_phase = bootstrap
    owned={}
    try:
        process = subprocess.Popen(command, start_new_session=True)
        while process.poll() is None:
            now = time.monotonic()
            collect_owned_descendants(process.pid,owned)
            progress = read_json(directory / PROGRESS_NAME)
            if progress and progress.get('invocationId') == invocation: last_phase = progress
            if now - started >= whole_timeout:
                timeout_reason = 'whole-run-timeout'; break
            if now - last_phase.get('monotonic', started) >= phase_timeout:
                timeout_reason = 'stale-phase-timeout'; break
            time.sleep(.1)
        if timeout_reason:
            print(json.dumps({'nativePerformance':'watchdog-timeout', 'reason':timeout_reason,
                'phase':last_phase, 'elapsedSeconds':time.monotonic()-started}), flush=True)
            cleanup=kill_owned_group(process,owned,dump_stack=True)
        else:
            # Even a prematurely exited worker cannot leave its Chromium children.
            cleanup=kill_owned_group(process,owned)
        progress=read_json(directory/PROGRESS_NAME)
        if progress and progress.get('invocationId')==invocation:last_phase=progress
        result = read_json(directory / REPORT_NAME) or {'runs':[], 'errors':[]}
        result['supervisor'] = {'invocationId':invocation, 'phaseTimeoutSeconds':phase_timeout,
            'wholeTimeoutSeconds':whole_timeout, 'elapsedSeconds':time.monotonic()-started,
            'workerExitCode':process.returncode, 'timeoutReason':timeout_reason,
            'lastPhase':last_phase, 'ownedProcessGroup':process.pid, 'ownedGroupCleanupAttempted':True,'cleanup':cleanup}
        if timeout_reason or process.returncode != 0 or not result.get('completed') or not cleanup['noObservedLiveOwnedDescendants']:
            result['completed'] = False
            result.setdefault('errors', []).append(timeout_reason or f'worker exited {process.returncode} without completed evidence')
            for run in result.get('runs', []):
                if not run.get('completed'): run['qualified'] = False
            atomic_json(directory / REPORT_NAME, result)
            return 124 if timeout_reason else process.returncode or 1
        atomic_json(directory / REPORT_NAME, result)
        print(json.dumps({'nativePerformance':'supervisor-complete', 'elapsedSeconds':result['supervisor']['elapsedSeconds']}), flush=True)
        return 0
    except BaseException as error:
        if process is not None: cleanup=kill_owned_group(process,owned)
        result = read_json(directory / REPORT_NAME) or {'runs':[], 'errors':[]}
        result['completed'] = False
        result.setdefault('errors', []).append('supervisor: '+str(error))
        result['supervisor'] = {'lastPhase':last_phase, 'ownedProcessGroup':process.pid if process else None,
            'ownedGroupCleanupAttempted':process is not None}
        atomic_json(directory / REPORT_NAME, result)
        raise


def watchdog_self_test():
    # Deliberately tiny budgets test the external supervisor itself, not browser
    # performance. The production constants remain exactly 90 and 480 seconds.
    with tempfile.TemporaryDirectory(prefix='native-performance-watchdog-') as temporary:
        root = Path(temporary)
        cases = [('healthy',0,False), ('failed-exit',7,False), ('stalled-call',124,True), ('stalled-cleanup',124,True)]
        for name, expected, stall in cases:
            directory = root / name; directory.mkdir()
            invocation = uuid.uuid4().hex
            code = """import json,os,signal,subprocess,sys,time
from pathlib import Path
out=Path(sys.argv[1]);token=sys.argv[2];name=sys.argv[3]
signal.signal(signal.SIGUSR1,lambda *_:None)
phase={'invocationId':token,'phase':'cleanup.close' if name=='stalled-cleanup' else name,'state':'before','monotonic':time.monotonic(),'identity':{'selfTest':name}}
(out/'presentation-performance-progress.json').write_text(json.dumps(phase))
report={'completed':name=='healthy','invocationId':token,'phase':phase,'runs':[{'completed':name=='healthy','qualified':name=='healthy'}],'errors':['original-error-retained'] if name=='stalled-cleanup' else []}
(out/'presentation-performance-browser-report.json').write_text(json.dumps(report))
if name.startswith('stalled'):
 child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True)
 (out/'descendant.pid').write_text(str(child.pid))
 time.sleep(60)
sys.exit(7 if name=='failed-exit' else 0)
"""
            actual = supervise([sys.executable,'-u','-c',code,str(directory),invocation,name],directory,invocation,
                               phase_timeout=.5,whole_timeout=3)
            assert actual == expected, (name,actual,expected)
            result = read_json(directory / REPORT_NAME)
            print(json.dumps({'watchdogSelfTest':name,'cleanup':result['supervisor']['cleanup']},ensure_ascii=False),flush=True)
            assert result['completed'] == (name=='healthy'), name
            assert result['supervisor']['ownedGroupCleanupAttempted'], name
            assert result['supervisor']['cleanup']['noObservedLiveOwnedDescendants'], name
            if stall:
                assert result['supervisor']['timeoutReason']=='stale-phase-timeout', name
                assert not result['runs'][0]['qualified'], name
                pid = int((directory/'descendant.pid').read_text())
                stat = Path(f'/proc/{pid}/stat')
                # A killed grandchild can briefly remain a zombie until init reaps it.
                assert not stat.exists() or stat.read_text().split(') ',1)[1].startswith('Z'), {'case':name,'descendantPid':pid,'cleanup':result['supervisor']['cleanup']}
            if name=='stalled-cleanup':assert 'original-error-retained' in result['errors']
            print(json.dumps({'watchdogSelfTest':name,'passed':True}),flush=True)
    return 0


if args.watchdog_self_test:
    sys.exit(watchdog_self_test())
if not args.before_url or not args.fixture:
    parser.error('--before-url and --fixture are required for measurement')
if args.repetitions < 2 or args.sample_ms < 500 or args.warmup_ms < 100:
    parser.error('At least two paired repetitions, 500ms samples and 100ms warmup are required')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
if not args.measurement_worker:
    invocation = uuid.uuid4().hex
    command = [sys.executable,'-u',str(Path(__file__).resolve()),*sys.argv[1:],'--measurement-worker','--invocation-id',invocation]
    sys.exit(supervise(command,out,invocation))

# Only the supervised worker imports/starts Playwright. The independent watchdog
# remains live even when its greenlet or CDP transport is stuck indefinitely.
from playwright.sync_api import sync_playwright
stack_file = (out/'presentation-performance-worker-stack.txt').open('w')
faulthandler.enable(file=stack_file, all_threads=True)
faulthandler.register(signal.SIGUSR1, file=stack_file, all_threads=True)
active_identity = {}
report = {
    'completed': False, 'invocationId':args.invocation_id, 'phaseHistory':[], 'classification': 'actual native browser timings / HTTP / native localStorage / unmodified clocks, RAF and timers',
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

def checkpoint(phase, state, **detail):
    item = {'invocationId':args.invocation_id, 'phase':phase, 'state':state,
            'monotonic':time.monotonic(), 'wallTime':time.time(), 'identity':dict(active_identity), **detail}
    report['phase'] = item
    report['phaseHistory'].append(item)
    # Progress first: the supervisor can distinguish slow serialization from a
    # blocked browser call. Both files are atomic and contain no fixture payload.
    atomic_json(out/PROGRESS_NAME,item)
    atomic_json(out/REPORT_NAME,report)
    print(json.dumps({'nativePerformance':phase,'state':state,'identity':item['identity'],**detail}),flush=True)


def brief_error(error):
    value=str(error)
    if len(value)<=2400:return value
    return value[:1800]+' ... [error text truncated; chars='+str(len(value))+'; sha256='+hashlib.sha256(value.encode()).hexdigest()+'] ... '+value[-400:]


def phase_call(name, action, **detail):
    checkpoint(name,'before',**detail)
    try: result = action()
    except BaseException as error:
        report['errors'].append({'phase':name,'identity':dict(active_identity),'error':brief_error(error)})
        checkpoint(name,'error',error=brief_error(error),**detail)
        raise
    checkpoint(name,'after',**detail)
    return result


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
   storage:localStorage instanceof Storage,fileText:native(File.prototype.text)}, frames:[],longTasks:[],events:[],inputs:[],errors:[],started:performance.now(),
   supported:PerformanceObserver.supportedEntryTypes,seedError:null,visibilityEvents:[],fileSelections:[]};
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
 document.addEventListener('visibilitychange',event=>p.visibilityEvents.push({at:performance.now(),hidden:document.hidden,visibility:document.visibilityState,trusted:event.isTrusted}));
 document.addEventListener('change',event=>{
  if(event.target instanceof HTMLInputElement&&event.target.type==='file')p.fileSelections.push({at:performance.now(),trusted:event.isTrusted,files:[...event.target.files].map(file=>({name:file.name,size:file.size,type:file.type}))});
 },true);
 window.__nativePresentationProbe={snapshot:(full=true,verifyImport=false)=>{
   const status=document.querySelector('[data-bind="status"]')?.textContent??null;
   const notice=document.querySelector('[data-bind="notice-text"]')?.textContent??'';
   const protectedState=/受保护|自动保存暂停|已暂停写入|本地存储不可用|临时初始画面/.test((status??'')+notice);
   const currentRaw=full?localStorage.getItem(key):null,readAt=performance.now();
   let currentByteProof=null;
   if(verifyImport){
    const actual=JSON.parse(currentRaw),expected=JSON.parse(p.seeded);
    expected.savedAt=actual.savedAt;expected.lastTickAt=actual.lastTickAt;
    currentByteProof={matches:JSON.stringify(expected,null,2)===currentRaw,savedAt:actual.savedAt,
     lastTickAt:actual.lastTickAt,stringChars:currentRaw.length,readAt};
   }
   return {...(full?p:{}),now:performance.now(),hidden:document.hidden,visibility:document.visibilityState,
    ready:!!document.querySelector('[data-bind="energy-chip"]'),status,notice,protectedState,frameCount:p.frames.length,longTaskCount:p.longTasks.length,inputCount:p.inputs.length,visibilityEventCount:p.visibilityEvents.length,
    ...(full?{currentRaw,currentReadAt:readAt}:{}),...(verifyImport?{currentByteProof}:{})};
 }};
})();"""


def snapshot(page, full=True, instrument=True, verify_import=False):
    action=lambda:page.evaluate('({full,verifyImport})=>window.__nativePresentationProbe.snapshot(full,verifyImport)',{'full':full,'verifyImport':verify_import})
    return phase_call('snapshot.bulk' if full else 'snapshot.light',action) if instrument else action()


def metrics(cdp, instrument=True):
    action=lambda:cdp.send('Performance.getMetrics')
    result=phase_call('cdp.metrics',action) if instrument else action()
    return {item['name']:item['value'] for item in result['metrics']}


def delta(before, after):
    names = ('ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount')
    return {name: (after[name]-before[name]) * (1000 if name.endswith('Duration') else 1)
            for name in names if name in before and name in after}


def native_click(page, selector):
    # Genuine browser pointer dispatch; no element.click or synthetic event.
    phase_call('input.native-click',lambda:page.locator(selector).click(timeout=30000),selector=selector)


def tab(page, name):
    if phase_call('navigation.offline-modal',lambda:page.locator('[data-bind="offline-modal"]').is_visible()): native_click(page,'[data-action="dismiss-offline"]')
    native_click(page,f'[data-tab="{name}"]')
    phase_call('navigation.visible-panel',lambda:page.locator(f'[data-tab-panel="{name}"]').wait_for(state='visible'),tab=name)


def collect_sample(page, cdp, name):
    active_identity['sample']=name
    tab(page,name); phase_call('sample.warmup',lambda:page.wait_for_timeout(args.warmup_ms),milliseconds=args.warmup_ms)
    # No checkpoints, stdout, file I/O or callbacks added inside the CPU window.
    # A watchdog stack dump identifies the exact blocked Python line if needed.
    checkpoint('sample.measure-block','before',operations=['snapshot.light','cdp.metrics.start','native-wait','cdp.metrics.end','snapshot.light'])
    before_probe=snapshot(page,False,instrument=False); before=metrics(cdp,instrument=False); host_start=time.perf_counter()
    page.wait_for_timeout(args.sample_ms)
    after=metrics(cdp,instrument=False); after_probe=snapshot(page,False,instrument=False)
    host_elapsed_ms=(time.perf_counter()-host_start)*1000
    checkpoint('sample.measure-block','after')
    observations=snapshot(page)  # Bulk records and native Storage are read outside the measured window.
    start,end=before_probe['now'],after_probe['now']
    aligned_metric_elapsed_ms=(after.get('Timestamp',float('nan'))-before.get('Timestamp',float('nan')))*1000
    check('CDP CPU metric window has a finite positive aligned timestamp duration',math.isfinite(aligned_metric_elapsed_ms) and aligned_metric_elapsed_ms>0)
    frames=[row['interval'] for row in observations['frames'] if start<row['at']<=end]
    longs=[row for row in observations['longTasks'] if start<=row['start']<end]
    result={'tab':name,'startMs':start,'endMs':end,'nativeElapsedMs':end-start,
            'hostElapsedMs':host_elapsed_ms,'alignedMetricElapsedMs':aligned_metric_elapsed_ms,'cpu':delta(before,after),
            'rawMetricsBefore':before,'rawMetricsAfter':after,'frameIntervalsMs':frames,
            'frameIntervalSummaryMs':summary(frames),'longTasks':longs,'longTaskDurationMs':sum(row['duration'] for row in longs),
            'visibilityBefore':before_probe['visibility'],'visibilityAfter':after_probe['visibility'],
            'protectedDuringSample':before_probe['protectedState'] or after_probe['protectedState'],
            'statusBefore':before_probe['status'],'statusAfter':after_probe['status'],
            'noticeBefore':before_probe['notice'],'noticeAfter':after_probe['notice']}
    check('sample remains genuinely visible',not before_probe['hidden'] and not after_probe['hidden'],{'tab':name})
    checkpoint('sample.complete','after',tab=name)
    return result


def run(browser, profile, variant, repetition, order):
    url=args.before_url if variant=='before' else args.after_url
    parsed=urlparse(url)
    check('benchmark bundle is HTTP(S)',parsed.scheme in ('http','https'))
    active_identity.clear();active_identity.update(profile=profile['profile'],variant=variant,repetition=repetition,url=url)
    run={'profile':profile['profile'],'variant':variant,'repetition':repetition,'pairOrder':order,'url':url,
         'sourceSaveSha256':digest(profile['save']),'sourceStateSha256':profile['stateSha256'],'samples':[],
         'pageErrors':[],'failedRequests':[],'qualified':False,'completed':False}
    report['runs'].append(run)
    context=page=cdp=None
    checkpoint('run.begin','before')
    try:
        context=phase_call('context.create',lambda:browser.new_context(viewport={'width':1440,'height':1100},reduced_motion='reduce',accept_downloads=True))
        phase_call('context.init-script',lambda:context.add_init_script(PROBE.replace('__KEY__',json.dumps(profile['key'])).replace('__SAVE__',json.dumps(profile['save']))))
        page=phase_call('page.create',context.new_page);page.set_default_timeout(30000)
        page.on('pageerror',lambda error:run['pageErrors'].append(str(error)))
        page.on('requestfailed',lambda request:run['failedRequests'].append(request.url))
        cdp=phase_call('cdp.session',lambda:context.new_cdp_session(page))
        phase_call('cdp.enable',lambda:cdp.send('Performance.enable'))
        checkpoint('initialization.measure-block','before',operations=['cdp.metrics.start','page.goto','ready-locator','snapshot.light','cdp.metrics.end'])
        before=metrics(cdp,instrument=False);host=time.perf_counter()
        response=page.goto(url,wait_until='domcontentloaded',timeout=60000)
        check('actual production HTTP response',response is not None and response.status==200,{'url':url})
        page.locator('[data-bind="energy-chip"]').wait_for(timeout=60000)
        ready_light=snapshot(page,False,instrument=False);after=metrics(cdp,instrument=False)
        initialization_host_ms=(time.perf_counter()-host)*1000
        checkpoint('initialization.measure-block','after')
        initialized=snapshot(page)
        run['initialization']={'hostToReadyMs':initialization_host_ms,'documentToReadyMs':ready_light['now'],
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
        phase_call('initialization.network-idle',lambda:page.wait_for_load_state('networkidle'))
        for name in args.tabs.split(','):
            run['samples'].append(collect_sample(page,cdp,name.strip()))
            checkpoint('sample.recorded','after',tab=name.strip())
        active_identity.pop('sample',None)
        checkpoint('inputs.begin','before')
        # Alternate actual nav targets to capture native input dispatch and paint.
        start=snapshot(page,False)['now']
        for name in ('overview','orders','fleet','overview','fleet','orders'):
            tab(page,name);phase_call('input.settle',lambda:page.wait_for_timeout(150),tab=name)
        end=snapshot(page)
        run['interactions']={'startedMs':start,'events':[row for row in end['events'] if row['start']>=start],
            'paintOpportunityBounds':[row for row in end['inputs'] if row['start']>=start],
            'nativeEventTimingSupported':'event' in end['supported']}
        check('measured navigation inputs are genuine trusted events',all(row['trusted'] for row in run['interactions']['paintOpportunityBounds']))
        # Native persistence qualification happens AFTER CPU samples. Imported
        # replacement intentionally exercises genuine current+backup capacity.
        checkpoint('persistence.begin','before')
        tab(page,'save');native_click(page,'[data-action="save"]')
        saved=snapshot(page)
        run['nativePersistence']={'manualSaveStatus':saved['status'],'currentChars':len((saved['currentRaw'] or '').encode('utf-16-le'))//2,
            'importRoute':'existing native file input / native File.text / unchanged full rebased seed bytes',
            'giantTextLimitation':'Prior cca22ec baseline combined run timed out filling the 1.90M-character textarea before import; actionability versus browser text insertion cost remains unresolved. This file route does not qualify giant-text editing.'}
        file_path=out/f"native-import-{profile['profile']}-{variant}-{repetition}.json"
        file_bytes=initialized['seeded'].encode('utf-8')
        phase_call('persistence.prepare-file',lambda:file_path.write_bytes(file_bytes))
        check('native file input receives the exact full rebased payload bytes',file_path.read_bytes()==file_bytes)
        run['nativePersistence']['inputFile']={'path':str(file_path.resolve()),'sha256':hashlib.sha256(file_bytes).hexdigest(),
            'utf8Bytes':len(file_bytes),'stringChars':len(initialized['seeded'].encode('utf-16-le'))//2}
        run['nativePersistence']['preImportDOM']=phase_call('persistence.pre-import-dom',lambda:page.evaluate('''() => {
          const text=document.querySelector('#transfer'),file=document.querySelector('[data-bind="import-file"]');
          const rect=text.getBoundingClientRect(),style=getComputedStyle(text);
          return {visiblePanel:[...document.querySelectorAll('[data-tab-panel]')].find(e=>!e.hidden)?.dataset.tabPanel,
           hidden:document.hidden,visibility:document.visibilityState,activeElement:document.activeElement?.id,
           transfer:{disabled:text.disabled,readOnly:text.readOnly,valueChars:text.value.length,display:style.display,visibility:style.visibility,width:rect.width,height:rect.height},
           file:{type:file.type,disabled:file.disabled,accept:file.accept}};
        }'''))
        before_replacement=snapshot(page)
        # Install only AFTER every steady-state CPU/input measurement. This
        # read-only observer captures the first import terminal DOM update in its
        # microtask, before a later native autosave can replace the committed raw.
        witness_id=f"{args.invocation_id}:{profile['profile']}:{variant}:{repetition}"
        phase_call('persistence.arm-terminal-witness',lambda:page.evaluate(r'''({key,name,size,id}) => {
          const statusNode=document.querySelector('[data-bind="status"]');
          const initialStatus=statusNode.textContent;
          if(!['已保存到本地','已自动保存'].includes(initialStatus))throw Error('Persistence witness requires a fresh ready-save status, never an earlier import result');
          let selected=null,selectionCount=0,witness=null;
          const terminal=status=>status==='已导入并存入本地'||status.startsWith('导入失败')||/文件读取期间出现了更新的操作|受保护|已暂停写入|本地存储不可用/.test(status);
          const onFile=event=>{
            if(event.target!==document.querySelector('[data-bind="import-file"]')||!(event.target instanceof HTMLInputElement)||event.target.type!=='file')return;
            selectionCount++;
            const files=[...event.target.files];
            if(!event.isTrusted||files.length!==1||files[0].name!==name||files[0].size!==size)throw Error('Unexpected native file selection for persistence witness');
            if(selected!==null)throw Error('Persistence witness cannot reuse a prior file selection');
            selected=Object.freeze({at:performance.now(),wallAt:Date.now(),trusted:event.isTrusted,
              name:files[0].name,size:files[0].size,priorRaw:localStorage.getItem(key)});
          };
          const observer=new MutationObserver(()=>{
            const status=statusNode.textContent;
            if(witness||!selected||!terminal(status))return;
            const observed=window.__nativePresentationProbe.snapshot(true,true);
            const backups=Object.keys(localStorage).filter(k=>k.startsWith(key+'.backup'))
              .map(key=>Object.freeze({key,value:localStorage.getItem(key)}));
            witness=Object.freeze({id,initialStatus,selectionCount,selected,status:observed.status,
              notice:observed.notice,at:observed.now,hidden:observed.hidden,visibility:observed.visibility,
              protectedState:observed.protectedState,currentRaw:observed.currentRaw,
              currentByteProof:Object.freeze(observed.currentByteProof),backups:Object.freeze(backups)});
            observer.disconnect();document.removeEventListener('change',onFile,true);
          });
          observer.observe(statusNode,{subtree:true,childList:true,characterData:true});
          document.addEventListener('change',onFile,true);
          window.__nativePersistenceWitness=()=>witness;
        }''',{'key':profile['key'],'name':file_path.name,'size':len(file_bytes),'id':witness_id}))
        persistence_cpu_before=metrics(cdp);persistence_started=time.perf_counter()
        phase_call('persistence.select-native-file',lambda:page.locator('[data-bind="import-file"]').set_input_files(str(file_path.resolve()),timeout=30000))
        # File.text and the replacement transaction are genuinely asynchronous.
        # Wait for a terminal DOM result; a fixed sleep is not an acknowledgement.
        completion=phase_call('persistence.await-file-result',lambda:page.wait_for_function(
            '() => window.__nativePersistenceWitness?.() || false',polling=50,timeout=30000).json_value())
        persistence_cpu_after=metrics(cdp)
        run['nativePersistence']['completion']={key:completion[key] for key in ('status','notice','at','hidden','visibility')}
        check('first terminal witness belongs to the exact single trusted file selection',
            completion['id']==witness_id and completion['initialStatus'] in ('已保存到本地','已自动保存') and completion['selectionCount']==1
            and completion['selected']['trusted'] and completion['selected']['name']==file_path.name
            and completion['selected']['size']==len(file_bytes) and completion['at']>=completion['selected']['at'])
        run['nativePersistence']['terminalWitness']={'id':completion['id'],'initialStatus':completion['initialStatus'],
            'selectionCount':completion['selectionCount'],'selectedAt':completion['selected']['at'],
            'selectedWallAt':completion['selected']['wallAt'],'terminalAt':completion['at'],
            'preFileNativeReadSha256':digest(completion['selected']['priorRaw'] or ''),
            'committedNativeReadSha256':digest(completion['currentRaw'] or ''),
            'scope':'Read-only observer installed after CPU sampling; first terminal DOM microtask bound to one trusted expected file change, native current and backups captured synchronously.'}
        run['nativePersistence']['diagnostics']={'hostElapsedMs':(time.perf_counter()-persistence_started)*1000,
            'cpu':delta(persistence_cpu_before,persistence_cpu_after),'rawMetricsBefore':persistence_cpu_before,'rawMetricsAfter':persistence_cpu_after,
            'scope':'Separate post-measurement persistence diagnostic span, including normal game work during native file selection/async completion and controller waits; never part of steady-state comparison.'}
        replacement=snapshot(page)
        visibility_events=[event for event in replacement['visibilityEvents'] if event['at']>=before_replacement['now']]
        run['nativePersistence']['visibilityEvents']=visibility_events
        run['nativePersistence']['nativeCounts']={'before':{key:before_replacement[key] for key in ('frameCount','longTaskCount','inputCount','visibilityEventCount')},
            'after':{key:replacement[key] for key in ('frameCount','longTaskCount','inputCount','visibilityEventCount')}}
        run['nativePersistence']['fileSelections']=[event for event in replacement['fileSelections'] if event['at']>=before_replacement['now']]
        check('browser selected the actual full-size JSON file',any(file['name']==file_path.name and file['size']==len(file_bytes) for event in run['nativePersistence']['fileSelections'] for file in event['files']))
        run['nativePersistence']['remainedVisible']=not before_replacement['hidden'] and not completion['hidden'] and not replacement['hidden'] and not any(event['hidden'] for event in visibility_events)
        check('native file persistence remains visible',run['nativePersistence']['remainedVisible'])
        # Compare the entire native stored string in the SAME synchronous snapshot
        # that reads it at the first terminal DOM change. A later independent read may
        # legitimately observe its next autosave rather than this import result.
        # Only transaction envelope timestamps are substituted; no state is masked.
        byte_proof=completion['currentByteProof']
        run['nativePersistence']['currentByteProof']={**byte_proof,
            'observedRawSha256':digest(completion['currentRaw'] or ''),
            'scope':'Full native current-slot read and exact source comparison in the first terminal DOM microtask; normal later autosaves remain enabled.'}
        run['nativePersistence']['replacementStatus']=replacement['status']
        backups=completion['backups']
        run['nativePersistence']['backups']=[{'key':row['key'],'sha256':digest(row['value'] or ''),
            'stringChars':len((row['value'] or '').encode('utf-16-le'))//2,
            'matchesPreImportNativeRead':row['value']==before_replacement['currentRaw'],
            'matchesManualSaveNativeRead':row['value']==saved['currentRaw'],
            'matchesNativeFileChangeRead':row['value']==completion['selected']['priorRaw']} for row in backups]
        run['nativePersistence']['manualSavedSha256']=digest(saved['currentRaw'] or '')
        run['nativePersistence']['preImportNativeReadSha256']=digest(before_replacement['currentRaw'] or '')
        run['nativePersistence']['postImportNativeReadSha256']=digest(replacement['currentRaw'] or '')
        run['nativePersistence']['currentCharsAfterReplacement']=len((replacement['currentRaw'] or '').encode('utf-16-le'))//2
        run['nativePersistence']['protectedAfterManualSave']=saved['protectedState']
        run['nativePersistence']['protectedAfterReplacement']=replacement['protectedState']
        run['nativePersistence']['manualSaveSucceeded']=saved['status']=='已保存到本地' and bool(saved['currentRaw']) and not saved['protectedState']
        run['nativePersistence']['replacementSucceeded']=completion['status']=='已导入并存入本地' and bool(completion['currentRaw']) and not completion['protectedState'] and not replacement['protectedState'] and byte_proof['matches']
        run['nativePersistence']['verifiedPreservedNativeBytes']=any(row['matchesNativeFileChangeRead'] for row in run['nativePersistence']['backups'])
        run['nativePersistence']['qualified']=run['nativePersistence']['manualSaveSucceeded'] and run['nativePersistence']['replacementSucceeded'] and run['nativePersistence']['verifiedPreservedNativeBytes'] and run['nativePersistence']['remainedVisible']
        checkpoint('persistence.result','after',qualified=run['nativePersistence']['qualified'],status=completion['status'])
        check('native import commits exact current bytes and preserves exact prior backup bytes',run['nativePersistence']['qualified'])
        run['readyDuringSamples']=not run['startupProtected'] and not any(sample['protectedDuringSample'] for sample in run['samples'])
        run['measurementQualified']=run['readyDuringSamples'] and not run['pageErrors'] and not run['failedRequests']
        if not run['readyDuringSamples']:run['blocker']='Native save protection arose during timing; excluded from ready-gameplay aggregates.'
        check('native measurement has no production page errors or failed requests',not run['pageErrors'] and not run['failedRequests'],run['pageErrors'])
    except BaseException as error:
        run['error']=brief_error(error)
        report['errors'].append({'identity':dict(active_identity),'error':brief_error(error)})
        checkpoint('run.error','error',error=brief_error(error))
        raise
    finally:
        failed=sys.exc_info()[0] is not None
        # Persist original failure and partial samples BEFORE potentially blocked
        # detach/close. No unfinished run is ever accepted by aggregate().
        checkpoint('run.pre-cleanup','before')
        if cdp is not None:phase_call('cleanup.cdp-detach',cdp.detach)
        if context is not None:phase_call('cleanup.context-close',context.close)
        if not failed:
            run['completed']=True
            run['qualified']=bool(run.get('measurementQualified'))
        checkpoint('run.complete','after',qualified=run['qualified'],completed=run['completed'])


def served_identity(request, url):
    response=phase_call('identity.document',lambda:request.get(url,timeout=30000),url=url)
    check('identity document HTTP response',response.status==200,{'url':url})
    html=phase_call('identity.document-body',response.body);text=html.decode('utf-8')
    identity={'url':url,'htmlSha256':hashlib.sha256(html).hexdigest(),'assets':[]}
    release=phase_call('identity.release',lambda:request.get(urljoin(url,'release.json'),timeout=30000),url=url)
    identity['release']=phase_call('identity.release-json',release.json) if release.status==200 else {'httpStatus':release.status}
    for path in sorted(set(re.findall(r'(?:src|href)=[\"\']([^\"\']+\.(?:js|css))(?:[\"\'])',text))):
        asset_url=urljoin(url,path);asset=phase_call('identity.asset',lambda:request.get(asset_url,timeout=30000),url=asset_url)
        check('served bundle identity asset HTTP response',asset.status==200,{'url':asset_url})
        body=phase_call('identity.asset-body',asset.body);sha=hashlib.sha256(body).hexdigest()
        release_path=urlparse(asset_url).path.removeprefix(urlparse(url).path)
        expected=identity['release'].get('files',{}).get(release_path)
        identity['assets'].append({'url':asset_url,'sha256':sha,'bytes':len(body),'releaseExpectedSha256':expected})
        if expected:check('served asset matches release manifest hash',sha==expected,{'url':asset_url})
    check('served JavaScript identity recorded',any(urlparse(item['url']).path.endswith('.js') for item in identity['assets']))
    return identity


def aggregate():
    grouped={}
    pairs={}
    for run in report['runs']:
        pairs.setdefault((run['profile'],run['repetition']),{})[run['variant']]=run
    matched={key for key,pair in pairs.items() if set(pair)=={'before','after'} and
             all(run.get('completed') and run['qualified'] for run in pair.values())}
    report['pairQualification']=[{'profile':profile,'repetition':repetition,'accepted':(profile,repetition) in matched,
        'variants':{variant:{'completed':run.get('completed',False),'qualified':run['qualified']} for variant,run in pair.items()}}
        for (profile,repetition),pair in pairs.items()]
    for run in report['runs']:
        if (run['profile'],run['repetition']) not in matched:continue
        key=(run['profile'],run['variant'])
        bucket=grouped.setdefault(key,{'startupScriptMs':[],'startupTaskMs':[],'startupHostMs':[],'tabs':{},'eventLatencyMs':[],'paintOpportunityBoundMs':[]})
        bucket['startupScriptMs'].append(run['initialization']['cpu'].get('ScriptDuration'))
        bucket['startupTaskMs'].append(run['initialization']['cpu'].get('TaskDuration'))
        bucket['startupHostMs'].append(run['initialization']['hostToReadyMs'])
        for sample in run['samples']:
            tab_group=bucket['tabs'].setdefault(sample['tab'],{'scriptMs':[],'taskMs':[],'scriptMsPerSecond':[],'taskMsPerSecond':[],'longTaskMs':[],'frameIntervalsMs':[]})
            for metric,name in [('ScriptDuration','scriptMs'),('TaskDuration','taskMs')]:
                value=sample['cpu'].get(metric);tab_group[name].append(value)
                tab_group[name+'PerSecond'].append(None if value is None else value*1000/sample['alignedMetricElapsedMs'])
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


def worker_main():
    playwright=browser=request=None
    try:
        checkpoint('worker.begin','before')
        profiles=[]
        for path,label in [(args.moderate_fixture,'moderate'),(args.fixture,'combined')]:
            if not path:continue
            source=phase_call('fixture.read',lambda:json.loads(Path(path).read_text()),profile=label)
            ready=source.get('ready',source.get('base'))
            raw=source.get('save',json.dumps(ready,ensure_ascii=False,indent=2))
            profile={'profile':source.get('profile',label),'key':source['key'],'ready':ready,'save':raw,
                     'stateSha256':digest(json.dumps(ready['state'],sort_keys=True,separators=(',',':'),ensure_ascii=False))}
            profiles.append(profile)
            report['profiles'].append({'profile':profile['profile'],'path':path,'description':source['description'],
                'sourceSaveSha256':digest(raw),'sourceStateSha256':profile['stateSha256'],'sourceUtf8Bytes':len(raw.encode()),
                'sourceStringChars':len(raw.encode('utf-16-le'))//2,'manifest':source.get('manifest')})
        playwright=phase_call('playwright.start',lambda:sync_playwright().start())
        browser=phase_call('browser.launch',lambda:playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox']))
        report['environment']={'platform':platform.platform(),'python':platform.python_version(),'browser':browser.version}
        request=phase_call('identity.context-create',playwright.request.new_context)
        report['servedBundles']={}
        for name,url in [('before',args.before_url),('after',args.after_url)]:
            report['servedBundles'][name]=served_identity(request,url)
        phase_call('identity.context-close',request.dispose);request=None
        for profile in profiles:
            for repetition in range(args.repetitions):
                order=('before','after') if repetition%2==0 else ('after','before')
                for variant in order:run(browser,profile,variant,repetition,list(order))
        report['measurementsCompleted']=True
    except BaseException as error:
        report['errors'].append(brief_error(error))
        checkpoint('worker.error','error',error=brief_error(error))
        raise
    finally:
        failed=sys.exc_info()[0] is not None
        aggregate()
        checkpoint('worker.pre-cleanup','before')
        if request is not None:phase_call('cleanup.identity-context',request.dispose)
        if browser is not None:phase_call('cleanup.browser-close',browser.close)
        if playwright is not None:phase_call('cleanup.playwright-stop',playwright.stop)
        if not failed:report['completed']=bool(report.get('measurementsCompleted'))
        checkpoint('worker.complete','after',completed=report['completed'])
        print(json.dumps({'completed':report['completed'],'runs':len(report['runs']),
            'qualifiedRuns':sum(row['qualified'] for row in report['runs']),'comparisons':report.get('comparisons',[])},ensure_ascii=False),flush=True)


try:
    worker_main()
except BaseException as error:
    # Playwright errors can embed the entire imported save. Keep terminal output
    # small; partial evidence and the exact named phase have already been saved.
    print(json.dumps({'nativePerformance':'worker-failed','error':brief_error(error)}),flush=True)
    sys.exit(1)
