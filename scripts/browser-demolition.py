"""CI-only native ordinary demolition acceptance against exact SHA-pinned HTTP assets.

The complete natural loop imports the byte-identical ac3 milestone10 r10 envelope,
migrates only per-planet demolition:null, then replays its original one-live-second
step. Trusted UI input pays/cancels/re-pays, reloads mid-job, completes 9→8 and pays
for an ordinary 8→9 rebuild. Four widths prove layout, not four economic loops.
The declared clock controls Date/performance/RAF timestamps only. Native storage,
File.text, dialogs, HTTP assets, timers, events and page reload are unchanged.
Explicit stale-DOM/cross-tab fault probes are labeled synthetic and kept separate.
"""
from contextlib import contextmanager
import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright, expect

HOST_STARTED_MONOTONIC = time.monotonic()
HOST_STARTED_AT = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def atomic_json(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='demolition-review-save.json')
parser.add_argument('--natural-report', default='demolition-natural-report.json')
parser.add_argument('--expected-report-sha256', required=True)
parser.add_argument('--release')
parser.add_argument('--output', default='demolition-evidence')
parser.add_argument('--chromium')
parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true':
    parser.error('Native demolition browser acceptance is CI-only; local execution is not authorized.')
if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
    parser.error('--expected-sha (or GITHUB_SHA) must pin the exact 40-character commit')
if not re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256):
    parser.error('--expected-report-sha256 must independently pin the complete natural report')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'demolition-browser-report.json'
