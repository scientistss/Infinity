"""CI-only natural NPC acceptance with actual production HTTP/V8/release identity.
Date/performance/RAF timestamps are controlled. Native localStorage, File.text,
confirmation, trusted input, rendering and reload remain actual browser behavior.
Separate fault branches explicitly wrap native storage and never claim natural
quota exhaustion or unchanged disk after uncertain readback. No local run allowed.
"""
from contextlib import contextmanager
from fractions import Fraction
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
parser.add_argument('--fixture', default='npc-attack-natural-report.json')
parser.add_argument('--natural-report', default='npc-attack-natural-report.json')
parser.add_argument('--expected-report-sha256', required=True)
parser.add_argument('--release')
parser.add_argument('--output', default='npc-attack-evidence')
parser.add_argument('--chromium')
parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true':
    parser.error('Native NPC browser acceptance is CI-only; local execution is not authorized.')
if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
    parser.error('--expected-sha (or GITHUB_SHA) must pin the exact 40-character commit')
if not re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256):
    parser.error('--expected-report-sha256 must independently pin the complete natural report')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'npc-attack-browser-report.json'
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
        deadline = time.monotonic() + 910
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
fixtures['source']['reportSha256'] = fixture_sha256
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
parsed = urlparse(args.url)
if parsed.scheme not in ('http', 'https'):
    raise ValueError('Acceptance requires actual HTTP(S) production URL')
ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
checks, errors, failed_requests, evidence, source_bindings = [], [], [], [], []
page_sources, release_metadata = {}, None
completed, active_page, source_sha, failure = False, None, None, None
case, branch_metrics = 'setup', {}
CARD, QUEUE = '#space-messages', '#space-fleets'
WALLET_TOLERANCE = 1e-7
CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window),caf=window.cancelAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('npc-clock');
 const epoch=saved?Number(saved):__EPOCH__;let elapsed=0;
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 // Read-only native-frame observer: deliberately bypass the controlled RAF
 // wrapper and expose its real callback timestamp, without advancing elapsed.
 let observerFrame=0;
 window.__npcObserveFrame=({selector,timeoutMs})=>new Promise(resolve=>{
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
 window.__npcFrameCount=0;
 window.requestAnimationFrame=callback=>raf(()=>{window.__npcFrameCount++;callback(elapsed);});
 window.__npcAdvance=async ms=>{const beforeAt=epoch+elapsed;elapsed+=ms;sessionStorage.setItem('npc-clock',String(epoch+elapsed));await new Promise(raf);await new Promise(raf);return{beforeAt,afterAt:epoch+elapsed};};
 window.__npcNative=[Storage.prototype.getItem,Storage.prototype.setItem,File.prototype.text,window.confirm,window.setTimeout,window.setInterval].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 window.__npcDrags=[];for(const type of ["dragstart","drop","dragend"])document.addEventListener(type,event=>window.__npcDrags.push({type,trusted:event.isTrusted,slot:event.target.closest?.("[data-slot]")?.dataset.slot||null}),true);
 window.__npcClicks=[];window.__npcEdits=[];window.__npcFiles=[];window.__npcWheels=[];window.__npcStorage=[];
 document.addEventListener('click',event=>{const b=event.target.closest?.('button');if(b)window.__npcClicks.push({action:b.dataset.action||b.dataset.orderAction||b.dataset.buildingTemplateAction||b.dataset.tab||(b.hasAttribute("data-demolish")?"demolition-preview":b.hasAttribute("data-demolition-confirm")?"demolition-confirm":b.hasAttribute("data-demolition-dismiss")?"demolition-dismiss":b.hasAttribute("data-cancel-demolition")?"demolition-cancel":null),id:b.dataset.id||b.id,trusted:event.isTrusted});},true);
 for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches?.('select,input'))window.__npcEdits.push({id:event.target.id,type,trusted:event.isTrusted,value:event.target.value});},true);
 document.addEventListener('wheel',event=>window.__npcWheels.push({trusted:event.isTrusted,deltaY:event.deltaY,deltaX:event.deltaX}),{capture:true,passive:true});
 document.addEventListener('change',event=>{if(event.target.matches?.('[data-bind="import-file"]'))window.__npcFiles.push({trusted:event.isTrusted,name:event.target.files[0]?.name,size:event.target.files[0]?.size,priorRaw:localStorage.getItem(__KEY__)});},true);
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&event.key===__KEY__)window.__npcStorage.push({trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue});});
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
        'mode': 'Date/performance/RAF timestamps simulated. Positive advances are 500/1000ms and original live tick runs; native timers remain unchanged. Imported envelopes retain their original clocks; main-loop reload has zero saved gap; separate true cold-start branch uses a declared ten-second controlled wall gap.',
        'successfulAdvanceCalls': sum(row['successfulAdvanceCalls'] for row in branches),
        'zeroAdvanceCalls': sum(row['zeroAdvanceCalls'] for row in branches),
        'liveOneSecondAdvanceCalls': sum(row['liveOneSecondAdvanceCalls'] for row in branches),
        'simulatedSeconds': sum(row['simulatedSeconds'] for row in branches), 'branches': branches,
        'uncertainty': 'An unfinished advance remains advanceInFlight and is not counted as observed simulated time.'}


def advance(page, milliseconds=0):
    if milliseconds not in (0, 500, 1000):
        raise ValueError('Acceptance only permits zero-time UI frames or exact half/one-second live advances')
    metrics = branch_metrics[case]
    metrics['attemptedAdvanceCalls'] += 1
    metrics['advanceInFlight'] = {'requestedMilliseconds': milliseconds,
        'hostStartOffsetSeconds': time.monotonic() - HOST_STARTED_MONOTONIC}
    observed = page.evaluate('(ms)=>window.__npcAdvance(ms)', milliseconds)
    if observed['afterAt'] - observed['beforeAt'] != milliseconds:
        raise AssertionError('Actual controlled clock delta differs from requested advance')
    metrics['successfulAdvanceCalls'] += 1
    metrics['zeroAdvanceCalls'] += int(milliseconds == 0)
    metrics['liveOneSecondAdvanceCalls'] += int(milliseconds == 1000)
    metrics['simulatedSeconds'] += (observed['afterAt'] - observed['beforeAt']) / 1000
    metrics['advanceInFlight'] = None


def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator(f'[data-tab="{name}"]').click(); advance(page)


