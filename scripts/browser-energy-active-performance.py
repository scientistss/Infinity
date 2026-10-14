#!/usr/bin/env python3
"""Bounded native active/control diagnostic for one exact 0.6.32-alpha.1 build.

No app hooks, virtual clocks, Profiler, altered HTML, automatic retries or CPU
thresholds. All 12 planned runs / 36 windows remain in the report on failure.
Native Save actions bracket (but do not coincide with) each CDP CPU window.
Their end-to-end timings include input dispatch, app work, and observation.
"""
import argparse
import faulthandler
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import signal
import statistics
import subprocess
import sys
import time
import traceback
import uuid
from urllib.parse import urljoin, urlparse

SOURCE_SHA = '6af7a5e85a522ba89478c5e95d919a2c04fb2e55'
SCHEMA = 'energy-active-performance-native-v1'
FIXTURE_SCHEMA = 'energy-active-performance-fixtures-v1'
REPORT_NAME, PROGRESS_NAME = 'report.json', 'progress.json'
WHOLE_TIMEOUT_SECONDS, PHASE_TIMEOUT_SECONDS, RUN_HORIZON_SECONDS = 480, 90, 120
WARMUP_MS, SAMPLE_MS = 600, 2000
TABS = ('overview', 'curvature', 'fleet')
PROFILES = ('ordinary-1world', 'capital-assisted-4world-8fleet')
STORAGE_KEY = 'infinity.original-p4.save.v1'
ROOT = Path(__file__).resolve().parents[1]


def sha(raw):
    return hashlib.sha256(raw.encode() if isinstance(raw, str) else raw).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.' + str(os.getpid()) + '.tmp')
    tmp.write_bytes(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode())
    tmp.replace(path)


def read_json(path):
    try: return json.loads(path.read_bytes())
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


def planned_runs():
    """One immutable schedule definition shared by supervisor and worker."""
    runs = []
    for profile in PROFILES:
        for repetition in range(3):
            order = ['active', 'control'] if repetition % 2 == 0 else ['control', 'active']
            for variant in order:
                ident = f'{profile}-{repetition}-{variant}'
                runs.append({'id': ident, 'profile': profile, 'variant': variant,
                    'repetition': repetition, 'pairOrder': order, 'started': False, 'completed': False, 'qualified': False,
                    'windows': [{'id': f'{ident}-{tab}', 'tab': tab, 'index': i, 'started': False,
                                 'completed': False} for i, tab in enumerate(TABS)]})
    return runs


def supervise(command, output, invocation, phase_timeout=PHASE_TIMEOUT_SECONDS, whole_timeout=WHOLE_TIMEOUT_SECONDS):
    """Independent native-worker watchdog; kill only observed owned processes."""
    started = time.monotonic()
    initial = {'invocationId': invocation, 'phase': 'worker.spawn', 'monotonic': started}
    atomic_json(output / PROGRESS_NAME, initial)
    initial_report = {'schema': SCHEMA, 'invocationId': invocation, 'completed': False, 'qualified': False,
                      'phase': initial, 'runs': planned_runs(), 'errors': []}
    atomic_json(output / REPORT_NAME, initial_report)
    process, owned, reason, latest = None, {}, None, initial
    try:
        process = subprocess.Popen(command, start_new_session=True)
        while process.poll() is None:
            collect_owned_descendants(process.pid, owned)
            progress = read_json(output / PROGRESS_NAME)
            if progress and progress.get('invocationId') == invocation: latest = progress
            now = time.monotonic()
            if now - started >= whole_timeout: reason = 'whole-worker-timeout'
            elif now - latest.get('monotonic', started) >= phase_timeout: reason = 'phase-stall-timeout'
            elif latest.get('runStartedMonotonic') and now - latest['runStartedMonotonic'] >= RUN_HORIZON_SECONDS:
                reason = 'run-horizon-expired'
            if reason: break
            time.sleep(.1)
    finally:
        cleanup = kill_owned_group(process, owned, dump_stack=bool(reason)) if process else {'noObservedLiveOwnedDescendants': True}
        result = read_json(output / REPORT_NAME) or initial_report
        result['supervisor'] = {'invocationId': invocation, 'wholeTimeoutSeconds': whole_timeout,
            'phaseTimeoutSeconds': phase_timeout, 'runHorizonSeconds': RUN_HORIZON_SECONDS,
            'elapsedSeconds': time.monotonic() - started, 'timeoutReason': reason,
            'lastPhase': latest, 'workerExitCode': process.returncode if process else None, 'cleanup': cleanup}
        if reason or not process or process.returncode or not cleanup['noObservedLiveOwnedDescendants']:
            result['completed'] = result['qualified'] = False
            result.setdefault('errors', []).append(reason or 'worker/cleanup failed')
            for run in result.get('runs', []):
                if not run.get('completed'): run['qualified'] = False
        atomic_json(output / REPORT_NAME, result)
    return 124 if reason else (process.returncode or (0 if result.get('completed') else 1))


