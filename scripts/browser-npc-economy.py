"""CI-only natural NPC acceptance with actual production HTTP/V8/release identity.
Date/performance/RAF timestamps are controlled. Native localStorage, File.text,
confirmation, trusted input, rendering and reload remain actual browser behavior.
Separate fault branches explicitly wrap native storage and never claim natural
quota exhaustion or unchanged disk after uncertain readback. No local run allowed.
"""
from r14_compatibility import expected_npc_economy
from npc_display_contract import (MESSAGE_ROWS_SAMPLE_JS, assert_message_rows,
                                  MESSAGE_OPENERS_SAMPLE_JS, typed_message_openers, exact_copied_data)
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
parser.add_argument('--fixture', default='npc-economy-review-save.json')
parser.add_argument('--natural-report', default='npc-natural-r11-report.json')
parser.add_argument('--expected-report-sha256', required=True)
parser.add_argument('--release')
parser.add_argument('--output', default='npc-economy-evidence')
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
report_path = out / 'npc-economy-browser-report.json'
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
 document.addEventListener('wheel',event=>window.__npcWheels.push({trusted:event.isTrusted,deltaY:event.deltaY}),{capture:true,passive:true});
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
        'mode': 'Date/performance/RAF timestamps simulated. Positive advances are 500/1000ms and original live tick runs; native timers remain unchanged. Imported envelopes retain their original clocks; main-loop reload has zero saved gap; separate true cold-start branch uses a declared100000-second controlled wall gap.',
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
        'originalR10SaveSha256': fixtures['origin']['originalSaveSha256'], 'actualCa5R11Sha256': fixtures['origin']['r11Sha256'],
        'classification': 'One real r11→r14 age0 native file import, real paid research202/probe203/scouts4/5, actual arrival snapshots and reload. Separate exact-source identity-report/curvature/newgame/offline/protection branches.',
        'responsiveScope': '320/390/768/1440 actual frozen report glyphs and controls; five real hit points, ancestor clipping, stable native scroll and exact screenshot geometry. One economic execution only.',
        'timing': timing_report(), 'oracle': 'Every serialized main-loop field equals actual domain milestones; separately frozen research/probe/fuel costs, IDs, arrival ages and stock formulas.',
        'nativeBoundary': 'Browser storage/file/dialog/HTTP are native. Date/performance/RAF timestamps are controlled. Fault-only Storage wrappers are explicit. This runner is not a genuine unmodified-clock background-throttling test.',
        'boundsSeconds': {'worker': 300, 'supervisor': 305}, 'checks': checks,
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


def configure_scout(page):
    tab(page, 'fleet')
    select(page, '#flight-mission', 'scout')
    input_number(page, '[data-ship="espionage_probe"]', 1)
    input_number(page, '#flight-galaxy', 1); input_number(page, '#flight-system', 56); input_number(page, '#flight-position', 6)
    expect(page.locator('#space-send')).to_be_enabled()
    quote = page.locator('#space-quote').inner_text()
    check('real visible quote locks one-second leg and four deuterium prepayment', '单程 1 秒' in quote and '往返燃料 4' in quote and '总货舱 7' in quote, quote)
    check('live quote never exposes unseen NPC stocks', '抵达时快照' not in quote and '固定产量' not in quote and '经济年龄' not in quote)


def wallet_debit(before, after, cost, label):
    for old in before['planets']:
        new = planet(after, old['id'])
        for resource in ('metal', 'crystal', 'deuterium'):
            expected = float(old['resources'][resource]) - (cost[resource] if old['id'] == HOME else 0)
            actual = float(new['resources'][resource])
            check(label + ': independent real payment ' + old['id'] + '/' + resource,
                  abs(actual - expected) <= 1e-7 + abs(expected) * 2e-14, {'actual': actual, 'expected': expected})
    check(label + ': no lifetime/RNG/NPC time change at payment',
          all(exact_json(before[key], after[key]) for key in ('lifetime', 'arcade', 'deepSpace', 'npcEconomy', 'totalTime')))


def check_no_early_report(page, state, fleet_id):
    check('no report exists before actual arrival for fleet' + str(fleet_id), not any(m['id'] == f'scout-{fleet_id}' for m in state['messages']))
    tab(page, 'galaxy'); trusted_click(page, '[data-space="home"]')
    galaxy = page.locator('#space-worlds').inner_text()
    check('galaxy has NPC identity with no unseen current stock, production or age',
          '晨星共同体 56-6' in galaxy and all(token not in galaxy for token in ('抵达时快照', '固定产量', '经济年龄', '50000.000', '30000.000')))
    tab(page, 'fleet')
    text = page.locator('#space-fleets').inner_text() + page.locator('#space-quote').inner_text()
    check('outbound rows/quote never expose future stocks', all(token not in text for token in ('抵达时快照', '固定产量', '经济年龄')))