def raw(page):
    return page.evaluate('(key)=>window.__npcNativeRead?window.__npcNativeRead(key):localStorage.getItem(key)', KEY)


def storage(page):
    return page.evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,(window.__npcNativeRead?window.__npcNativeRead(k):localStorage.getItem(k))]))')


def read(page):
    return json.loads(raw(page))['state']


def planet(state, ident=HOME):
    return next(value for value in state['planets'] if value['id'] == ident)


def trusted_click(page, selector):
    native_scroll_to(page, selector)
    before = page.evaluate('window.__npcClicks.length'); page.locator(selector).click(); advance(page)
    events = page.evaluate('(n)=>window.__npcClicks.slice(n)', before)
    check('actual user input produces exactly one trusted button click', len(events) == 1 and events[0]['trusted'], events)


def select(page, selector, value):
    field = page.locator(selector); before = field.input_value()
    index = field.evaluate('(e,value)=>[...e.options].findIndex(option=>option.value===value)', value)
    check(selector + ': requested native option exists', index >= 0)
    count = page.evaluate('window.__npcEdits.length'); field.focus(); field.press('Home')
    for _ in range(index):
        field.press('ArrowDown')
    field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__npcEdits.slice(n)', count)
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
    check(name + ': every serialized game field equals independent NPC oracle plus byte-pinned eef legacy engine', same,
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
        current = page.evaluate('options=>window.__npcObserveFrame(options)',
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
        attempt('scroll and wheel diagnostics', lambda: failure.__setitem__('scrollAndWheels', page.evaluate('({width:innerWidth,height:innerHeight,scrollY,scrollHeight:document.scrollingElement?.scrollHeight,wheelCount:window.__npcWheels?.length||0,wheels:window.__npcWheels?.slice(-200)||[]})')))
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


def check(name, condition, detail=None):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), **({'detail': detail} if detail is not None else {})})
    flush()
    if not condition:
        raise AssertionError(f'{case}: {name}')


def import_confirmation(value, progress):
    return (f'已读取存档 v{value["version"]}/r{value["revision"]}。\n'
            f'是否替换当前进度（{progress}）？\n'
            '读取期间产生的变化也会被替换。保留当前已保存原件，写入校验成功后才采用。')


def verify_conflict_refusal(before, after, status):
    check('real conflict import reports refusal and the required cold-refresh recovery boundary',
          status == '导入失败，当前进度未改动：检测到其他标签页修改了存档，已暂停写入。请先导出本页保留的原件，再刷新读取最新存档。', status)
    check('refused conflict import preserves every current, legacy and backup byte', exact_json(before, after))


def import_save(page, value, label, original_raw=None, expected=None, expected_conflict=False, displayed_progress=None):
    check('native handoff retains exact original zero-gap clocks', value['savedAt'] == value['lastTickAt'] == page.evaluate('Date.now()'))
    text = original_raw if original_raw is not None else json.dumps(value, ensure_ascii=False)
    check('file bytes decode to complete intended envelope without patching', exact_json(json.loads(text), value))
    path = out / f'native-import-{label}.json'; path.write_bytes(text.encode('utf-8'))
    tab(page, 'save')
    if page.locator('[data-action="save"]').is_enabled():
        page.locator('[data-action="save"]').click()
    before, before_storage, count, dialogs = raw(page), storage(page), page.evaluate('window.__npcFiles.length'), []
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
    files = page.evaluate('window.__npcFiles')
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


def prepare_protected_export(page, before):
    # Navigation has its own narrow preference-write contract. Never ignore UI
    # keys when asserting that the subsequent protected export writes nothing.
    check('protected export navigation starts from the complete unchanged overview storage',
          before.get('infinity.ui.tab') == 'overview' and exact_json(storage(page), before))
    trusted_click(page, '[data-tab="save"]')
    after = storage(page)
    check('overview to save changes only the exact tab preference; all other stored bytes remain identical',
          exact_json(after, {**before, 'infinity.ui.tab': 'save'}))
    return after