# This observer records native callbacks. It does not replace any API, call the
# engine, intercept storage, modify the DOM, or use the RAF timestamp argument.
# A Save witness is synchronous capture -> production root listener -> document
# bubble for the same trusted Event; no microtask timing shortcut is used.
PROBE = r'''(() => {
 if (location.origin !== __ORIGIN__) return;
 const key=__KEY__, fixture=__FIXTURE__;
 const original={date:Date.now,dateConstructor:Date,performance:performance.now,raf:requestAnimationFrame,cancelRaf:cancelAnimationFrame,
   timeout:setTimeout,interval:setInterval,clearTimeout,clearInterval,get:Storage.prototype.getItem,set:Storage.prototype.setItem,
   remove:Storage.prototype.removeItem,clear:Storage.prototype.clear,key:Storage.prototype.key};
 const native=()=>({date:Date.now===original.date,dateConstructor:Date===original.dateConstructor,performance:performance.now===original.performance,
   raf:requestAnimationFrame===original.raf,cancelRaf:cancelAnimationFrame===original.cancelRaf,
   timeout:setTimeout===original.timeout,interval:setInterval===original.interval,
   clearTimeout:clearTimeout===original.clearTimeout,clearInterval:clearInterval===original.clearInterval,
   get:Storage.prototype.getItem===original.get,set:Storage.prototype.setItem===original.set,
   remove:Storage.prototype.removeItem===original.remove,clear:Storage.prototype.clear===original.clear,key:Storage.prototype.key===original.key,
   nativeCode:Object.values(original).every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn))),
   storage:localStorage instanceof Storage});
 const p={documentId:crypto.randomUUID(),origin:location.origin,startedAt:performance.now(),startedWallAt:Date.now(),
   supported:[...PerformanceObserver.supportedEntryTypes],raf:[],events:[],eventTiming:[],longTasks:[],visibility:[],
   statusChanges:[],errors:[],seedError:null,seededRaw:null,reloaded:false,witnesses:[]};
 const storage=()=>({readStartedAt:performance.now(),readStartedWallAt:Date.now(),currentRaw:localStorage.getItem(key),
   backups:Object.keys(localStorage).filter(k=>k.startsWith(key+'.backup')).sort().map(k=>({key:k,raw:localStorage.getItem(k)})),
   readEndedAt:performance.now(),readEndedWallAt:Date.now()});
 const light=()=>({documentId:p.documentId,now:performance.now(),wallNow:Date.now(),rafCount:p.raf.length,eventCount:p.events.length,
   eventTimingCount:p.eventTiming.length,longTaskCount:p.longTasks.length,hidden:document.hidden,visibility:document.visibilityState,
   tab:document.querySelector('[data-tab-panel]:not([hidden])')?.dataset.tabPanel??null,
   status:document.querySelector('[data-bind="status"]')?.textContent??null,
   notice:document.querySelector('[data-bind="notice-text"]')?.textContent??null,native:native()});
 try {
   p.beforeSeed=storage();
   if(p.beforeSeed.currentRaw===null){
     const value=JSON.parse(fixture),wall=Date.now(); value.savedAt=value.lastTickAt=wall;
     p.seededRaw=JSON.stringify(value,null,2);p.seededAt=wall;
     localStorage.setItem(key,p.seededRaw);localStorage.setItem('infinity.ui.tab','save');
   }else p.reloaded=true;
   p.afterSeed=storage();
 }catch(error){p.seedError={name:error.name,message:error.message};}
 let previous=null;
 const frame=()=>{const now=performance.now();p.raf.push({sequence:p.raf.length,at:now,wallAt:Date.now(),
   interval:previous===null?null:now-previous});previous=now;requestAnimationFrame(frame);};
 requestAnimationFrame(frame);
 if(p.supported.includes('longtask'))new PerformanceObserver(list=>{
   for(const e of list.getEntries())p.longTasks.push({start:e.startTime,duration:e.duration,name:e.name});
 }).observe({type:'longtask',buffered:true});
 if(p.supported.includes('event'))new PerformanceObserver(list=>{
   for(const e of list.getEntries())p.eventTiming.push({name:e.name,start:e.startTime,duration:e.duration,
     processingStart:e.processingStart,processingEnd:e.processingEnd,interactionId:e.interactionId,cancelable:e.cancelable});
 }).observe({type:'event',buffered:true,durationThreshold:16});
 let armed=null,selected=null;
 const target=e=>{const n=e.target instanceof Element?e.target.closest('button'):null;
   return {id:n?.id??null,tab:n?.dataset.tab??null,action:n?.dataset.action??null,disabled:n?.disabled??null};};
 const record=(e,stage)=>{const row={sequence:p.events.length,type:e.type,stage,trusted:e.isTrusted,
   at:performance.now(),wallAt:Date.now(),eventTimestamp:e.timeStamp,target:target(e),rafCount:p.raf.length};p.events.push(row);return row;};
 for(const type of ['pointerdown','pointerup','click','keydown','input','change'])document.addEventListener(type,e=>{
   const row=record(e,'capture');
   if(type==='click'&&armed&&row.target.action==='save'){
     selected=e;armed.click=row;armed.before=light();armed.beforeStorage=storage();
   }
 },true);
 document.addEventListener('click',e=>{
   const row=record(e,'bubble');
   if(e===selected&&armed){
     armed.bubble=row;armed.after=light();armed.afterStorage=storage();p.witnesses.push(armed);armed=null;selected=null;
   }
 },false);
 document.addEventListener('visibilitychange',e=>p.visibility.push({at:performance.now(),wallAt:Date.now(),hidden:document.hidden,
   visibility:document.visibilityState,trusted:e.isTrusted}));
 window.addEventListener('error',e=>p.errors.push(String(e.message)));
 document.addEventListener('DOMContentLoaded',()=>{
   const read=()=>p.statusChanges.push({at:performance.now(),wallAt:Date.now(),status:light().status,notice:light().notice});
   for(const selector of ['[data-bind="status"]','[data-bind="notice-text"]']){
     const node=document.querySelector(selector);if(node)new MutationObserver(read).observe(node,{childList:true,subtree:true,characterData:true});
   }read();
 },{once:true});
 window.__activeEnergyDiagnostic={light,storage,full:()=>({...p,observation:light(),currentStorage:storage()}),
   arm:id=>{if(armed)throw Error('Unfinished Save witness');armed={id};},witness:id=>p.witnesses.find(w=>w.id===id)??null};
})();'''