def independent_report(age):
    return (f'侦察报告 [1:56:6]：晨星共同体 56-6（NPC npc-1:56:6；派系：晨星共同体）。抵达时快照（数值保留3位小数）：游戏时间 {25810 + age:.3f} 秒。'
            f'金属 {500 + age * 5:.3f}/50000.000，固定产量 5.000/秒，生产中；晶体 {250 + age * 2.5:.3f}/30000.000，固定产量 2.500/秒，生产中；'
            f'重氢 {age:.3f}/10000.000，固定产量 1.000/秒，生产中。轨道驻军：轻型战斗机 4，重型战斗机 0；驻军战斗科技 0。历史快照不会随时间更新。')


def independent_scout_message(fleet_id, age):
    """Complete literal expected arrival. Never derive identity/time from UI."""
    assert type(fleet_id) is int and type(age) is int and (fleet_id, age) in ((4, 3), (5, 65))
    at = 25810 + age
    return {'id': f'scout-{fleet_id}', 'at': at, 'text': independent_report(age),
        'npcScoutSnapshot': {'model': 'npc-scout-snapshot-v1', 'fleetId': fleet_id,
            'originId': 'homeworld', 'target': {'galaxy': 1, 'system': 56, 'position': 6},
            'observedAt': str(at), 'stock': [500 + age * 5, 250 + age * 2.5, age],
            'garrison': {'light_fighter': 4, 'heavy_fighter': 0},
            'defenderTech': {'weapons': 0, 'shields': 0, 'armour': 0}}}


def current_message_display(page, state):
    evidence = page.evaluate(MESSAGE_ROWS_SAMPLE_JS)
    valid = True
    try:
        assert_message_rows(evidence, state['messages'])
    except (AssertionError, KeyError, TypeError, ValueError):
        valid = False
    check('complete current message rows retain exact state order/text/time and typed-only ordered rehearsal/comparison controls', valid, evidence)


def arrived_report(page, state, fleet_id, age):
    messages = [m for m in state['messages'] if m['id'] == f'scout-{fleet_id}']
    check('one real arrived immutable snapshot: fleet' + str(fleet_id), len(messages) == 1 and exact_json(messages[0], independent_scout_message(fleet_id, age))
          and state['npcEconomy'] == expected_npc_economy([age]), messages)
    tab(page, 'messages'); current_message_display(page, state)
    check('actual arrival UI shows complete independent report text', page.locator('#space-message-list > .space-message > p:first-of-type').all_text_contents().count(independent_report(age)) == 1)
    row = page.locator(f'#space-message-list > .space-message[data-message-id="scout-{fleet_id}"]')
    openers = row.evaluate(MESSAGE_OPENERS_SAMPLE_JS) if row.count() == 1 else None
    check('actual typed arrival has exactly the original rehearsal then comparison opener with unchanged native values',
          exact_copied_data(openers, typed_message_openers()), openers)
    return messages[0]


def report_selector(page, text):
    rows = page.locator('#space-message-list > .space-message').evaluate_all('(rows)=>rows.map(row=>({id:row.getAttribute("data-message-id"),text:row.querySelector(":scope > p")?.textContent}))')
    matches = [row for row in rows if row['text'] == text]
    check('exact saved snapshot appears once in its stable keyed message DOM', len(matches) == 1 and re.fullmatch(r'scout-[0-9]+', matches[0]['id'] or '') is not None, rows)
    return f'#space-message-list > .space-message[data-message-id="{matches[0]["id"]}"] > p:first-of-type'


