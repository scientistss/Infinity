"""Ordinary manual transport loading on the pinned, actual HTTP production app.

The unchanged natural milestone is a handoff, not continuous natural browser play.
Date/performance/RAF are explicitly controlled; Storage/File/confirm remain native.
Normal edits/clicks/wheel are trusted. Stale-node probes are labeled synthetic.
Only the independent explicit dispatch click may create/pay for a real fleet.
"""
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
from decimal import Decimal
from pathlib import Path
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright, expect


def atomic_json(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='transport-load-review-save.json')
parser.add_argument('--natural-report', default='natural-growth-report.json')
parser.add_argument('--expected-report-sha256', required=True)
parser.add_argument('--release')
parser.add_argument('--output', default='transport-load-evidence')
parser.add_argument('--chromium')
parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
    parser.error('--expected-sha (or GITHUB_SHA) must pin the exact 40-character commit')
if not re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256):
    parser.error('--expected-report-sha256 must independently pin the complete natural report')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'transport-load-browser-report.json'
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
        deadline = time.monotonic() + 245
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
    report['processCleanup'] = {'observedProcessCount': len(owned), 'terminalObservedResiduals': residual,
        'terminalObservedLiveCount': len(live_residual), 'terminalObservedZombieCount': sum(info['state'] == 'Z' for info in residual),
        'method': 'Only observed worker descendants with matching PID/start-time are signaled; unrelated processes are untouched.',
        'boundary': 'Sampled descendant observation cannot prove absence of unobserved fast-orphaned processes. Zombies are reported as residuals, never described as zero descendants.'}
    atomic_json(report_path, report)
    print(json.dumps({'completed': report.get('completed', False), 'passed': report.get('passed', 0),
                      'case': report.get('case'), 'report': str(report_path), 'observedResiduals': residual}, ensure_ascii=False))
    sys.exit(code if code else (0 if report.get('completed') else 1))