class Recorder:
    def __init__(self, args):
        self.args, self.output = args, Path(args.output).resolve()
        self.identity, self.run_started, self.serial = {}, None, 0
        self.strict_inputs = []
        self.report = {'schema': SCHEMA, 'invocationId': args.invocation_id, 'completed': False, 'qualified': False,
            'parameters': {'warmupMs': WARMUP_MS, 'sampleMs': SAMPLE_MS, 'wholeTimeoutSeconds': WHOLE_TIMEOUT_SECONDS,
                           'phaseTimeoutSeconds': PHASE_TIMEOUT_SECONDS, 'runHorizonSeconds': RUN_HORIZON_SECONDS,
                           'repetitions': 3, 'tabs': list(TABS), 'navigationInputsPerRun': 6},
            'classification': 'whole-application native diagnostic; no CPU threshold or optimization assertion',
            'limits': ['CDP CPU counters describe the complete app plus common read-only observer overhead.',
                       'Save witnesses bracket but are not simultaneous with CDP CPU boundaries.',
                       'Save/input durations are end-to-end actions, never isolated SaveSession timings.',
                       'RAF callback performance.now gaps are observations, not paint completion or CPU time.',
                       'Callback-entry gaps do not equal the engine RAF timestamp gaps; no-catch-up qualification also requires complete status history and saved accounted-clock/totalTime evidence.',
                       'EventTiming entries below the native 16ms threshold may be absent, never reported as zero.',
                       'Headless foreground Chromium does not qualify real display, mobile or OS-hidden performance.',
                       'No failed or slow sample is dropped or automatically rerun.',
                       'A watchdog-killed metric call may leave its in-memory endpoint unknown; no endpoint is invented and no file I/O is inserted into the CPU window.'],
            'runs': [], 'errors': []}
        self.report['runs'] = planned_runs()
        self.phase('worker.initialized')

    def phase(self, name, state='before', **extra):
        row = {'invocationId': self.args.invocation_id, 'phase': name, 'state': state,
               'monotonic': time.monotonic(), 'wallTime': time.time(), 'identity': dict(self.identity),
               'runStartedMonotonic': self.run_started, **extra}
        self.report['phase'] = row
        atomic_json(self.output / PROGRESS_NAME, row)
        with (self.output / 'phase-history.jsonl').open('a') as stream: stream.write(json.dumps(row) + '\n')
        atomic_json(self.output / REPORT_NAME, self.report)
        atomic_json(self.output / 'strict-reader-inputs.json', {'files': self.strict_inputs})
        print(json.dumps({'phase': name, 'state': state, 'identity': self.identity}), flush=True)

    def call(self, name, action):
        self.phase(name)
        try: value = action()
        except BaseException as error:
            self.report['errors'].append({'phase': name, 'identity': dict(self.identity), 'error': str(error)[:2000]})
            self.phase(name, 'error')
            raise
        self.phase(name, 'after')
        return value

    def raw(self, name, raw):
        raw = raw.encode() if isinstance(raw, str) else raw
        self.serial += 1
        path = self.output / 'raw' / f'{self.serial:05d}-{name}'
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream: stream.write(raw)
        return {'file': str(path.relative_to(self.output)), 'sha256': sha(raw), 'bytes': len(raw)}

    def json(self, name, value):
        return self.raw(name + '.json', json.dumps(value, ensure_ascii=False, allow_nan=False).encode())

    def storage(self, label, value):
        result = {k: v for k, v in value.items() if k not in ('currentRaw', 'backups')}
        result['current'] = self.raw(label + '-current.json', value['currentRaw']) if value['currentRaw'] is not None else None
        result['backups'] = [{'key': row['key'], 'raw': self.raw(label + '-backup.json', row['raw'])} for row in value['backups']]
        if result['current'] is not None: self.strict_inputs.append(result['current'])
        self.strict_inputs.extend(row['raw'] for row in result['backups'])
        return result


def require(condition, reason):
    if not condition: raise AssertionError(reason)


def metric_values(raw):
    result = {row['name']: row['value'] for row in raw['metrics']}
    for name in ('Timestamp', 'ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'):
        require(name in result and type(result[name]) in (int, float) and math.isfinite(result[name]), 'missing/nonfinite CDP metric ' + name)
    return result


def summary(values):
    if not values: return {'count': 0, 'median': None, 'p95': None, 'min': None, 'max': None}
    values = sorted(values)
    return {'count': len(values), 'median': statistics.median(values), 'p95': values[math.ceil(.95 * len(values)) - 1],
            'min': values[0], 'max': values[-1]}


def validate_source_and_build(r):
    root, build = Path(r.args.source_root).resolve(), Path(r.args.build_dir).resolve()
    def git(*args): return subprocess.check_output(['git', '-C', str(root), *args], env={**os.environ, 'GIT_OPTIONAL_LOCKS': '0'}).decode().strip()
    require(git('rev-parse', 'HEAD') == SOURCE_SHA, 'source root is not the exact approved public source')
    require(not git('status', '--porcelain', '--untracked-files=no'), 'source root has tracked mutations')
    release_raw = (build / 'release.json').read_bytes(); release = json.loads(release_raw)
    require(release['sourceSha'] == SOURCE_SHA and release['version'] == '0.6.32-alpha.1'
            and release['saveVersion'] == 9 and release['saveRevision'] == 16, 'wrong served source/version/revision')
    require(len(release['files']) == 62, 'exact release must have 62 manifest assets')
    actual = sorted(str(p.relative_to(build)) for p in build.rglob('*') if p.is_file())
    require(actual == sorted([*release['files'], 'release.json']), 'build must contain exact 63 files including release')
    files = []
    for name in actual:
        path = build / name
        require(not path.is_symlink() and path.resolve().is_relative_to(build), 'nonordinary build file')
        raw = path.read_bytes()
        require(name == 'release.json' or sha(raw) == release['files'][name], 'build asset hash differs from release')
        files.append({'path': name, 'sha256': sha(raw), 'bytes': len(raw)})
    r.report['build'] = {'sourceSha': SOURCE_SHA, 'sourceTree': git('rev-parse', 'HEAD^{tree}'), 'release': release,
                         'releaseRaw': r.raw('release.json', release_raw), 'files': files}
    r.report['harness'] = {'runner': r.raw('runner.py', Path(__file__).read_bytes()),
                           'observer': r.raw('observer.js', PROBE), 'python': platform.python_version(), 'platform': platform.platform()}
    return release