if not args.worker:
    if any(out.iterdir()):
        raise SystemExit('Use an empty --output directory; failed or prior evidence must remain separate.')
    atomic_json(report_path, {'completed': False, 'result': 'starting', 'checks': []})
    owned = {}

    def process_info(pid):
        try:
            fields = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
            return {'pid': pid, 'birth': fields[19], 'state': fields[0], 'parent': int(fields[1])}
        except (OSError, IndexError, ValueError):
            return None

    def collect(root):
        pending, visited = [root, *owned], set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid); info = process_info(pid)
            if info is None or (pid in owned and owned[pid] != info['birth']):
                continue
            owned[pid] = info['birth']
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try:
                    pending.extend(int(value) for value in children.read_text().split())
                except OSError:
                    pass

    def terminate(sig):
        for pid, birth in reversed(list(owned.items())):
            info = process_info(pid)
            if info and info['birth'] == birth:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass

    expired, code = False, 1
    with (out / 'worker.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, __file__, *sys.argv[1:], '--worker'],
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 305
        try:
            while True:
                collect(process.pid)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    expired = True; break
                try:
                    code = process.wait(timeout=min(.2, remaining)); break
                except subprocess.TimeoutExpired:
                    pass
        finally:
            collect(process.pid); terminate(signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            time.sleep(.1); terminate(signal.SIGKILL); process.wait(timeout=2)
    residual = [info for pid, birth in owned.items() if (info := process_info(pid)) and info['birth'] == birth]
    live_residual = [info for info in residual if info['state'] not in ('Z', 'X')]
    report = json.loads(report_path.read_text())
    if expired or code or live_residual:
        report.update(completed=False, result='external watchdog timeout' if expired else 'failed')
    report['workerExitCode'] = code
    report['supervisorHostElapsedSeconds'] = time.monotonic() - HOST_STARTED_MONOTONIC
    report['processCleanup'] = {'observedProcessCount': len(owned), 'terminalObservedResiduals': residual,
        'terminalObservedLiveCount': len(live_residual), 'terminalObservedZombieCount': sum(info['state'] == 'Z' for info in residual),
        'method': 'Only observed worker descendants with matching PID/start-time are signaled; unrelated processes are untouched.',
        'boundary': 'Sampled descendant observation cannot prove absence of unobserved fast-orphaned processes. Zombies are reported as residuals, never described as zero descendants.'}
    atomic_json(report_path, report)
    print(json.dumps({'completed': report.get('completed', False), 'passed': report.get('passed', 0),
                      'case': report.get('case'), 'report': str(report_path), 'observedResiduals': residual}, ensure_ascii=False))
    sys.exit(code if code else (0 if report.get('completed') else 1))

fixture_bytes = Path(args.fixture).read_bytes()
fixture_sha256 = hashlib.sha256(fixture_bytes).hexdigest()
fixtures = json.loads(fixture_bytes)
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
RESOURCES = ('metal', 'crystal', 'deuterium')
parsed = urlparse(args.url)
if parsed.scheme not in ('http', 'https'):
    raise ValueError('Acceptance requires actual HTTP(S) production URL')
ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
checks, errors, failed_requests, evidence, source_bindings = [], [], [], [], []
page_sources, release_metadata = {}, None
completed, active_page, source_sha, failure = False, None, None, None
case = 'setup'
branch_metrics = {}
CARD = '[data-bind="bld-metal_storage"]'
QUEUE = '#demolition-job'
OPEN = '[data-demolish="metal_storage"]'
CONFIRM = '[data-demolition-confirm]'
DISMISS = '[data-demolition-dismiss]'
CANCEL = '[data-cancel-demolition]'
REBUILD = '[data-action="enqueue"][data-id="metal_storage"]'
PAID = {'metal': '128000', 'crystal': '0', 'deuterium': '0'}
REBUILD_PAID = {'metal': '256000', 'crystal': '0', 'deuterium': '0'}
DURATION, REBUILD_DURATION = 768 / 55, 1536 / 55
WALLET_TOLERANCE = 1e-6
ORIGIN_WALLET = {'metal': 2920000, 'crystal': 422694.07506993704, 'deuterium': 50827.623029905495}
GROSS = {'metal': 578.1007209732234, 'crystal': 384.44214731548226, 'deuterium': 244.20297428190867}

CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('demolition-clock');
 const epoch=saved?Number(saved):__EPOCH__;let elapsed=0;
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 // Read-only native-frame observer: deliberately bypass the controlled RAF
 // wrapper and expose its real callback timestamp, without advancing elapsed.
 let observerFrame=0;
 window.__demoObserveFrame=({selector,timeoutMs})=>new Promise(resolve=>{
   const observe=(nativeFrameTimestamp,observerTimedOut)=>{
     const element=document.querySelector(selector),r=element?.getBoundingClientRect();
     return {nativeFrameSequence:observerFrame,nativeFrameTimestamp,observerTimedOut,controlledElapsed:elapsed,
       geometry:{scrollX,scrollY,width:innerWidth,height:innerHeight,
         documentWidth:document.scrollingElement.scrollWidth,documentHeight:document.scrollingElement.scrollHeight,
         rect:r?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}:null}};
   };
   const guard=setTimeout(()=>{caf(frame);resolve(observe(null,true));},timeoutMs);
   const frame=raf(timestamp=>{clearTimeout(guard);observerFrame++;resolve(observe(timestamp,false));});
 });
 window.__demoFrameCount=0;
 window.requestAnimationFrame=callback=>raf(()=>{window.__demoFrameCount++;callback(elapsed);});
 window.__demoAdvance=async ms=>{const beforeAt=epoch+elapsed;elapsed+=ms;sessionStorage.setItem('demolition-clock',String(epoch+elapsed));await new Promise(raf);await new Promise(raf);return{beforeAt,afterAt:epoch+elapsed};};
 window.__demoNative=[Storage.prototype.getItem,Storage.prototype.setItem,File.prototype.text,window.confirm,window.setTimeout,window.setInterval].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 window.__demoDrags=[];for(const type of ["dragstart","drop","dragend"])document.addEventListener(type,event=>window.__demoDrags.push({type,trusted:event.isTrusted,slot:event.target.closest?.("[data-slot]")?.dataset.slot||null}),true);
 window.__demoClicks=[];window.__demoEdits=[];window.__demoFiles=[];window.__demoWheels=[];window.__demoStorage=[];
 document.addEventListener('click',event=>{const b=event.target.closest?.('button');if(b)window.__demoClicks.push({action:b.dataset.action||b.dataset.orderAction||b.dataset.buildingTemplateAction||b.dataset.tab||(b.hasAttribute("data-demolish")?"demolition-preview":b.hasAttribute("data-demolition-confirm")?"demolition-confirm":b.hasAttribute("data-demolition-dismiss")?"demolition-dismiss":b.hasAttribute("data-cancel-demolition")?"demolition-cancel":null),id:b.dataset.id||b.id,trusted:event.isTrusted});},true);
 for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches?.('select,input'))window.__demoEdits.push({id:event.target.id,type,trusted:event.isTrusted,value:event.target.value});},true);
 document.addEventListener('wheel',event=>window.__demoWheels.push({trusted:event.isTrusted,deltaY:event.deltaY}),{capture:true,passive:true});
 document.addEventListener('change',event=>{if(event.target.matches?.('[data-bind="import-file"]'))window.__demoFiles.push({trusted:event.isTrusted,name:event.target.files[0]?.name,size:event.target.files[0]?.size,priorRaw:localStorage.getItem(__KEY__)});},true);
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&event.key===__KEY__)window.__demoStorage.push({trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue});});
})();'''.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY))
def begin_case(label):
    global case
    now = time.monotonic()
    if case in branch_metrics:
        branch_metrics[case]['_hostEnded'] = now
    case = label
    branch_metrics[case] = {'_hostStarted': now, '_hostEnded': None,
        'attemptedAdvanceCalls': 0, 'successfulAdvanceCalls': 0, 'zeroAdvanceCalls': 0,
        'liveOneSecondAdvanceCalls': 0, 'simulatedSeconds': 0, 'advanceInFlight': None}

def timing_report():
    now = time.monotonic()
    branches = [{key: value for key, value in metrics.items() if not key.startswith('_')} | {
        'case': label, 'hostElapsedSeconds': (metrics['_hostEnded'] or now) - metrics['_hostStarted'],
        'hostStartOffsetSeconds': metrics['_hostStarted'] - HOST_STARTED_MONOTONIC,
        'hostEndOffsetSeconds': None if metrics['_hostEnded'] is None else metrics['_hostEnded'] - HOST_STARTED_MONOTONIC,
    } for label, metrics in branch_metrics.items()]
    return {'hostStartedAt': HOST_STARTED_AT, 'workerHostElapsedSeconds': now - HOST_STARTED_MONOTONIC,
        'hostClock': 'Python monotonic, independent of the controlled browser clock',
        'mode': 'Date/performance/RAF timestamps simulated. Positive advances are 1000ms and original live tick runs; native timers remain unchanged. Imported envelopes retain their original clocks; reload has zero saved gap.',
        'successfulAdvanceCalls': sum(row['successfulAdvanceCalls'] for row in branches),
        'zeroAdvanceCalls': sum(row['zeroAdvanceCalls'] for row in branches),
        'liveOneSecondAdvanceCalls': sum(row['liveOneSecondAdvanceCalls'] for row in branches),
        'simulatedSeconds': sum(row['simulatedSeconds'] for row in branches), 'branches': branches,
        'uncertainty': 'An unfinished advance remains advanceInFlight and is not counted as observed simulated time.'}

def advance(page, milliseconds=0):
    if milliseconds not in (0, 1000):
        raise ValueError('Acceptance only permits zero-time UI frames or exact one-second live advances')
    metrics = branch_metrics[case]
    metrics['attemptedAdvanceCalls'] += 1
    metrics['advanceInFlight'] = {'requestedMilliseconds': milliseconds,
        'hostStartOffsetSeconds': time.monotonic() - HOST_STARTED_MONOTONIC}
    observed = page.evaluate('(ms)=>window.__demoAdvance(ms)', milliseconds)
    if observed['afterAt'] - observed['beforeAt'] != milliseconds:
        raise AssertionError('Actual controlled clock delta differs from requested advance')
    metrics['successfulAdvanceCalls'] += 1
    metrics['zeroAdvanceCalls' if milliseconds == 0 else 'liveOneSecondAdvanceCalls'] += 1
    metrics['simulatedSeconds'] += (observed['afterAt'] - observed['beforeAt']) / 1000
    metrics['advanceInFlight'] = None

def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator(f'[data-tab="{name}"]').click(); advance(page)

def raw(page):
    return page.evaluate('(key)=>localStorage.getItem(key)', KEY)

def storage(page):
    return page.evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))')

def read(page):
    return json.loads(raw(page))['state']

def planet(state, ident=HOME):
    return next(value for value in state['planets'] if value['id'] == ident)

def trusted_click(page, selector):
    native_scroll_to(page, selector)
    before = page.evaluate('window.__demoClicks.length'); page.locator(selector).click(); advance(page)
    events = page.evaluate('(n)=>window.__demoClicks.slice(n)', before)
    check('actual user input produces exactly one trusted button click', len(events) == 1 and events[0]['trusted'], events)

def select(page, selector, value):
    field = page.locator(selector); before = field.input_value()
    index = field.evaluate('(e,value)=>[...e.options].findIndex(option=>option.value===value)', value)
    check(selector + ': requested native option exists', index >= 0)
    count = page.evaluate('window.__demoEdits.length'); field.focus(); field.press('Home')
    for _ in range(index):
        field.press('ArrowDown')
    field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__demoEdits.slice(n)', count)
    check(selector + ': native keyboard selects exact option with trusted change', field.input_value() == value and
          (before == value or any(event['id'] == (field.get_attribute('id') or '') and event['type'] == 'change' and event['trusted'] for event in events)), events)

def exact_json(left, right):
    if type(left) is not type(right):
        # JSON has one number type. Integers and nonintegral numbers still
        # compare numerically; booleans never borrow numeric equality.
        return type(left) in (int, float) and type(right) in (int, float) and left == right
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(exact_json(left[k], right[k]) for k in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(exact_json(a, b) for a, b in zip(left, right))
    return left == right

def whole_state(name, actual, expected):
    same = exact_json(actual, expected)
    if not same:
        atomic_json(out / (name + '-actual-state.json'), actual); atomic_json(out / (name + '-expected-state.json'), expected)
    check(name + ': every serialized game field equals production-engine oracle plus separate independent goldens', same,
          {'actualSha256': hashlib.sha256(json.dumps(actual, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
           'expectedSha256': hashlib.sha256(json.dumps(expected, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
           'scope': 'Full state: wallets, natural production, historical plans/IDs, timers, fleets, messages and all other fields; no exclusions or tolerances'})

def record(page, name):
    path = out / (name + '.json'); path.write_text(raw(page), encoding='utf-8')
    evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}); flush()

def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    path = out / name; page.screenshot(path=str(path), full_page=False, timeout=7000)
    evidence.append({'case': case, 'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}); flush()

def visibility(page, selectors):
    return page.evaluate('''selectors=>({viewport:{width:innerWidth,height:innerHeight},scrollY,targets:selectors.map(selector=>{
      const e=document.querySelector(selector),r=e.getBoundingClientRect(),s=getComputedStyle(e);
      const points=[[r.x+3,r.y+3],[r.right-3,r.y+3],[r.x+3,r.bottom-3],[r.right-3,r.bottom-3],[r.x+r.width/2,r.y+r.height/2]].map(([x,y])=>{
       const hit=document.elementFromPoint(x,y);return{x,y,unoccluded:!!hit&&(hit===e||e.contains(hit)),hit:hit?{tag:hit.tagName,id:hit.id}:null};});
      return{selector,text:e.innerText,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
       visible:r.width>6&&r.height>6&&s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0,
       contained:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,disabled:!!e.disabled,points};})})''', selectors)

def attach(page):
    page.set_default_timeout(7000); page.set_default_navigation_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))
    capture = {'responses': [], 'executed': [], 'cdp': page.context.new_cdp_session(page)}
    page_sources[page] = capture
    page.on('response', lambda response: capture['responses'].append(response)
            if response.request.resource_type in ('script', 'stylesheet') else None)
    capture['cdp'].send('Network.enable'); capture['cdp'].send('Network.setCacheDisabled', {'cacheDisabled': True})
    capture['cdp'].on('Debugger.scriptParsed', lambda event: capture['executed'].append(event)
                        if event.get('url', '').startswith(('http://', 'https://')) else None)
    capture['cdp'].send('Debugger.enable')

def verify_bundle(page):
    global source_sha, release_metadata
    if release_metadata is None:
        release_url = args.release or urljoin(args.url, 'release.json')
        check('release URL belongs to exact tested origin', f'{urlparse(release_url).scheme}://{urlparse(release_url).netloc}' == ORIGIN)
        response = page.request.get(release_url)
        check('release is actual HTTP 200 from requested URL', response.status == 200 and response.url == release_url)
        release_metadata = response.json(); source_sha = release_metadata.get('sourceSha')
        check('release pins exact mandatory tested commit', source_sha == args.expected_sha, source_sha)
        check('release save schema matches strict natural fixture', release_metadata.get('saveVersion') == fixtures['base']['version'] and release_metadata.get('saveRevision') == fixtures['base']['revision'])
        atomic_json(out / 'release.json', release_metadata)
    capture = page_sources[page]
    files = {urljoin(args.url, name): (name, expected) for name, expected in release_metadata['files'].items()}
    rows, bodies, executed = [], {}, []
    for response in capture['responses']:
        name, expected = files.get(response.url, (None, None))
        check('actual asset response belongs to pinned release', name is not None and response.status == 200 and response.url == response.request.url,
              {'type': response.request.resource_type, 'status': response.status, 'finalURL': response.url})
        body = response.body(); digest = hashlib.sha256(body).hexdigest(); bodies[response.url] = body
        row = {'type': response.request.resource_type, 'status': response.status, 'requestURL': response.request.url,
               'finalURL': response.url, 'releaseFile': name, 'bytes': len(body), 'httpSha256': digest, 'releaseSha256': expected}
        rows.append(row); check('complete served JS/CSS bytes match exact release hash', digest == expected, row)
        if not source_bindings:
            (out / ('served-' + Path(name).name)).write_bytes(body)
    check('real production JS and CSS responses were both captured', any(row['type'] == 'script' for row in rows) and any(row['type'] == 'stylesheet' for row in rows))
    for event in capture['executed']:
        url = event['url']; name, expected = files.get(url, (None, None))
        check('actual V8-executed HTTP script has matching pinned HTTP response', name is not None and url in bodies, url)
        source = capture['cdp'].send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
        digest = hashlib.sha256(source.encode('utf-8')).hexdigest()
        row = {'url': url, 'scriptId': event['scriptId'], 'releaseFile': name,
               'executedSourceSha256': digest, 'httpSha256': hashlib.sha256(bodies[url]).hexdigest(), 'releaseSha256': expected}
        check('read-only V8 source equals complete HTTP bytes and pinned release', digest == row['httpSha256'] == expected, row)
        executed.append(row)
        if not source_bindings:
            (out / ('executed-' + Path(name).name)).write_text(source, encoding='utf-8')
    check('real production script was observed executing in V8', bool(executed))
    source_bindings.append({'case': case, 'page': len(source_bindings) + 1, 'httpAssets': rows, 'executedScripts': executed,
                            'classification': 'Read-only CDP source inspection; no interception, inline bundle or game-state globals'})
    capture['cdp'].send('Debugger.disable'); flush()

def verify_document_response(response):
    body = response.body(); digest = hashlib.sha256(body).hexdigest()
    expected = release_metadata['files']['index.html']
    check('complete original HTTP200 document body matches pinned release index.html', response.status == 200 and response.url == args.url and digest == expected,
          {'url': response.url, 'httpSha256': digest, 'releaseSha256': expected, 'bytes': len(body)})
    path = out / 'served-index.html'
    if not path.exists():
        path.write_bytes(body)

def text_leaf_visibility(page, selectors):
    return page.evaluate(r"""selectors=>{
      const rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
      const clipValues=new Set(['hidden','clip','scroll','auto']);
      return {viewport:{width:innerWidth,height:innerHeight},scrollY,leaves:selectors.map(selector=>{
        const leaf=document.querySelector(selector);
        if(!leaf)return {selector,missing:true,passed:false};
        const ancestry=[];
        for(let node=leaf;node;node=node.parentElement){
          const s=getComputedStyle(node),b=node.getBoundingClientRect();
          const x=b.x+node.clientLeft,y=b.y+node.clientTop;
          const paintContain=s.contain.split(/\s+/).some(v=>['paint','strict','content'].includes(v));
          ancestry.push({tag:node.tagName,id:node.id,bind:node.dataset.bind||null,rect:rect(b),
            paddingClip:{x,y,right:x+node.clientWidth,bottom:y+node.clientHeight},
            overflowX:s.overflowX,overflowY:s.overflowY,clipX:clipValues.has(s.overflowX)||paintContain,
            clipY:clipValues.has(s.overflowY)||paintContain,contain:s.contain,clipPath:s.clipPath,
            legacyClip:s.clip,contentVisibility:s.contentVisibility,display:s.display,visibility:s.visibility,
            opacity:Number(s.opacity),textOverflow:s.textOverflow,whiteSpace:s.whiteSpace,
            lineClamp:s.getPropertyValue('-webkit-line-clamp'),scrollWidth:node.scrollWidth,
            clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight});
        }
        const fragments=[];let sourceText='';
        const walker=document.createTreeWalker(leaf,NodeFilter.SHOW_TEXT);let node;
        while((node=walker.nextNode())){
          sourceText+=node.data;
          // Nonwhitespace character ranges avoid claiming that a bounding box
          // proves its text. Every real glyph fragment must fit every clip box.
          for(let offset=0;offset<node.data.length;){
            const glyph=String.fromCodePoint(node.data.codePointAt(offset)),end=offset+glyph.length;
            if(glyph.trim()){
              const range=document.createRange();range.setStart(node,offset);range.setEnd(node,end);
              const boxes=[...range.getClientRects()].map(rect);
              const parent=node.parentElement;
              const measurements=boxes.map(box=>{
                const x=box.x+box.width/2,y=box.y+box.height/2,hit=document.elementFromPoint(x,y);
                const viewportContained=box.x>=0&&box.y>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;
                const clips=ancestry.filter(a=>a.clipX||a.clipY).map(a=>({tag:a.tag,id:a.id,bind:a.bind,
                  xFits:!a.clipX||(box.x>=a.paddingClip.x-0.5&&box.right<=a.paddingClip.right+0.5),
                  yFits:!a.clipY||(box.y>=a.paddingClip.y-0.5&&box.bottom<=a.paddingClip.bottom+0.5)}));
                return {rect:box,viewportContained,clips,unoccluded:!!hit&&(hit===parent||parent.contains(hit)),
                  hit:hit?{tag:hit.tagName,id:hit.id,bind:hit.dataset?.bind||null}:null};
              });
              fragments.push({glyph,boxes:measurements,passed:measurements.length>0&&measurements.every(m=>
                m.rect.width>0&&m.rect.height>0&&m.viewportContained&&m.unoccluded&&m.clips.every(c=>c.xFits&&c.yFits))});
            }
            offset=end;
          }
        }
        const stylesVisible=ancestry.every(a=>a.display!=='none'&&a.visibility==='visible'&&a.opacity>0&&a.contentVisibility!=='hidden');
        // Nonrectangular clipping cannot be proved by these rectangles, so fail
        // closed rather than calling such a text fragment fully visible.
        const rectangularClips=ancestry.every(a=>a.clipPath==='none'&&a.legacyClip==='auto'&&(!a.lineClamp||a.lineClamp==='none'||a.lineClamp==='0'));
        return {selector,text:leaf.innerText,sourceText,rect:rect(leaf.getBoundingClientRect()),ancestry,fragments,
          stylesVisible,rectangularClips,passed:stylesVisible&&rectangularClips&&fragments.length>0&&fragments.every(f=>f.passed)};
      })};
    }""", selectors)

def wait_for_scroll_settled(page, selector):
    # A target entering the viewport does not mean its native smooth scroll has
    # stopped. Require four fresh native frames with exact complete geometry,
    # spanning >=150ms on both the native RAF and independent host clocks.
    # Nothing here changes CSS, input, elapsed game time or application methods.
    started = time.monotonic()
    samples, previous, identical, stable_host, stable_native = [], None, 0, None, None
    for attempt in range(33):
        remaining = 1600 - (time.monotonic() - started) * 1000
        if remaining <= 0:
            break
        current = page.evaluate('options=>window.__demoObserveFrame(options)',
                                {'selector': selector, 'timeoutMs': min(250, remaining)})
        observed_at = time.monotonic()
        current['hostOffsetMilliseconds'] = (observed_at - started) * 1000
        samples.append(current)
        geometry = current['geometry']
        fresh = not current['observerTimedOut'] and current['nativeFrameTimestamp'] is not None and (
            previous is None or current['nativeFrameSequence'] > previous['nativeFrameSequence'] and
            current['nativeFrameTimestamp'] > previous['nativeFrameTimestamp'] and
            current['controlledElapsed'] == previous['controlledElapsed'])
        if not fresh or geometry['rect'] is None:
            check('scroll readiness requires a fresh native frame, unchanged game clock and mounted target', False,
                  {'selector': selector, 'samples': samples})
        if previous is not None and exact_json(previous['geometry'], geometry):
            identical += 1
        else:
            identical, stable_host, stable_native = 1, observed_at, current['nativeFrameTimestamp']
        host_span = (observed_at - stable_host) * 1000
        native_span = current['nativeFrameTimestamp'] - stable_native
        if identical >= 4 and host_span >= 150 and native_span >= 150 and current['hostOffsetMilliseconds'] <= 1600:
            check('native scroll and target geometry settle across four fresh frames and 150 ms', True,
                  {'selector': selector, 'samples': samples, 'stableSamples': identical,
                   'stableHostMilliseconds': host_span, 'stableNativeFrameMilliseconds': native_span,
                   'hostClock': 'Python monotonic; not the controlled browser clock'})
            return
        previous = current
        if attempt < 32:
            remaining = 1600 - (time.monotonic() - started) * 1000
            if remaining <= 0:
                break
            page.wait_for_timeout(min(50, remaining))
    check('native scroll and target geometry settle within 1600 ms bounded sampling', False, {'selector': selector, 'samples': samples})


def native_scroll_to(page, selector):
    wait_for_scroll_settled(page, selector)
    for _ in range(5):
        target = page.locator(selector); box = target.bounding_box()
        limits = target.evaluate('''element=>{
          const header=document.querySelector('.topbar');
          return {height:innerHeight,width:innerWidth,inTopbar:!!header&&header.contains(element),
            headerPosition:header?getComputedStyle(header).position:null,
            headerBottom:header?.getBoundingClientRect().bottom||0};}''')
        # Read actual viewport/hit evidence first. A topbar child or a floating
        # layer can be fully visible above headerBottom; header ancestry never
        # grants visibility and an arbitrary screenshot inset is not a clip.
        limits['top'] = 0 if limits['inTopbar'] or limits['headerPosition'] not in ('sticky', 'fixed') else max(0, limits['headerBottom'])
        check('target fits its actual complete viewport', box is not None and box['height'] <= limits['height'] and box['width'] <= limits['width'],
              {'selector': selector, 'box': box, 'limits': limits})
        proof = visibility(page, [selector])
        wholly_visible = len(proof['targets']) == 1 and all(item['visible'] and item['contained'] and len(item['points']) == 5 and all(point['unoccluded'] for point in item['points']) for item in proof['targets'])
        if wholly_visible:
            check('native target is wholly visible with five unoccluded hit-tests', True, proof)
            return
        # Only a failed real visibility proof invokes repositioning. Reserve the
        # sticky header for normal content, but never mistake it for an overlay
        # above an already fully hit-testable floating target.
        available = limits['height'] - limits['top']
        check('target fits its actual unobstructed viewport region', box['height'] <= available,
              {'selector': selector, 'box': box, 'limits': limits, 'failedVisibility': proof})
        target_y = limits['top'] + (available - box['height']) / 2
        page.mouse.move(limits['width'] - 12, limits['height'] - 12)
        page.mouse.wheel(0, round(box['y'] - target_y)); advance(page)
        wait_for_scroll_settled(page, selector)
    check('Actual wheel input could not expose the complete requested region with five unoccluded hit-tests', False,
          {'selector': selector, 'lastVisibility': visibility(page, [selector])})


def capture_failure(error, page=None):
    global completed, failure
    completed = False
    failure = {'case': case, 'error': repr(error), 'traceback': traceback.format_exc()}

    def attempt(label, action):
        try:
            action()
        except BaseException as capture_error:
            failure.setdefault('captureErrors', []).append({'step': label, 'error': repr(capture_error)})

    def artifact(name, data):
        path = out / name; path.write_bytes(data)
        evidence.append({'case': case, 'file': name, 'sha256': hashlib.sha256(data).hexdigest()})

    def capture_raw():
        failure['rawSave'] = raw(page)
        if failure['rawSave'] is not None:
            artifact('failure-raw-save.json', failure['rawSave'].encode('utf-8'))

    # Persist the original failure before diagnostics. A failed individual
    # capture must neither hide that error nor prevent the other evidence.
    attempt('original failure report', flush)
    if page is not None:
        attempt('raw save', capture_raw)
        for name, selector in [('card', CARD), ('queue', QUEUE), ('status', '[data-bind="status"]')]:
            attempt(name, lambda name=name, selector=selector: failure.__setitem__(name, page.locator(selector).all_text_contents()))
        attempt('scroll and wheel diagnostics', lambda: failure.__setitem__('scrollAndWheels', page.evaluate('({width:innerWidth,height:innerHeight,scrollY,scrollHeight:document.scrollingElement?.scrollHeight,wheelCount:window.__demoWheels?.length||0,wheels:window.__demoWheels?.slice(-200)||[]})')))
        # all_text_contents above intentionally retains hidden historical text.
        # Report visibility separately so it cannot be mistaken for shown work.
        attempt('diagnostic target visibility', lambda: failure.__setitem__('targetVisibility', page.evaluate("""selectors=>selectors.map(selector=>{
          const element=document.querySelector(selector);if(!element)return {selector,missing:true};
          const r=element.getBoundingClientRect(),s=getComputedStyle(element);
          return {selector,hidden:element.hidden,hiddenAncestor:!!element.closest('[hidden]'),
            display:s.display,visibility:s.visibility,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
            controls:[...element.querySelectorAll('button,input,select')].map(e=>({tag:e.tagName,id:e.id,disabled:e.disabled}))};
        })""", [CARD, QUEUE, '[data-bind="res-metal"]'])))
        attempt('DOM', lambda: artifact('failure-dom.html', page.content().encode('utf-8')))
        attempt('report before screenshot', flush)
        attempt('screenshot', lambda: artifact('failure.png', page.screenshot(full_page=False, timeout=2000)))
    attempt('final failure report', flush)

@contextmanager
def capture_live_failure():
    try:
        yield
    except BaseException as error:
        capture_failure(error, active_page)
        raise

def flush():
    atomic_json(report_path, {'completed': completed, 'result': 'passed' if completed else 'incomplete',
        'case': case, 'url': args.url, 'sourceSha': source_sha, 'fixture': fixtures['description'],
        'fixtureSha256': fixture_sha256, 'sourceReportSha256': fixtures['source']['reportSha256'],
        'originReportSha256': fixtures['origin']['reportSha256'], 'originalSaveSha256': fixtures['origin']['originalSaveSha256'],
        'classification': 'One unchanged ac3 milestone10 natural economic loop. Separate labeled synthetic no-RAF DOM probes, actual reset/curvature retirement, and robot2/computer0 seeded boundary branches with trusted paid/off/clear/rebuild UI. Four widths are layout evidence only.',
        'responsiveScope': '320/390/768/1440: complete actual quote/loss text and active-job cancellation controls, glyph clipping, five-point hit-tests, native wheel motion and action-labeled screenshots. One economic execution at1440.',
        'timing': timing_report(), 'oracle': 'Every serialized state field compared exactly. Separately fixed integer fees/IDs, exact saved Number timers and independently integrated wallet/lifetime predictions.',
        'decimalTolerance': {'absolute': WALLET_TOLERANCE, 'scope': 'Only independent integration predictions for decimal wallets/lifetime; exact full-state comparisons, paid amounts, identities, timers and migration projections never receive tolerance.'},
        'boundsSeconds': {'worker': 300, 'supervisor': 305}, 'checks': checks,
        'passed': sum(value['passed'] for value in checks), 'errors': errors, 'failedRequests': failed_requests,
        'sourceBindings': source_bindings, 'evidence': evidence, 'failure': failure})


def check(name, condition, detail=None):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), **({'detail': detail} if detail is not None else {})})
    flush()
    if not condition:
        raise AssertionError(f'{case}: {name}')


def building_tab(page):
    tab(page, 'facilities'); expect(page.locator(CARD)).to_be_visible()


def save(page, expected=None):
    tab(page, 'save'); page.locator('[data-action="save"]').click(); result = read(page); building_tab(page)
    if expected is not None:
        whole_state(expected, result, fixtures['expected'][expected])
    return result


def boot(epoch, width=1440):
    global active_page
    context = browser.new_context(viewport={'width': width, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': [
            {'name': 'infinity.ui.tab', 'value': 'overview'},
            {'name': 'infinity.save.v1', 'value': 'EXPLICIT LEGACY SENTINEL: retain unchanged'}]}]})
    context.add_init_script(CLOCK.replace('__EPOCH__', str(epoch)))
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('production document is actual HTTP200 at exact requested URL', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); verify_document_response(response)
    check('Storage/File.text/dialog/timer functions remain native', page.evaluate('window.__demoNative'))
    return context, page


def import_confirmation(value, progress):
    return (f'已读取存档 v{value["version"]}/r{value["revision"]}。\n'
            f'是否替换当前进度（{progress}）？\n'
            '读取期间产生的变化也会被替换。保留当前已保存原件，写入校验成功后才采用。')


def verify_conflict_refusal(before, after, status):
    check('real conflict import reports refusal and the required cold-refresh recovery boundary',
          status == '导入失败，当前进度未改动：检测到其他标签页修改了存档，已暂停写入。请先导出本页保留的原件，再刷新读取最新存档。', status)
    check('refused conflict import preserves every current, legacy and backup byte', exact_json(before, after))


def verify_recovery_storage(before, after, competing, restored):
    check('new protected-session recovery adopts exactly the original complete saved bytes', after.get(KEY) == restored)
    check('new protected-session recovery preserves every pre-existing noncurrent storage byte',
          all(after.get(key) == value for key, value in before.items() if key != KEY))
    added = set(after) - set(before)
    backup = lambda key: key == KEY + '.backup' or key.startswith(KEY + '.backup.')
    check('recovery only adds backup keys and preserves the exact malformed competing source',
          all(backup(key) for key in added) and any(backup(key) and value == competing for key, value in after.items()))


def import_save(page, value, label, original_raw=None, expected=None, expected_conflict=False, displayed_progress=None):
    check('native handoff retains exact original zero-gap clocks', value['savedAt'] == value['lastTickAt'] == page.evaluate('Date.now()'))
    text = original_raw if original_raw is not None else json.dumps(value, ensure_ascii=False)
    check('file bytes decode to complete intended envelope without patching', exact_json(json.loads(text), value))
    path = out / f'native-import-{label}.json'; path.write_bytes(text.encode('utf-8'))
    tab(page, 'save')
    if page.locator('[data-action="save"]').is_enabled():
        page.locator('[data-action="save"]').click()
    before, before_storage, count, dialogs = raw(page), storage(page), page.evaluate('window.__demoFiles.length'), []
    if displayed_progress is None:
        current = read(page); selected = planet(current, current['activePlanetId'])
        displayed_progress = f'第 {current["stats"]["launches"] + 1} 轮，{len(current["planets"])} 颗星球，当前“{selected["name"]}”'
    confirmation = import_confirmation(value, displayed_progress)
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message == confirmation
        dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', answer)
    page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败，当前进度未改动' if expected_conflict else '已导入并存入本地')
    files = page.evaluate('window.__demoFiles')
    check('real file selection/native asynchronous read/one explicit native confirmation', len(dialogs) == 1 and dialogs[0]['valid'] and len(files) == count + 1 and files[-1] == {'trusted': True, 'name': path.name, 'size': path.stat().st_size, 'priorRaw': before}, dialogs)
    if expected_conflict:
        verify_conflict_refusal(before_storage, storage(page), page.locator('[data-bind="status"]').inner_text())
        evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                         'classification': 'Real native file/confirmation rejected by the existing conflict session; never a successful recovery', 'nativeConfirmation': dialogs})
        building_tab(page)
        return
    wanted = expected if expected is not None else value
    whole_state('import-' + label, read(page), wanted['state'])
    check('entire adopted native envelope equals exact migration/unchanged handoff oracle', exact_json(json.loads(raw(page)), wanted))
    evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'classification': label, 'nativeConfirmation': dialogs})
    building_tab(page)


def reload_conflicted_source(page, competing):
    # A conflict cannot be reset/imported away. Navigation creates a new session
    # from the SAME malformed bytes, which must now enter protected placeholder.
    before = storage(page)
    check('conflict cold reload starts at zero saved gap without replacing the shared source',
          raw(page) == competing and json.loads(competing)['lastTickAt'] == page.evaluate('Date.now()'))
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle')
    check('conflict recovery boundary is an actual fresh HTTP200 document', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); verify_document_response(response)
    check('cold reload keeps every malformed current, legacy and backup byte unchanged', exact_json(storage(page), before))
    check('cold reload destroys the prior document references rather than reviving its review', page.evaluate('typeof window.__demoRetained === "undefined"'))
    expect(page.locator('[data-bind="notice"]')).to_contain_text('当前仅显示临时初始画面')
    tab(page, 'overview')
    placeholder = page.evaluate("""()=>({planet:document.querySelector('[data-bind="ov-planet"]').innerText,
      played:document.querySelector('[data-bind="played"]').innerText,
      options:[...document.querySelector('#planet-select').options].map(o=>({value:o.value,text:o.textContent})),
      jobHidden:document.querySelector('#demolition-job').hidden,reviewHidden:document.querySelector('#demolition-review').hidden,
      confirmations:document.querySelectorAll('[data-demolition-confirm]').length,cancellations:document.querySelectorAll('[data-cancel-demolition]').length})""")
    check('fresh protected session displays only a frozen initial placeholder with no inherited authority',
          placeholder == {'planet': '母星', 'played': '累计 0 秒', 'options': [{'value': 'homeworld', 'text': '母星'}],
                          'jobHidden': True, 'reviewHidden': True, 'confirmations': 0, 'cancellations': 0}, placeholder)
    tab(page, 'save')
    protected_storage = storage(page)
    trusted_click(page, '[data-action="save"]')
    check('fresh protected placeholder native save still refuses to change any malformed current or backup byte',
          exact_json(storage(page), protected_storage) and raw(page) == competing and '原件已保留并受保护' in page.locator('[data-bind="status"]').inner_text())
    building_tab(page)


def one_seconds(page, count):
    for _ in range(count):
        advance(page, 1000)


def reload_verified(page, expected):
    original = raw(page); saved = json.loads(original); paid = copy.deepcopy(planet(saved['state'])['demolition']); queue = copy.deepcopy(planet(saved['state'])['buildQueue'])
    check('native cold reload has exactly zero saved gap', saved['savedAt'] == saved['lastTickAt'] == page.evaluate('Date.now()'))
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle')
    check('native reload receives actual HTTP200 production document', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); verify_document_response(response); building_tab(page)
    check('entire original saved bytes survive page startup before another save', raw(page) == original)
    restored = save(page, expected)
    check('native reload preserves exact paid identity, total and remaining fractional seconds', planet(restored)['demolition'] == paid and planet(restored)['buildQueue'] == queue)
    record(page, expected + '-after-native-reload')


def wallet_transfer(before, after, fee, direction, label):
    for old in before['planets']:
        current = planet(after, old['id'])
        for resource in RESOURCES:
            amount = int(fee[resource]) if old['id'] == HOME else 0
            a, b = float(old['resources'][resource]), float(current['resources'][resource])
            expected = a + direction * amount
            check(label + ': independently exact requested integer, correct actual direction ' + old['id'] + '/' + resource,
                  abs(b - expected) <= WALLET_TOLERANCE and (b < a if amount and direction == -1 else b > a if amount else b == a),
                  {'before': old['resources'][resource], 'after': current['resources'][resource], 'integerAmount': amount, 'direction': direction, 'expectedWallet': expected})
    check(label + ': no lifetime resources are awarded', before['lifetime'] == after['lifetime'])


def paid_golden(before, after, ident, ordinary=False):
    job = planet(after)['buildQueue'][0] if ordinary else planet(after)['demolition']
    fee, duration = (REBUILD_PAID, REBUILD_DURATION) if ordinary else (PAID, DURATION)
    check('fixed independent fee/identity/source/task and exact saved fractional duration', job is not None and job['jobId'] == ident == before['orders']['nextJobId'] and job['source'] == 'manual' and job['taskId'] is None and job['paid'] == fee and job['totalSeconds'] == job['remainingSeconds'] == duration and job['building'] == 'metal_storage' and (job['targetLevel'] == 9 if ordinary else job['kind'] == 'demolition' and job['fromLevel'] == 9 and job['toLevel'] == 8), job)
    wallet_transfer(before, after, fee, -1, 'native real payment')
    check('one new paid identity, no new finite plan or terraformer ledger', after['orders']['nextJobId'] == ident + 1 and before['orders']['tasks'] == after['orders']['tasks'] and before['terraformerGrantJobFloor'] == after['terraformerGrantJobFloor'] == 89 and all(planet(before, p['id'])['terraformerFields'] == p['terraformerFields'] for p in after['planets']))
    return job


def wallet_golden(state, elapsed, metal_produced, net_spent):
    for resource in RESOURCES:
        produced = metal_produced if resource == 'metal' else GROSS[resource] * elapsed
        expected = ORIGIN_WALLET[resource] + produced - (net_spent if resource == 'metal' else 0)
        check('independent integrated natural wallet ' + resource, abs(float(planet(state)['resources'][resource]) - expected) <= WALLET_TOLERANCE,
              {'actual': planet(state)['resources'][resource], 'expected': expected, 'produced': produced, 'netSpent': net_spent if resource == 'metal' else 0})
        initial_lifetime = float(fixtures['expected']['origin']['lifetime'][resource])
        check('independent natural lifetime excludes all fees/refunds/completion ' + resource, abs(float(state['lifetime'][resource]) - initial_lifetime - produced) <= WALLET_TOLERANCE)
    check('other planet capped wallet stays unchanged', planet(state, COLONY)['resources'] == {'metal': '10000', 'crystal': '10000', 'deuterium': '0'})


def quote_golden(page):
    title = page.locator('#demolition-review-title').inner_text()
    fee = page.locator('#demolition-review-fee').inner_text()
    duration = page.locator('#demolition-review-time').inner_text()
    losses = page.locator('#demolition-review-losses').inner_text()
    check('actual quote fixes planet/building9→8 and all three literal resource fees', title == '母星 · 金属仓库 9 → 8' and fee == '拆除费：金属 128000 / 晶体 0 / 重氢 0', {'title': title, 'fee': fee})
    check('rounded14-second UI never replaces exact fractional saved time', '14 秒' in duration and float(page.locator('#demolition-review-time').get_attribute('data-total-seconds')) == DURATION and '离子减费不缩短时间' in duration, duration)
    check('quote itself explicitly shows one freed field, unchanged total, both exact caps, kept overstock/paused production, no historical refund and100% current-fee cancellation',
          all(value in losses for value in ('124 → 123', '总格 173 不变', '2920000 → 1590000', '超仓资源保留', '自然生产暂停', '不返还历史建造投入', '100%', '本次实际拆除费')), losses)
    return {'title': title, 'fee': fee, 'duration': duration, 'losses': losses}


def wheel_roundtrip(page, label, width):
    page.mouse.move(width - 12, 1080); page.mouse.wheel(0, -100000)
    page.wait_for_timeout(80); page.wait_for_function('scrollY === 0', polling=20, timeout=1000); advance(page)
    start = page.evaluate('({scrollY,height:innerHeight,scrollHeight:document.scrollingElement.scrollHeight,wheelCount:window.__demoWheels.length})')
    check(label + ': actual document can scroll', start['scrollHeight'] > start['height'], start)
    page.mouse.wheel(0, min(480, start['scrollHeight'] - start['height']))
    page.wait_for_function('(y)=>scrollY>y', arg=start['scrollY'], polling=20, timeout=1000); advance(page)
    down = page.evaluate('(n)=>({scrollY,wheels:window.__demoWheels.slice(n)})', start['wheelCount'])
    check(label + ': trusted positive wheel actually moves document', down['scrollY'] > start['scrollY'] and bool(down['wheels']) and all(w['trusted'] for w in down['wheels']) and any(w['deltaY'] > 0 for w in down['wheels']), {'before': start, 'after': down})
    page.mouse.wheel(0, -100000); page.wait_for_function('scrollY === 0', polling=20, timeout=1000); advance(page)
    returned = page.evaluate('(n)=>({scrollY,wheels:window.__demoWheels.slice(n)})', start['wheelCount'])
    check(label + ': trusted negative wheel actually returns to top', returned['scrollY'] == 0 and returned['scrollY'] < down['scrollY'] and all(w['trusted'] for w in returned['wheels']) and any(w['deltaY'] < 0 for w in returned['wheels']), {'before': down, 'after': returned})


def responsive(page, label, quote=False):
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100}); building_tab(page)
        wheel_roundtrip(page, label + '-' + str(width), width)
        if quote:
            trusted_click(page, OPEN); quote_golden(page)
            selectors = ['#demolition-review-title', '#demolition-review-fee', '#demolition-review-time', '#demolition-review-losses', CONFIRM, DISMISS]
        else:
            selectors = ['#demolition-job-title', '#demolition-job-time', '#demolition-job-fee', '#demolition-job > p:nth-of-type(3)', CANCEL, REBUILD]
        for index, selector in enumerate(selectors):
            native_scroll_to(page, selector)
            before = visibility(page, [selector]); leaves = text_leaf_visibility(page, [selector])
            check(f'{label} {width}px target{index}: actual text glyphs fit viewport/all clip ancestors and real five-point hit targets',
                  all(item['visible'] and item['contained'] and len(item['points']) == 5 and all(p['unoccluded'] for p in item['points']) for item in before['targets']) and all(leaf['passed'] for leaf in leaves['leaves']), {'target': before, 'textLeaves': leaves})
            if selector in (CONFIRM, DISMISS, CANCEL):
                check(f'{label} {width}px intended economic control is visibly enabled', all(not item['disabled'] for item in before['targets']))
            if selector == REBUILD:
                check(f'{label} {width}px old upgrade is visibly structurally blocked during demolition', page.locator(REBUILD).is_disabled() and '拆除' in page.locator(REBUILD).inner_text())
            snap(page, f'{label}-{width}-{index}.png')
            after = visibility(page, [selector]); after_leaves = text_leaf_visibility(page, [selector])
            # Persist both complete observations BEFORE asserting so a real
            # screenshot movement/clipping failure retains its exact difference.
            artifact = out / f'{label}-{width}-{index}-visibility.json'; atomic_json(artifact, {'before': before, 'after': after, 'textLeaves': leaves, 'afterTextLeaves': after_leaves})
            evidence.append({'case': case, 'file': artifact.name, 'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()})
            check('screenshot preserves actual visible control and every glyph', exact_json(before, after) and exact_json(leaves, after_leaves),
                  {'artifact': artifact.name, 'beforeTarget': before, 'afterTarget': after, 'everyGlyphAndAncestorExact': exact_json(leaves, after_leaves)})
        check(f'{label} {width}px no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
        if quote:
            native_scroll_to(page, '#demolition-review'); snap(page, f'{label}-{width}-complete-quote.png')
            trusted_click(page, DISMISS); check('native preview dismissal hides review', page.locator('#demolition-review').is_hidden())
    page.set_viewport_size({'width': 1440, 'height': 1100})


def force_retained(page, label, indices=None):
    before = storage(page)
    page.evaluate('indices=>{for(const [index,b] of window.__demoRetained.entries()){if(b&&(indices===null||indices.includes(index))){b.disabled=false;b.click();}}}', indices)
    advance(page)
    check(label + ': explicitly synthetic forced stale DOM replay cannot write any save/backup key', storage(page) == before)


def export_protected(page, original, name):
    tab(page, 'save')
    with page.expect_download() as pending:
        page.locator('[data-action="export"]').click()
    path = out / name; pending.value.save_as(str(path))
    check('protected real download exports byte-exact cached original', path.read_bytes() == original.encode())
    evidence.append({'case': case, 'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})


def timeout(_signal, _frame):
    raise TimeoutError('Demolition native acceptance exceeded the300-second worker bound')


def atomic_stale_probe(page, kind):
    """Explicit synthetic DOM events, separate from trusted economic play."""
    result = page.evaluate(r'''({kind,home,colony})=>{
      const action=window.__demoRetained[0];
      const before={frames:window.__demoFrameCount,at:Date.now(),selected:document.querySelector('#planet-select').value};
      if(kind==='hidden-roundtrip'){
        const hidden=Object.getOwnPropertyDescriptor(document,'hidden'),visibility=Object.getOwnPropertyDescriptor(document,'visibilityState');
        try{
          Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
          Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>"hidden"});
          document.dispatchEvent(new Event('visibilitychange'));
          const selection=document.querySelector('#planet-select');
          for(const value of [colony,home]){selection.value=value;selection.dispatchEvent(new Event('change',{bubbles:true}));}
        }finally{
          if(hidden)Object.defineProperty(document,'hidden',hidden);else delete document.hidden;
          if(visibility)Object.defineProperty(document,'visibilityState',visibility);else delete document.visibilityState;
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }else{
        const target=kind==='detach-confirm'||kind==='detach-cancel'?action:document.querySelector('#demolition-review');
        const parent=target.parentNode,next=target.nextSibling;
        parent.removeChild(target);parent.insertBefore(target,next);
      }
      const disabledBeforeReplay=action.disabled;
      action.disabled=false;action.click();
      return {kind,before,after:{frames:window.__demoFrameCount,at:Date.now(),selected:document.querySelector('#planet-select').value},disabledBeforeReplay,
        documentHidden:document.hidden,connected:action.isConnected,classification:'Synthetic visibility/DOM negative probe in one JS task with no intervening RAF; not native OS background.'};
    }''', {'kind': kind, 'home': HOME, 'colony': COLONY})
    check('synthetic retirement and immediate stale replay occur with no hidden live time or intervening paint', result['before']['frames'] == result['after']['frames'] and result['before']['at'] == result['after']['at'] and result['after']['selected'] == HOME and not result['documentHidden'] and result['connected'], result)
    advance(page)


def slot_one(page):
    tab(page, 'protocol'); expect(page.locator('[data-slot="1"]')).to_be_visible()


def locked_slot_probe(page, cleared=False):
    """Force forbidden enabled/param events, then use a real native drag/drop."""
    before = read(page)
    if not cleared:
        check('locked card exposes no enabled permission parameters', page.locator('[data-slot="1"] [data-path]:enabled').count() == 0)
        result = page.evaluate(r'''()=>{
          const checkbox=document.querySelector('[data-bind="slot-enabled-1"]');
          checkbox.disabled=false;checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));
          let field=document.querySelector('[data-slot="1"] [data-path]');
          const forged=!field;
          if(forged){field=document.createElement('select');field.dataset.path='trigger.seconds';field.innerHTML='<option value="10">10</option><option value="1">1</option>';document.querySelector('[data-bind="slot-params-1"]').append(field);}
          const original=field.value;field.disabled=false;field.value=[...field.options].find(o=>o.value!==original).value;field.dispatchEvent(new Event('change',{bubbles:true}));
          const result={checkboxDisabled:checkbox.disabled,checkboxChecked:checkbox.checked,paramDisabled:field.disabled,syntheticForgedParameter:forged};
          if(forged)field.remove();return result;
        }''')
        advance(page)
        check('synthetic force-enable and parameter changes are immediately rejected in locked off slot', result['checkboxDisabled'] and not result['checkboxChecked'] and result['paramDisabled'], result)
    count = page.evaluate('window.__demoDrags.length')
    page.locator('[data-bind="catalog-auto_collect"]').drag_to(page.locator('[data-slot="1"]'))
    advance(page)
    drags = page.evaluate('(n)=>window.__demoDrags.slice(n)', count)
    check('actual catalog drag/drop targets the locked second slot through trusted native drag events', any(e['trusted'] and e['type'] == 'dragstart' for e in drags) and any(e['trusted'] and e['type'] == 'drop' and e['slot'] == '1' for e in drags), drags)
    whole_state('locked-' + ('empty' if cleared else 'off') + '-forbidden-enable-edit-install-full-state', save(page), before)


signal.signal(signal.SIGALRM, timeout); signal.alarm(300)
begin_case('setup')
try:
    source_bytes = Path(args.natural_report).read_bytes(); source_report = json.loads(source_bytes)
    check('complete natural report independently hash-bound to CLI and fixture', hashlib.sha256(source_bytes).hexdigest() == args.expected_report_sha256 == fixtures['source']['reportSha256'])
    check('formal fixture and engine report belong to exact clean candidate SHA', fixtures['schema'] == 'infinity-demolition-browser-fixture-v1' and source_report['schema'] == 'infinity-demolition-natural-growth-v1' and source_report['outcome']['status'] == 'passed' and source_report['source']['sourceSha'] == source_report['source']['gitHead'] == fixtures['source']['sourceSha'] == args.expected_sha and source_report['source']['sourceScopeStatusPorcelain'] == fixtures['source']['sourceScopeStatusPorcelain'] == fixtures['source']['oracleSourceScopeStatusPorcelain'] == '')
    check('source origin is literal green ac3 serializer slice', fixtures['origin']['sourceSha'] == 'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a' and fixtures['origin']['reportSha256'] == '303175f79caeb3b27bdd6d03262aff5c67ced0171b2c60c07794c42dca394025' and hashlib.sha256(fixtures['originalSaveRaw'].encode()).hexdigest() == fixtures['origin']['originalSaveSha256'] == 'd456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a' and json.loads(fixtures['originalSaveRaw']) == fixtures['originalSave'])
    check('literal independent fees/durations/capacities and all fourteen complete milestones', fixtures['golden']['paid'] == PAID and fixtures['golden']['rebuildPaid'] == REBUILD_PAID and fixtures['golden']['demolitionSeconds'] == DURATION and fixtures['golden']['rebuildSeconds'] == REBUILD_DURATION and fixtures['golden']['cap8'] == 1590000 and fixtures['golden']['cap9'] == 2920000 and len(fixtures['naturalMilestones']) == 14)
    for key, milestone in fixtures['naturalMilestones'].items():
        matches = [m for m in source_report['milestones'] if m['name'] == key]
        check('full milestone unchanged from domain report: ' + key, len(matches) == 1 and exact_json(matches[0], milestone) and milestone['strictRoundtrips'] == 2 and milestone['stateAdoptedFromReload'])
    (out / 'source-demolition-natural-report.json').write_bytes(source_bytes)
    with sync_playwright() as playwright, capture_live_failure():
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        begin_case('one unchanged natural source -> native real cancel/re-pay/reload/demolish/ordinary-rebuild loop')
        context, page = boot(fixtures['originalSave']['savedAt'])
        import_save(page, fixtures['originalSave'], 'unchanged-ac3-milestone10-original-byte-slice', original_raw=fixtures['originalSaveRaw'], expected=fixtures['importedSave'])
        advance(page, 1000); origin = save(page, 'origin')
        check('one original ordinary live tick restores actual prior final game25811', origin['totalTime'] == '25811' and origin['activePlanetId'] == COLONY and planet(origin)['resources'] == fixtures['golden']['originWallet'])
        select(page, '#planet-select', HOME); selected = save(page, 'selectedHome')
        responsive(page, 'native-quote-dismissed', quote=True); dismissed = save(page, 'previewDismissed')
        whole_state('all-four-native-preview-dismissals-have-zero-world-effect', dismissed, selected)
        trusted_click(page, OPEN); quote_golden(page); native_scroll_to(page, '#demolition-review'); snap(page, 'native-reviewed-before-job202-payment.png')
        trusted_click(page, CONFIRM); first_paid = save(page, 'firstPaid'); paid_golden(dismissed, first_paid, 202)
        record(page, 'native-job202-paid'); responsive(page, 'native-job202-active-cancel-control')
        one_seconds(page, 2); before_cancel = save(page, 'firstTwoSeconds'); record(page, 'native-job202-immediately-before-refund')
        check('paid cancellation starts before due with exact unchanged saved fee', planet(before_cancel)['demolition']['remainingSeconds'] == DURATION - 2 and planet(before_cancel)['demolition']['paid'] == PAID)
        page.evaluate('(s)=>window.__demoRetained=[document.querySelector(s)]', CANCEL)
        trusted_click(page, CANCEL); after_cancel = save(page, 'firstRefunded'); wallet_transfer(before_cancel, after_cancel, PAID, 1, 'native paid cancellation')
        wallet_golden(after_cancel, 2, 2 * GROSS['metal'], 0)
        check('refund retains two seconds of actual production above old cap, never rewinds identity', planet(after_cancel)['demolition'] is None and float(planet(after_cancel)['resources']['metal']) > 2920000 and after_cancel['orders']['nextJobId'] == 203 and planet(after_cancel)['buildings']['metal_storage'] == 9)
        native_scroll_to(page, '[data-bind="level-metal_storage"]'); snap(page, 'native-paid-cancel-retains-level9.png'); record(page, 'native-job202-refund-retains-production')
        force_retained(page, 'separately labeled negative probe for consumed cancellation job202'); whole_state('duplicate-cancel-does-not-refund', save(page), after_cancel)
        trusted_click(page, OPEN); quote_golden(page); trusted_click(page, CONFIRM); second_paid = save(page, 'secondPaid'); paid_golden(after_cancel, second_paid, 203)
        one_seconds(page, 5); partial = save(page, 'partialFiveSeconds'); record(page, 'native-job203-partial-five-seconds')
        check('real mid-work reload starts with positive timer and unchanged level9', planet(partial)['demolition']['remainingSeconds'] == DURATION - 5 and planet(partial)['buildings']['metal_storage'] == 9)
        reload_verified(page, 'partialReloaded'); native_scroll_to(page, QUEUE); snap(page, 'native-job203-partial-reload.png')
        one_seconds(page, 9); complete = save(page, 'demolitionComplete'); record(page, 'native-job203-actual-completion')
        wallet_golden(complete, 16, GROSS['metal'] * (2 + DURATION), 128000)
        check('completed demolition panel is hidden and no enabled old cancellation control remains',
              page.locator(QUEUE).is_hidden() and page.locator(CANCEL + ':enabled').count() == 0,
              page.locator(QUEUE).evaluate('e=>({hidden:e.hidden,rectCount:e.getClientRects().length,oldCancelDisabled:e.querySelector("[data-cancel-demolition]")?.disabled??null})'))
        check('real completed overcap metal UI displays stopped natural production', page.locator('[data-bind="rate-metal"]').inner_text() == '+0.00/s')
        native_scroll_to(page, '[data-bind="res-metal"]'); snap(page, 'native-retained-overcap-metal-production-paused.png')
        check('true9→8 completion preserves overcap stock, one released field, unchanged total/grants/buildcount', planet(complete)['demolition'] is None and planet(complete)['buildings']['metal_storage'] == 8 and sum(planet(complete)['buildings'].values()) == 123 and planet(complete)['fieldsMax'] == 173 and planet(complete)['terraformerFields'] == {'base': 163, 'grantedLevels': 2} and float(planet(complete)['resources']['metal']) > 1590000 and complete['stats']['buildsCompleted'] == 135 and complete['orders']['nextJobId'] == 204)
        check('ordinary native warehouse card restores old level9 upgrade and28-second time', page.locator(REBUILD).is_enabled() and '9' in page.locator('[data-bind="upgrade-metal_storage"]').inner_text() and '28 秒' in page.locator('[data-bind="time-metal_storage"]').inner_text())
        native_scroll_to(page, CARD); snap(page, 'native-completed-level8-ordinary-rebuild-offer.png')
        trusted_click(page, REBUILD); rebuild_paid = save(page, 'rebuildPaid'); paid_golden(complete, rebuild_paid, 204, ordinary=True); record(page, 'native-old-upgrade-entry-job204-paid')
        one_seconds(page, 28); rebuilt = save(page, 'rebuildComplete'); record(page, 'native-job204-rebuild-completed')
        metal_produced = GROSS['metal'] * (2 + DURATION + (28 - REBUILD_DURATION))
        wallet_golden(rebuilt, 44, metal_produced, 384000)
        check('ordinary completion restores one field/capacity and increments only real rebuild count', planet(rebuilt)['buildings']['metal_storage'] == 9 and not planet(rebuilt)['buildQueue'] and planet(rebuilt)['demolition'] is None and sum(planet(rebuilt)['buildings'].values()) == 124 and rebuilt['stats']['buildsCompleted'] == 136 and rebuilt['orders']['nextJobId'] == 205)
        reload_verified(page, 'completeReloaded'); advance(page, 1000); later = save(page, 'later')
        wallet_golden(later, 45, metal_produced + GROSS['metal'], 384000)
        check('subsequent real tick resumes metal production without another fee/refund/job/plan restart', float(planet(later)['resources']['metal']) > float(planet(rebuilt)['resources']['metal']) and later['orders']['nextJobId'] == 205 and later['orders']['tasks'] == origin['orders']['tasks'] and later['stats']['buildsCompleted'] == 136)
        native_scroll_to(page, CARD); snap(page, 'native-complete-reload-further-live-tick.png'); record(page, 'native-final-one-extra-tick'); context.close()

        begin_case('separate negative native review dismissal/planet-roundtrip/import retirement probes')
        context, page = boot(fixtures['base']['savedAt']); import_save(page, fixtures['base'], 'actual-natural-origin-handoff-for-authority-boundaries')
        select(page, '#planet-select', HOME); baseline = save(page, 'selectedHome')
        trusted_click(page, OPEN); page.evaluate('(s)=>window.__demoRetained=[document.querySelector(s)]', CONFIRM)
        trusted_click(page, DISMISS); trusted_click(page, OPEN); force_retained(page, 'dismissed quote cannot steal fresh review consent')
        whole_state('dismiss-reopen-stale-control-all-fields', save(page), baseline)
        trusted_click(page, OPEN); page.evaluate('(s)=>window.__demoRetained=[document.querySelector(s)]', CONFIRM)
        select(page, '#planet-select', COLONY); select(page, '#planet-select', HOME)
        check('planet A→B→A leaves old confirm immediately disabled', page.locator(CONFIRM).is_disabled())
        force_retained(page, 'planet-roundtrip stale confirmation'); whole_state('planet-roundtrip-no-fee-no-ID', save(page), baseline)
        trusted_click(page, OPEN); page.evaluate('(s)=>window.__demoRetained=[document.querySelector(s)]', CONFIRM)
        import_save(page, fixtures['naturalMilestones']['selectedHome']['save'], 'same-world-native-reimport-retires-old-review')
        check('native file replacement leaves retained old confirm disabled', page.evaluate('window.__demoRetained.every(b=>b.disabled)'))
        force_retained(page, 'same-world file import never revives old consent'); whole_state('reimport-full-world-unchanged', save(page), baseline); context.close()

        for paid_fault in (False, True):
            begin_case('separate real cross-tab protection with synthetic stale replay: ' + ('paid cancel' if paid_fault else 'unpaid confirm'))
            handoff = fixtures['naturalMilestones']['firstPaid' if paid_fault else 'selectedHome']['save']
            context, page = boot(handoff['savedAt']); import_save(page, handoff, 'actual-natural-paid-handoff' if paid_fault else 'actual-natural-unpaid-handoff')
            baseline = save(page, 'firstPaid' if paid_fault else 'selectedHome')
            # Establish the second tab before fresh consent. Opening a tab may
            # hide the original; a visibility-invalidated quote cannot serve as
            # evidence that the later storage conflict disabled live consent.
            other = context.new_page(); other.goto(urljoin(args.url, 'release.json'), wait_until='domcontentloaded')
            page.bring_to_front(); advance(page); building_tab(page)
            if not paid_fault:
                trusted_click(page, OPEN)
            controls = [OPEN, CANCEL] if paid_fault else [OPEN, CONFIRM]
            page.evaluate('(s)=>window.__demoRetained=s.map(x=>document.querySelector(x))', controls)
            check('immediately before conflict the visible reviewed/paid action is truly enabled', page.evaluate('document.visibilityState === "visible" && !!window.__demoRetained[1] && !window.__demoRetained[1].disabled'))
            original = raw(page)
            corrupt = copy.deepcopy(json.loads(original)); del corrupt['state']['planets'][0]['terraformerFields']; competing = json.dumps(corrupt, ensure_ascii=False)
            other.evaluate('([k,s])=>localStorage.setItem(k,s)', [KEY, competing])
            expect(page.locator('[data-bind="notice"]')).to_contain_text('其他标签页')
            check('genuine trusted native StorageEvent observes exact competing bytes', any(e['trusted'] and e['oldValue'] == original and e['newValue'] == competing for e in page.evaluate('window.__demoStorage')))
            check('protection immediately visibly disables every present new mutating control while page stays visible', page.evaluate('document.visibilityState === "visible" && window.__demoRetained.every(b=>b&&b.disabled)'))
            native_scroll_to(page, CANCEL if paid_fault else CONFIRM); snap(page, 'native-protected-' + ('cancel' if paid_fault else 'confirm') + '-disabled.png')
            force_retained(page, 'protected new demolition controls')
            export_protected(page, original, 'native-protected-' + ('paid' if paid_fault else 'review') + '-original.json')
            check('replay/export never overwrites competing raw bytes', raw(page) == competing)
            suffix = 'paid' if paid_fault else 'review'
            import_save(page, handoff, 'expected-conflict-refusal-' + suffix, expected_conflict=True)
            # The prior synthetic replay deliberately changed disabled=false;
            # retired capabilities need not repaint that artificial old flag.
            check('refused replacement keeps the same retired reference in the original document',
                  page.evaluate('window.__demoRetained[1].ownerDocument === document'))
            force_retained(page, 'refused conflict import never revives old document authority', indices=[1])
            export_protected(page, original, 'native-conflict-refused-' + suffix + '-original.json')
            before_close = storage(page); other.close()
            check('closing the fault-writer tab changes no current, legacy or backup bytes', exact_json(storage(page), before_close))
            trusted_click(page, '[data-action="save"]')
            check('closed fault-writer does not restore old-session save authority', exact_json(storage(page), before_close) and '其他标签页' in page.locator('[data-bind="status"]').inner_text())
            reload_conflicted_source(page, competing)
            # The actual new session has loaded the same unreadable raw source.
            # Its visible world is the initial placeholder, not read(page)'s two
            # planets. Fresh explicit consent now describes that real boundary.
            before_recovery = storage(page)
            import_save(page, handoff, 'new-protected-session-native-recovery-' + suffix,
                        displayed_progress='第 1 轮，1 颗星球，当前“母星”')
            verify_recovery_storage(before_recovery, storage(page), competing, original)
            check('fresh restored document has no old review, while saved paid work alone gets a new cancel control',
                  page.locator('#demolition-review').is_hidden() and page.locator(CONFIRM).count() == 0 and
                  (page.locator(CANCEL).count() == 1 and page.locator(CANCEL).is_enabled() if paid_fault else page.locator(CANCEL).count() == 0))
            whole_state('native-recovery-preserves-exact-world', save(page), baseline)
            if paid_fault:
                # This is a separate same-document, same-ID ready-session import
                # retirement test. It does not pretend old DOM survived reload.
                page.evaluate('(s)=>window.__demoRetained=[document.querySelector(s)]', CANCEL)
                import_save(page, handoff, 'ready-same-world-paid-reimport-retires-current-cancel')
                check('ready same-world reimport disables the actual retained prior cancellation node',
                      page.evaluate('(s)=>window.__demoRetained[0].disabled && window.__demoRetained[0] !== document.querySelector(s)', CANCEL))
                force_retained(page, 'ready same-world paid reimport cannot reuse retired cancellation')
                whole_state('same-world-paid-reimport-never-refunds-or-changes-job-timer', save(page), baseline)
            context.close()
        for kind in ('hidden-roundtrip', 'detach-confirm', 'detach-review', 'detach-cancel'):
            begin_case('explicit synthetic no-RAF stale DOM retirement: ' + kind)
            key = 'firstPaid' if kind == 'detach-cancel' else 'selectedHome'
            handoff = fixtures['naturalMilestones'][key]['save']
            context, page = boot(handoff['savedAt']); import_save(page, handoff, 'actual-handoff-for-synthetic-' + kind)
            baseline = save(page, key)
            if kind != 'detach-cancel':
                trusted_click(page, OPEN)
            page.evaluate('(s)=>window.__demoRetained=[document.querySelector(s)]', CANCEL if kind == 'detach-cancel' else CONFIRM)
            atomic_stale_probe(page, kind)
            whole_state('synthetic-' + kind + '-no-fee-refund-or-world-mutation', save(page), baseline)
            record(page, 'synthetic-' + kind + '-unchanged-world'); context.close()

        begin_case('native reset replacement retires actual old review nodes')
        handoff = fixtures['naturalMilestones']['selectedHome']['save']
        context, page = boot(handoff['savedAt']); import_save(page, handoff, 'actual-handoff-for-native-reset-boundary')
        trusted_click(page, OPEN); page.evaluate('(s)=>window.__demoRetained=[document.querySelector(s)]', CONFIRM)
        tab(page, 'save'); dialogs = []
        def reset_confirmation(dialog):
            valid = dialog.type == 'confirm' and dialog.message == '备份当前原始存档并重新开始？新存档写入成功后才会替换当前进度。'
            dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
        page.once('dialog', reset_confirmation); trusted_click(page, '[data-action="reset"]')
        check('one explicit actual native reset confirmation', len(dialogs) == 1 and dialogs[0]['valid'])
        after_reset = save(page)
        check('authorized reset actually replaced original economic world', len(after_reset['planets']) == 1 and all(level == 0 for level in planet(after_reset)['buildings'].values()) and planet(after_reset)['demolition'] is None and after_reset['orders']['nextJobId'] == 1)
        force_retained(page, 'real reset retired pre-reset review'); whole_state('post-reset-baseline-stale-replay-not-pre-reset-world', save(page), after_reset)
        record(page, 'native-reset-old-review-has-no-authority'); context.close()

        begin_case('separate unchanged natural paid handoff -> real native curvature loses demolition fee and retires old cancel')
        handoff = fixtures['synthetic']['prestige']['base']
        context, page = boot(handoff['savedAt']); import_save(page, handoff, 'unchanged-natural-paid-handoff-for-curvature-boundary')
        save(page, 'naturalCurvaturePaid'); page.evaluate('(s)=>window.__demoRetained=[document.querySelector(s)]', CANCEL)
        tab(page, 'curvature')
        page.locator('#prestige-preview-details > summary').click(); advance(page)
        preview = page.locator('#prestige-preview-paid').inner_text()
        check('actual curvature preview discloses paid demolition loss without refund', '拆除' in preview and '128000' in preview and ('不退款' in preview or '不退' in preview), preview)
        native_scroll_to(page, '#prestige-preview-paid'); snap(page, 'natural-paid-handoff-native-curvature-demolition-loss.png')
        dialogs = []
        def curvature_confirmation(dialog):
            valid = dialog.type == 'confirm' and dialog.message == fixtures['synthetic']['prestige']['confirmation']
            dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
        page.once('dialog', curvature_confirmation); trusted_click(page, '[data-action="prestige"]')
        check('actual native curvature consent equals complete loss model', len(dialogs) == 1 and dialogs[0]['valid'], dialogs)
        after_curvature = save(page, 'naturalCurvatureReset')
        force_retained(page, 'curvature retired paid old-world cancel'); whole_state('post-curvature-stale-cancel-no-refund', save(page), after_curvature)
        check('curvature clears actual paid demolition instead of refunding it', all(p['demolition'] is None for p in after_curvature['planets']) and after_curvature['stats']['launches'] == handoff['state']['stats']['launches'] + 1)
        record(page, 'natural-paid-handoff-native-curvature-old-cancel-retired'); context.close()

        for mode in ('Off', 'Clear'):
            begin_case('explicit synthetic robot2/computer0 setup -> native demolish/reload/locked-' + mode.lower() + '/ordinary-rebuild unlock')
            handoff = fixtures['synthetic']['robot']['base']; gold = fixtures['synthetic']['robot']['golden']
            context, page = boot(handoff['savedAt']); import_save(page, handoff, 'explicit-synthetic-robot2-slot2-enabled-' + mode.lower())
            baseline = save(page, 'syntheticRobotBase'); slot_one(page)
            check('synthetic setup exposes real second-slot card and editable parameters before relock', page.locator('[data-bind="slot-enabled-1"]').is_checked() and page.locator('[data-bind="slot-enabled-1"]').is_enabled() and page.locator('[data-slot="1"] [data-path]:enabled').count() > 0)
            building_tab(page); trusted_click(page, '[data-demolish="robotics_factory"]')
            losses = page.locator('#demolition-review-losses').inner_text()
            check('actual robot2→1 quote discloses exact slot2 name/state and relock', '可用协议槽 2 → 1' in losses and '槽2将锁定：自动采集（已启用）' in losses, losses)
            check('independent robot three-resource fee/minimum1s visible before consent', page.locator('#demolition-review-fee').inner_text() == '拆除费：金属 400 / 晶体 120 / 重氢 200' and float(page.locator('#demolition-review-time').get_attribute('data-total-seconds')) == 1)
            trusted_click(page, CONFIRM); paid = save(page, 'syntheticRobotPaid')
            job = planet(paid)['demolition']; check('actual synthetic-branch paid job has literal fee, manualID1 and1s', job['jobId'] == 1 and job['paid'] == gold['paid'] and job['totalSeconds'] == job['remainingSeconds'] == 1 and job['source'] == 'manual' and job['taskId'] is None)
            wallet_transfer(baseline, paid, gold['paid'], -1, 'native robot demolition payment')
            reload_verified(page, 'syntheticRobotPaid'); advance(page, 1000); locked = save(page, 'syntheticRobotLocked')
            reload_verified(page, 'syntheticRobotLocked'); slot_one(page)
            check('actual completion/reload preserves enabled locked card, permits off/clear but forbids parameters/drag', planet(locked)['buildings']['robotics_factory'] == 1 and locked['research']['levels']['computer_tech'] == 0 and locked['protocols']['slots'][1]['card']['enabled'] is True and page.locator('[data-bind="slot-lock-1"]').is_visible() and page.locator('[data-bind="slot-enabled-1"]').is_enabled() and page.locator('[data-action="slot-clear"][data-index="1"]').is_enabled() and page.locator('[data-slot="1"] [data-path]:enabled').count() == 0 and page.locator('[data-slot-drag="1"]').get_attribute('draggable') == 'false')
            native_scroll_to(page, '[data-slot="1"]'); snap(page, 'synthetic-native-slot2-locked-before-' + mode.lower() + '.png')
            if mode == 'Off':
                native_scroll_to(page, '[data-slot="1"] label.check'); count = page.evaluate('window.__demoEdits.length')
                page.locator('[data-bind="slot-enabled-1"]').uncheck(); advance(page)
                edits = page.evaluate('(n)=>window.__demoEdits.slice(n)', count)
                check('actual user checkbox explicitly turns locked card off', not page.locator('[data-bind="slot-enabled-1"]').is_checked() and any(e['trusted'] and e['type'] == 'change' for e in edits), edits)
            else:
                trusted_click(page, '[data-action="slot-clear"][data-index="1"]')
            changed = save(page, 'syntheticRobot' + mode); reload_verified(page, 'syntheticRobot' + mode); slot_one(page)
            locked_slot_probe(page, cleared=mode == 'Clear')
            trusted_click(page, '[data-action="enqueue"][data-id="robotics_factory"]'); rebuilding = save(page, 'syntheticRobot' + mode + 'RebuildPaid')
            rebuild_job = planet(rebuilding)['buildQueue'][0]
            check('old ordinary robot upgrade really pays literal800/240/400 and job2/1s', rebuild_job['jobId'] == 2 and rebuild_job['paid'] == gold['rebuildPaid'] and rebuild_job['totalSeconds'] == 1 and rebuild_job['targetLevel'] == 2)
            wallet_transfer(changed, rebuilding, gold['rebuildPaid'], -1, 'ordinary robot rebuild payment')
            advance(page, 1000); unlocked = save(page, 'syntheticRobot' + mode + 'Unlocked'); reload_verified(page, 'syntheticRobot' + mode + 'Unlocked'); slot_one(page)
            check('actual ordinary rebuild unlocks slot2 without reviving disabled/cleared configuration', planet(unlocked)['buildings']['robotics_factory'] == 2 and page.locator('[data-bind="slot-lock-1"]').is_hidden() and (unlocked['protocols']['slots'][1]['card']['enabled'] is False and not page.locator('[data-bind="slot-enabled-1"]').is_checked() if mode == 'Off' else unlocked['protocols']['slots'][1]['card'] is None))
            native_scroll_to(page, '[data-slot="1"]'); snap(page, 'synthetic-native-slot2-unlocked-still-' + mode.lower() + '.png'); record(page, 'synthetic-native-slot2-unlocked-still-' + mode.lower()); context.close()

        begin_case('suite integrity')
        check('no uncaught app JavaScript errors or failed production requests', not errors and not failed_requests, {'errors': errors, 'failedRequests': failed_requests})
        check('actual production release is expected v9/r12', release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 12)
        completed = True; flush(); browser.close()
except BaseException as error:
    if failure is None:
        capture_failure(error)
    raise
finally:
    signal.alarm(0)
    if failure is None:
        flush()