fixtures = json.loads(Path(args.fixture).read_text())
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
RESOURCES = ('metal', 'crystal', 'deuterium')
EPOCH = int(fixtures['epoch'])
parsed = urlparse(args.url)
if parsed.scheme not in ('http', 'https'):
    raise ValueError('Acceptance requires an actual HTTP(S) production URL')
ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
checks, errors, failed_requests, evidence, source_bindings = [], [], [], [], []
page_sources, release_metadata = {}, None
completed, active_page, source_sha, failure = False, None, None, None
case = 'setup'
CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('transport-load-clock');
 const epoch=saved?Number(saved):__EPOCH__;
 let elapsed=0; Date.now=()=>epoch+elapsed;
 Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=callback=>raf(()=>callback(elapsed));
 window.__loadAdvance=async ms=>{elapsed+=ms;sessionStorage.setItem('transport-load-clock',String(epoch+elapsed));await new Promise(raf);await new Promise(raf);};
 window.__loadNative=[Storage.prototype.getItem,Storage.prototype.setItem,File.prototype.text,window.confirm].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 window.__loadClicks=[];window.__loadEdits=[];window.__loadFiles=[];window.__loadStorageEvents=[];window.__loadWheels=[];
 document.addEventListener('click',event=>{const b=event.target.closest?.('#space-fleet button');if(b)window.__loadClicks.push({id:b.id,trusted:event.isTrusted});},true);
 for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches?.('#space-fleet input,#space-fleet select,#planet-select'))window.__loadEdits.push({id:event.target.id,ship:event.target.dataset.ship||null,type,trusted:event.isTrusted,value:event.target.value});},true);
 document.addEventListener('wheel',event=>window.__loadWheels.push({trusted:event.isTrusted,deltaY:event.deltaY}),{capture:true,passive:true});
 document.addEventListener('change',event=>{if(event.target.matches?.('[data-bind="import-file"]'))window.__loadFiles.push({trusted:event.isTrusted,name:event.target.files[0]?.name,size:event.target.files[0]?.size,priorRaw:localStorage.getItem(__KEY__)});},true);
 window.__watchLoadStorage=()=>window.addEventListener('storage',event=>{
  if(event.storageArea===localStorage&&event.key===__KEY__)queueMicrotask(()=>window.__loadStorageEvents.push({trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue,
   disabled:[...document.querySelectorAll('#transport-load-helper button')].every(e=>e.disabled)}));
 });
})();'''.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY)).replace('__EPOCH__', str(EPOCH))


def flush():
    atomic_json(report_path, {'completed': completed, 'result': 'passed' if completed else 'incomplete',
        'case': case, 'url': args.url, 'sourceSha': source_sha,
        'fixture': fixtures['description'], 'fixtureSha256': hashlib.sha256(Path(args.fixture).read_bytes()).hexdigest(),
        'sourceReportSha256': fixtures['source']['reportSha256'],
        'timing': 'Explicit controlled Date/performance/RAF; natural economy remains enabled. Sub-5-second frames use original live tick; >=5-second frames use original catchUp. Reload is native with zero controlled gap.',
        'boundsSeconds': {'worker': 240, 'supervisor': 245}, 'checks': checks,
        'passed': sum(value['passed'] for value in checks), 'errors': errors,
        'failedRequests': failed_requests, 'sourceBindings': source_bindings, 'evidence': evidence, 'failure': failure})


def check(name, condition, detail=None):
    checks.append({'case': case, 'name': name, 'passed': bool(condition),
                   **({'detail': detail} if detail is not None else {})})
    flush()
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__loadAdvance(ms)', milliseconds)


def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator(f'[data-tab="{name}"]').click(); advance(page)


def fleet_tab(page):
    tab(page, 'fleet'); expect(page.locator('#space-fleet')).to_be_visible()


def raw(page):
    return page.evaluate('(key)=>localStorage.getItem(key)', KEY)


def storage(page):
    return page.evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))')


def read(page):
    return json.loads(raw(page))['state']


def save(page):
    tab(page, 'save'); page.locator('[data-action="save"]').click()
    result = read(page); fleet_tab(page)
    return result


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


def boot(which='base'):
    global active_page
    fixture = copy.deepcopy(fixtures[which]); fixture['savedAt'] = fixture['lastTickAt'] = EPOCH
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': [
            {'name': KEY, 'value': json.dumps(fixture, ensure_ascii=False)},
            {'name': 'infinity.ui.tab', 'value': 'overview'},
            {'name': 'infinity.save.v1', 'value': 'EXPLICIT LEGACY SENTINEL: retain unchanged'}]}]})
    context.add_init_script(CLOCK)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('production page is actual HTTP 200', response is not None and response.status == 200)
    verify_bundle(page); check('Storage, File.text and confirm are native', page.evaluate('window.__loadNative'))
    page.evaluate('window.__watchLoadStorage()'); fleet_tab(page)
    check('nontransport helper is hidden at ordinary default mission', page.locator('#flight-mission').input_value() == 'colonize' and page.locator('#transport-load-helper').is_hidden())
    return context, page


def select(page, selector, value):
    field = page.locator(selector); before = field.input_value()
    index = field.evaluate('(e,value)=>[...e.options].findIndex(option=>option.value===value)', value)
    check(selector + ': requested native option exists', index >= 0)
    count = page.evaluate('window.__loadEdits.length'); field.focus(); field.press('Home')
    for _ in range(index):
        field.press('ArrowDown')
    field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__loadEdits.slice(n)', count)
    check(selector + ': native keyboard selects exact option with trusted change', field.input_value() == value and
          (before == value or any(event['id'] == field.get_attribute('id') and event['type'] == 'change' and event['trusted'] for event in events)), events)


def type_value(page, selector, value):
    field = page.locator(selector); count = page.evaluate('window.__loadEdits.length')
    field.focus(); field.press('ControlOrMeta+A'); field.press('Backspace'); field.press_sequentially(str(value)); field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__loadEdits.slice(n)', count)
    check(selector + ': native keyboard types exact draft with trusted input', field.input_value() == str(value) and
          any(event['id'] == (field.get_attribute('id') or '') and event['ship'] == field.get_attribute('data-ship') and event['type'] == 'input' and event['trusted'] for event in events), events)


def configure(page):
    select(page, '#flight-mission', 'transport'); select(page, '#flight-speed', '100')
    for part in ('galaxy', 'system', 'position'):
        type_value(page, '#flight-' + part, fixtures['target'][part])
    type_value(page, '[data-ship="small_cargo"]', '2')
    for resource in RESOURCES:
        type_value(page, '#cargo-' + resource, '0')
    expect(page.locator('#transport-load-helper')).to_be_visible()


def cargo(page):
    return {resource: page.locator('#cargo-' + resource).input_value() for resource in RESOURCES}


def fill_max(page, resource, expected):
    before, values = storage(page), cargo(page)
    page.locator('#transport-fill-' + resource).click(); advance(page)
    values[resource] = expected
    check(resource + ': explicit max changes only its own draft field', cargo(page) == values, cargo(page))
    check(resource + ': max click preserves every native storage byte', storage(page) == before)


def assert_numbers(page, *numbers):
    text = page.locator('#transport-load-summary').inner_text()
    check('visible helper shows exact current quantities', all(re.search(r'(?<![\d.])' + re.escape(str(n)) + r'(?![\d.])', text) for n in numbers), text)
    return text


def planet(state, ident=HOME):
    return next(value for value in state['planets'] if value['id'] == ident)


def whole_state(name, actual, expected):
    if actual != expected:
        atomic_json(out / (name + '-actual-state.json'), actual); atomic_json(out / (name + '-expected-state.json'), expected)
    check(name + ': every serialized game field equals independent original-engine oracle', actual == expected,
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


def native_scroll_to(page, selector):
    for _ in range(5):
        box = page.locator(selector).bounding_box()
        limits = page.evaluate('({height:innerHeight,width:innerWidth,top:Math.max(0,document.querySelector(".topbar")?.getBoundingClientRect().bottom||0)+12})')
        available = limits['height'] - limits['top'] - 12
        check('target fits below actual sticky header', box is not None and box['height'] <= available, {'selector': selector, 'box': box, 'limits': limits})
        if box['y'] >= limits['top'] and box['y'] + box['height'] <= limits['height'] - 12:
            return
        target_y = limits['top'] + (available - box['height']) / 2
        page.mouse.move(limits['width'] - 12, limits['height'] - 12)
        page.mouse.wheel(0, round(box['y'] - target_y)); page.wait_for_timeout(100); advance(page)
    raise AssertionError('Actual wheel input could not expose the complete requested region')


def responsive_screenshot(page, width):
    required = ['#transport-load-summary', *['#transport-fill-' + resource for resource in RESOURCES]]
    root = page.locator('#transport-load-helper').bounding_box()
    available = page.evaluate('innerHeight-Math.max(0,document.querySelector(".topbar")?.getBoundingClientRect().bottom||0)-24')
    groups = [('#transport-load-helper', ['#transport-load-helper', *required], '')] if root and root['height'] <= available else [
        (selector, [selector], '-' + selector.removeprefix('#transport-')) for selector in required]
    for target, selectors, suffix in groups:
        native_scroll_to(page, target); before = visibility(page, selectors)
        check(f'{width}px{suffix}: full region and five hit-test points are visible/unoccluded before screenshot',
              all(item['visible'] and item['contained'] and not item['disabled'] and all(point['unoccluded'] for point in item['points']) for item in before['targets']), before)
        snap(page, f'transport-load-{width}{suffix}.png'); after = visibility(page, selectors)
        check(f'{width}px{suffix}: unchanged full region stays unoccluded after screenshot', after == before, after)
        path = out / f'transport-load-{width}{suffix}-visibility.json'
        atomic_json(path, {'coverage': 'Whole helper in one viewport' if len(groups) == 1 else 'Separate real viewport per helper element', 'before': before, 'after': after})
        evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}); flush()


def remember(page):
    page.evaluate('window.__retiredLoadButton=document.querySelector("#transport-fill-metal")')


def reject_retained(page, label, hidden=False):
    before, values = storage(page), cargo(page)
    check(label + ': retired helper is visibly disabled or hidden', page.locator('#transport-fill-metal').is_disabled() or hidden and page.locator('#transport-load-helper').is_hidden())
    page.evaluate('''()=>{const b=window.__retiredLoadButton;b.disabled=false;b.click();}'''); advance(page)
    check(label + ': synthetic retained-node replay changes no draft or native storage', cargo(page) == values and storage(page) == before,
          {'classification': 'Explicit synthetic untrusted retained-button click; not a normal user action'})


def import_fixture(page, which='base'):
    fixture = copy.deepcopy(fixtures[which]); fixture['savedAt'] = fixture['lastTickAt'] = page.evaluate('Date.now()')
    tab(page, 'save'); path = out / f'native-import-{which}.json'
    path.write_text(json.dumps(fixture, ensure_ascii=False), encoding='utf-8')
    before, selections, dialogs = raw(page), page.evaluate('window.__loadFiles.length'), []
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message.startswith(f'已读取存档 v{fixture["version"]}/r{fixture["revision"]}。') and '是否替换当前进度' in dialog.message and '写入校验成功后才采用' in dialog.message
        dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', answer); page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
    files = page.evaluate('window.__loadFiles')
    check('native file selection and exactly one explicit native confirmation authorize import', len(dialogs) == 1 and dialogs[0]['valid'] and len(files) == selections + 1 and files[-1] == {'trusted': True, 'name': path.name, 'size': path.stat().st_size, 'priorRaw': before})
    fleet_tab(page); whole_state('native-import-' + which, read(page), fixture['state'])


def rejected_conflict_import(page):
    """A native confirmed read cannot authorize overwriting the actual other writer."""
    fixture = copy.deepcopy(fixtures['base']); fixture['savedAt'] = fixture['lastTickAt'] = page.evaluate('Date.now()')
    tab(page, 'save'); path = out / 'rejected-conflict-import-natural-base.json'
    path.write_text(json.dumps(fixture, ensure_ascii=False), encoding='utf-8')
    before, prior_raw = storage(page), raw(page)
    selections, dialogs = page.evaluate('window.__loadFiles.length'), []
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message.startswith(f'已读取存档 v{fixture["version"]}/r{fixture["revision"]}。') and '是否替换当前进度' in dialog.message and '写入校验成功后才采用' in dialog.message
        dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', answer); page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败，当前进度未改动')
    expect(page.locator('[data-bind="status"]')).to_contain_text('其他标签页')
    files = page.evaluate('window.__loadFiles')
    check('conflict refusal follows real File selection/read and one explicit native confirmation', len(dialogs) == 1 and dialogs[0]['valid'] and len(files) == selections + 1 and files[-1] == {'trusted': True, 'name': path.name, 'size': path.stat().st_size, 'priorRaw': prior_raw})
    check('refused conflict import preserves every current, backup and legacy storage byte', storage(page) == before)
    evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'classification': 'Intentionally rejected real file replacement; retained source bytes'})
    fleet_tab(page); check('confirmed but refused import never restores protected max authority', page.locator('#transport-fill-metal').is_disabled())


def reload_verified(page):
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle')
    check('native reload gets fresh actual HTTP 200', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); fleet_tab(page)


def timeout(_signal, _frame):
    raise TimeoutError('Manual transport loading acceptance exceeded the 240-second worker bound')


signal.signal(signal.SIGALRM, timeout); signal.alarm(240)
try:
    source_bytes = Path(args.natural_report).read_bytes()
    source_report = json.loads(source_bytes)
    check('complete natural report independently matches requested and fixture SHA-256', hashlib.sha256(source_bytes).hexdigest() == args.expected_report_sha256 == fixtures['source']['reportSha256'])
    milestones = [value for value in source_report['milestones'] if value['name'] == '08-colony-established-by-fleet-arrival']
    check('fixture retains exact original natural milestone and complete save', len(milestones) == 1 and milestones[0] == fixtures['naturalMilestone'] and milestones[0]['save'] == fixtures['base'] == fixtures['naturalBaseline'])
    (out / 'source-natural-growth-report.json').write_bytes(source_bytes)
    atomic_json(out / 'original-natural-milestone08.json', fixtures['naturalMilestone'])
    fault = copy.deepcopy(fixtures['noFuel']['state']); planet(fault)['resources']['deuterium'] = planet(fixtures['base']['state'])['resources']['deuterium']
    check('explicit noFuel fault changes only the single declared natural deuterium field', fault == fixtures['base']['state'] and planet(fixtures['noFuel']['state'])['resources']['deuterium'] == '7', fixtures['faults']['noFuel'])
    check('independent original-engine route goldens are literal 10000 capacity / 8 fuel / 9992 cargo', fixtures['independentProbes']['empty']['capacity'] == '10000' and fixtures['independentProbes']['empty']['fuel'] == '8' and fixtures['independentProbes']['empty']['metalMaximum'] == '9992' and fixtures['execution']['fleetId'] == 2)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        case = 'natural route: actual typed overload and explicit read-only maxima'
        context, page = boot(); configure(page); baseline = save(page); before = storage(page)
        whole_state('initial-natural-baseline', baseline, fixtures['execution']['expected']['baseline'])
        type_value(page, '#cargo-metal', '10000'); summary = assert_numbers(page, '10000', '8')
        check('10000 typed metal visibly exceeds capacity by precisely 8 and cannot dispatch', '超出 8' in summary and page.locator('#space-send').is_disabled())
        check('overload preview never silently edits cargo or writes any storage', cargo(page) == {'metal': '10000', 'crystal': '0', 'deuterium': '0'} and storage(page) == before)
        whole_state('overload-keeps-full-state', save(page), baseline)
        fill_max(page, 'metal', '9992'); assert_numbers(page, '9992', '8', '10000')
        check('filling 9992 leaves dispatch as a separate enabled action', page.locator('#space-send').is_enabled() and not read(page)['fleets'])
        type_value(page, '#cargo-crystal', '500'); fill_max(page, 'metal', '9492')
        check('500 crystal is retained exactly when metal fills remaining capacity', cargo(page) == {'metal': '9492', 'crystal': '500', 'deuterium': '0'})
        type_value(page, '#cargo-crystal', '0.3'); fill_max(page, 'metal', '9991.699999999999')
        check('fractional 0.3 crystal stays verbatim while exact representable metal maximum remains dispatchable', cargo(page) == {'metal': '9991.699999999999', 'crystal': '0.3', 'deuterium': '0'} and page.locator('#space-send').is_enabled())
        whole_state('fractional-roundtrip-boundary-is-full-state-read-only', save(page), baseline)
        for resource in RESOURCES:
            type_value(page, '#cargo-' + resource, '0')
        fill_max(page, 'crystal', '554.808618111057')
        type_value(page, '#cargo-crystal', '0'); fill_max(page, 'deuterium', '7942.03903587735')
        check('deuterium maximum reserves exactly 8 rather than filling available stock', Decimal(planet(baseline)['resources']['deuterium']) - Decimal(cargo(page)['deuterium']) == Decimal('8'))
        whole_state('all-maxima-are-full-state-read-only', save(page), baseline)
        check('ordinary max activations were trusted browser clicks', page.evaluate('["metal","crystal","deuterium"].every(r=>window.__loadClicks.some(e=>e.id==="transport-fill-"+r&&e.trusted))'))
        record(page, 'preview-and-fill-no-dispatch'); context.close()

        case = 'current request conditions and invalid values cannot borrow stale maxima'
        context, page = boot(); configure(page); baseline = save(page)
        for invalid in ('oops', '-1', '1e309'):
            type_value(page, '#cargo-crystal', invalid); remember(page)
            reject_retained(page, 'invalid other cargo ' + invalid)
            check('invalid cargo remains byte-for-byte visible', page.locator('#cargo-crystal').input_value() == invalid)
        type_value(page, '#cargo-crystal', '0')
        for count in ('0', '3'):
            type_value(page, '[data-ship="small_cargo"]', count); remember(page)
            reject_retained(page, 'no usable fleet for ship count ' + count)
        type_value(page, '[data-ship="small_cargo"]', '1'); fill_max(page, 'metal', '4994'); assert_numbers(page, '5000', '6')
        type_value(page, '[data-ship="small_cargo"]', '2'); select(page, '#flight-speed', '10')
        fill_max(page, 'metal', '9996'); assert_numbers(page, '10000', '4')
        select(page, '#flight-speed', '100'); fill_max(page, 'metal', '9992')
        type_value(page, '#flight-position', '11'); remember(page); reject_retained(page, 'target changed to origin')
        type_value(page, '#flight-position', '10'); remember(page); select(page, '#flight-mission', 'deploy')
        reject_retained(page, 'nontransport mission', hidden=True)
        select(page, '#flight-mission', 'transport'); fill_max(page, 'metal', '9992')
        select(page, '#planet-select', COLONY); remember(page); reject_retained(page, 'origin changed to shipless natural colony')
        whole_state('selected-natural-colony', save(page), fixtures['execution']['expected']['selectedColony'])
        select(page, '#planet-select', HOME); fill_max(page, 'metal', '9992')
        whole_state('all-condition-edits-remain-read-only', save(page), baseline); context.close()

        case = 'explicit debit-only fuel fault is rejected without additional changes'
        context, page = boot('noFuel'); configure(page); baseline = save(page); remember(page)
        reject_retained(page, '7 deuterium cannot prepay 8 fuel')
        check('fuel insufficiency is visibly explained', '重氢' in page.locator('#transport-load-reason').inner_text())
        whole_state('no-fuel-fault-preserved', save(page), baseline); context.close()

        case = 'native confirmed same-ID import retires the pre-import helper'
        context, page = boot(); configure(page); type_value(page, '#cargo-metal', '123'); baseline = save(page); remember(page)
        import_fixture(page); reject_retained(page, 'same-ID original natural save replacement')
        whole_state('same-ID-import-no-hidden-action', save(page), baseline)
        type_value(page, '#cargo-metal', '124'); fill_max(page, 'metal', '9992')
        whole_state('fresh-edit-reauthorizes-only-draft-fill', save(page), baseline); context.close()

        case = 'detached or replaced DOM nodes cannot inherit current helper authority'
        context, page = boot(); configure(page); baseline = save(page); before, values = storage(page), cargo(page)
        page.evaluate('''()=>{const b=document.querySelector('#transport-fill-metal'),parent=b.parentNode;b.remove();parent.append(b);b.disabled=false;b.click();}'''); advance(page)
        check('same-turn original-node removal and reinserted synthetic click cannot fill or save', cargo(page) == values and storage(page) == before,
              {'classification': 'Explicit synthetic DOM manipulation and untrusted click'})
        whole_state('removed-helper-preserves-world', save(page), baseline); context.close()
        context, page = boot(); configure(page); baseline = save(page); before = storage(page)
        page.evaluate('''()=>{const e=document.querySelector('#cargo-metal');window.__replacedLoadInput=e;const replacement=e.cloneNode(true);replacement.value='7';e.replaceWith(replacement);const b=document.querySelector('#transport-fill-metal');b.disabled=false;b.click();}'''); advance(page)
        check('same-ID cloned input cannot borrow max authority or alter detached original', cargo(page) == {'metal': '7', 'crystal': '0', 'deuterium': '0'} and page.evaluate('window.__replacedLoadInput.value') == '0' and storage(page) == before)
        whole_state('replacement-input-preserves-world', save(page), baseline); context.close()

        case = 'real second-tab storage conflict protects hidden helper'
        context, page = boot(); configure(page); type_value(page, '#cargo-metal', '123'); save(page); remember(page); tab(page, 'overview')
        second = context.new_page(); attach(second); response = second.goto(args.url, wait_until='networkidle')
        check('competing writer is an actual same-origin HTTP page', response is not None and response.status == 200)
        verify_bundle(second); import_fixture(second, 'noFuel'); committed = raw(second)
        page.wait_for_function('window.__loadStorageEvents.some(e=>e.trusted)')
        events = page.evaluate('window.__loadStorageEvents')
        check('trusted native StorageEvent immediately disables hidden helper', any(event['trusted'] and event['disabled'] and event['newValue'] == committed for event in events), events)
        fleet_tab(page); reject_retained(page, 'native cross-tab protection')
        check('protected helper preserves the exact other-tab result', raw(page) == committed)
        rejected_conflict_import(page); reject_retained(page, 'refused import leaves old protected session retired')
        check('failed old-session import cannot replace the actual writer result', raw(page) == committed)
        before_close = storage(page); second.close(); advance(page)
        check('closing writer changes no current, backup or legacy byte and does not restore authority', storage(page) == before_close and page.locator('#transport-fill-metal').is_disabled())
        check('cold reload will use precisely zero controlled offline gap', page.evaluate('Date.now()') == json.loads(committed)['lastTickAt'])
        reload_verified(page)
        check('cold reload discards old DOM references and all old draft values', page.evaluate('typeof window.__retiredLoadButton==="undefined"') and cargo(page) == dict.fromkeys(RESOURCES, '0') and page.locator('[data-ship="small_cargo"]').input_value() == '0' and page.locator('#flight-mission').input_value() == 'colonize')
        whole_state('cold-reload-adopts-exact-latest-shared-noFuel', read(page), json.loads(committed)['state'])
        check('cold reload itself preserves every latest current, backup and legacy byte', storage(page) == before_close)
        configure(page); remember(page); reject_retained(page, 'latest shared world genuinely still has only 7 fuel')
        whole_state('fresh-noFuel-draft-does-not-change-latest-world', save(page), fixtures['noFuel']['state'])
        # Only this freshly reloaded ready session may choose a new file. This is
        # never treated as recovery by import inside the retired conflict session.
        import_fixture(page, 'base'); reject_retained(page, 'new ready-session import still retires previous helper')
        type_value(page, '#cargo-metal', '124'); fill_max(page, 'metal', '9992')
        whole_state('fresh-edit-after-real-reload-and-confirmed-file-is-read-only', save(page), fixtures['base']['state'])
        context.close()

        case = 'natural production changes stock-limited maxima at the next explicit click'
        context, page = boot(); configure(page); baseline = save(page)
        advance(page, 5000); produced = save(page)
        whole_state('five-second-natural-production', produced, fixtures['execution']['expected']['naturalFiveSeconds'])
        current_crystal = planet(produced)['resources']['crystal']
        check('actual natural production creates a distinct current fractional crystal stock', current_crystal != planet(baseline)['resources']['crystal'])
        fill_max(page, 'crystal', current_crystal)
        check('new stock-limited click uses current naturally produced stock, never initial quote stock', cargo(page) == {'metal': '0', 'crystal': current_crystal, 'deuterium': '0'})
        whole_state('current-stock-fill-adds-no-payment-or-state-write', save(page), produced); context.close()

        case = 'one independent native dispatch, real delivery/return, reload and no duplicate payment'
        context, page = boot(); configure(page); baseline = save(page); fill_max(page, 'metal', '9992')
        whole_state('pre-dispatch-no-payment', save(page), baseline)
        clicks = page.evaluate('window.__loadClicks.filter(e=>e.id==="space-send").length')
        page.locator('#space-send').click(); advance(page); departed = read(page)
        whole_state('departed', departed, fixtures['execution']['expected']['departed'])
        sent = page.evaluate('window.__loadClicks.filter(e=>e.id==="space-send")')
        check('exactly one separate trusted dispatch click creates real fleet 2', len(sent) == clicks + 1 and sent[-1]['trusted'] and len(departed['fleets']) == 1 and departed['fleets'][0]['id'] == 2 and departed['nextFleetId'] == 3)
        actual_fleet = next(value for value in departed['fleets'] if value['id'] == 2)
        check('real fleet carries literal 9992 metal on the approved natural route', actual_fleet['originId'] == HOME and actual_fleet['target'] == {'galaxy': 1, 'system': 56, 'position': 10} and actual_fleet['mission'] == 'transport' and actual_fleet['orderTransport'] is None and actual_fleet['ships']['small_cargo'] == 2 and actual_fleet['cargo'] == {'metal': '9992', 'crystal': '0', 'deuterium': '0'})
        check('dispatch exact wallet differences equal cargo9992 and prepaid fuel8',
              {resource: Decimal(planet(baseline)['resources'][resource]) - Decimal(planet(departed)['resources'][resource]) for resource in RESOURCES} == {'metal': Decimal('9992'), 'crystal': Decimal('0'), 'deuterium': Decimal('8')})
        check('dispatch removes exactly two original ships and no plan payment/identity', planet(departed)['units']['small_cargo'] == 0 and departed['orders'] == baseline['orders'])
        record(page, 'real-manual-dispatch-fleet2')
        advance(page, 1000); inflight = save(page); whole_state('inflight', inflight, fixtures['execution']['expected']['inflight']); record(page, 'inflight-before-native-reload')
        check('reload starts during actual outbound fleet with precisely zero offline gap', len(inflight['fleets']) == 1 and not inflight['fleets'][0]['returning'] and inflight['fleets'][0]['remaining'] > 0 and page.evaluate('Date.now()') == json.loads(raw(page))['lastTickAt'])
        reload_verified(page); restored = save(page); whole_state('reloaded-inflight', restored, fixtures['execution']['expected']['reloadedInflight'])
        check('native reload preserves the same fleet, wallet and prepaid fuel', restored['fleets'] == inflight['fleets'] and restored['planets'] == inflight['planets'] and restored['nextFleetId'] == 3)
        advance(page, 5000); delivered = save(page); whole_state('delivered', delivered, fixtures['execution']['expected']['delivered']); record(page, 'delivered-returning-fleet2')
        check('original fleet 2 actually delivered and is returning empty with both ships', len(delivered['fleets']) == 1 and delivered['fleets'][0]['id'] == 2 and delivered['fleets'][0]['returning'] and delivered['fleets'][0]['cargo'] == dict.fromkeys(RESOURCES, '0') and delivered['fleets'][0]['ships']['small_cargo'] == 2 and any(message['id'] == 'arrival-2' for message in delivered['messages']))
        advance(page, 5000); returned = save(page); whole_state('returned', returned, fixtures['execution']['expected']['returned']); record(page, 'returned-original-ships')
        check('both original ships return with no fleet or new payment', not returned['fleets'] and planet(returned)['units']['small_cargo'] == 2 and returned['nextFleetId'] == 3 and returned['orders'] == baseline['orders'] and any(message['id'] == 'return-2' for message in returned['messages']))
        advance(page, 60000); later = save(page); whole_state('later-no-double-pay', later, fixtures['execution']['expected']['later']); record(page, 'later-no-double-payment')
        check('waiting does not dispatch again or duplicate delivery/return', not later['fleets'] and later['nextFleetId'] == 3 and sum(message['id'] == 'dispatch-2' for message in later['messages']) == 1 and sum(message['id'] == 'arrival-2' for message in later['messages']) == 1 and sum(message['id'] == 'return-2' for message in later['messages']) == 1)
        context.close()

        case = 'four-width native keyboard/wheel screenshots and focused-node stability'
        context, page = boot(); configure(page); baseline = save(page)
        for viewport_index, width in enumerate((320, 390, 768, 1440), 1):
            page.set_viewport_size({'width': width, 'height': 1100})
            for resource in RESOURCES:
                type_value(page, '#cargo-' + resource, '0')
            page.locator('#transport-fill-metal').focus(); page.keyboard.press('Enter'); advance(page)
            check(f'{width}px: native keyboard independently fills 9992 metal and preserves focus', cargo(page) == {'metal': '9992', 'crystal': '0', 'deuterium': '0'} and page.locator('#transport-fill-metal').evaluate('(e)=>document.activeElement===e'))
            field = page.locator('#cargo-metal'); field.focus(); field.press('Home'); field.press('ArrowRight')
            page.evaluate('window.__loadFocused=document.activeElement'); caret = field.evaluate('(e)=>[e.selectionStart,e.selectionEnd]')
            for _ in range(3):
                advance(page, 1000)
            check(f'{width}px: real focused draft identity/caret survive regular frames', field.evaluate('(e)=>e===window.__loadFocused&&document.activeElement===e&&JSON.stringify([e.selectionStart,e.selectionEnd])===JSON.stringify(' + json.dumps(caret) + ')'))
            check(f'{width}px: document has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
            page.mouse.move(width - 12, 1080); page.mouse.wheel(0, -100000); page.wait_for_timeout(100); advance(page)
            responsive_screenshot(page, width)
            whole_state(f'responsive-{width}-natural-production-only', save(page), fixtures['execution']['expected'][f'responsive{viewport_index * 3}LiveSeconds'])
        wheels = page.evaluate('window.__loadWheels')
        check('responsive evidence includes actual trusted wheel input', bool(wheels) and all(event['trusted'] for event in wheels) and any(event['deltaY'] > 0 for event in wheels), wheels)
        whole_state('four-width-keyboard-fills-add-only-natural-production', save(page), fixtures['execution']['expected']['responsive12LiveSeconds']); context.close()
        case = 'suite integrity'
        check('no uncaught JavaScript errors or failed production requests', not errors and not failed_requests, {'errors': errors, 'failedRequests': failed_requests})
        completed = True; flush(); browser.close()
except BaseException as error:
    failure = {'case': case, 'error': repr(error), 'traceback': traceback.format_exc()}
    if active_page is not None:
        try:
            failure['rawSave'] = raw(active_page)
            failure['helper'] = active_page.locator('#transport-load-helper').all_text_contents()
            failure['cargo'] = cargo(active_page)
            failure['status'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure.png')
        except BaseException as capture_error:
            failure['captureError'] = repr(capture_error)
    flush(); raise
finally:
    signal.alarm(0); flush()