def fixtures(r):
    directory = Path(r.args.fixtures).resolve()
    manifest_raw = (directory / 'report.json').read_bytes(); manifest = json.loads(manifest_raw)
    require(manifest['schema'] == FIXTURE_SCHEMA and manifest['status'] == 'passed', 'fixture generation not passed')
    require(manifest['sourceSha'] == SOURCE_SHA and manifest['storageKey'] == STORAGE_KEY, 'fixture source or key mismatch')
    require([p['id'] for p in manifest['profiles']] == list(PROFILES), 'fixture profile census changed')
    r.report['fixtures'] = {'manifest': r.raw('fixture-manifest.json', manifest_raw), 'profiles': []}
    result = {}
    r.fixture_summaries = {}
    for profile in manifest['profiles']:
        record = {'id': profile['id'], 'variants': {}}; r.report['fixtures']['profiles'].append(record)
        for variant in ('active', 'control'):
            meta = profile['variants'][variant]; path = directory / meta['file']
            require(path.resolve().is_relative_to(directory) and not path.is_symlink(), 'invalid fixture path')
            raw = path.read_bytes(); value = json.loads(raw)
            require(sha(raw) == meta['sha256'] and value['version'] == 9 and value['revision'] == 16, 'fixture bytes/revision mismatch')
            require(sha(canonical(value['state'])) == meta['stateSha256'], 'fixture state digest mismatch')
            result[(profile['id'], variant)] = raw.decode()
            r.fixture_summaries[(profile['id'], variant)] = meta['summary']
            record['variants'][variant] = {'raw': r.raw(f'fixture-{profile["id"]}-{variant}.json', raw), 'metadata': meta}
    return result


def verify_http_build(r, request, release):
    rows = []
    for item in r.report['build']['files']:
        url = urljoin(r.args.url, item['path'])
        response = request.get(url, timeout=30000)
        require(response.status == 200 and response.url == url, 'HTTP build asset missing or redirected: ' + url)
        raw = response.body()
        require(sha(raw) == item['sha256'] and len(raw) == item['bytes'], 'HTTP build bytes differ: ' + url)
        rows.append({'url': url, 'file': item['path'], 'status': response.status, 'body': r.raw('http-build-' + Path(item['path']).name, raw)})
    r.report['httpBuild'] = rows

def light(page):
    return page.evaluate('() => window.__activeEnergyDiagnostic.light()')


def append_event(rows):
    # Playwright caches its wrapper on the callback. list.append is a builtin
    # method and cannot accept that attribute; keep the original payload/order.
    def receive(value):
        rows.append(value)
    return receive


def saved_summary(r, value):
    state = value['state']; expected = r.current_fixture['state']
    caps = {row['id']: row['caps'] for row in r.current_fixture_summary['planets']}
    active = state['energyChallenge']['active']
    require(bool(active) == (r.current_variant == 'active'), 'challenge variant changed during native observation')
    require(active is None or 0 <= int(active['scoreUnits']) < 10**18, 'active score capped or invalid')
    elapsed = Fraction(state['totalTime']) - Fraction(expected['totalTime'])
    require(0 <= elapsed < RUN_HORIZON_SECONDS, 'native saved state exceeded logical horizon')
    require([p['id'] for p in state['planets']] == [p['id'] for p in expected['planets']], 'native world census changed')
    require([f['id'] for f in state['fleets']] == [f['id'] for f in expected['fleets']], 'native fleet census changed')
    require(all(f['remaining'] > 0 for f in state['fleets']), 'fleet arrived during diagnostic')
    wallets = []
    for planet in state['planets']:
        headroom = {resource: Fraction(str(caps[planet['id']][resource])) - Fraction(amount)
                    for resource, amount in planet['resources'].items()}
        require(all(amount > 0 for amount in headroom.values()), 'native warehouse full/overflow')
        wallets.append({'id': planet['id'], 'resources': planet['resources'], 'caps': caps[planet['id']],
                        'headroom': {resource: {'numerator': str(amount.numerator), 'denominator': str(amount.denominator)}
                                     for resource, amount in headroom.items()}})
    return {'scoreUnits': active['scoreUnits'] if active else None, 'wallets': wallets,
            'totalTime': state['totalTime'], 'savedAt': value['savedAt'], 'lastTickAt': value['lastTickAt'],
            'elapsedLogicalSeconds': str(elapsed), 'worldCount': len(state['planets']),
            'fleets': [{'id': f['id'], 'remaining': f['remaining'], 'elapsed': f['elapsed'], 'returning': f['returning']} for f in state['fleets']],
            'nextJobId': state['orders']['nextJobId']}