def export_protected(page, original, name):
    baseline = storage(page)
    check('protected export begins on the already selected save page',
          baseline.get('infinity.ui.tab') == 'save'
          and page.locator('[data-tab="save"]').get_attribute('aria-selected') == 'true')
    with page.expect_download() as pending:
        trusted_click(page, '[data-action="export"]')
    path = out / name; pending.value.save_as(str(path))
    check('protected real download exports byte-exact cached original', path.read_bytes() == original.encode())
    check('protected export preserves the complete save-page storage baseline without any key exception',
          exact_json(storage(page), baseline))
    evidence.append({'case': case, 'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})


def flush():
    atomic_json(report_path, {'completed': completed, 'result': 'passed' if completed else 'incomplete',
        'case': case, 'url': args.url, 'sourceSha': source_sha, 'fixture': fixtures['description'],
        'fixtureSha256': fixture_sha256, 'sourceReportSha256': fixtures['source']['reportSha256'],
        'originalR12SaveSha256': fixtures['origin']['rawSha256'],
        'classification': 'Unedited public eef r12 66s two-scout save imported through the native file picker; complete r13 paid action/tick tape replay. Explicit native Storage fault wrappers and DOM mutation probes are separate branches. The two enumerated synthetic boundary fixtures change only colony metal right to 0.25 or landed LF count to 1e15; neither is part of the natural main.',
        'responsiveScope': '320/390/768/1440 actual frozen report glyphs and controls; five real hit points, ancestor clipping, stable native scroll and exact screenshot geometry. One economic execution only, with route/clear/form/report four-width witnesses at real milestones.',
        'timing': timing_report(), 'oracle': 'Natural-main serialized fields equal pinned eef legacy engine plus independent NPC LF combat, loot, FNV, wallet, event and exact-decimal oracle. Curvature and abandonment have independent whole-state branch checks. Other boundary envelopes are real current-engine executions with separately asserted ownership, money and combat invariants. No game globals or source injection. Natural main is never economically patched; the explicitly synthetic branch fields are enumerated separately.',
        'nativeBoundary': 'Browser storage/file/dialog/HTTP are native. Date/performance/RAF timestamps are controlled. Fault-only Storage wrappers are explicit. This runner is not a genuine unmodified-clock background-throttling test.',
        'boundsSeconds': {'worker': 900, 'supervisor': 910}, 'checks': checks,
        'passed': sum(value['passed'] for value in checks), 'errors': errors, 'failedRequests': failed_requests,
        'sourceBindings': source_bindings, 'evidence': evidence, 'failure': failure})


def building_tab(page):
    # Compatibility name for the reused exact native file/confirmation helper.
    tab(page, 'overview')


def save(page, expected=None):
    tab(page, 'save'); trusted_click(page, '[data-action="save"]'); result = read(page)
    if expected is not None:
        whole_state(expected, result, fixtures['expected'][expected])
    return result


FAULT = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const key=__KEY__, fault=__FAULT__, get=Storage.prototype.getItem,set=Storage.prototype.setItem;
 const writes=new Set(); window.__npcFaultAudit=[];
 window.__npcNativeRead=k=>get.call(localStorage,k);
 const matches=k=>fault.target==='current'?k===key:k===key+'.backup'||k.startsWith(key+'.backup.');
 Storage.prototype.getItem=function(k){k=String(k);
   if(this===localStorage&&fault.operation==='readback'&&matches(k)&&writes.has(k)){
     window.__npcFaultAudit.push({kind:'readback-throw',key:k});throw new DOMException('Explicit NPC acceptance readback fault','SecurityError');
   }return get.call(this,k);
 };
 Storage.prototype.setItem=function(k,v){k=String(k);v=String(v);
   if(this!==localStorage)return set.call(this,k,v);
   if(fault.operation==='write'&&matches(k)){
     window.__npcFaultAudit.push({kind:'write-'+fault.mode,key:k,value:v});
     if(fault.mode==='throw')throw new DOMException('Explicit NPC acceptance quota fault','QuotaExceededError');
     if(fault.mode==='drop')return;
   }
   set.call(this,k,v);writes.add(k);window.__npcFaultAudit.push({kind:'write-return',key:k,value:v});
 };
})();'''


def boot(epoch, width=1440, initial_raw=None, fault=None):
    global active_page
    entries = [{'name': 'infinity.ui.tab', 'value': 'overview'},
               {'name': 'infinity.save.v1', 'value': 'EXPLICIT LEGACY SENTINEL: retain unchanged'}]
    if initial_raw is not None:
        entries.append({'name': KEY, 'value': initial_raw})
    context = browser.new_context(viewport={'width': width, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': entries}]})
    initialization = CLOCK.replace('__EPOCH__', str(epoch))
    if fault is not None:
        initialization += '\n' + FAULT.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY)).replace('__FAULT__', json.dumps(fault))
    context.add_init_script(initialization)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('actual HTTP200 production document at exact URL', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); verify_document_response(response)
    check('Storage/File.text/dialog/timer functions were native before explicitly labeled optional fault wrapper', page.evaluate('window.__npcNative'))
    return context, page


def reload_same_time(page, expected):
    original = raw(page); envelope = json.loads(original)
    check('real reload begins at exact saved watermark', envelope['savedAt'] == envelope['lastTickAt'] == page.evaluate('Date.now()'))
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle'); verify_bundle(page); verify_document_response(response)
    check('native startup leaves complete original raw envelope unchanged before save', raw(page) == original)
    whole_state('same-time-reload-' + expected, save(page), fixtures['expected'][expected])
    record(page, 'same-time-reload-' + expected)


def input_number(page, selector, value):
    before = page.evaluate('window.__npcEdits.length')
    field = page.locator(selector); field.fill(str(value)); field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__npcEdits.slice(n)', before)
    check('native numeric edit uses trusted input and exact value: ' + selector,
          field.input_value() == str(value) and any(row['trusted'] and row['type'] == 'input' for row in events), events)


def timeout(_signal, _frame):
    raise TimeoutError('NPC attack native acceptance exceeded the 900-second worker bound')


signal.signal(signal.SIGALRM, timeout); signal.alarm(900)
begin_case('setup')

def snapshot_control(page, selector, filename, capture=True):
    native_scroll_to(page, selector)
    proof = visibility(page, [selector])
    check(filename + ': full viewport and five unobstructed hit points',
          all(row['visible'] and row['contained'] and all(p['unoccluded'] for p in row['points']) for row in proof['targets']), proof)
    glyphs = text_leaf_visibility(page, [selector])
    check(filename + ': every actual glyph fits viewport and ancestor clipping and is unoccluded',
          len(glyphs['leaves']) == 1 and all(leaf['passed'] for leaf in glyphs['leaves']), glyphs)
    check(filename + ': no page-level horizontal overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
    if capture:
        snap(page, filename + '.png')


def route_attack(page):
    tab(page, 'galaxy'); trusted_click(page, '[data-space="home"]')
    selector = '[data-space="route"][data-mission="attack"][data-coordinate="1:56:6"]'
    # A galaxy table is intentionally horizontally scrollable. Use actual wheel
    # input inside that container; never change scrollLeft or element geometry.
    native_scroll_to(page, '#space-range')
    target = page.locator(selector); box = target.bounding_box()
    if box and (box['x'] < 0 or box['x'] + box['width'] > page.viewport_size['width']):
        region = page.locator('[data-tab-panel="galaxy"] .space-table-scroll').bounding_box()
        if region:
            page.mouse.move(min(region['x'] + region['width'] / 2, page.viewport_size['width'] - 15), max(80, min(region['y'] + 30, 900)))
            page.mouse.wheel(1200, 0); advance(page)
    trusted_click(page, selector)
    check('native galaxy attack route fills mission and exact target',
          page.locator('#flight-mission').input_value() == 'attack' and [page.locator('#flight-' + key).input_value() for key in ('galaxy', 'system', 'position')] == ['1', '56', '6'])


def configure_fleet(page, mission, count=0):
    if mission == 'attack':
        route_attack(page)
    else:
        tab(page, 'fleet'); select(page, '#flight-mission', mission)
        for key, value in (('galaxy', 1), ('system', 56), ('position', 6)):
            input_number(page, '#flight-' + key, value)
    for ship in ('light_fighter', 'espionage_probe'):
        value = count if ship == 'light_fighter' and mission == 'attack' else 1 if ship == 'espionage_probe' and mission == 'scout' else 0
        field = page.locator('[data-ship="' + ship + '"]')
        if field.input_value() != str(value):
            input_number(page, '[data-ship="' + ship + '"]', value)
    expect(page.locator('#space-send')).to_be_enabled()
    check('outgoing quote does not expose unseen NPC resources or garrison',
          all(text not in page.locator('#space-quote').inner_text() for text in ('抵达时快照', '驻军战斗科技', '50000.000')))


def cargo_draft_witness(page):
    # Explicit user clearing is the only action that can alter these draft texts.
    before = save(page)
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        tab(page, 'fleet'); select(page, '#flight-mission', 'transport')
        for resource, value in (('metal', '17'), ('crystal', 'bad'), ('deuterium', '3e0')):
            input_number(page, '#cargo-' + resource, value)
        route_attack(page)
        check(f'{width}px cargo switch preserves every original raw draft and makes it readonly',
              [page.locator('#cargo-' + r).input_value() for r in ('metal', 'crystal', 'deuterium')] == ['17', 'bad', '3e0']
              and all(page.locator('#cargo-' + r).evaluate('(e)=>e.readOnly||e.disabled') for r in ('metal', 'crystal', 'deuterium')))
        expect(page.locator('#space-send')).to_be_disabled()
        selector = '[data-space="attack-clear-cargo"]'; snapshot_control(page, selector, f'native-{width}-explicit-clear-cargo')
        trusted_click(page, selector)
        check('explicit clear makes precisely three zeros without a paid action', [page.locator('#cargo-' + r).input_value() for r in ('metal', 'crystal', 'deuterium')] == ['0', '0', '0'])
        whole_state(f'cargo-draft-only-{width}', save(page), before)
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)


report_glyph_proofs = set()


def report_body_glyphs(page, selector, receipt, label, width):
    proof_key = (receipt['fleetId'], width)
    if proof_key in report_glyph_proofs:
        return
    battle = receipt['battle']
    def count(value):
        # The natural main deliberately fights only LF; unsupported fleets fail
        # this independent literal presenter rather than inheriting app labels.
        check('natural report glyph oracle contains only literal light fighters', set(value) <= {'light_fighter'})
        return '轻型战斗机 ' + str(value['light_fighter']) if value.get('light_fighter') else '无'
    def losses(before, after):
        n = before.get('light_fighter', 0) - after.get('light_fighter', 0)
        return count({'light_fighter': n} if n else {})
    expected_body = [
        f'出发星球 {receipt["originId"]} → [1:56:6] · 实际游戏时间 {receipt["at"]} 秒',
        f'我方出征：{count(battle["attackerBefore"])}；永久损失：{losses(battle["attackerBefore"], battle["attackerAfter"])}；幸存：{count(battle["attackerAfter"])}',
        f'NPC 当时驻军：{count(battle["defenderBefore"])}；永久损失：{losses(battle["defenderBefore"], battle["defenderAfter"])}；幸存：{count(battle["defenderAfter"])}',
        f'实际装载：金属 {receipt["loot"][0]} · 晶体 {receipt["loot"][1]} · 重氢 {receipt["loot"][2]}。返抵原出发星球后一次结算；不足 1 的部分保留为该星球待结算权益，不计入普通可花库存。此处仍记录本场完整整数战利品，历史战报不可再次领取。',
        '本场我方武器 1 / 护盾 5 / 装甲 0；NPC 科技均为 0。出航货舱倍率 ×1.4。',
    ]
    check('all five historical report paragraphs match independent literal text',
          page.locator(selector + ' > div > p').all_inner_texts() == expected_body)
    for index in range(1, 6):
        leaf = selector + f' > div > p:nth-child({index})'
        snapshot_control(page, leaf, f'{label}-{receipt["fleetId"]}-{width}-body-{index}', capture=index in (2, 4))
    rounds = selector + ' details[data-npc-rounds]'
    if not battle['rounds']:
        check('zero-round body explicitly says no combat', page.locator(rounds + ' > div').inner_text() == '无驻军收集，本次没有战斗回合。')
        snapshot_control(page, rounds + ' > div', f'{label}-{receipt["fleetId"]}-{width}-zero-rounds')
    else:
        region = rounds + ' > div.space-table-scroll'
        native_scroll_to(page, region)
        # Walk columns first. On narrow screens expose each column with real
        # horizontal wheel input, never scrollLeft/CSS or geometry substitution.
        for column, key in enumerate(('round', 'attacker', 'defender', 'attackDamage', 'defendDamage'), 1):
            first = rounds + f' tbody tr:first-child td:nth-child({column})'
            for _ in range(3):
                outer, cell = page.locator(region).bounding_box(), page.locator(first).bounding_box()
                if cell['x'] >= outer['x'] and cell['x'] + cell['width'] <= outer['x'] + outer['width']:
                    break
                page.mouse.move(outer['x'] + outer['width'] / 2, outer['y'] + min(20, outer['height'] / 2))
                prior = page.evaluate('window.__npcWheels.length')
                page.mouse.wheel(round(cell['x'] + cell['width'] / 2 - outer['x'] - outer['width'] / 2), 0); advance(page)
                wait_for_scroll_settled(page, first)
                check('round column exposed by actual trusted horizontal wheel',
                      any(e['trusted'] and e['deltaX'] != 0 for e in page.evaluate('(n)=>window.__npcWheels.slice(n)', prior)))
            for row, values in enumerate(battle['rounds'], 1):
                leaf = rounds + f' tbody tr:nth-child({row}) td:nth-child({column})'
                check('displayed round cell retains exact frozen numeric value',
                      Fraction(page.locator(leaf).inner_text()) == Fraction(str(values[key])))
                snapshot_control(page, leaf, f'{label}-{receipt["fleetId"]}-{width}-round-{row}-column-{column}', capture=row == 1)
    report_glyph_proofs.add(proof_key)


def inspect_reports(page, expected, label, four_widths=False):
    before = save(page); tab(page, 'messages')
    reports = expected['npcBattles']['reports']
    for receipt in reports:
        tab(page, 'messages')
        selector = f'#npc-battle-reports details[data-npc-report="{receipt["fleetId"]}"]'
        node = page.locator(selector); expect(node).to_have_count(1)
        summary = selector + ' > summary'
        widths = (320, 390, 768, 1440) if four_widths else (page.viewport_size['width'],)
        for width in widths:
            page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
            native_scroll_to(page, summary); page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
            if not node.evaluate('(e)=>e.open'):
                page.locator(summary).press('Space'); advance(page)
            check('keyboard activation opens the saved report', node.evaluate('(e)=>e.open'))
            rounds = selector + ' details[data-npc-rounds]'
            if not page.locator(rounds).evaluate('(e)=>e.open'):
                page.locator(rounds + ' > summary').focus(); page.locator(rounds + ' > summary').press('Enter'); advance(page)
            rows = page.locator(rounds + ' tbody tr').count()
            check('rendered round count equals frozen actual receipt', rows == len(receipt['battle']['rounds']))
            if four_widths:
                snapshot_control(page, summary, f'{label}-{receipt["fleetId"]}-{width}-report')
                snapshot_control(page, rounds + ' > summary', f'{label}-{receipt["fleetId"]}-{width}-rounds')
                report_body_glyphs(page, selector, receipt, label, width)
            handle = node.element_handle(); advance(page); check('ordinary repaint retains keyed open report node', handle.evaluate('(e)=>e.isConnected&&e.open'))
        whole_state(f'{label}-report-{receipt["fleetId"]}-readonly', save(page), before)
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)


def verify_exact_money_witnesses():
    witnesses = fixtures['moneyWitnesses']
    check('natural report includes fuel and dock exact-money witnesses',
          any(w['kind'] == 'fuel-launch' for w in witnesses) and any(w['kind'] == 'loot-dock' and w['signedInteger'] > 0 for w in witnesses))
    for row in witnesses:
        source, prior, after, pending = [Fraction(row[key]) for key in ('beforeWallet', 'beforeRemainder', 'afterWallet', 'afterRemainder')]
        check('independent Python Fraction verifies original five-term equation',
              source + prior + row['signedInteger'] - after - pending == 0, row)
        check('independent Python verifies conservative main and strict subunit tail',
              0 <= pending < 1 and after <= source + prior + row['signedInteger'], row)
        check('fuel authorization uses ordinary wallet alone', row['signedInteger'] >= 0 or source >= -row['signedInteger'], row)
    for world in fixtures['base']['state']['planets']:
        check('native source migration begins with exactly zero tails on every actual planet',
              world['npcResourceRemainder'] == {'metal': '0', 'crystal': '0', 'deuterium': '0'})


def remainder_detail_witness(page, expected):
    before = save(page); tab(page, 'fleet')
    for world in expected['planets']:
        selector = '#space-planets [data-world-id="' + world['id'] + '"] .npc-resource-remainder'
        tails = world['npcResourceRemainder']
        if not any(value != '0' for value in tails.values()):
            expect(page.locator(selector)).to_have_count(0)
            continue
        expect(page.locator(selector)).to_have_count(1)
        exact_text = f'金属 {tails["metal"]} · 晶体 {tails["crystal"]} · 重氢 {tails["deuterium"]}'
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
            summary = selector + ' > summary'; native_scroll_to(page, summary)
            if not page.locator(selector).evaluate('(e)=>e.open'):
                page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
            check('pending rights expose exact per-resource strings separately from spendable wallet',
                  page.locator(selector + ' .npc-remainder-exact').inner_text() == exact_text
                  and '不计入普通可花库存' in page.locator(selector).inner_text())
            snapshot_control(page, selector + ' .npc-remainder-exact', f'native-{world["id"]}-{width}-exact-pending-rights')
        whole_state('remainder-detail-is-readonly-' + world['id'], save(page), before)
        tab(page, 'fleet')
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)


def native_tape(page):
    report_widths_done, quote_widths_done, draft_done = False, False, False
    for index, operation in enumerate(fixtures['tape']):
        kind = operation['kind']
        if kind == 'checkpoint':
            name = operation['name']; actual = save(page, name)
            if name in ('attack7-paid-outbound', 'attack8-paid-outbound', 'win8-loot-delivered-once', 'empty10-zero-round-loot-delivered'):
                reload_same_time(page, name); record(page, 'native-' + name)
            if name == 'empty10-zero-round-loot-delivered':
                remainder_detail_witness(page, actual)
            if name == 'first-three-fighters-complete' and not draft_done:
                cargo_draft_witness(page); draft_done = True
            if actual['npcBattles']['reports']:
                first_delivered = not report_widths_done and any(r['delivery'] == 'delivered' for r in actual['npcBattles']['reports'])
                inspect_reports(page, actual, 'native-' + name, four_widths=first_delivered or name in ('win8-loot-delivered-once', 'empty10-zero-round-loot-delivered'))
                report_widths_done = report_widths_done or first_delivered
            for fleet in actual['fleets']:
                if fleet.get('npcAttack', {}).get('phase', {}).get('dockBlocked'):
                    tab(page, 'fleet'); selector = f'[data-space="npc-retry-dock"][data-fleet="{fleet["id"]}"]'
                    for width in (320, 390, 768, 1440):
                        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
                        snapshot_control(page, selector, f'native-{name}-{width}-blocked-retry')
                    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)
            continue
        if kind == 'advance':
            check('main route uses actual bounded one-second native live ticks', operation['seconds'] == 1)
            advance(page, 1000)
        elif kind == 'research':
            tab(page, 'research'); trusted_click(page, '[data-bind="research-' + operation['tech'] + '"]')
        elif kind == 'build':
            tab(page, 'shipyard'); input_number(page, '[data-bind="uqty-' + operation['unit'] + '"]', operation['count'])
            trusted_click(page, '[data-bind="ubuild-' + operation['unit'] + '"]')
        elif kind in ('scout', 'attack'):
            before_send = save(page)
            configure_fleet(page, kind, operation.get('count', 0))
            if kind == 'attack' and not quote_widths_done:
                for width in (320, 390, 768, 1440):
                    page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
                    snapshot_control(page, '#space-send', f'native-{width}-paid-attack-controls')
                page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page); quote_widths_done = True
            trusted_click(page, '#space-send')
            if kind == 'attack':
                after_send = read(page)
                donor_before, donor_after = planet(before_send), planet(after_send)
                check('native paid attack obeys exact W+r fuel equation',
                      Fraction(donor_before['resources']['deuterium']) + Fraction(donor_before['npcResourceRemainder']['deuterium']) - operation['expectedFuel'] ==
                      Fraction(donor_after['resources']['deuterium']) + Fraction(donor_after['npcResourceRemainder']['deuterium']))
                check('native fuel leaves every other resource and right unchanged', all(donor_before['resources'][r] == donor_after['resources'][r] and donor_before['npcResourceRemainder'][r] == donor_after['npcResourceRemainder'][r] for r in ('metal', 'crystal')))
                check('successful native attack consumes ship draft exactly once', page.locator('[data-ship="light_fighter"]').input_value() == '0')
                expect(page.locator('#space-send')).to_be_disabled()
        elif kind == 'retry':
            tab(page, 'fleet'); trusted_click(page, f'[data-space="npc-retry-dock"][data-fleet="{operation["fleetId"]}"]')
        else:
            raise AssertionError('Unknown exact natural tape operation: ' + kind)
    check('full native paid route includes four-width draft/form/report witnesses', draft_done and quote_widths_done and report_widths_done)


def same_time_boundaries():
    # Cold browser startup from each unedited authentic natural milestone covers
    # outbound, positive pre-arrival, postbattle, blocked/delivered states.
    selected = []
    for row in fixtures['milestones']:
        state = row['save']['state']; attack = next((f for f in state['fleets'] if f['mission'] == 'attack'), None)
        if row['name'] in ('attack8-paid-outbound', 'win8-loot-delivered-once') or attack and (attack['returning'] or 0 < attack['remaining'] < 1):
            selected.append(row)
    signatures = set()
    for row in selected:
        attack = next((f for f in row['save']['state']['fleets'] if f['mission'] == 'attack'), None)
        signature = 'delivered' if not attack else ('blocked' if attack['npcAttack']['phase'].get('dockBlocked') else ('returning-loot' if any(Fraction(value) > 0 for value in attack['cargo'].values()) else 'returning-empty') if attack['returning'] else 'pre-arrival')
        if signature in signatures:
            continue
        signatures.add(signature); begin_case('native same-time cold reload: ' + signature)
        context, page = boot(row['save']['savedAt'], initial_raw=row['raw'])
        whole_state('cold-' + row['name'], save(page), row['save']['state']); reload_same_time(page, row['name']); context.close()


def recall_and_offline():
    branch = fixtures['branches']['recall']; begin_case('native outbound recall with no battle and no fuel refund')
    context, page = boot(branch['base']['savedAt'], initial_raw=branch['baseRaw'])
    advance(page, 1000); tab(page, 'fleet'); trusted_click(page, '[data-space="recall"][data-fleet="8"]'); advance(page, 1000)
    whole_state('native-recalled-return', save(page), branch['expected']); record(page, 'native-recall-no-loot'); context.close()
    branch = fixtures['branches']['offline']; begin_case('actual cold startup with controlled ten-second offline gap')
    context, page = boot(branch['now'], initial_raw=branch['baseRaw'])
    whole_state('native-offline-once', save(page), branch['expected']['state']); first = raw(page)
    page.reload(wait_until='networkidle'); advance(page)
    check('same-time second startup leaves original adopted raw unchanged', raw(page) == first)
    whole_state('native-offline-second-startup', save(page), branch['expected']['state']); record(page, 'native-offline-once'); context.close()


def simultaneous_arrivals():
    branch = fixtures['branches']['simultaneous']; begin_case('two genuinely paid attacks with exactly the same arrival')
    context, page = boot(branch['base']['savedAt'], initial_raw=branch['baseRaw'])
    for fleet_id in branch['fleetIds']:
        configure_fleet(page, 'attack', branch['count']); trusted_click(page, '#space-send')
    whole_state('native-simultaneous-paid', save(page), branch['paid'])
    for _ in range(branch['advanceToArrival']):
        advance(page, 1000)
    arrived = save(page); whole_state('native-simultaneous-arrived', arrived, branch['arrived'])
    check('same-arrival actual report order follows stable IDs',
          [r['fleetId'] for r in arrived['npcBattles']['reports'] if r['fleetId'] in branch['fleetIds']] == branch['fleetIds'])
    for _ in range(branch['advanceToReturn']):
        advance(page, 1000)
    whole_state('native-simultaneous-returned', save(page), branch['returned']); record(page, 'native-simultaneous-two-attacks'); context.close()


def exact_confirmation(page, selector, expected, accept, label):
    dialogs = []
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message == expected
        dialogs.append({'type': dialog.type, 'message': dialog.message, 'valid': valid, 'accepted': accept and valid})
        dialog.accept() if accept and valid else dialog.dismiss()
    page.once('dialog', answer)
    trusted_click(page, selector)
    check(label + ': exactly one native confirmation has the complete expected text',
          len(dialogs) == 1 and dialogs[0]['valid'] and dialogs[0]['accepted'] == accept, dialogs)
    evidence.append({'case': case, 'label': label, 'nativeConfirmation': dialogs})


def remainder_reset_boundaries():
    branch = fixtures['branches']['curvature']
    begin_case('genuine earned pending right: native curvature preview, cancel and accepted reset')
    context, page = boot(branch['base']['savedAt'], initial_raw=branch['baseRaw'])
    whole_state('earned-right-curvature-start', save(page), branch['base']['state'])
    tail = planet(branch['base']['state'])['npcResourceRemainder']['crystal']
    check('curvature source has the exact naturally earned tiny right', tail == '0.00000000006')
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page); tab(page, 'curvature')
        for selector in ('#prestige-preview-details', '#prestige-preview-npc-remainders'):
            summary = selector + ' > summary'; native_scroll_to(page, summary)
            if not page.locator(selector).evaluate('(e)=>e.open'):
                page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
        expected_row = '母星 [homeworld]：金属 0 / 晶体 ' + tail + ' / 重氢 0'
        check('curvature preview exposes exact earned owner/resource without ordinary-wallet rounding',
              page.locator('#prestige-preview-npc-remainder-rows').inner_text() == expected_row)
        snapshot_control(page, '#prestige-preview-npc-remainder-rows', f'native-{width}-curvature-earned-right')
        exact_confirmation(page, '[data-action="prestige"]', branch['confirmation'], False, f'curvature-{width}-cancel')
        whole_state('curvature-cancel-retains-complete-earned-state-' + str(width), save(page), branch['base']['state'])
    tab(page, 'curvature')
    exact_confirmation(page, '[data-action="prestige"]', branch['confirmation'], True, 'curvature-accept')
    actual = save(page); whole_state('curvature-independent-whole-state-reset', actual, branch['expected'])
    check('new home has zero rights and permanent NPC universe is retained',
          all(all(v == '0' for v in world['npcResourceRemainder'].values()) for world in actual['planets'])
          and exact_json(actual['npcEconomy'], branch['base']['state']['npcEconomy']))
    record(page, 'native-earned-right-curvature-accepted'); context.close()

    branch = fixtures['branches']['abandon']
    begin_case('explicit synthetic colony-only quarter-unit right: native abandon cancel and accept')
    check('abandon fixture discloses the sole synthetic edit', branch['syntheticChanges'] ==
          [{'path': 'planets[colony-1].npcResourceRemainder.metal', 'before': '0', 'after': '0.25'}])
    context, page = boot(branch['base']['savedAt'], initial_raw=branch['baseRaw'])
    button = '[data-space="abandon"][data-planet="colony-1"]'
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page); tab(page, 'fleet')
        selector = '#space-planets [data-world-id="colony-1"] .npc-resource-remainder'
        summary = selector + ' > summary'; native_scroll_to(page, summary)
        if not page.locator(selector).evaluate('(e)=>e.open'):
            page.locator(summary).focus(); page.locator(summary).press('Enter'); advance(page)
        check('synthetic colony right retains exact owner and amount in UI',
              page.locator(selector + ' .npc-remainder-exact').inner_text() == '金属 0.25 · 晶体 0 · 重氢 0')
        snapshot_control(page, selector + ' .npc-remainder-exact', f'native-{width}-synthetic-colony-right')
        exact_confirmation(page, button, branch['confirmation'], False, f'abandon-{width}-cancel')
        whole_state('abandon-cancel-preserves-every-field-' + str(width), save(page), branch['base']['state'])
    tab(page, 'fleet'); exact_confirmation(page, button, branch['confirmation'], True, 'abandon-accept')
    actual = save(page); whole_state('abandon-independent-ownership-removal', actual, branch['expected'])
    check('abandoned right is never transferred to home or NPC',
          exact_json(planet(actual), planet(branch['base']['state']))
          and exact_json(actual['npcEconomy'], branch['base']['state']['npcEconomy'])
          and not any(p['id'] == 'colony-1' for p in actual['planets']))
    record(page, 'native-synthetic-colony-right-abandoned'); context.close()


def blocked_retry_boundary():
    branch = fixtures['branches']['blockedRetry']
    check('blocked dock fixture discloses only synthetic landed ships',
          len(branch['syntheticChanges']) == 1 and branch['syntheticChanges'][0]['path'] == 'planets[homeworld].units.light_fighter'
          and branch['syntheticChanges'][0]['after'] == 10 ** 15)
    for row in branch['moneyWitnesses']:
        target = Fraction(row['beforeWallet']) + Fraction(row['beforeRemainder']) + row['signedInteger']
        check('independent Python exact retry money proof for ' + row['resource'],
              Fraction(row['afterWallet']) + Fraction(row['afterRemainder']) == target
              and 0 <= Fraction(row['afterRemainder']) < 1 and Fraction(row['afterWallet']) <= target)
    for width in (320, 390, 768, 1440):
        begin_case('explicit synthetic landed limit: actual failed and successful native dock retry at width ' + str(width))
        context, page = boot(branch['base']['savedAt'], width=width, initial_raw=branch['baseRaw'])
        for _ in range(branch['advanceToBlocked']):
            advance(page, 1000)
        whole_state('actual-blocked-arrival-' + str(width), save(page), branch['blocked'])
        tab(page, 'fleet'); button = '[data-space="npc-retry-dock"][data-fleet="8"]'
        expect(page.locator(button)).to_be_enabled()
        snapshot_control(page, button, f'native-{width}-blocked-dock-retry')
        trusted_click(page, button)
        expect(page.locator('[data-bind="status"]')).to_have_text(branch['refusal'])
        whole_state('failed-retry-keeps-ship-cargo-right-report-once-' + str(width), save(page), branch['blocked'])
        configure_fleet(page, 'attack', branch['releaseCount']); trusted_click(page, '#space-send')
        released = save(page); whole_state('genuine-paid-capacity-release-' + str(width), released, branch['released'])
        tab(page, 'fleet'); old_button = page.locator(button).element_handle()
        snapshot_control(page, button, f'native-{width}-released-capacity-retry')
        trusted_click(page, button); actual = save(page)
        whole_state('successful-native-retry-exact-once-' + str(width), actual, branch['expected'])
        for row in branch['moneyWitnesses']:
            resource = row['resource']; before, after = planet(released), planet(actual)
            check('native actual retry exact entitlement ' + resource,
                  Fraction(before['resources'][resource]) + Fraction(before['npcResourceRemainder'][resource]) + row['signedInteger'] ==
                  Fraction(after['resources'][resource]) + Fraction(after['npcResourceRemainder'][resource]))
        tab(page, 'fleet'); expect(page.locator(button)).to_have_count(0)
        old_button.evaluate('(element)=>element.click()'); advance(page)
        whole_state('retired-retry-node-cannot-credit-twice-' + str(width), save(page), branch['expected'])
        record(page, 'native-' + str(width) + '-synthetic-blocked-release-and-retry'); context.close()


def old_node_witnesses():
    row = fixtures['naturalMilestones']['first-three-fighters-complete']
    for probe in ('hidden-tab', 'remove-reinsert', 'clone', 'same-world-import'):
        begin_case('explicit DOM authority probe: ' + probe)
        context, page = boot(row['save']['savedAt'], initial_raw=row['raw']); configure_fleet(page, 'attack', 4)
        button = page.locator('#space-send').element_handle()
        if probe == 'hidden-tab':
            tab(page, 'messages'); button.evaluate('(e)=>e.click()')
        elif probe == 'remove-reinsert':
            button.evaluate('(e)=>{const p=e.parentElement,n=e.nextSibling;e.remove();p.insertBefore(e,n);e.click();}')
        elif probe == 'clone':
            button.evaluate('(e)=>{const clone=e.cloneNode(true);e.replaceWith(clone);clone.click();}')
        else:
            import_save(page, row['save'], 'same-seed-same-ids-world-replacement', original_raw=row['raw'])
            tab(page, 'fleet')
            check('same-world stale probe runs in the visible fleet panel without re-editing the retired draft',
                  page.locator('#space-fleet').is_visible())
            button.evaluate('(e)=>e.click()')
        advance(page); whole_state('retired-authority-' + probe, save(page), row['save']['state'])
        record(page, 'native-retired-authority-' + probe); context.close()


def storage_faults():
    row = fixtures['naturalMilestones']['attack7-paid-outbound']
    for fault in ({'target': 'current', 'operation': 'write', 'mode': 'throw'},
                  {'target': 'current', 'operation': 'write', 'mode': 'drop'},
                  {'target': 'current', 'operation': 'readback'}):
        begin_case('explicit native attack storage fault: ' + json.dumps(fault, sort_keys=True))
        context, page = boot(row['save']['savedAt'], initial_raw=row['raw'], fault=fault)
        advance(page, 1000); tab(page, 'save')
        if page.locator('[data-action="save"]').is_enabled():
            trusted_click(page, '[data-action="save"]')
        expect(page.locator('[data-bind="notice"]')).to_be_visible()
        audit = page.evaluate('window.__npcFaultAudit'); check('fault branch actually reached declared Storage wrapper', any(x['kind'].startswith(('write-', 'readback-')) for x in audit), audit)
        disk_after_fault = storage(page); tab(page, 'fleet')
        for _ in range(3):
            advance(page, 1000)
        check('save protection disables attack recall authority', page.locator('[data-space="recall"][data-fleet="7"]').is_disabled())
        tab(page, 'save'); export_protected(page, row['raw'], 'native-protected-' + fault['operation'] + '-' + fault.get('mode', 'throw') + '.json')
        check('fault branch retains original cached complete attack envelope', json.loads(row['raw'])['state']['fleets'][0]['id'] == 7)
        check('readback uncertainty is reported without claiming unchanged disk', fault['operation'] != 'readback' or any(x['kind'] == 'readback-throw' for x in audit))
        label = fault['operation'] + '-' + fault.get('mode', 'throw')
        atomic_json(out / ('native-storage-fault-audit-' + label + '.json'), {'fault': fault, 'audit': audit, 'storageAfterUncertainTransaction': disk_after_fault, 'classification': 'Explicit native Storage wrapper fault. Successful write followed by throwing readback may have changed disk; no unchanged-disk claim.'})
        record(page, 'native-fault-' + label); context.close()


def migration_backup_faults():
    for fault in ({'target': 'backup', 'operation': 'write', 'mode': 'throw'}, {'target': 'backup', 'operation': 'readback'}):
        begin_case('explicit native backup fault during exact r12 migration: ' + fault['operation'])
        context, page = boot(fixtures['originalSave']['savedAt'], initial_raw=fixtures['originalSaveRaw'], fault=fault)
        expect(page.locator('[data-bind="notice"]')).to_contain_text('原件已保留并受保护')
        tab(page, 'overview'); played = page.locator('[data-bind="played"]').inner_text(); baseline = storage(page)
        advance(page, 1000); advance(page, 1000)
        check('migration backup failure freezes visible progress and all stored bytes', page.locator('[data-bind="played"]').inner_text() == played and storage(page) == baseline)
        tab(page, 'save'); export_protected(page, fixtures['originalSaveRaw'], 'native-migration-original-' + fault['operation'] + '.json')
        audit = page.evaluate('window.__npcFaultAudit')
        check('declared backup fault actually reached native wrapper', any(x['kind'] == ('readback-throw' if fault['operation'] == 'readback' else 'write-throw') for x in audit), audit)
        context.close()


def cross_tab():
    row = fixtures['naturalMilestones']['attack7-paid-outbound']; competing = fixtures['naturalMilestones']['attack8-paid-outbound']
    begin_case('actual native cross-tab storage event retires attack controls')
    context, page = boot(row['save']['savedAt'], initial_raw=row['raw']); tab(page, 'fleet')
    old_recall = page.locator('[data-space="recall"][data-fleet="7"]').element_handle()
    writer = context.new_page(); writer.goto(urljoin(args.url, 'icons/save.webp'), wait_until='load')
    writer.evaluate('({key,value})=>localStorage.setItem(key,value)', {'key': KEY, 'value': competing['raw']})
    page.bring_to_front(); expect(page.locator('[data-bind="notice"]')).to_contain_text('其他标签页')
    check('real trusted storage event delivered exact competing bytes', any(x['trusted'] and x['newValue'] == competing['raw'] for x in page.evaluate('window.__npcStorage')))
    old_recall.evaluate('(e)=>e.click()'); advance(page, 1000)
    check('cross-tab protection does not overwrite competing attack world', raw(page) == competing['raw'])
    tab(page, 'save'); export_protected(page, row['raw'], 'native-cross-tab-original-attack.json'); context.close()


try:
    source_bytes = Path(args.natural_report).read_bytes(); source_report = json.loads(source_bytes)
    check('complete natural report independently pinned by fixture and CLI', hashlib.sha256(source_bytes).hexdigest() == args.expected_report_sha256 == fixture_sha256)
    check('passing exact candidate natural report with clean source required',
          source_report['schema'] == 'infinity-npc-attack-natural-route-v1' and source_report['outcome']['status'] == 'passed'
          and source_report['source']['sourceSha'] == source_report['source']['gitHead'] == args.expected_sha
          and source_report['source']['sourceScopeStatusPorcelain'] == '')
    check('original public r12 final raw remains byte-exact', hashlib.sha256(fixtures['originalSaveRaw'].encode()).hexdigest() == '047d49cbf04fd5424bca4d7d45e861e0439a0d51c4ac54700f77e263bb8eadcc'
          and fixtures['originalSave']['revision'] == 12 and fixtures['base']['revision'] == 13
          and fixtures['provenance']['injectedGameState'] is False)
    for row in fixtures['milestones']:
        check('milestone raw bytes and full envelope are bound: ' + row['name'],
              hashlib.sha256(row['raw'].encode()).hexdigest() == row['rawSha256'] and exact_json(json.loads(row['raw']), row['save']))
    verify_exact_money_witnesses()
    (out / 'source-npc-attack-natural-report.json').write_bytes(source_bytes)
    with sync_playwright() as playwright, capture_live_failure():
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        begin_case('native exact public r12 import then full actual paid scout/build/battle/loot/return loop')
        context, page = boot(fixtures['originalSave']['savedAt'])
        import_save(page, fixtures['originalSave'], 'public-eef-r12-final66', original_raw=fixtures['originalSaveRaw'], expected=fixtures['importedSave'])
        native_tape(page); record(page, 'native-final-full-loop'); context.close()
        same_time_boundaries(); recall_and_offline(); simultaneous_arrivals(); remainder_reset_boundaries(); blocked_retry_boundary(); old_node_witnesses(); storage_faults(); migration_backup_faults(); cross_tab()
        begin_case('suite integrity')
        check('no actual app errors or failed production requests', not errors and not failed_requests, {'errors': errors, 'failedRequests': failed_requests})
        check('served release exact v9/r13', release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 13)
        completed = True; flush(); browser.close()
except BaseException as error:
    if failure is None:
        capture_failure(error)
    raise
finally:
    signal.alarm(0)
    if failure is None:
        flush()
