"""Terraformer native continuation on the exact HTTP production release.

Independent unchanged natural milestones are separate UI handoffs, never a claim
of continuous human play. Date/performance/RAF are explicit test simulations.
Storage, File.text, confirm, trusted clicks/keyboard/wheel remain native. Every
live/catchUp/reload world is checked in full against the production-engine oracle
AND literal independent payment/field goldens. Legacy/DM/protection faults are
labeled synthetic. Failures remain on disk; watchdog expiry is never a pass.

Checklist: pinned response+V8 bytes; natural ready -> pay -> paid cold reload ->
real completion -> no repeat; ordinary building; 1980 supply finite wait -> real
production change -> fixed-payer payment/cancel/rebuild; colony owner; curvature
retirement; four real viewport proofs; actual r9 continuous/10000 no-grant;
DM-zero failure; native cross-tab protection with enqueue/cancel/DM refusal.
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
parser.add_argument('--fixture', default='terraformer-review-save.json')
parser.add_argument('--natural-report', default='natural-terraformer-report.json')
parser.add_argument('--expected-report-sha256', required=True)
parser.add_argument('--release')
parser.add_argument('--output', default='terraformer-evidence')
parser.add_argument('--chromium')
parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha):
    parser.error('--expected-sha (or GITHUB_SHA) must pin the exact 40-character commit')
if not re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256):
    parser.error('--expected-report-sha256 must independently pin the complete natural report')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'terraformer-browser-report.json'
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
        deadline = time.monotonic() + 425
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
    raise ValueError('Acceptance requires actual HTTP(S) production URL')
ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
checks, errors, failed_requests, evidence, source_bindings = [], [], [], [], []
page_sources, release_metadata = {}, None
completed, active_page, source_sha, failure = False, None, None, None
case = 'setup'
CARD = '[data-bind="bld-terraformer"]'
PAY = '[data-action="enqueue"][data-id="terraformer"]'
QUEUE = '[data-bind="queue-list"]'
PAID_CONTROLS = [f'{QUEUE} [data-action="cancel-queue"]',
                 f'{QUEUE} [data-action="dm-speedup"][data-mode="halve"]',
                 f'{QUEUE} [data-action="dm-speedup"][data-mode="finish"]']
CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('terraformer-clock');
 const epoch=saved?Number(saved):__EPOCH__;let elapsed=0;
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=callback=>raf(()=>callback(elapsed));
 window.__terraAdvance=async ms=>{elapsed+=ms;sessionStorage.setItem('terraformer-clock',String(epoch+elapsed));await new Promise(raf);await new Promise(raf);};
 window.__terraNative=[Storage.prototype.getItem,Storage.prototype.setItem,File.prototype.text,window.confirm].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 window.__terraClicks=[];window.__terraEdits=[];window.__terraFiles=[];window.__terraWheels=[];window.__terraStorage=[];
 document.addEventListener('click',event=>{const b=event.target.closest?.('button');if(b)window.__terraClicks.push({action:b.dataset.action||b.dataset.orderAction||b.dataset.buildingTemplateAction||b.dataset.tab,id:b.dataset.id||b.id,trusted:event.isTrusted});},true);
 for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches?.('select,input'))window.__terraEdits.push({id:event.target.id,type,trusted:event.isTrusted,value:event.target.value});},true);
 document.addEventListener('wheel',event=>window.__terraWheels.push({trusted:event.isTrusted,deltaY:event.deltaY}),{capture:true,passive:true});
 document.addEventListener('change',event=>{if(event.target.matches?.('[data-bind="import-file"]'))window.__terraFiles.push({trusted:event.isTrusted,name:event.target.files[0]?.name,size:event.target.files[0]?.size,priorRaw:localStorage.getItem(__KEY__)});},true);
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&event.key===__KEY__)window.__terraStorage.push({trusted:event.isTrusted,oldValue:event.oldValue,newValue:event.newValue});});
})();'''.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY)).replace('__EPOCH__', str(EPOCH))


def flush():
    atomic_json(report_path, {'completed': completed, 'result': 'passed' if completed else 'incomplete',
        'case': case, 'url': args.url, 'sourceSha': source_sha, 'fixture': fixtures['description'],
        'fixtureSha256': hashlib.sha256(Path(args.fixture).read_bytes()).hexdigest(),
        'sourceReportSha256': fixtures['source']['reportSha256'],
        'classification': 'Separate unchanged natural milestone UI handoffs. Controlled test clock, not 5-hour continuous real-time human play. Explicit synthetic legacy/DM/protection cases remain separate.',
        'responsiveScope': 'At 320/390/768/1440: actual PAY and paid cancel/halve/finish nodes each have their own native-wheel viewport and five-point hit-test screenshot, in addition to card/queue outlines and trusted navigation clicks. Economic action scenarios execute at 1440; other-width economic execution is not claimed.',
        'timing': 'Date/performance/RAF simulated. <5 seconds uses real tick; >=5 seconds uses original catchUp. Native reload has zero controlled gap. Production is never frozen.',
        'oracle': 'Every serialized field, with no exclusions. Independently fixed resource/field/identity goldens supplement shared-engine differential expectations.',
        'boundsSeconds': {'worker': 420, 'supervisor': 425}, 'checks': checks,
        'passed': sum(value['passed'] for value in checks), 'errors': errors, 'failedRequests': failed_requests,
        'sourceBindings': source_bindings, 'evidence': evidence, 'failure': failure})


def check(name, condition, detail=None):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), **({'detail': detail} if detail is not None else {})})
    flush()
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__terraAdvance(ms)', milliseconds)


def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator(f'[data-tab="{name}"]').click(); advance(page)


def building_tab(page):
    tab(page, 'facilities'); expect(page.locator(CARD)).to_be_visible()


def raw(page):
    return page.evaluate('(key)=>localStorage.getItem(key)', KEY)


def storage(page):
    return page.evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))')


def read(page):
    return json.loads(raw(page))['state']


def save(page, expected=None):
    tab(page, 'save'); page.locator('[data-action="save"]').click(); result = read(page); building_tab(page)
    if expected:
        whole_state(expected, result, fixtures['expected'][expected])
    return result


def planet(state, ident=HOME):
    return next(value for value in state['planets'] if value['id'] == ident)


def used(state, ident=HOME):
    return sum(planet(state, ident)['buildings'].values())


def grants(state):
    return {p['id']: {'level': p['buildings']['terraformer'], 'fields': p['fieldsMax'], 'ledger': p['terraformerFields'], 'used': sum(p['buildings'].values())} for p in state['planets']}


def paid_golden(before, after, owner, level, source='manual'):
    a, b = planet(before, owner), planet(after, owner); job = b['buildQueue'][-1]
    expected = {'metal': '0', 'crystal': '50000' if level == 1 else '100000', 'deuterium': '100000' if level == 1 else '200000'}
    check('literal actual payment M0/C50000/D100000 or level2 double, exact wallet debit',
          job['paid'] == expected and all(Decimal(b['resources'][r]) == Decimal(a['resources'][r]) - Decimal(expected[r]) for r in RESOURCES), {'paid': job['paid'], 'before': a['resources'], 'after': b['resources']})
    check('payment issues one real qualified job identity without granting fields or levels',
          job['jobId'] == before['orders']['nextJobId'] and job['jobId'] >= after['terraformerGrantJobFloor'] and job['source'] == source and job['targetLevel'] == level and job['remainingSeconds'] > 0 and grants(before) == grants(after))
    return job


def grant_golden(before, after, owner):
    for ident, old in grants(before).items():
        new = grants(after)[ident]; delta = int(ident == owner)
        check('literal owner-only level+1 / total+5 / used+1 / free+4', new['level'] == old['level'] + delta and new['fields'] == old['fields'] + 5 * delta and new['used'] == old['used'] + delta and new['fields'] - new['used'] == old['fields'] - old['used'] + 4 * delta and new['ledger']['grantedLevels'] == old['ledger']['grantedLevels'] + delta and new['ledger']['base'] == old['ledger']['base'], {'planet': ident, 'before': old, 'after': new})


def trusted_click(page, selector):
    native_scroll_to(page, selector)
    before = page.evaluate('window.__terraClicks.length'); page.locator(selector).click(); advance(page)
    events = page.evaluate('(n)=>window.__terraClicks.slice(n)', before)
    check('actual user input produces exactly one trusted button click', len(events) == 1 and events[0]['trusted'], events)


def boot(seed=None, width=1440):
    global active_page
    values = [{'name': 'infinity.ui.tab', 'value': 'overview'}, {'name': 'infinity.save.v1', 'value': 'EXPLICIT LEGACY SENTINEL: retain unchanged'}]
    if seed is not None:
        seed = copy.deepcopy(seed); seed['savedAt'] = seed['lastTickAt'] = EPOCH
        values.append({'name': KEY, 'value': json.dumps(seed, ensure_ascii=False)})
    context = browser.new_context(viewport={'width': width, 'height': 1100}, reduced_motion='reduce', accept_downloads=True,
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': values}]})
    context.add_init_script(CLOCK); page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('production page is actual HTTP 200', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); check('Storage, File.text and confirm are unchanged native functions', page.evaluate('window.__terraNative'))
    building_tab(page)
    return context, page


def import_save(page, value, label):
    seed = copy.deepcopy(value); seed['savedAt'] = seed['lastTickAt'] = page.evaluate('Date.now()')
    path = out / f'native-import-{label}.json'; path.write_text(json.dumps(seed, ensure_ascii=False), encoding='utf-8')
    tab(page, 'save'); before, count, dialogs = raw(page), page.evaluate('window.__terraFiles.length'), []
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message.startswith(f'已读取存档 v{seed["version"]}/r{seed["revision"]}。') and '是否替换当前进度' in dialog.message and '写入校验成功后才采用' in dialog.message
        dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
    page.once('dialog', answer); page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
    files = page.evaluate('window.__terraFiles')
    check('native File selection/read followed by one explicit native confirmation', len(dialogs) == 1 and dialogs[0]['valid'] and len(files) == count + 1 and files[-1] == {'trusted': True, 'name': path.name, 'size': path.stat().st_size, 'priorRaw': before})
    evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'classification': label})
    building_tab(page)
    if seed['revision'] == 10:
        whole_state('import-' + label, read(page), seed['state'])


def handoff(page, key):
    import_save(page, fixtures['naturalMilestones'][key]['save'], 'unchanged-natural-' + key)


def responsive(page, label, selectors, widths=(320, 390, 768, 1440)):
    for width in widths:
        page.set_viewport_size({'width': width, 'height': 1100})
        count = page.evaluate('window.__terraClicks.length')
        page.locator('[data-tab="facilities"]').click(); advance(page)
        clicks = page.evaluate('(n)=>window.__terraClicks.slice(n)', count)
        check(f'{width}px real visible navigation click is trusted', len(clicks) == 1 and clicks[0]['trusted'] and clicks[0]['action'] == 'facilities', clicks)
        for index, selector in enumerate(selectors):
            page.mouse.move(width - 12, 1080); page.mouse.wheel(0, -100000); page.wait_for_timeout(80); advance(page)
            native_scroll_to(page, selector); before = visibility(page, [selector])
            check(f'{label} {width}px target {index}: actual whole region visible with five unoccluded hit-tests', all(item['visible'] and item['contained'] and all(point['unoccluded'] for point in item['points']) for item in before['targets']), before)
            if (label == 'new-payment-ready' and selector == PAY) or (label == 'new-paid-in-progress' and selector in PAID_CONTROLS):
                check(f'{label} {width}px actual economic control is enabled', all(not item['disabled'] for item in before['targets']), before)
            snap(page, f'{label}-{width}-{index}.png'); after = visibility(page, [selector])
            check('screenshot preserves exact visible unobscured target', after == before)
            path = out / f'{label}-{width}-{index}-visibility.json'; atomic_json(path, {'before': before, 'after': after})
            evidence.append({'case': case, 'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        check(f'{width}px no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    wheels = page.evaluate('window.__terraWheels')
    check('responsive proof includes trusted native wheel input', bool(wheels) and all(e['trusted'] for e in wheels) and any(e['deltaY'] > 0 for e in wheels))
    page.set_viewport_size({'width': 1440, 'height': 1100})


def visible_fields(page, state, owner):
    check('building completion counter agrees with the actual completed world', f"已完成建造 {state['stats']['buildsCompleted']} 次" in page.locator('[data-bind="passive"]').inner_text())
    check('building queue displays actual selected-owner field count', f"格子 {used(state, owner)}/{planet(state, owner)['fieldsMax']}" in page.locator('[data-bind="queue-summary"]').inner_text())
    tab(page, 'overview')
    check('overview displays same owner field count', page.locator('[data-bind="ov-fields"]').inner_text() == f"{used(state, owner)} / {planet(state, owner)['fieldsMax']}")
    tab(page, 'galaxy'); page.locator('[data-space="home"]').click(); advance(page); details = page.locator('#expansion-navigation')
    if not details.evaluate('(e)=>e.open'):
        page.locator('#expansion-navigation-summary').click(); advance(page)
    select(page, '#expansion-position', str(planet(state, owner)['coordinates']['position']))
    expect(page.locator('#expansion-properties')).to_contain_text(f"{planet(state, owner)['fieldsMax']} 格")
    check('read-only expansion view identifies stored owner fields', '已保存的行星属性' in page.locator('#expansion-properties').inner_text())
    building_tab(page)



def type_value(page, selector, value):
    field = page.locator(selector); before = page.evaluate('window.__terraEdits.length')
    native_scroll_to(page, selector)
    field.focus(); field.press('ControlOrMeta+A'); field.press('Backspace'); field.press_sequentially(str(value)); field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__terraEdits.slice(n)', before)
    check('native keyboard enters exact value through trusted input', field.input_value() == str(value) and any(e['trusted'] and e['type'] == 'input' and e['id'] == (field.get_attribute('id') or '') for e in events), events)


def template_plans(page):
    tab(page, 'orders')
    if not page.locator('#building-templates').evaluate('(e)=>e.open'):
        page.locator('#building-templates > summary').click(); advance(page)


def reviewed_template(page):
    return page.evaluate('''()=>({
      confirmSame:document.querySelector('#building-template-confirm-apply')===window.__terraTemplateConfirm,
      reviewVisible:!document.querySelector('#building-template-review-panel').hidden,
      enabled:!document.querySelector('#building-template-confirm-apply').disabled,
      condition:document.querySelector('[data-building-template-review-building="terraformer"] > p')?.innerText,
      prices:[...document.querySelectorAll('[data-building-template-review-building="terraformer"] > p')].slice(1).map(e=>e.innerText),
      budgets:[...document.querySelectorAll('[data-building-template-building="terraformer"] input')].map(e=>[e.dataset.buildingTemplateBudget,e.value]),
      payer:document.querySelector('#building-template-payer').value})''')


def one_seconds(page, count):
    for _ in range(count):
        advance(page, 1000)
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

def select(page, selector, value):
    field = page.locator(selector); before = field.input_value()
    index = field.evaluate('(e,value)=>[...e.options].findIndex(option=>option.value===value)', value)
    check(selector + ': requested native option exists', index >= 0)
    count = page.evaluate('window.__terraEdits.length'); field.focus(); field.press('Home')
    for _ in range(index):
        field.press('ArrowDown')
    field.press('Tab'); advance(page)
    events = page.evaluate('(n)=>window.__terraEdits.slice(n)', count)
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

def reload_verified(page):
    capture = page_sources[page]; capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle')
    check('native reload gets fresh actual HTTP 200', response is not None and response.status == 200 and response.url == args.url)
    verify_bundle(page); building_tab(page)


def timeout(_signal, _frame):
    raise TimeoutError('Terraformer native acceptance exceeded the 420-second worker bound')


signal.signal(signal.SIGALRM, timeout); signal.alarm(420)
try:
    source_bytes = Path(args.natural_report).read_bytes(); source_report = json.loads(source_bytes)
    check('complete natural report independently matches CLI and fixture hash', hashlib.sha256(source_bytes).hexdigest() == args.expected_report_sha256 == fixtures['source']['reportSha256'])
    check('natural engine report passed and declares the candidate SHA', source_report['outcome']['status'] == 'passed' and source_report['source']['sourceSha'] == args.expected_sha == fixtures['source']['sourceSha'] and source_report['provenance']['injectedGameState'] is False)
    check('formal native evidence rejects dirty or unreported production-source scope',
          source_report['source'].get('gitHead') == args.expected_sha and
          source_report['source'].get('sourceScopeStatusPorcelain') == '',
          {'gitHead': source_report['source'].get('gitHead'),
           'sourceScopeStatusPorcelain': source_report['source'].get('sourceScopeStatusPorcelain'),
           'worktreeStatusPorcelain': source_report['source'].get('worktreeStatusPorcelain'),
           'boundary': 'Require the explicitly recorded production-source scope to be clean. Preserve full worktree status, including generated evidence. Dirty or missing source-scope reports are local preparation only.'})
    for key, milestone in fixtures['naturalMilestones'].items():
        matches = [row for row in source_report['milestones'] if row['name'] == milestone['name']]
        check('entire named natural milestone is unchanged: ' + key, len(matches) == 1 and matches[0] == milestone and milestone['strictRoundtrips'] == 2 and milestone['stateAdoptedFromReload'] and milestone['subsequentLiveTickObserved'])
    (out / 'source-natural-terraformer-report.json').write_bytes(source_bytes)
    check('independent literal first/second payment and energy goldens', fixtures['golden']['first'] == {'metal': '0', 'crystal': '50000', 'deuterium': '100000'} and fixtures['golden']['second'] == {'metal': '0', 'crystal': '100000', 'deuterium': '200000'} and fixtures['golden']['firstEnergy'] == 1000 and fixtures['golden']['secondEnergy'] == 2000)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        case = 'natural ready milestone -> trusted payment -> live paid reload -> actual +5/net4 completion'
        context, page = boot(); handoff(page, 'ready'); baseline = save(page, 'firstBaseline')
        text = page.locator(CARD).inner_text()
        check('real card shows current supply / requirement and new paid +5/net4 terms', '供能 1.98e3' in text and '需要 1.00e3' in text and '+5' in text.replace(' ', '') and '+4' in text.replace(' ', ''), text)
        responsive(page, 'new-payment-ready', [CARD, '[data-bind="queue-summary"]', PAY])
        trusted_click(page, PAY); paid = save(page, 'firstPaid'); job = paid_golden(baseline, paid, HOME, 1)
        check('new paid queue explicitly describes +5 only on completion', '完成总格 +5' in page.locator(QUEUE).inner_text())
        responsive(page, 'new-paid-in-progress', [QUEUE, *PAID_CONTROLS])
        advance(page, 1000); inflight = save(page, 'firstOneSecond'); record(page, 'first-inflight-before-reload')
        check('native cold reload starts with the same real job genuinely unfinished', planet(inflight)['buildQueue'][0]['jobId'] == job['jobId'] and planet(inflight)['buildQueue'][0]['remainingSeconds'] > 0 and page.evaluate('Date.now()') == json.loads(raw(page))['lastTickAt'])
        reload_verified(page); save(page, 'firstReloadedPaid')
        advance(page, 1000); done = save(page, 'firstCompleted'); grant_golden(baseline, done, HOME); record(page, 'first-real-completion')
        visible_fields(page, done, HOME)
        reload_verified(page); save(page, 'firstReloadedCompleted'); advance(page, 1000); later = save(page, 'firstLater')
        check('reload and later tick never repeat completed grant or job', grants(later) == grants(done) and not planet(later)['buildQueue'] and later['orders']['nextJobId'] == done['orders']['nextJobId'])
        trusted_click(page, '[data-action="enqueue"][data-id="metal_storage"]'); save(page, 'ordinaryPaid')
        one_seconds(page, fixtures['execution']['ordinarySeconds']); ordinary = save(page, 'ordinaryCompleted')
        check('ordinary subsequent building occupies one field without another expansion grant', planet(ordinary)['fieldsMax'] == 168 and planet(ordinary)['terraformerFields']['grantedLevels'] == 1 and used(ordinary) == used(later) + 1)
        context.close()

        case = 'natural finite plan at actual 1980 supply -> native production change -> fixed-home payment and exact cancel'
        context, page = boot(); handoff(page, 'waiting'); waiting = save(page, 'waitingBaseline')
        check('second level visibly waits for 2000 actual supply', page.locator(PAY).is_disabled() and '供能' in page.locator(PAY).inner_text() and '2.00e3' in page.locator(CARD).inner_text())
        advance(page, 1000); save(page, 'waitingOneSecond')
        details = page.locator('.prod-settings')
        if not details.evaluate('(e)=>e.open'):
            details.locator('summary').click(); advance(page)
        select(page, '[data-prod="solar_plant"]', '100'); save(page, 'waitingRestoredSupply')
        select(page, '#planet-select', COLONY); save(page, 'waitingSelectedColony')
        one_seconds(page, fixtures['execution']['planSeconds']); plan_paid = save(page, 'planPaid')
        pjob = planet(plan_paid)['buildQueue'][0]
        check('actual finite payment belongs to fixed home while colony selected', plan_paid['activePlanetId'] == COLONY and pjob['jobId'] == fixtures['execution']['planJob'] and pjob['source'] == 'plan' and pjob['taskId'] == fixtures['execution']['taskId'] and pjob['paid'] == {'metal': '0', 'crystal': '100000', 'deuterium': '200000'} and grants(plan_paid) == grants(waiting))
        tab(page, 'orders'); trusted_click(page, f'[data-order-action="order-pause"][data-task-id="{pjob["taskId"]}"]'); save(page, 'planPaused')
        select(page, '#planet-select', HOME); before_cancel = save(page, 'planSelectedHome')
        trusted_click(page, f'{QUEUE} [data-action="cancel-queue"][data-paid-job="{pjob["jobId"]}"]'); refunded = save(page, 'planRefunded')
        check('real cancellation refunds exactly actual paid only to home and gives no fields', grants(refunded) == grants(before_cancel) and all(Decimal(planet(refunded, ident)['resources'][r]) == Decimal(planet(before_cancel, ident)['resources'][r]) + (Decimal(pjob['paid'][r]) if ident == HOME else 0) for ident in (HOME, COLONY) for r in RESOURCES))
        task = next(t for t in refunded['orders']['tasks'] if t['id'] == pjob['taskId'])
        check('plan retains exact charged/refunded financial history', task['charged'] == task['refunded'] == pjob['paid'] and task['activeJob'] is None)
        tab(page, 'orders'); trusted_click(page, f'[data-order-action="order-cancel"][data-task-id="{pjob["taskId"]}"]'); before_second = save(page, 'planCancelled')
        trusted_click(page, PAY); second = save(page, 'secondPaid'); paid_golden(before_second, second, HOME, 2)
        select(page, '#planet-select', COLONY); save(page, 'secondSelectedColony'); one_seconds(page, 4)
        second_done = save(page, 'secondCompleted'); grant_golden(before_second, second_done, HOME); context.close()

        case = 'unchanged real colony milestone -> trusted local payment -> home selection keeps grant on colony'
        context, page = boot(); handoff(page, 'colony'); colony = save(page, 'colonyBaseline')
        trusted_click(page, PAY); colony_paid = save(page, 'colonyPaid'); paid_golden(colony, colony_paid, COLONY, 1)
        select(page, '#planet-select', HOME); save(page, 'colonySelectedHome'); one_seconds(page, 2)
        colony_done = save(page, 'colonyCompleted'); grant_golden(colony, colony_done, COLONY)
        reload_verified(page); save(page, 'colonyReloaded'); context.close()

        case = 'unchanged naturally earned curvature milestone -> native confirm -> old-world authority retirement'
        context, page = boot(); handoff(page, 'curvature'); before_reset = save(page, 'curvatureBaseline')
        task_id = fixtures['execution']['retiredTaskId']; tab(page, 'orders')
        page.evaluate('(id)=>window.__terraRetiredResume=document.querySelector(`[data-order-action="order-resume"][data-task-id="${id}"]`)', task_id)
        tab(page, 'curvature'); expect(page.locator('#prestige-preview')).to_be_visible()
        check('real curvature preview reports same earned gain and two-world loss', page.locator('#prestige-preview').get_attribute('data-gain') == fixtures['execution']['preview']['gain'] and fixtures['execution']['preview']['worlds']['count'] == len(before_reset['planets']) == 2)
        dialogs = []
        def confirm_curvature(dialog):
            valid = dialog.type == 'confirm' and dialog.message == fixtures['execution']['confirmation']; dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
        page.once('dialog', confirm_curvature); trusted_click(page, '[data-action="prestige"]')
        check('one native fresh curvature confirmation exactly matches loss model', len(dialogs) == 1 and dialogs[0]['valid'])
        reset = save(page, 'curvatureReset')
        check('new world is exactly home163/terra0/grant0 with retired paid-ID boundary', len(reset['planets']) == 1 and planet(reset)['fieldsMax'] == planet(reset)['terraformerFields']['base'] == 163 and planet(reset)['buildings']['terraformer'] == planet(reset)['terraformerFields']['grantedLevels'] == 0 and reset['terraformerGrantJobFloor'] == before_reset['orders']['nextJobId'])
        tab(page, 'orders'); before_replay = storage(page)
        page.evaluate('()=>{const b=window.__terraRetiredResume;b.disabled=false;b.click();}')
        advance(page); check('explicit synthetic old resume-node replay cannot revive retired authority', storage(page) == before_replay)
        save(page, 'curvatureReset'); advance(page, 1000); save(page, 'curvatureLater'); context.close()


        case = 'natural cancelled-level2 milestone -> real template review refresh without repricing or new authority'
        context, page = boot(); handoff(page, 'template'); save(page, 'templateBaseline')
        select(page, '#planet-select', HOME); before_template = save(page, 'templateSelectedHome')
        template_plans(page); trusted_click(page, '#building-template-new')
        type_value(page, '#building-template-name', fixtures['execution']['templateName'])
        select(page, '#building-template-goals .building-template-goal select', 'terraformer')
        type_value(page, '#building-template-goals .building-template-goal input', '2')
        trusted_click(page, '#building-template-save')
        created_template = read(page); whole_state('templateCreated', created_template, fixtures['expected']['templateCreated'])
        template_id = fixtures['execution']['templateId']
        trusted_click(page, f'#building-template-library button[data-building-template-action="select"][data-building-template-id="{template_id}"]')
        select(page, '#building-template-payer', HOME)
        trusted_click(page, '#building-template-fill-quotes'); trusted_click(page, '#building-template-review')
        page.evaluate('()=>window.__terraTemplateConfirm=document.querySelector("#building-template-confirm-apply")')
        review = reviewed_template(page)
        check('explicit native review has literal M0/C100000/D200000 budget and fixed home payer', review['reviewVisible'] and review['enabled'] and review['payer'] == HOME and dict(review['budgets']) == {'metal': '0', 'crystal': '100000', 'deuterium': '200000'} and '真实未付总报价：金属 0 / 晶体 100000 / 重氢 200000' in review['prices'][0] and '能源不足' not in review['condition'], review)
        for pct, oracle, needs_energy in [('0', 'templateSolarOff', True), ('100', 'templateSolarRestored', False)]:
            building_tab(page)
            if not page.locator('.prod-settings').evaluate('(e)=>e.open'):
                page.locator('.prod-settings > summary').click(); advance(page)
            select(page, '[data-prod="solar_plant"]', pct)
            whole_state(oracle, read(page), fixtures['expected'][oracle])
            template_plans(page); latest = reviewed_template(page)
            check('real energy change refreshes retained review warning without changing quote, budgets, payer or confirm identity', latest['confirmSame'] and latest['reviewVisible'] and latest['enabled'] and latest['prices'] == review['prices'] and latest['budgets'] == review['budgets'] and latest['payer'] == HOME and ('能源不足' in latest['condition']) == needs_energy and (not needs_energy or '1980 / 需要 2000' in latest['condition']), latest)
            native_scroll_to(page, '#building-template-review-panel'); snap(page, f'natural-template-review-solar-{pct}.png')
            current = read(page)
            check('viewing/reviewing/solar change never creates a job or task, debits a wallet or grants fields', current['orders'] == before_template['orders'] and grants(current) == grants(before_template) and all(planet(current, owner)['resources'] == planet(before_template, owner)['resources'] for owner in (HOME, COLONY)))
        whole_state('template-energy-roundtrip-full-state', read(page), created_template); context.close()

        case = 'explicit debit-only DM-zero failure, separate from unchanged natural route'
        context, page = boot(fixtures['dmFault']); failed_before = save(page, 'dmFailure')
        dm = f'{QUEUE} [data-action="dm-speedup"][data-mode="finish"]'
        check('insufficient DM visibly disables completion', page.locator(dm).is_disabled())
        page.evaluate('(selector)=>{const b=document.querySelector(selector);b.disabled=false;b.click();}', dm); advance(page)
        check('explicit synthetic enabled-node DM probe reports insufficient DM', '暗物质不足' in page.locator('[data-bind="status"]').inner_text())
        failed_after = save(page, 'dmFailure'); whole_state('DM-failure-no-debit-no-grant', failed_after, failed_before); context.close()

        for name, legacy in fixtures['legacy']['cases'].items():
            case = 'explicit synthetic historical native r9 migration and old paid completion: ' + name
            row = legacy['row']; original = row['raw']
            check('historical native raw is independently hash-bound and canonical', hashlib.sha256(original.encode()).hexdigest() == row['rawSha256'] and json.loads(original) == row['oldReaderOutput'] and fixtures['legacy']['sourceSha'] == 'f96894eb1b32737ab403890ed83fdb3da41a0644')
            (out / f'original-r9-{name}.json').write_text(original, encoding='utf-8')
            context, page = boot(); import_save(page, json.loads(original), 'synthetic-actual-r9-' + name)
            migrated = save(page, f'legacy-{name}-migrated')
            check('r9 migration grants zero and sets actual old nextJobId floor', migrated['terraformerGrantJobFloor'] == row['oldReaderOutput']['state']['orders']['nextJobId'] and all(p['terraformerFields'] == {'base': p['fieldsMax'], 'grantedLevels': 0} for p in migrated['planets']))
            check('old paid queue states completion does not add fields', '旧版已付：完成升级，不增加格数' in page.locator(QUEUE).inner_text())
            if name == 'full10000_plan':
                check('10000 fields displayed before old paid completion', '/10000' in page.locator('[data-bind="queue-summary"]').inner_text())
                responsive(page, 'old-paid-10000', [QUEUE, '[data-bind="queue-summary"]', *PAID_CONTROLS])
            reload_verified(page); save(page, f'legacy-{name}-migrated')
            one_seconds(page, legacy['firstSeconds']); first_old = save(page, f'legacy-{name}-firstCompleted')
            check('old actual first completion raises level3 but never grants', planet(first_old)['buildings']['terraformer'] == 3 and planet(first_old)['fieldsMax'] == planet(migrated)['fieldsMax'] and planet(first_old)['terraformerFields']['grantedLevels'] == 0)
            one_seconds(page, legacy['remainingSeconds']); old_done = save(page, f'legacy-{name}-completed')
            check('continuous old paid queue fully completes unchanged original target semantics and zero reward', not planet(old_done)['buildQueue'] and planet(old_done)['buildings']['terraformer'] == (4 if name == 'continuous_manual' else 3) and planet(old_done)['fieldsMax'] == (10000 if name == 'full10000_plan' else 163) and planet(old_done)['terraformerFields']['grantedLevels'] == 0)
            reload_verified(page); save(page, f'legacy-{name}-completed'); context.close()

        case = 'explicit native second-tab conflict freezes enqueue, paid cancel and DM without debit or grant'
        context, page = boot(); handoff(page, 'ready'); trusted_click(page, PAY); protected_before = save(page, 'firstPaid')
        prior_raw = raw(page)
        selectors = [PAY, f'{QUEUE} [data-action="cancel-queue"]', f'{QUEUE} [data-action="dm-speedup"][data-mode="finish"]']
        page.evaluate('(selectors)=>window.__terraProtectedButtons=selectors.map(s=>document.querySelector(s))', selectors)
        frozen = page.locator('[data-bind="queue-summary"]').inner_text()
        other = context.new_page(); other.goto(urljoin(args.url, 'release.json'), wait_until='domcontentloaded')
        competing = copy.deepcopy(json.loads(prior_raw)); del competing['state']['planets'][0]['terraformerFields']
        competing_raw = json.dumps(competing, ensure_ascii=False)
        other.evaluate('([key,raw])=>localStorage.setItem(key,raw)', [KEY, competing_raw])
        expect(page.locator('[data-bind="notice"]')).to_contain_text('其他标签页'); advance(page)
        events = page.evaluate('window.__terraStorage')
        check('actual trusted cross-tab StorageEvent observes competing native bytes', any(e['trusted'] and e['oldValue'] == prior_raw and e['newValue'] == competing_raw for e in events))
        before_replay = storage(page)
        page.evaluate('()=>{for(const b of window.__terraProtectedButtons){b.disabled=false;b.click();}}'); advance(page, 2000)
        check('synthetic retained enqueue/cancel/DM replay under real protection cannot write or finish', storage(page) == before_replay and page.locator('[data-bind="queue-summary"]').inner_text() == frozen and page.locator('[data-bind="level-terraformer"]').inner_text().startswith('0'))
        tab(page, 'save')
        with page.expect_download() as pending:
            page.locator('[data-action="export"]').click()
        export_path = out / 'protected-original-paid-world.json'; pending.value.save_as(str(export_path))
        check('protection exports exact cached pre-conflict paid original, not granted fallback', export_path.read_text() == prior_raw)
        whole_state('protected-original-has-no-debit-or-grant', json.loads(export_path.read_text())['state'], protected_before)
        check('competing current bytes remain untouched', raw(page) == competing_raw)
        other.close(); context.close()
        case = 'suite integrity'
        check('no uncaught JavaScript errors or failed production requests', not errors and not failed_requests, {'errors': errors, 'failedRequests': failed_requests})
        check('version and current strict save release were verified', release_metadata['version'] == '0.6.16-alpha.1' and release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 10)
        completed = True; flush(); browser.close()
except BaseException as error:
    failure = {'case': case, 'error': repr(error), 'traceback': traceback.format_exc()}
    if active_page is not None:
        try:
            failure['rawSave'] = raw(active_page)
            failure['card'] = active_page.locator(CARD).all_text_contents()
            failure['queue'] = active_page.locator(QUEUE).all_text_contents()
            failure['status'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure.png')
        except BaseException as capture_error:
            failure['captureError'] = repr(capture_error)
    flush(); raise
finally:
    signal.alarm(0); flush()