def observed_save(r, page, ident):
    r.call('save.arm', lambda: page.evaluate('id => window.__activeEnergyDiagnostic.arm(id)', ident))
    r.phase('save.native-click-and-witness')
    start = time.perf_counter()
    page.locator('[data-action="save"]').click(timeout=15000)
    witness = page.evaluate('id => window.__activeEnergyDiagnostic.witness(id)', ident)
    elapsed = (time.perf_counter() - start) * 1000
    r.phase('save.native-click-and-witness', 'after')
    require(witness is not None and witness['id'] == ident, 'native Save witness absent')
    # Persist original bytes before qualification so failure never erases them.
    before, after = witness['beforeStorage'], witness['afterStorage']
    witness['beforeStorage'] = r.storage(ident + '-before', before)
    witness['afterStorage'] = r.storage(ident + '-after', after)
    witness['hostActionEndToEndMs'] = elapsed
    witness['nativeCaptureToCompletedObservationMs'] = witness['after']['now'] - witness['before']['now']
    witness['timingScope'] = 'Host: trusted locator dispatch through returned event witness; native: capture through post-handler observation, including common observer work. Neither isolates SaveSession.'
    actual = json.loads(after['currentRaw']) if after['currentRaw'] is not None else None
    if actual is not None: witness['savedStateSummary'] = saved_summary(r, actual)
    ref = r.json(ident + '-witness', witness)
    require(witness['click']['trusted'] and witness['bubble']['trusted'] and not witness['click']['target']['disabled'], 'Save was not trusted/enabled')
    require(witness['click']['target']['action'] == witness['bubble']['target']['action'] == 'save', 'Save event target changed')
    require(witness['after']['status'] == '已保存到本地', 'native Save did not succeed')
    require(all(witness['after']['native'].values()) and all(witness['before']['native'].values()), 'native API identity changed')
    require(after['currentRaw'] is not None, 'native Save has no current bytes')
    actual = json.loads(after['currentRaw'])
    require(actual['version'] == 9 and actual['revision'] == 16, 'native Save changed version/revision')
    return ref, witness, actual


def navigate(r, page, target, ident):
    r.phase('navigation.native-click-and-visible')
    start = time.perf_counter()
    before = light(page)
    page.locator(f'[data-tab="{target}"]').click(timeout=15000)
    page.locator(f'[data-tab-panel="{target}"]').wait_for(state='visible', timeout=15000)
    after = light(page)
    result = {'id': ident, 'target': target, 'before': before, 'after': after,
              'hostActionEndToEndMs': (time.perf_counter() - start) * 1000}
    r.phase('navigation.native-click-and-visible', 'after')
    require(after['tab'] == target, 'navigation target not visible')
    return result


def collect_window(r, page, cdp, window):
    window['started'] = True; r.identity['window'] = window['id']
    window['preSave'], pre, _ = observed_save(r, page, window['id'] + '-pre')
    window['navigationTo'] = navigate(r, page, window['tab'], window['id'] + '-enter')
    warmup_start = light(page)
    r.call('window.warmup', lambda: page.wait_for_timeout(WARMUP_MS))
    warmup_end = light(page)
    window['warmup'] = {'before': warmup_start, 'after': warmup_end, 'requestedMs': WARMUP_MS}
    r.phase('window.native-measure')
    # NO checkpoint, disk write, save, state read, input or Debugger in this
    # region. Marker reads surround counters and are not treated as exact state.
    marker_before = marker_after = raw_before = raw_after = None
    host_before = host_after_start_counter = host_before_end_counter = host_after = None
    metric_block_completed = False
    try:
        marker_before = light(page)
        host_before = time.perf_counter()
        raw_before = cdp.send('Performance.getMetrics')
        host_after_start_counter = time.perf_counter()
        page.wait_for_timeout(SAMPLE_MS)
        host_before_end_counter = time.perf_counter()
        raw_after = cdp.send('Performance.getMetrics')
        host_after = time.perf_counter()
        marker_after = light(page)
        metric_block_completed = True
    finally:
        # Only after the successful or aborted measurement region: retain each
        # endpoint that really returned. A failure never triggers a replacement
        # end counter/marker, and a hard-killed worker cannot claim unknown data.
        window['metricBlockCompleted'] = metric_block_completed
        if marker_before is not None: window['beforeMarker'] = marker_before
        if marker_after is not None: window['afterMarker'] = marker_after
        if raw_before is not None: window['metricsBefore'] = r.json(window['id'] + '-metrics-before', raw_before)
        if raw_after is not None: window['metricsAfter'] = r.json(window['id'] + '-metrics-after', raw_after)
        window['hostWindow'] = {'beforeStartCounter': host_before, 'afterStartCounter': host_after_start_counter,
            'beforeEndCounter': host_before_end_counter, 'afterEndCounter': host_after,
            'elapsedMs': (host_after - host_before) * 1000 if host_after is not None and host_before is not None else None}
        r.phase('window.native-measure', 'after' if metric_block_completed else 'error')
    a, b = metric_values(raw_before), metric_values(raw_after)
    window['metricElapsedMs'] = (b['Timestamp'] - a['Timestamp']) * 1000
    window['cpuMs'] = {name: (b[name] - a[name]) * 1000 for name in ('ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration')}
    window['navigationBack'] = navigate(r, page, 'save', window['id'] + '-leave')
    window['postSave'], post, _ = observed_save(r, page, window['id'] + '-post')
    window['boundaryGaps'] = {'preSaveToBeforeMarkerMs': marker_before['now'] - pre['after']['now'],
        'afterMarkerToPostSaveMs': post['after']['now'] - marker_after['now'],
        'saveWitnessSpanMs': post['after']['now'] - pre['after']['now'],
        'explanation': 'Persisted wallets/score bound the wider Save-to-Save interval, not instantaneous CDP metric endpoints.'}
    require(0 < window['metricElapsedMs'] < 5000, 'CPU window expired or includes possible catch-up gap')
    require(all(value >= 0 and math.isfinite(value) for value in window['cpuMs'].values()), 'invalid CPU counter delta')
    require(not marker_before['hidden'] and not marker_after['hidden'], 'CPU window not visible')
    require(marker_before['tab'] == marker_after['tab'] == window['tab'], 'CPU window changed tab')
    require(all(marker_before['native'].values()) and all(marker_after['native'].values()), 'window native API changed')
    window['completed'] = True
    r.phase('window.complete', 'after')