def responsive_report(page, label, text):
    tab(page, 'messages')
    for width in (320, 390, 768, 1440):
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        selector = report_selector(page, text)
        native_scroll_to(page, selector)
        before = visibility(page, [selector]); leaves = text_leaf_visibility(page, [selector])
        check(f'{label} {width}px report fully visible with five actual hits and every glyph',
              all(row['visible'] and row['contained'] and len(row['points']) == 5 and all(point['unoccluded'] for point in row['points']) for row in before['targets'])
              and all(leaf['passed'] for leaf in leaves['leaves']), {'targets': before, 'textLeaves': leaves})
        snap(page, f'{label}-{width}.png')
        after, after_leaves = visibility(page, [selector]), text_leaf_visibility(page, [selector])
        artifact = out / f'{label}-{width}-visibility.json'
        atomic_json(artifact, {'before': before, 'after': after, 'textLeaves': leaves, 'afterTextLeaves': after_leaves})
        evidence.append({'case': case, 'file': artifact.name, 'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()})
        check('screenshot does not move any real report geometry/glyph', exact_json(before, after) and exact_json(leaves, after_leaves), artifact.name)
        check(f'{label} {width}px no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    page.set_viewport_size({'width': 1440, 'height': 1100})


def confirm_action(page, selector, exact_message):
    dialogs = []
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message == exact_message
        dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', answer); trusted_click(page, selector)
    check('one actual native confirmation with exact complete consequences', len(dialogs) == 1 and dialogs[0]['valid'], dialogs)


def offline_once(context, page):
    global active_page
    branch = fixtures['branches']['offline']
    old_raw = raw(page); check('offline branch closes from actual full saved natural endpoint', exact_json(json.loads(old_raw), branch['base']))
    page.close()
    # The new page starts on an actual same-origin image, not the application;
    # assign only this test's session clock before the true app cold start.
    page = context.new_page(); active_page = page
    page.goto(urljoin(args.url, 'icons/save.webp'), wait_until='load')
    page.evaluate('(at)=>sessionStorage.setItem("npc-clock",String(at))', branch['now'])
    check('closed application retained exact native saved/backup bytes', raw(page) == old_raw)
    attach(page); response = page.goto(args.url, wait_until='networkidle'); verify_bundle(page); verify_document_response(response)
    adopted = save(page)
    whole_state('true-cold-start-offline-7200', adopted, branch['expected']['state'])
    check('true cold start records capped new watermark and NPC adopted age', json.loads(raw(page))['lastTickAt'] == branch['now']
          and adopted['npcEconomy'] == expected_npc_economy([7266]))
    adopted_raw = raw(page)
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle'); verify_bundle(page); verify_document_response(response)
    check('second native startup retains exact offline-adopted bytes before any further save', raw(page) == adopted_raw)
    whole_state('second-cold-start-no-reclaimed-capped-time', save(page), branch['expected']['state'])
    check('old reports remain frozen after adopted offline time', adopted['messages'] == branch['base']['state']['messages'])
    record(page, 'native-offline-once-100000-capped7200-reload-zero'); return page


def protection_case(fault):
    source = fixtures['originalSaveRaw']; envelope = fixtures['originalSave']
    context, page = boot(envelope['lastTickAt'] + 100000 * 1000, initial_raw=source, fault=fault)
    expect(page.locator('[data-bind="notice"]')).to_contain_text('原件已保留并受保护')
    baseline = storage(page); notice = page.locator('[data-bind="notice"]').inner_text()
    tab(page, 'overview'); played = page.locator('[data-bind="played"]').inner_text()
    check('failed upgrade visibly retains readable old progress before offline adoption', '25810' in played or '7 小时' in played, played)
    before_ui = page.locator('[data-bind="played"]').inner_text()
    advance(page, 1000); advance(page, 1000); tab(page, 'overview')
    check('protected real frames freeze visible old world and every storage byte', page.locator('[data-bind="played"]').inner_text() == before_ui and exact_json(storage(page), baseline))
    tab(page, 'galaxy'); check('protected read-only galaxy cannot expose live NPC resource snapshots', '抵达时快照' not in page.locator('#space-worlds').inner_text())
    tab(page, 'overview')
    export_baseline = prepare_protected_export(page, baseline)
    label = fault['target'] + '-' + fault['operation'] + '-' + fault.get('mode', 'throw')
    export_protected(page, source, 'protected-original-' + label + '.json')
    check('protected native original export itself cannot mutate any stored key', exact_json(storage(page), export_baseline))
    audit = page.evaluate('window.__npcFaultAudit')
    check('intended explicit native-storage fault actually triggered', any(row['kind'] == ('readback-throw' if fault['operation'] == 'readback' else 'write-' + fault['mode']) for row in audit), audit)
    artifact = out / ('protection-' + label + '.json')
    atomic_json(artifact, {'fault': fault, 'notice': notice, 'audit': audit, 'storageAfterUncertainTransaction': baseline,
        'classification': 'Explicit Storage wrapper fault. A successful native write followed by unreadable readback may have changed disk; only visible adoption/protection/original export are asserted.'})
    evidence.append({'case': case, 'file': artifact.name, 'sha256': hashlib.sha256(artifact.read_bytes()).hexdigest()})
    context.close()


def timeout(_signal, _frame):
    raise TimeoutError('NPC native acceptance exceeded the 300-second worker bound')


signal.signal(signal.SIGALRM, timeout); signal.alarm(300)
begin_case('setup')
try:
    source_bytes = Path(args.natural_report).read_bytes(); source_report = json.loads(source_bytes)
    check('complete natural report independently hash-bound to fixture and CLI', hashlib.sha256(source_bytes).hexdigest() == args.expected_report_sha256 == fixtures['source']['reportSha256'])
    check('formal fixture/report belong to exact clean candidate commit', fixtures['schema'] == 'infinity-npc-economy-browser-fixture-v1'
          and source_report['schema'] == 'infinity-npc-natural-r11-route-v1' and source_report['outcome']['status'] == 'passed'
          and source_report['source']['sourceSha'] == source_report['source']['gitHead'] == fixtures['source']['sourceSha'] == args.expected_sha
          and source_report['source']['sourceScopeStatusPorcelain'] == fixtures['source']['sourceScopeStatusPorcelain'] == fixtures['source']['oracleSourceScopeStatusPorcelain'] == '')
    check('original r10 and genuinely ca5-produced r11 bytes bind complete source chain',
          hashlib.sha256(fixtures['origin']['originalSaveRaw'].encode()).hexdigest() == 'd456cbee26543071ce0a53b64f718dd707c59b4f47ccb5c07d10a292cd45aa2a'
          and hashlib.sha256(fixtures['originalSaveRaw'].encode()).hexdigest() == fixtures['origin']['r11Sha256']
          and source_report['source']['historicalProducer']['sourceSha'] == 'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b'
          and fixtures['originalSave']['revision'] == 11 and fixtures['base']['revision'] == 14)
    for key, row in fixtures['naturalMilestones'].items():
        matches = [m for m in source_report['milestones'] if m['name'] == key]
        check('entire genuine milestone unchanged: ' + key, len(matches) == 1 and exact_json(matches[0], row) and row['strictRoundtrips'] == 2 and row['stateAdoptedFromReload'])
    (out / 'source-npc-natural-report.json').write_bytes(source_bytes)
    with sync_playwright() as playwright, capture_live_failure():
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        begin_case('one actual ca5 r11 native file import → r14 age0 → paid research/probe/two-scout loop')
        context, page = boot(fixtures['originalSave']['savedAt'])
        import_save(page, fixtures['originalSave'], 'actual-ca5-produced-r11', original_raw=fixtures['originalSaveRaw'], expected=fixtures['importedSave'])
        baseline = save(page, 'origin-migrated-r11-age-zero')
        check('r11 historical25810 seconds create age0, no retroactive NPC stock', baseline['totalTime'] == '25810' and baseline['npcEconomy'] == expected_npc_economy())
        select(page, '#planet-select', HOME); selected = save(page, 'selected-home')
        tab(page, 'shipyard')
        # Locked units still permit mode inspection; the distinct payment
        # control, rather than the old one-step build button, owns eligibility.
        expect(page.locator('[data-bind="ubuild-espionage_probe"]')).to_be_enabled()
        locked_probe_raw = raw(page)
        trusted_click(page, '[data-bind="ubuild-espionage_probe"][data-action="manual-unit-mode"][data-mode="count"]')
        expect(page.locator('[data-bind="ubuild-espionage_probe"]')).to_have_attribute('aria-pressed', 'true')
        expect(page.locator('[data-bind="upay-espionage_probe"]')).to_be_disabled()
        check('locked probe quote preserves complete original save bytes', raw(page) == locked_probe_raw)
        check('probe is genuinely locked before paid combustion3', '燃烧引擎' in page.locator('[data-bind="ureason-espionage_probe"]').inner_text())
        check('manual probe payment exposes the same genuine prerequisite', '燃烧引擎' in page.locator('[data-bind="umanual-reason-espionage_probe"]').inner_text())
        tab(page, 'research'); trusted_click(page, '[data-bind="research-combustion_drive"]')
        research_paid = save(page, 'research-paid-unfinished'); wallet_debit(selected, research_paid, {'metal': 1600, 'crystal': 0, 'deuterium': 2400}, 'research202')
        check('research202 has original paid source/identity/timer', research_paid['research']['queue'][0]['jobId'] == 202 and research_paid['research']['queue'][0]['remainingSeconds'] == 1)
        advance(page, 1000); research_done = save(page, 'research-complete')
        tab(page, 'shipyard')
        check('probe manual quantity remains the original one-unit draft', page.locator('[data-bind="uqty-espionage_probe"]').input_value() == '1')
        probe_quote_raw = raw(page)
        trusted_click(page, '[data-bind="ubuild-espionage_probe"][data-action="manual-unit-mode"][data-mode="count"]')
        expect(page.locator('[data-bind="ubuild-espionage_probe"]')).to_have_attribute('aria-pressed', 'true')
        check('unlocked probe quote preserves complete original save bytes before separate payment', raw(page) == probe_quote_raw)
        expect(page.locator('[data-bind="utotal-espionage_probe"]')).to_have_text('金属 0 · 晶体 1,000 · 重氢 0')
        expect(page.locator('[data-bind="upay-espionage_probe"]')).to_be_enabled()
        trusted_click(page, '[data-bind="upay-espionage_probe"][data-action="manual-unit-pay"]')
        expect(page.locator('[data-bind="upay-espionage_probe"]')).to_be_disabled()
        probe_paid = save(page, 'probe-paid-unfinished'); wallet_debit(research_done, probe_paid, {'metal': 0, 'crystal': 1000, 'deuterium': 0}, 'probe203')
        check('probe203 is a real paid shipyard job', planet(probe_paid)['shipyardQueue'][0]['jobId'] == 203)
        advance(page, 1000); probe_done = save(page, 'probe-complete'); configure_scout(page)
        trusted_click(page, '#space-send'); first_out = save(page, 'first-scout-outbound')
        wallet_debit(probe_done, first_out, {'metal': 0, 'crystal': 0, 'deuterium': 4}, 'scout4')
        check_no_early_report(page, first_out, 4); record(page, 'native-paid-scout4-no-early-report')
        advance(page, 1000); first = save(page, 'first-snapshot-returning'); frozen = arrived_report(page, first, 4, 3)
        responsive_report(page, 'native-first-arrival-age3-stock515-257_5-3', frozen['text']); record(page, 'native-first-actual-arrival')
        advance(page, 1000); save(page, 'first-probe-returned')
        for _ in range(60):
            advance(page, 1000)
        wait_done = save(page, 'ordinary-wait-complete'); configure_scout(page)
        trusted_click(page, '#space-send'); second_out = save(page, 'second-scout-outbound')
        wallet_debit(wait_done, second_out, {'metal': 0, 'crystal': 0, 'deuterium': 4}, 'scout5'); check_no_early_report(page, second_out, 5)
        advance(page, 500); save(page, 'second-scout-halfway-native-free-strict-reload')
        reload_same_time(page, 'second-scout-halfway-native-free-strict-reload')
        advance(page, 500); second = save(page, 'second-snapshot-returning'); second_report = arrived_report(page, second, 5, 65)
        check('first report text/time frozen through wait/payment/midflight reload/second arrival', next(m for m in second['messages'] if m['id'] == 'scout-4') == frozen)
        responsive_report(page, 'native-second-arrival-age65-stock825-412_5-65', second_report['text'])
        responsive_report(page, 'native-old-first-report-still-frozen-after-second-arrival', frozen['text'])
        advance(page, 1000); final = save(page, 'final-returned-and-reloaded'); reload_same_time(page, 'final-returned-and-reloaded')
        check('same actual paid probe returned twice with no NPC cargo or reward', not final['fleets'] and planet(final)['units']['espionage_probe'] == 1 and final['nextFleetId'] == 6)
        record(page, 'native-natural-final66-seconds')

        begin_case('real native close/reopen from final natural save, controlled100000-second gap, one7200 adoption')
        page = offline_once(context, page); context.close()

        begin_case('genuine ca5 identity-only historical reports remain exactly unchanged after r14 migration')
        branch = fixtures['branches']['legacyIdentity']; context, page = boot(branch['save']['savedAt'])
        import_save(page, branch['save'], 'genuine-ca5-identity-only-branch', original_raw=branch['raw'], expected=branch['migratedSave'])
        legacy_state = save(page)
        check('actual old identity reports retain every exact source field with explicit null snapshot', all(set(m) == {'id', 'at', 'text'} for m in branch['save']['state']['messages'])
              and exact_json(legacy_state['messages'], [{**m, 'npcScoutSnapshot': None} for m in branch['save']['state']['messages']])
              and legacy_state['npcEconomy'] == expected_npc_economy())
        tab(page, 'messages'); current_message_display(page, legacy_state); text = page.locator('#space-messages').inner_text()
        check('actual old report UI remains identity-only', '战斗与精确情报尚未开放' in text and '抵达时快照' not in text)
        record(page, 'native-historical-identity-reports-preserved'); context.close()

        begin_case('real naturally eligible curvature preserves universe/NPC age/snapshots')
        branch = fixtures['branches']['curvature']; context, page = boot(branch['base']['savedAt'])
        import_save(page, branch['base'], 'natural-final-for-real-curvature')
        tab(page, 'curvature'); confirm_action(page, '[data-action="prestige"]', branch['confirmation'])
        curved = save(page); whole_state('native-real-curvature-full-state', curved, branch['expected']['state'])
        check('curvature preserves exact universe age66 and frozen reports', curved['npcEconomy'] == branch['base']['state']['npcEconomy'] and curved['universe'] == branch['base']['state']['universe'] and curved['messages'] == branch['base']['state']['messages'])
        record(page, 'native-curvature-preserves-npc-age'); context.close()

        begin_case('complete new game starts age0 with no old reports')
        branch = fixtures['branches']['curvature']; context, page = boot(branch['base']['savedAt'])
        import_save(page, branch['base'], 'natural-final-for-real-new-game')
        tab(page, 'save'); confirm_action(page, '[data-action="reset"]', '备份当前原始存档并重新开始？新存档写入成功后才会替换当前进度。')
        fresh = save(page)
        check('new game has age0, one new planet, no old reports/ships/jobs/time', fresh['npcEconomy'] == expected_npc_economy() and fresh['messages'] == [] and fresh['totalTime'] == '0' and len(fresh['planets']) == 1 and not fresh['fleets'] and fresh['nextFleetId'] == 1)
        record(page, 'native-newgame-age-zero'); context.close()

        for fault in ({'target': 'backup', 'operation': 'write', 'mode': 'throw'},
                      {'target': 'backup', 'operation': 'readback'},
                      {'target': 'current', 'operation': 'write', 'mode': 'throw'},
                      {'target': 'current', 'operation': 'write', 'mode': 'drop'},
                      {'target': 'current', 'operation': 'readback'}):
            begin_case('explicit native storage fault: ' + json.dumps(fault, sort_keys=True)); protection_case(fault)

        begin_case('actual cross-tab storage event freezes age and preserves recoverable original')
        base = fixtures['naturalMilestones']['first-snapshot-returning']; context, page = boot(base['save']['savedAt'])
        import_save(page, base['save'], 'natural-first-report-for-cross-tab'); cached = raw(page)
        tab(page, 'overview'); prior_played = page.locator('[data-bind="played"]').inner_text()
        writer = context.new_page(); writer.goto(urljoin(args.url, 'icons/save.webp'), wait_until='load')
        competing = fixtures['naturalMilestones']['second-snapshot-returning']['raw']
        writer.evaluate('({key,raw})=>localStorage.setItem(key,raw)', {'key': KEY, 'raw': competing})
        page.bring_to_front(); expect(page.locator('[data-bind="notice"]')).to_contain_text('其他标签页')
        check('genuine native trusted storage event carries exact new external bytes', any(event['trusted'] and event['newValue'] == competing for event in page.evaluate('window.__npcStorage')))
        before = storage(page); advance(page, 1000); advance(page, 1000); tab(page, 'overview')
        check('cross-tab protection freezes actual visible world and does not overwrite competing bytes', page.locator('[data-bind="played"]').inner_text() == prior_played and storage(page) == before and raw(page) == competing)
        export_baseline = prepare_protected_export(page, before)
        export_protected(page, cached, 'cross-tab-retained-original.json')
        check('original export does not change competing world or backups', storage(page) == export_baseline); context.close()

        begin_case('suite integrity')
        check('no app errors or failed production requests', not errors and not failed_requests, {'errors': errors, 'failedRequests': failed_requests})
        check('served exact release is v9/r14', release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 14)
        completed = True; flush(); browser.close()
except BaseException as error:
    if failure is None:
        capture_failure(error)
    raise
finally:
    signal.alarm(0)
    if failure is None:
        flush()
