"""Ordinary local-order quotation, against the actual HTTP production bundle.

Anonymous strict synthetic saves, native Storage/File/confirm, trusted ordinary
browser input, and explicitly controlled Date/performance/RAF timestamps. Retained
button replay is labeled synthetic. No state injection, inline bundle, natural-play,
native-background or real-device claim. Preview/fill must be read-only to game state.
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
parser.add_argument('--fixture', default='order-quotes-review-save.json')
parser.add_argument('--release', help='Release metadata HTTP URL; default is URL/release.json')
parser.add_argument('--output', default='order-quotes-evidence')
parser.add_argument('--chromium')
parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
    parser.error('--expected-sha (or GITHUB_SHA) must pin the exact 40-character commit')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'order-quotes-browser-report.json'
if not args.worker:
    # Reuse the building-template suite's bounded worker and PID/birth-checked
    # descendant cleanup. No process-name matching or unrelated browser killing.
    if any(out.iterdir()):
        raise SystemExit('Use an empty --output directory; do not mix old evidence into this run.')
    atomic_json(report_path, {'completed': False, 'result': 'starting', 'checks': []})
    owned = {}

    def identity(pid):
        try:
            return Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()[19]
        except (OSError, IndexError):
            return None

    def collect(root):
        pending, visited = [root, *owned], set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid); birth = identity(pid)
            if birth is None or (pid in owned and owned[pid] != birth):
                continue
            owned[pid] = birth
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try:
                    pending.extend(int(value) for value in children.read_text().split())
                except OSError:
                    pass

    def terminate(process, sig):
        for pid, birth in reversed(list(owned.items())):
            if identity(pid) == birth:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        if process.pid in owned and identity(process.pid) == owned[process.pid]:
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass

    expired, code = False, 1
    with (out / 'worker.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, __file__, *sys.argv[1:], '--worker'],
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 175
        try:
            while True:
                collect(process.pid)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    expired = True
                    break
                try:
                    code = process.wait(timeout=min(.25, remaining))
                    break
                except subprocess.TimeoutExpired:
                    pass
        finally:
            collect(process.pid); terminate(process, signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            time.sleep(.1); terminate(process, signal.SIGKILL); process.wait(timeout=2)
    report = json.loads(report_path.read_text())
    if expired or code:
        report.update(completed=False, result='external watchdog timeout' if expired else 'failed')
    report['workerExitCode'] = code
    report['processCleanup'] = 'Worker and PID/start-time-verified descendants terminated; unrelated processes untouched.'
    atomic_json(report_path, report)
    print(json.dumps({'completed': report.get('completed', False), 'passed': report.get('passed', 0),
                      'case': report.get('case'), 'report': str(report_path)}, ensure_ascii=False))
    sys.exit(code if code else (0 if report.get('completed') else 1))

fixtures = json.loads(Path(args.fixture).read_text())
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
RESOURCES = ('metal', 'crystal', 'deuterium')
CASES = (('building', 'metal_mine', 3), ('research', 'energy_tech', 2), ('shipyard', 'light_fighter', 5))
FIRST_PAYMENTS = {
    'building': {'metal': '90', 'crystal': '22', 'deuterium': '0'},
    'research': {'metal': '0', 'crystal': '800', 'deuterium': '400'},
    'shipyard': {'metal': '15000', 'crystal': '5000', 'deuterium': '0'},
}
MODE = 'Actual HTTP / native Storage and file import / anonymous synthetic saves / controlled simulation timestamps'
EPOCH = int(time.time() * 1000)
parsed = urlparse(args.url)
if parsed.scheme not in ('http', 'https'):
    raise ValueError('Acceptance requires an actual HTTP(S) production URL')
ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
checks, errors, failed_requests, evidence, source_bindings, wallet_records = [], [], [], [], [], []
page_sources, release_metadata = {}, None
completed, active_page, source_sha, failure = False, None, None, None
case = 'setup'
atomic_json(out / 'original-legacy-wallet-payment-probe.json', fixtures['originalPaymentProbe'])
evidence.append({'file': 'original-legacy-wallet-payment-probe.json',
                 'sha256': hashlib.sha256((out / 'original-legacy-wallet-payment-probe.json').read_bytes()).hexdigest(),
                 'classification': 'Original independent preflight values retained unchanged, including legacy-wallet representation dust'})
CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('order-quote-clock');
 const epoch=saved?Number(saved):__EPOCH__;
 let elapsed=0; Date.now=()=>epoch+elapsed;
 Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=callback=>raf(()=>callback(elapsed));
 window.__quoteAdvance=async ms=>{elapsed+=ms;sessionStorage.setItem('order-quote-clock',String(epoch+elapsed));await new Promise(raf);await new Promise(raf);};
 window.__quoteNative=[Storage.prototype.getItem,Storage.prototype.setItem,File.prototype.text,window.confirm].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 window.__quoteClicks=[];window.__quoteEdits=[];window.__quoteFiles=[];window.__quoteStorageEvents=[];
 document.addEventListener('click',event=>{const b=event.target.closest?.('#order-form button');if(b)window.__quoteClicks.push({id:b.id,trusted:event.isTrusted});},true);
 for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches?.('#order-form input,#order-form select,#planet-select'))window.__quoteEdits.push({id:event.target.id,type,trusted:event.isTrusted,value:event.target.value});},true);
 document.addEventListener('change',event=>{if(event.target.matches?.('[data-bind="import-file"]'))window.__quoteFiles.push({trusted:event.isTrusted,name:event.target.files[0]?.name,size:event.target.files[0]?.size,priorRaw:localStorage.getItem(__KEY__)});},true);
 window.__watchQuoteStorage=()=>window.addEventListener('storage',event=>{
  if(event.storageArea===localStorage&&event.key===__KEY__)queueMicrotask(()=>window.__quoteStorageEvents.push({trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue,
   disabled:[...document.querySelectorAll('#order-quote button')].every(e=>e.disabled)}));
 });
})();'''.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY)).replace('__EPOCH__', str(EPOCH))


def flush():
    atomic_json(report_path, {'completed': completed, 'result': 'passed' if completed else 'incomplete',
        'case': case, 'mode': MODE, 'url': args.url, 'sourceSha': source_sha,
        'fixture': fixtures['description'], 'fixtureSha256': hashlib.sha256(Path(args.fixture).read_bytes()).hexdigest(),
        'timing': 'Controlled Date/performance/RAF. Normal actions use trusted native input; retained-button attacks use explicit synthetic clicks. No natural-play or native-background claim.',
        'boundsSeconds': {'worker': 170, 'supervisor': 175}, 'checks': checks,
        'passed': sum(value['passed'] for value in checks), 'errors': errors,
        'failedRequests': failed_requests, 'sourceBindings': source_bindings, 'walletReconciliations': wallet_records,
        'evidence': evidence, 'failure': failure})


def check(name, condition, detail=None):
    checks.append({'case': case, 'name': name, 'passed': bool(condition),
                   **({'detail': detail} if detail is not None else {})})
    flush()
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__quoteAdvance(ms)', milliseconds)


def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator(f'[data-tab="{name}"]').click(); advance(page)


def plans(page):
    tab(page, 'orders'); expect(page.locator('#space-orders')).to_be_visible()


def raw(page):
    return page.evaluate('(key)=>localStorage.getItem(key)', KEY)


def storage(page):
    return page.evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))')


def read(page):
    return json.loads(raw(page))['state']


def save(page):
    tab(page, 'save'); page.locator('[data-action="save"]').click()
    result = read(page); plans(page)
    return result


def attach(page):
    page.set_default_timeout(7000); page.set_default_navigation_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))
    capture = {'responses': [], 'executed': [], 'cdp': page.context.new_cdp_session(page)}
    page_sources[page] = capture
    page.on('response', lambda response: capture['responses'].append(response)
            if response.request.resource_type in ('script', 'stylesheet') else None)
    capture['cdp'].send('Network.enable')
    capture['cdp'].send('Network.setCacheDisabled', {'cacheDisabled': True})
    capture['cdp'].on('Debugger.scriptParsed', lambda event: capture['executed'].append(event)
                        if event.get('url', '').startswith(('http://', 'https://')) else None)
    capture['cdp'].send('Debugger.enable')


def verify_bundle(page):
    global source_sha, release_metadata
    if release_metadata is None:
        release_url = args.release or urljoin(args.url, 'release.json')
        check('release URL belongs to exact tested origin', f'{urlparse(release_url).scheme}://{urlparse(release_url).netloc}' == ORIGIN)
        response = page.request.get(release_url)
        check('release metadata is actual HTTP 200 from requested URL', response.status == 200 and response.url == release_url)
        release_metadata = response.json(); source_sha = release_metadata.get('sourceSha')
        check('release pins exact mandatory tested commit', source_sha == args.expected_sha, source_sha)
        check('release save schema matches strict fixture', release_metadata.get('saveVersion') == fixtures['base']['version'] and release_metadata.get('saveRevision') == fixtures['base']['revision'])
        atomic_json(out / 'release.json', release_metadata)
    capture = page_sources[page]
    files = {urljoin(args.url, name): (name, expected) for name, expected in release_metadata['files'].items()}
    rows, bodies, executed = [], {}, []
    for response in capture['responses']:
        name, expected = files.get(response.url, (None, None))
        check('real script/stylesheet response belongs to pinned release', name is not None and response.status == 200 and response.url == response.request.url,
              {'type': response.request.resource_type, 'status': response.status, 'finalURL': response.url})
        body = response.body(); digest = hashlib.sha256(body).hexdigest(); bodies[response.url] = body
        row = {'type': response.request.resource_type, 'status': response.status, 'requestURL': response.request.url,
               'finalURL': response.url, 'releaseFile': name, 'bytes': len(body), 'httpSha256': digest, 'releaseSha256': expected}
        rows.append(row)
        check('complete served JS/CSS bytes match exact release hash', digest == expected, row)
    check('both real production JavaScript and CSS responses were captured', any(row['type'] == 'script' for row in rows) and any(row['type'] == 'stylesheet' for row in rows))
    for event in capture['executed']:
        url = event['url']; name, expected = files.get(url, (None, None))
        check('actual V8-executed HTTP script has matching pinned HTTP response', name is not None and url in bodies, url)
        source = capture['cdp'].send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
        digest = hashlib.sha256(source.encode('utf-8')).hexdigest()
        row = {'url': url, 'scriptId': event['scriptId'], 'releaseFile': name,
               'executedSourceSha256': digest, 'httpSha256': hashlib.sha256(bodies[url]).hexdigest(), 'releaseSha256': expected}
        check('read-only V8 source equals actual HTTP bytes and pinned release', digest == row['httpSha256'] == expected, row)
        executed.append(row)
        if not source_bindings:
            (out / ('executed-' + Path(name).name)).write_text(source, encoding='utf-8')
    check('at least one real production script was observed executing in V8', bool(executed))
    source_bindings.append({'case': case, 'page': len(source_bindings) + 1, 'httpAssets': rows, 'executedScripts': executed,
                            'classification': 'Read-only CDP source inspection; no interception, bundle evaluation or game-state injection'})
    capture['cdp'].send('Debugger.disable'); flush()


def boot(which='base'):
    global active_page
    fixture = copy.deepcopy(fixtures[which]); fixture['savedAt'] = fixture['lastTickAt'] = EPOCH
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': [
            {'name': KEY, 'value': json.dumps(fixture, ensure_ascii=False)},
            {'name': 'infinity.ui.tab', 'value': 'overview'},
            {'name': 'infinity.save.v1', 'value': 'SYNTHETIC LEGACY BYTES: retain unchanged'}]}]})
    context.add_init_script(CLOCK)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('production page is actual HTTP 200', response is not None and response.status == 200)
    verify_bundle(page)
    check('Storage, File.text and confirm are native', page.evaluate('window.__quoteNative'))
    page.evaluate('window.__watchQuoteStorage()'); plans(page)
    return context, page


def configure(page, kind='building', target='metal_mine', goal=3, payer=HOME):
    select(page, '#order-kind', kind); select(page, '#order-planet', payer)
    select(page, '#order-target', target); type_value(page, '#order-goal', str(goal))


def select(page, selector, value):
    field = page.locator(selector); before = field.input_value()
    index = field.evaluate('(e,value)=>[...e.options].findIndex(option=>option.value===value)', value)
    check(selector + ': requested native select option exists', index >= 0)
    count = page.evaluate('window.__quoteEdits.length')
    field.focus(); field.press('Home')
    for _ in range(index):
        field.press('ArrowDown')
    field.press('Tab')
    events = page.evaluate('(n)=>window.__quoteEdits.slice(n)', count)
    check(selector + ': keyboard chooses exact option with trusted change when changed', field.input_value() == value and
          (before == value or any(event['id'] == field.get_attribute('id') and event['type'] == 'change' and event['trusted'] for event in events)), events)


def type_value(page, selector, value):
    field = page.locator(selector); count = page.evaluate('window.__quoteEdits.length')
    field.focus(); field.press('ControlOrMeta+A'); field.press('Backspace'); field.press_sequentially(str(value)); field.press('Tab')
    events = page.evaluate('(n)=>window.__quoteEdits.slice(n)', count)
    check(selector + ': keyboard types exact draft value with trusted input', field.input_value() == str(value) and
          any(event['id'] == field.get_attribute('id') and event['type'] == 'input' and event['trusted'] for event in events), events)


def caps(page):
    return {resource: page.locator(f'#order-budget-{resource}').input_value() for resource in RESOURCES}


def quote(page, expected, fill=False):
    page.locator('#order-quote-view').click()
    cost = page.locator('#order-quote-cost').inner_text()
    check('visible current quote has all three exact resource amounts',
          '金属 ' + expected['metal'] + ' / 晶体 ' + expected['crystal'] + ' / 重氢 ' + expected['deuterium'] in cost, cost)
    if fill:
        page.locator('#order-quote-fill').click()
        check('explicit fill writes exactly the three draft budgets', caps(page) == expected, caps(page))


def fill_blocked(page):
    button = page.locator('#order-quote-fill')
    return button.is_hidden() or button.is_disabled()


def remember_fill(page):
    page.evaluate('window.__retiredQuoteFill=document.querySelector("#order-quote-fill")')


def reject_retained_fill(page, label):
    before, budget = storage(page), caps(page)
    check(label + ': fill visibly retired', fill_blocked(page))
    page.evaluate('''() => {const b=window.__retiredQuoteFill;b.disabled=false;b.hidden=false;b.click();}''')
    check(label + ': synthetic retained fill cannot change caps or any native bytes', caps(page) == budget and storage(page) == before)


def planet(state, ident=HOME):
    return next(p for p in state['planets'] if p['id'] == ident)


def whole_state(name, actual, expected):
    actual_raw = json.dumps(actual, ensure_ascii=False, sort_keys=True)
    expected_raw = json.dumps(expected, ensure_ascii=False, sort_keys=True)
    if actual != expected:
        atomic_json(out / (name + '-actual-state.json'), actual)
        atomic_json(out / (name + '-expected-state.json'), expected)
    check(name + ': complete serialized game matches independent existing-engine oracle', actual == expected,
          {'actualSha256': hashlib.sha256(actual_raw.encode()).hexdigest(),
           'expectedSha256': hashlib.sha256(expected_raw.encode()).hexdigest(),
           'scope': 'All game-state fields; no wallet, selection, IDs, timers or status fields removed or normalized'})


def wallet_delta(name, before, after, exact_ledger):
    check('legacy-wallet representation bound stays at the existing 1e-9 contract', fixtures['walletRepresentationBound'] == '0.000000001')
    for resource in RESOURCES:
        start, finish = planet(before)['resources'][resource], planet(after)['resources'][resource]
        delta = Decimal(start) - Decimal(finish)
        dust = delta - Decimal(exact_ledger[resource])
        row = {'case': case, 'stage': name, 'resource': resource, 'before': start, 'after': finish,
               'rawDecimalWalletDelta': str(delta), 'exactLedger': exact_ledger[resource],
               'signedRepresentationDust': str(dust), 'absoluteBound': '0.000000001',
               'classification': 'Legacy BigNumber wallet representation only; ledger, job price and whole-state oracle comparisons remain exact'}
        wallet_records.append(row)
        atomic_json(out / 'legacy-wallet-delta-report.json', wallet_records)
        check(name + ' ' + resource + ': raw wallet delta stays within documented representation bound of exact ledger', abs(dust) <= Decimal('0.000000001'), row)


def record(page, name):
    value = raw(page); path = out / (name + '.json'); path.write_text(value, encoding='utf-8')
    evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}); flush()


def snap(page, name, viewport=False):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    if not viewport:
        page.evaluate('scrollTo(0,0)')
    path = out / name
    page.screenshot(path=str(path), full_page=not viewport, timeout=7000)
    evidence.append({'case': case, 'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}); flush()


def quote_visibility(page, selectors):
    return page.evaluate('''selectors => ({viewport:{width:innerWidth,height:innerHeight},scrollY,targets:selectors.map(selector=>{
      const e=document.querySelector(selector),r=e.getBoundingClientRect(),style=getComputedStyle(e);
      const points=[[r.x+3,r.y+3],[r.right-3,r.y+3],[r.x+3,r.bottom-3],[r.right-3,r.bottom-3],[r.x+r.width/2,r.y+r.height/2]].map(([x,y])=>{
        const hit=document.elementFromPoint(x,y);return{x,y,unoccluded:!!hit&&(hit===e||e.contains(hit)),hit:hit?{tag:hit.tagName,id:hit.id}:null};});
      return{selector,text:e.innerText,rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
        visible:r.width>6&&r.height>6&&style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0,
        contained:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,disabled:!!e.disabled,points};})})''', selectors)


def scroll_native_to(page, selector):
    # Use actual browser wheel input, not DOM scrolling or hidden/layout changes.
    for _ in range(4):
        box = page.locator(selector).bounding_box()
        limits = page.evaluate('({height:innerHeight,width:innerWidth,top:Math.max(0,document.querySelector(".topbar")?.getBoundingClientRect().bottom||0)+12})')
        available = limits['height'] - limits['top'] - 12
        check('requested visible quote region fits below actual sticky header', box is not None and box['height'] <= available, {'selector': selector, 'box': box, 'limits': limits})
        if box['y'] >= limits['top'] and box['y'] + box['height'] <= limits['height'] - 12:
            return
        target_y = limits['top'] + (available - box['height']) / 2
        page.mouse.move(limits['width'] - 12, limits['height'] - 12)
        page.mouse.wheel(0, round(box['y'] - target_y)); page.wait_for_timeout(100); advance(page)
    raise AssertionError('Native wheel could not expose the complete quote region below the sticky header')


def visible_quote_screenshot(page, width):
    required = ['#order-quote-view', '#order-quote-fill', '#order-quote-status', '#order-quote-cost', '#order-quote-note']
    root = page.locator('#order-quote').bounding_box()
    available = page.evaluate('innerHeight-Math.max(0,document.querySelector(".topbar")?.getBoundingClientRect().bottom||0)-24')
    groups = [('#order-quote', ['#order-quote', *required], '')] if root and root['height'] <= available else [
        (selector, [selector], '-' + selector.removeprefix('#order-quote-')) for selector in required]
    for scroll_target, selectors, suffix in groups:
        scroll_native_to(page, scroll_target)
        before = quote_visibility(page, selectors)
        check(f'{width}px{suffix}: quote region is fully visible and center/four corners are unoccluded before screenshot',
              all(item['visible'] and item['contained'] and not item['disabled'] and all(point['unoccluded'] for point in item['points']) for item in before['targets']), before)
        snap(page, f'order-quotes-{width}{suffix}.png', viewport=True)
        after = quote_visibility(page, selectors)
        check(f'{width}px{suffix}: same complete unoccluded quote region remains after screenshot',
              after == before and all(point['unoccluded'] for item in after['targets'] for point in item['points']), after)
        path = out / f'order-quotes-{width}{suffix}-visibility.json'
        atomic_json(path, {'width': width, 'coverage': 'Entire quote region in one viewport' if len(groups) == 1 else 'Separate actual viewport for this quote element; entire quote region is taller than available viewport',
                           'before': before, 'after': after})
        evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}); flush()


def import_fixture(page, which='base'):
    fixture = copy.deepcopy(fixtures[which]); fixture['savedAt'] = fixture['lastTickAt'] = page.evaluate('Date.now()')
    tab(page, 'save'); path = out / f'native-import-{which}.json'
    path.write_text(json.dumps(fixture, ensure_ascii=False), encoding='utf-8')
    before, selections, dialogs = raw(page), page.evaluate('window.__quoteFiles.length'), []
    def confirm(dialog):
        valid = dialog.type == 'confirm' and dialog.message.startswith(f'已读取存档 v{fixture["version"]}/r{fixture["revision"]}。') and '是否替换当前进度' in dialog.message and '写入校验成功后才采用' in dialog.message
        dialogs.append({'valid': valid, 'message': dialog.message})
        dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', confirm)
    page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
    files = page.evaluate('window.__quoteFiles')
    check('real selected file and one fresh native confirmation authorize import', len(dialogs) == 1 and dialogs[0]['valid'] and len(files) == selections + 1 and files[-1] == {'trusted': True, 'name': path.name, 'size': path.stat().st_size, 'priorRaw': before})
    plans(page)
    check('native import adopts exact complete fixture state', read(page) == fixture['state'])


def rejected_conflict_import(page):
    """Exercise the real refusal; a conflict cannot be recovered by replacement."""
    fixture = copy.deepcopy(fixtures['base']); fixture['savedAt'] = fixture['lastTickAt'] = page.evaluate('Date.now()')
    tab(page, 'save'); path = out / 'rejected-conflict-import.json'
    path.write_text(json.dumps(fixture, ensure_ascii=False), encoding='utf-8')
    before, previous_raw = storage(page), raw(page)
    selections, dialogs = page.evaluate('window.__quoteFiles.length'), []
    def confirm(dialog):
        valid = dialog.type == 'confirm' and dialog.message.startswith(f'已读取存档 v{fixture["version"]}/r{fixture["revision"]}。') and '是否替换当前进度' in dialog.message and '写入校验成功后才采用' in dialog.message
        dialogs.append({'valid': valid, 'message': dialog.message})
        dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', confirm)
    page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败，当前进度未改动')
    expect(page.locator('[data-bind="status"]')).to_contain_text('其他标签页')
    files = page.evaluate('window.__quoteFiles')
    check('conflict refusal follows a real file read and one explicit native confirmation', len(dialogs) == 1 and dialogs[0]['valid'] and len(files) == selections + 1 and files[-1] == {'trusted': True, 'name': path.name, 'size': path.stat().st_size, 'priorRaw': previous_raw})
    check('rejected conflict replacement preserves every current, legacy and backup byte', storage(page) == before)
    plans(page)
    check('rejected replacement leaves the conflicting session visibly locked', page.locator('#order-quote-view').is_disabled() and fill_blocked(page))


def reload_verified(page):
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable')
    capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle')
    check('actual primary reload receives fresh HTTP 200', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); plans(page)


def timeout(_signal, _frame):
    raise TimeoutError('Local quote native acceptance exceeded its 170-second worker bound')


signal.signal(signal.SIGALRM, timeout); signal.alarm(170)
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        for kind, target, goal in CASES:
            case = kind + ': read-only exact quote, fixed payer, explicit fill and finite paid completion'
            context, page = boot()
            configure(page, kind, target, goal)
            check('all ordinary finite budgets still default to zero', caps(page) == dict.fromkeys(RESOURCES, '0'))
            baseline = save(page); before = storage(page)
            expected = fixtures['expectedQuotes']['base'][kind]
            quote(page, expected)
            check('view alone preserves all caps and native storage bytes', caps(page) == dict.fromkeys(RESOURCES, '0') and storage(page) == before)
            page.locator('#order-quote-fill').click()
            check('explicit fill has exact caps and no native storage write', caps(page) == expected and storage(page) == before)
            check('preview and fill preserve whole game state including wallet, queues and all IDs', save(page) == baseline)
            check('quote and fill ordinary clicks are trusted', page.evaluate('["order-quote-view","order-quote-fill"].every(id=>window.__quoteClicks.some(e=>e.id===id&&e.trusted))'))
            note = page.locator('#order-quote-note').inner_text()
            check('visible quote warns current estimate excludes fuel', '燃料' in note and ('不含' in note or '未包含' in note) and ('估算' in note or '估计' in note), note)
            select(page, '#planet-select', COLONY)
            check('top-planet navigation preserves independent fixed home payer and quote', page.locator('#order-planet').input_value() == HOME and not fill_blocked(page) and '合成报价付款母星' in page.locator('#order-quote-status').inner_text())
            baseline = save(page); page.locator('#order-create').click(); created = read(page)
            oracle = fixtures['execution'][kind]
            whole_state(kind + '-fixed-colony-view-baseline', baseline, oracle['baseline'])
            whole_state(kind + '-created', created, oracle['created'])
            check('existing Create alone makes exactly one unpaid local order', len(created['orders']['tasks']) == 1 and created['orders']['nextTaskId'] == 2 and created['orders']['nextJobId'] == baseline['orders']['nextJobId'] and created['planets'] == baseline['planets'])
            task = created['orders']['tasks'][0]
            check('created order retains fixed task ID, payer, exact finite caps and no transport', task['id'] == 1 and task['planetId'] == HOME and task['budget'] == expected and task['transport'] is None and task['charged'] == dict.fromkeys(RESOURCES, '0'))
            page.locator('#order-create').click(); quote(page, expected, fill=True); page.locator('#order-create').click()
            check('duplicate Create and identical explicit re-fill never renew consumed creation authority', read(page)['orders'] == created['orders'])
            advance(page, 10000); paid = save(page); task = paid['orders']['tasks'][0]
            whole_state(kind + '-paid', paid, oracle['paid'])
            queue = planet(paid)['buildQueue'] if kind == 'building' else paid['research']['queue'] if kind == 'research' else planet(paid)['shipyardQueue']
            expected_job_id = baseline['orders']['nextJobId']
            check('first paid identity is independently fixed after the one completed fixture batch', expected_job_id == 2)
            check('real scheduler allocates precisely one fresh job and receipt', len(queue) == 1 and task['activeJob'] == {'jobId': expected_job_id, 'quantity': goal if kind == 'shipyard' else 1, 'credited': 0} and paid['orders']['nextJobId'] == expected_job_id + 1)
            paid_job = queue[0]
            exact_payment = {resource: str(Decimal(paid_job['paidPerUnit'][resource]) * paid_job['orderedCount']) for resource in RESOURCES} if kind == 'shipyard' else paid_job['paid']
            check('first actual job price and charged entry equal independent fixed resource goldens', exact_payment == FIRST_PAYMENTS[kind] and task['charged'] == FIRST_PAYMENTS[kind] and task['refunded'] == dict.fromkeys(RESOURCES, '0'), {'independentGolden': FIRST_PAYMENTS[kind], 'actualPaid': exact_payment, 'charged': task['charged']})
            check('exact receipt belongs to matching real queue target, task and fixed payer', paid_job['jobId'] == expected_job_id and paid_job['taskId'] == task['id'] and paid_job['source'] == 'plan' and
                  paid_job['building' if kind == 'building' else 'tech' if kind == 'research' else 'unit'] == target and
                  (paid_job['planetId'] == HOME if kind == 'research' else True) and exact_payment == task['charged'], {'receipt': task['activeJob'], 'actualQueueJob': paid_job, 'exactPayment': exact_payment})
            wallet_delta(kind + '-paid', baseline, paid, {resource: str(Decimal(task['charged'][resource]) - Decimal(task['refunded'][resource])) for resource in RESOURCES})
            check('other planet complete wallet/queue/buildings/inventory stay unchanged', planet(paid, COLONY) == planet(baseline, COLONY))
            record(page, kind + '-paid')
            reload_verified(page)
            restored = save(page)
            whole_state(kind + '-reloaded-paid', restored, oracle['reloadedPaid'])
            restored_queue = planet(restored)['buildQueue'] if kind == 'building' else restored['research']['queue'] if kind == 'research' else planet(restored)['shipyardQueue']
            check('native reload retains exact real queue job, receipt and ledger', restored['orders'] == paid['orders'] and restored_queue == queue)
            advance(page, 180000); finished = save(page); task = finished['orders']['tasks'][0]
            whole_state(kind + '-finished', finished, oracle['finished'])
            actual = planet(finished)['buildings'][target] if kind == 'building' else finished['research']['levels'][target] if kind == 'research' else task['completedUnits']
            check('finite real work completes exact goal and consumes exact quote', task['status'] == 'completed' and task['activeJob'] is None and actual == goal and task['charged'] == expected and task['refunded'] == dict.fromkeys(RESOURCES, '0'))
            final_queue = planet(finished)['buildQueue'] if kind == 'building' else finished['research']['queue'] if kind == 'research' else planet(finished)['shipyardQueue']
            check('completed payment identity count is independently exact with no leftover job', not final_queue and finished['orders']['nextJobId'] == (3 if kind == 'shipyard' else 4))
            if kind == 'shipyard':
                check('ship plan means five additional ships despite seven existing ships', planet(baseline)['units'][target] == 7 and planet(finished)['units'][target] == 12)
            wallet_delta(kind + '-finished', baseline, finished, expected)
            advance(page, 60000)
            later = save(page); whole_state(kind + '-later', later, oracle['later'])
            check('completed order never creates or pays again', later['orders'] == finished['orders'])
            record(page, kind + '-completed'); context.close()

        case = 'explicit editable budget below quote remains a valid finite waiting order'
        context, page = boot(); configure(page); baseline = save(page)
        quote(page, fixtures['expectedQuotes']['base']['building'], fill=True)
        type_value(page, '#order-budget-metal', '100')
        check('native budget edit can deliberately lower quote without changing other caps', caps(page) == {'metal': '100', 'crystal': '55', 'deuterium': '0'})
        page.locator('#order-create').click(); created = read(page)
        whole_state('below-quote-created', created, fixtures['belowQuote']['created'])
        check('existing Create accepts the explicit below-quote budget without raising it', len(created['orders']['tasks']) == 1 and created['orders']['tasks'][0]['budget'] == caps(page))
        advance(page, 180000); waiting = save(page); task = waiting['orders']['tasks'][0]
        whole_state('below-quote-waiting', waiting, fixtures['belowQuote']['waiting'])
        check('real scheduler completes affordable first level then waits within finite cap', task['status'] == 'running' and task['targetLevel'] == 3 and planet(waiting)['buildings']['metal_mine'] == 2 and task['activeJob'] is None and task['charged'] == {'metal': '90', 'crystal': '22', 'deuterium': '0'} and '预算' in task['reason'], task)
        check('waiting order retains exact chosen budget and only one actual paid job', task['budget'] == {'metal': '100', 'crystal': '55', 'deuterium': '0'} and waiting['orders']['nextJobId'] == baseline['orders']['nextJobId'] + 1)
        wallet_delta('below-quote-waiting', baseline, waiting, task['charged'])
        advance(page, 60000)
        later = save(page); whole_state('below-quote-later', later, fixtures['belowQuote']['later'])
        check('waiting never raises cap or invents replacement work', later['orders'] == waiting['orders'])
        record(page, 'below-quote-waiting'); context.close()

        for kind, target, goal in CASES:
            case = kind + ': paid coverage remains owned by real manual jobs'
            context, page = boot('manual'); configure(page, kind, target, goal)
            baseline = save(page); before = storage(page)
            quote(page, fixtures['expectedQuotes']['manual'][kind], fill=True)
            check('quote/fill leave all manual paid jobs and IDs intact', storage(page) == before and save(page) == baseline)
            if kind != 'shipyard':
                summary = page.locator('#order-quote-status').inner_text()
                check('paid coverage is visibly distinguished from unpaid work', '已付款' in summary, summary)
                remember_fill(page); advance(page, 60000)
                reject_retained_fill(page, 'real paid-queue completion')
            else:
                check('existing inventory and already-paid ship batch do not reduce additional quantity quote', planet(baseline)['units'][target] == 7 and planet(baseline)['shipyardQueue'][0]['orderedCount'] == 3 and caps(page) == fixtures['expectedQuotes']['base'][kind])
            context.close()

        case = 'semantic draft A-to-B-to-A and transport retirement'
        context, page = boot(); configure(page); baseline = save(page)
        transitions = [('#order-target', 'crystal_mine', 'metal_mine'), ('#order-planet', COLONY, HOME), ('#order-kind', 'research', 'building')]
        for selector, away, back in transitions:
            quote(page, fixtures['expectedQuotes']['base']['building']); remember_fill(page)
            select(page, selector, away); select(page, selector, back)
            if selector == '#order-kind':
                select(page, '#order-target', 'metal_mine')
            reject_retained_fill(page, selector + ' A-to-B-to-A')
        quote(page, fixtures['expectedQuotes']['base']['building']); remember_fill(page)
        type_value(page, '#order-goal', '4'); type_value(page, '#order-goal', '3')
        reject_retained_fill(page, 'goal A-to-B-to-A')
        quote(page, fixtures['expectedQuotes']['base']['building']); remember_fill(page)
        page.locator('#order-transport-enabled').check()
        reject_retained_fill(page, 'transport enabled')
        page.locator('#order-quote-view').click()
        check('transport quote cannot offer a fill omitting unquoted fuel', fill_blocked(page) and '燃料' in page.locator('#order-quote-note').inner_text())
        page.locator('#order-transport-enabled').uncheck()
        reject_retained_fill(page, 'transport A-to-B-to-A')
        check('all draft retirement/replay checks preserve whole game state', save(page) == baseline)
        context.close()

        case = 'synthetic detached original fill cannot regain mounted quote authority'
        context, page = boot(); configure(page); baseline = save(page)
        quote(page, fixtures['expectedQuotes']['base']['building']); before, budget = storage(page), caps(page)
        page.evaluate('''() => {const b=document.querySelector('#order-quote-fill'),parent=b.parentNode;b.remove();parent.append(b);b.disabled=false;b.hidden=false;b.click();}''')
        check('same-turn original-node removal, reinsertion and synthetic click cannot fill or save', caps(page) == budget and storage(page) == before,
              {'classification': 'Deliberate synthetic DOM manipulation and untrusted click, not a native user action'})
        page.evaluate('''() => {const v=document.querySelector('#order-quote-view'),f=document.querySelector('#order-quote-fill');v.disabled=false;v.click();f.disabled=false;f.hidden=false;f.click();}''')
        check('damaged mount cannot silently acquire a new quote capability', caps(page) == budget and storage(page) == before and save(page) == baseline)
        context.close()

        case = 'synthetic replacement budget node cannot borrow the original quote'
        context, page = boot(); configure(page); baseline = save(page)
        quote(page, fixtures['expectedQuotes']['base']['building']); before = storage(page)
        page.evaluate('''() => {const original=document.querySelector('#order-budget-metal');window.__replacedQuoteCap=original;const replacement=original.cloneNode(true);replacement.value='7';original.replaceWith(replacement);const b=document.querySelector('#order-quote-fill');b.disabled=false;b.hidden=false;b.click();}''')
        check('replacement cap and detached original both remain untouched by synthetic fill', caps(page) == {'metal': '7', 'crystal': '0', 'deuterium': '0'} and page.evaluate('window.__replacedQuoteCap.value') == '0' and storage(page) == before,
              {'classification': 'Deliberate same-ID DOM input replacement and untrusted click, not a native user action'})
        check('replacing cap and replaying fill cannot change whole game state or paid IDs', save(page) == baseline)
        context.close()

        case = 'hidden paid-queue A-to-B-to-A through real enqueue and cancellation'
        context, page = boot(); configure(page); quote(page, fixtures['expectedQuotes']['base']['building']); remember_fill(page)
        baseline = save(page); tab(page, 'facilities')
        page.locator('[data-action="enqueue"][data-id="metal_mine"]').click()
        enqueued = read(page); job = planet(enqueued)['buildQueue'][0]
        whole_state('manual-queue-enqueued', enqueued, fixtures['queueAba']['enqueued'])
        check('ordinary building input created a fresh manual paid job', job['source'] == 'manual' and job['taskId'] is None and job['jobId'] == baseline['orders']['nextJobId'])
        page.locator(f'[data-action="cancel-queue"][data-paid-job="{job["jobId"]}"]:visible').first.click()
        restored = read(page); plans(page)
        whole_state('manual-queue-cancelled', restored, fixtures['queueAba']['cancelled'])
        check('real cancellation returns original price/level/paid-coverage context without reusing job ID', planet(restored)['buildings'] == planet(baseline)['buildings'] and planet(restored)['buildQueue'] == planet(baseline)['buildQueue'] and restored['orders']['nextJobId'] == baseline['orders']['nextJobId'] + 1)
        wallet_delta('manual-enqueue-cancel-roundtrip', baseline, restored, dict.fromkeys(RESOURCES, '0'))
        reject_retained_fill(page, 'hidden paid-queue A-to-B-to-A')
        quote(page, fixtures['expectedQuotes']['base']['building'], fill=True); context.close()

        case = 'hidden price-rule change retires the old quote'
        context, page = boot(); configure(page); quote(page, fixtures['expectedQuotes']['base']['building']); remember_fill(page)
        tab(page, 'curvature'); page.locator('[data-action="buy-tech"][data-id="growth_cut"]').click(); plans(page)
        check('ordinary curvature purchase really changes production price rule', read(page)['curvature']['growth_cut'] == 1)
        reject_retained_fill(page, 'current price rule changed')
        quote(page, fixtures['expectedQuotes']['curved']['building'], fill=True); context.close()

        case = 'confirmed same-ID world replacement never revives a quote'
        context, page = boot(); configure(page); quote(page, fixtures['expectedQuotes']['base']['building']); remember_fill(page)
        import_fixture(page); reject_retained_fill(page, 'same-ID file import')
        quote(page, fixtures['expectedQuotes']['base']['building'], fill=True)
        remember_fill(page); tab(page, 'curvature'); dialogs = []
        def prestige_confirm(dialog):
            valid = dialog.type == 'confirm' and '发射' in dialog.message
            dialogs.append({'valid': valid, 'message': dialog.message})
            dialog.accept() if valid else dialog.dismiss()
        page.once('dialog', prestige_confirm); page.locator('[data-action="prestige"]').click(); plans(page)
        check('real native confirmed prestige adopts one new round', len(dialogs) == 1 and dialogs[0]['valid'] and read(page)['stats']['launches'] == fixtures['base']['state']['stats']['launches'] + 1)
        reject_retained_fill(page, 'native confirmed curvature launch'); context.close()

        case = 'real second-tab conflict rejects replacement and recovers only on reload'
        context, page = boot(); configure(page); quote(page, fixtures['expectedQuotes']['base']['building']); remember_fill(page)
        tab(page, 'overview'); second = context.new_page(); attach(second)
        response = second.goto(args.url, wait_until='networkidle')
        check('competing writer is an actual same-origin HTTP page', response is not None and response.status == 200)
        verify_bundle(second); import_fixture(second, 'curved'); committed = raw(second)
        page.wait_for_function('window.__quoteStorageEvents.some(e=>e.trusted)')
        events = page.evaluate('window.__quoteStorageEvents')
        check('native trusted StorageEvent disables hidden quote controls immediately', any(event['trusted'] and event['disabled'] and event['newValue'] == committed for event in events), events)
        plans(page); reject_retained_fill(page, 'cross-tab protected session')
        check('forced protected quote fill preserves exact other-tab committed state', raw(page) == committed)
        rejected_conflict_import(page)
        check('failed in-place import cannot replace the actual writer result', raw(page) == committed)
        check('controlled primary reload has exactly zero offline gap', page.evaluate('Date.now()') == json.loads(committed)['lastTickAt'])
        before_close = storage(page); second.close()
        check('closing completed writer preserves all current, legacy and backup bytes', storage(page) == before_close)
        reload_verified(page)
        check('fresh page clock still equals committed last tick with no synthetic offline progress', page.evaluate('Date.now()') == json.loads(committed)['lastTickAt'])
        check('cold reload reads exact committed curved world with genuinely new controls', read(page) == json.loads(committed)['state'] and page.evaluate('typeof window.__retiredQuoteFill==="undefined"') and page.locator('#order-quote-view').is_enabled() and fill_blocked(page) and page.locator('#order-quote-cost').is_hidden() and caps(page) == dict.fromkeys(RESOURCES, '0'))
        configure(page); remember_fill(page)
        reject_retained_fill(page, 'freshly mounted controls have no inherited quote')
        quote(page, fixtures['expectedQuotes']['curved']['building'], fill=True)
        check('only fresh explicit quote/fill after cold reload changes caps and not game state', caps(page) == fixtures['expectedQuotes']['curved']['building'] and save(page) == json.loads(committed)['state'])
        context.close()

        case = 'native keyboard, focused draft identity and four real responsive screenshots'
        context, page = boot(); configure(page)
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 1100})
            for resource in RESOURCES:
                type_value(page, f'#order-budget-{resource}', '0')
            page.locator('#order-quote-view').focus(); page.keyboard.press('Enter')
            expect(page.locator('#order-quote-fill')).to_be_visible()
            page.locator('#order-quote-fill').focus(); page.keyboard.press('Space')
            check(f'{width}px: native keyboard can view and fill exact quote', caps(page) == fixtures['expectedQuotes']['base']['building'] and page.locator('#order-quote-fill').evaluate('(e)=>document.activeElement===e'))
            field = page.locator('#order-budget-metal')
            field.focus(); field.press('Home'); field.press('ArrowRight')
            page.evaluate('window.__quoteFocused=document.activeElement')
            caret = field.evaluate('(e)=>[e.selectionStart,e.selectionEnd]')
            for _ in range(3):
                advance(page, 1000)
            check(f'{width}px: frames preserve actual focused draft node and caret', field.evaluate('(e)=>e===window.__quoteFocused&&document.activeElement===e&&JSON.stringify([e.selectionStart,e.selectionEnd])===JSON.stringify(' + json.dumps(caret) + ')'))
            check(f'{width}px: no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
            visible_quote_screenshot(page, width)
        check('keyboard quote/fill never creates a task or allocates paid IDs', save(page)['orders'] == fixtures['base']['state']['orders'])
        context.close()
        case = 'suite integrity'
        check('no uncaught JavaScript errors or failed production requests', not errors and not failed_requests, {'errors': errors, 'failedRequests': failed_requests})
        completed = True; flush(); browser.close()
except BaseException as error:
    failure = {'case': case, 'error': repr(error), 'traceback': traceback.format_exc()}
    if active_page is not None:
        try:
            failure['rawSave'] = raw(active_page)
            failure['quote'] = active_page.locator('#order-quote').all_text_contents()
            failure['status'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure.png')
        except BaseException as capture_error:
            failure['captureError'] = repr(capture_error)
    flush()
    raise
finally:
    signal.alarm(0); flush()