def capture_native_sources(r, page, cdp, responses, parsed_scripts, release):
    sources = []; seen = set()
    for response in list(responses):
        if response.request.resource_type != 'script': continue
        url = response.url
        require(url.startswith(r.args.url), 'unexpected native app script origin')
        name = url[len(r.args.url):]
        require(name in release['files'] and name.endswith('.js') and response.status == 200, 'native app script not in release')
        raw = response.body()
        matches = [row for row in parsed_scripts if row.get('url') == url]
        require(len(matches) == 1 and url not in seen, 'missing/duplicate executed native script')
        native = cdp.send('Debugger.getScriptSource', {'scriptId': matches[0]['scriptId']})['scriptSource'].encode()
        record = {'url': url, 'file': name, 'status': response.status, 'scriptParsed': matches[0],
                  'http': r.raw('native-http-' + Path(name).name, raw), 'v8': r.raw('native-v8-' + Path(name).name, native)}
        sources.append(record); seen.add(url)
        require(raw == native and sha(raw) == release['files'][name], 'executed native V8/HTTP bytes differ from exact build')
    require(sources, 'no executed native application script identified')
    # Never carry Debugger instrumentation into warmup, CPU, Save or inputs.
    r.call('identity.debugger-disable', lambda: cdp.send('Debugger.disable'))
    return sources


def qualify_observations(run, observations):
    require(observations['seedError'] is None and not observations['reloaded'], 'fresh native storage seed failed')
    require(not observations['errors'] and not run['pageErrors'] and not run['failedRequests'], 'native app error/request failure')
    require(all(observations['observation']['native'].values()), 'native APIs changed')
    require(not observations['visibility'] and not observations['observation']['hidden'], 'native visibility changed')
    require(observations['raf'] and all(row['interval'] is None or 0 <= row['interval'] < 5000 for row in observations['raf']), 'observed RAF catch-up-sized gap')
    require(all(not any(word in (row['status'] or '') + (row['notice'] or '') for word in ('追赶', '保护', '暂停写入', '不可用', '临时初始'))
                for row in observations['statusChanges']), 'catch-up or protected state observed')
    clicks = [row for row in observations['events'] if row['type'] == 'click' and row['stage'] == 'capture']
    navigation = [row for row in clicks if row['target']['tab']]
    saves = [row for row in clicks if row['target']['action'] == 'save']
    require(len(navigation) == 6 and [row['target']['tab'] for row in navigation] == ['overview', 'save', 'curvature', 'save', 'fleet', 'save'], 'native navigation census changed')
    require(len(saves) == 6 and len(clicks) == 12 and all(row['trusted'] for row in observations['events']), 'native Save/input census changed')
    require(all(len([event for event in observations['events'] if event['type'] == kind and event['stage'] == 'capture']) == 12
                for kind in ('pointerdown', 'pointerup')), 'native pointer sequence incomplete')
    run['interactions'] = {'navigationClicks': navigation, 'saveClicks': saves,
        'nativeEventTimingSupported': 'event' in observations['supported'],
        'eventTimingCount': len(observations['eventTiming']),
        'nonzeroInteractionCount': len({row['interactionId'] for row in observations['eventTiming'] if row['interactionId']}),
        'eventTimingDurationMs': summary([row['duration'] for row in observations['eventTiming']]),
        'absentBelowThresholdMeans': 'unobserved below native 16ms threshold, never zero latency'}
    for window in run['windows']:
        start, end = window['beforeMarker']['now'], window['afterMarker']['now']
        window['observationRange'] = {'startMs': start, 'endMs': end, 'source': run['observations']}
        window['rafIntervalSummaryMs'] = summary([row['interval'] for row in observations['raf'] if start < row['at'] <= end and row['interval'] is not None])
        longs = [row for row in observations['longTasks'] if row['start'] < end and row['start'] + row['duration'] > start]
        window['overlappingLongTasks'] = longs
        window['eventTiming'] = [row for row in observations['eventTiming'] if start <= row['start'] < end]


def run_context(r, browser, fixture, run, release):
    context = page = cdp = None
    r.current_fixture, r.current_fixture_summary, r.current_variant = json.loads(fixture), r.fixture_summaries[(run['profile'], run['variant'])], run['variant']
    r.identity = {'run': run['id']}; r.run_started = time.monotonic(); run['started'] = True
    run.update({'startedHostMonotonic': r.run_started, 'url': r.args.url, 'pageErrors': [], 'failedRequests': [], 'errors': []})
    responses, parsed_scripts = [], []
    try:
        context = r.call('context.create', lambda: browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce'))
        probe = PROBE.replace('__ORIGIN__', json.dumps(f'{urlparse(r.args.url).scheme}://{urlparse(r.args.url).netloc}')).replace('__KEY__', json.dumps(STORAGE_KEY)).replace('__FIXTURE__', json.dumps(fixture))
        run['installedObserver'] = r.raw(run['id'] + '-installed-observer.js', probe)
        r.call('context.init-observer', lambda: context.add_init_script(probe))
        page = r.call('page.create', context.new_page)
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: run['pageErrors'].append(str(error)))
        page.on('requestfailed', lambda request: run['failedRequests'].append(request.url))
        r.call('page.response-listener', lambda: page.on('response', append_event(responses)))
        cdp = r.call('cdp.create', lambda: context.new_cdp_session(page))
        r.call('cdp.script-listener', lambda: cdp.on('Debugger.scriptParsed', append_event(parsed_scripts)))
        r.call('identity.debugger-enable', lambda: cdp.send('Debugger.enable'))
        r.call('metrics.enable', lambda: cdp.send('Performance.enable', {'timeDomain': 'timeTicks'}))
        response = r.call('page.native-navigation', lambda: page.goto(r.args.url, wait_until='networkidle', timeout=45000))
        require(response is not None and response.status == 200 and response.url == r.args.url, 'wrong native document')
        run['nativeDocument'] = r.raw(run['id'] + '-native-document.html', response.body())
        require(run['nativeDocument']['sha256'] == release['files']['index.html'], 'native document differs from build')
        r.call('page.ready', lambda: page.locator('[data-action="save"]').wait_for(state='visible', timeout=15000))
        initialized = r.call('startup.snapshot', lambda: page.evaluate('() => window.__activeEnergyDiagnostic.full()'))
        run['initialization'] = r.json(run['id'] + '-initialization', initialized)
        if initialized['seededRaw'] is not None:
            run['seededRaw'] = r.raw(run['id'] + '-native-seeded.json', initialized['seededRaw'])
            r.strict_inputs.append(run['seededRaw'])
        require(initialized['seededRaw'] is not None and initialized['seedError'] is None, 'fixture seed failed')
        expected = json.loads(fixture); expected['savedAt'] = expected['lastTickAt'] = initialized['seededAt']
        require(json.loads(initialized['seededRaw']) == expected, 'seed changed beyond envelope timestamps')
        require(initialized['beforeSeed']['currentRaw'] is None and initialized['beforeSeed']['backups'] == [], 'context origin was not empty')
        require(initialized['afterSeed']['currentRaw'] == initialized['seededRaw'] and initialized['afterSeed']['backups'] == [], 'native seed readback mismatch')
        require(initialized['currentStorage']['currentRaw'] == initialized['seededRaw'], 'startup unexpectedly rewrote strict current seed')
        require(initialized['observation']['status'] == '已读取本地存档', 'strict native startup did not adopt seeded current save')
        require(0 <= initialized['observation']['now'] - initialized['startedAt'] < 5000
                and 0 <= initialized['observation']['wallNow'] - initialized['seededAt'] < 5000,
                'startup exceeds conservative no-catch-up interval')
        require(all(initialized['observation']['native'].values()), 'startup APIs non-native')
        run['nativeScripts'] = r.call('identity.executed-sources', lambda: capture_native_sources(r, page, cdp, responses, parsed_scripts, release))
        run['debuggerDisabledBeforeWindows'] = True
        for window in run['windows']: collect_window(r, page, cdp, window)
        r.identity.pop('window', None)
        r.call('observations.delivery-settle', lambda: page.wait_for_timeout(100))
        observations = r.call('observations.final', lambda: page.evaluate('() => window.__activeEnergyDiagnostic.full()'))
        run['observations'] = r.json(run['id'] + '-observations', observations)
        run['finalStorage'] = r.storage(run['id'] + '-final', observations['currentStorage'])
        run['elapsedHostSeconds'] = time.monotonic() - r.run_started
        require(run['elapsedHostSeconds'] < RUN_HORIZON_SECONDS, 'run exceeded fixture horizon')
        qualify_observations(run, observations)
        run['completed'] = run['qualified'] = True
    except BaseException as error:
        run['errors'].append(str(error)[:2000]); run['qualified'] = False
        run['failureTraceback'] = r.raw(run['id'] + '-failure-traceback.txt', traceback.format_exc())
        r.phase('run.failed', 'error')
        if page is not None:
            try:
                partial = r.call('failure.partial-native-observations', lambda: page.evaluate('() => window.__activeEnergyDiagnostic?.full() ?? null'))
                run['partialObservations'] = r.json(run['id'] + '-partial-observations', partial)
                if partial is not None:
                    run['partialStorage'] = {}
                    for field in ('beforeSeed', 'afterSeed', 'currentStorage'):
                        if partial.get(field) is not None:
                            run['partialStorage'][field] = r.storage(run['id'] + '-partial-' + field, partial[field])
                    run['partialWitnessStorage'] = []
                    for index, witness in enumerate(partial.get('witnesses', [])):
                        run['partialWitnessStorage'].append({'id': witness['id'], **{
                            field: r.storage(f'{run["id"]}-partial-witness-{index}-{field}', witness[field])
                            for field in ('beforeStorage', 'afterStorage') if witness.get(field) is not None}})
            except BaseException as partial_error: run['errors'].append('partial observation failed: ' + str(partial_error)[:1000])
    finally:
        # Save current partial evidence before potentially stalled cleanup.
        r.phase('run.pre-cleanup')
        try:
            if cdp is not None: r.call('cleanup.cdp-detach', cdp.detach)
            if context is not None: r.call('cleanup.context-close', context.close)
        except BaseException as error:
            run['completed'] = run['qualified'] = False
            run['errors'].append('cleanup: ' + str(error)[:1000])
        r.run_started = None
        r.phase('run.complete', 'after')


def worker(args):
    r = Recorder(args)
    stack = (r.output / 'worker-stack.txt').open('w')
    faulthandler.enable(file=stack, all_threads=True)
    faulthandler.register(signal.SIGUSR1, file=stack, all_threads=True)
    playwright = browser = request = None
    try:
        release = r.call('identity.source-build', lambda: validate_source_and_build(r))
        inputs = r.call('fixtures.read', lambda: fixtures(r))
        # Import only inside the independently supervised native worker.
        from playwright.sync_api import sync_playwright
        playwright = r.call('playwright.start', lambda: sync_playwright().start())
        binary = args.chromium or shutil.which('google-chrome') or shutil.which('chromium') or playwright.chromium.executable_path
        binary = Path(binary).resolve()
        require(binary.is_file(), 'Chrome executable unavailable')
        r.report['chrome'] = {'launcherPath': str(binary), 'launcherBytes': binary.stat().st_size, 'launcherSha256': file_sha(binary),
                              'commandVersion': subprocess.check_output([str(binary), '--version'], timeout=15).decode().strip()}
        browser = r.call('browser.launch', lambda: playwright.chromium.launch(executable_path=str(binary), headless=True, args=['--no-sandbox']))
        r.report['chrome']['browserVersion'] = browser.version
        browser_cdp = r.call('identity.browser-cdp', browser.new_browser_cdp_session)
        r.report['chrome']['cdpVersion'] = r.call('identity.chrome-version', lambda: browser_cdp.send('Browser.getVersion'))
        command_line = r.call('identity.chrome-command-line', lambda: browser_cdp.send('Browser.getBrowserCommandLine'))
        r.report['chrome']['argv0'] = command_line['arguments'][0]
        # Official launchers may exec -a their shell-script path. Resolve the
        # actual browser PID reported by CDP against our owned process tree,
        # then hash /proc/PID/exe, never mislabel the launcher as engine bytes.
        process_info = r.call('identity.chrome-process', lambda: browser_cdp.send('SystemInfo.getProcessInfo'))
        browser_processes = [row for row in process_info['processInfo'] if row['type'] == 'browser']
        require(len(browser_processes) == 1, 'actual Chrome browser PID is ambiguous')
        browser_pid = int(browser_processes[0]['id']); owned = {}
        collect_owned_descendants(os.getpid(), owned)
        require(browser_pid in owned, 'CDP browser PID is not an observed owned descendant')
        executable = Path(f'/proc/{browser_pid}/exe').resolve()
        require(executable.is_file(), 'actual running Chrome executable unavailable')
        with executable.open('rb') as stream: require(stream.read(4) == b'\x7fELF', 'actual running Chrome must be a native Linux executable')
        r.report['chrome']['actualExecutable'] = {'path': str(executable), 'sha256': file_sha(executable),
            'bytes': executable.stat().st_size, 'processIdentity': owned[browser_pid], 'cdpProcess': browser_processes[0]}
        r.call('identity.browser-cdp-detach', browser_cdp.detach)
        request = r.call('identity.http-context', playwright.request.new_context)
        r.call('identity.http-all-files', lambda: verify_http_build(r, request, release))
        r.call('identity.http-context-close', request.dispose); request = None
        for run in r.report['runs']: run_context(r, browser, inputs[(run['profile'], run['variant'])], run, release)
        r.report['completed'] = all(run['completed'] for run in r.report['runs'])
        r.report['qualified'] = r.report['completed'] and all(run['qualified'] for run in r.report['runs'])
        r.report['totals'] = {'plannedRuns': 12, 'startedRuns': sum(run['started'] for run in r.report['runs']),
            'completedRuns': sum(run['completed'] for run in r.report['runs']), 'plannedWindows': 36,
            'completedWindows': sum(w['completed'] for run in r.report['runs'] for w in run['windows'])}
        # Keep every cell including missing values, without selecting favorable pairs.
        r.report['allSamples'] = [{'run': run['id'], 'variant': run['variant'], 'tab': window['tab'],
            'completed': window['completed'], 'cpuMs': window.get('cpuMs'), 'metricElapsedMs': window.get('metricElapsedMs')}
            for run in r.report['runs'] for window in run['windows']]
    except BaseException as error:
        r.report['completed'] = r.report['qualified'] = False
        r.report['errors'].append(str(error)[:2000])
        r.phase('worker.failed', 'error')
    finally:
        r.phase('worker.pre-cleanup')
        try:
            if request is not None: r.call('cleanup.http-context', request.dispose)
            if browser is not None: r.call('cleanup.browser', browser.close)
            if playwright is not None: r.call('cleanup.playwright', playwright.stop)
        except BaseException as error:
            r.report['completed'] = r.report['qualified'] = False
            r.report['errors'].append('worker cleanup: ' + str(error)[:1000])
        r.phase('worker.complete', 'after')
    return 0 if r.report['qualified'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--build-dir', required=True)
    parser.add_argument('--fixtures', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--chromium')
    parser.add_argument('--measurement-worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--invocation-id', help=argparse.SUPPRESS)
    args = parser.parse_args()
    parsed = urlparse(args.url)
    require(parsed.scheme in ('http', 'https') and args.url.endswith('/') and not parsed.query and not parsed.fragment, 'one explicit HTTP build directory URL required')
    output = Path(args.output).resolve()
    if args.measurement_worker:
        require(args.invocation_id, 'worker must be supervised')
        return worker(args)
    require(not output.exists() or not any(output.iterdir()), 'output must be absent or empty; never overwrite/retry a previous diagnostic')
    output.mkdir(parents=True, exist_ok=True)
    invocation = uuid.uuid4().hex
    command = [sys.executable, '-u', str(Path(__file__).resolve()), *sys.argv[1:], '--measurement-worker', '--invocation-id', invocation]
    return supervise(command, output, invocation)


if __name__ == '__main__':
    sys.exit(main())
