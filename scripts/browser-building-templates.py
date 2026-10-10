"""Bounded building-intent acceptance against the real HTTP bundle and native Storage.

Anonymous pre-funded fixtures; explicit synthetic Date/performance/RAF progression.
Normal CRUD/review/apply uses trusted browser inputs. Adversarial replay is labeled
synthetic. No memory Storage, inline bundle or application-state injection; no
natural-play, native-background, mobile-device or multi-hour timing claim.
"""
import argparse
import copy
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from decimal import Decimal
from pathlib import Path
from urllib.parse import urljoin, urlparse
from playwright.sync_api import sync_playwright, expect


def atomic_json(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='building-templates-review-save.json')
parser.add_argument('--output', default='building-templates-evidence')
parser.add_argument('--chromium')
parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
if not args.worker:
    # Linux CI supervisor: own only this worker and verified descendants, including
    # Chromium processes that move into separate process groups. Never pkill by name.
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    report_path = out / 'building-templates-browser-report.json'
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

    def terminate_owned(process, sig):
        for pid, birth in reversed(list(owned.items())):
            if identity(pid) == birth:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        # Guard the group fallback against PID reuse after the worker exits.
        if identity(process.pid) == owned.get(process.pid) and process.pid in owned:
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass

    expired, code = False, 1
    with (out / 'worker.log').open('w') as log:
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
            collect(process.pid)
            terminate_owned(process, signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            time.sleep(.1)
            terminate_owned(process, signal.SIGKILL)
            process.wait(timeout=2)
    result = json.loads(report_path.read_text())
    if expired:
        result.update(completed=False, result='external watchdog timeout', timeoutSeconds=175)
        code = 1
    result['workerExitCode'] = code
    result['processCleanup'] = 'Bounded worker session and PID/start-time-verified descendants terminated; unrelated processes untouched.'
    atomic_json(report_path, result)
    print(json.dumps({'completed': result.get('completed', False), 'passed': result.get('passed', 0),
                      'case': result.get('case'), 'workerExitCode': code, 'report': str(report_path)}, ensure_ascii=False))
    sys.exit(code if code else (0 if result.get('completed') else 1))
fixtures = json.loads(Path(args.fixture).read_text())
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
RESOURCES = ('metal', 'crystal', 'deuterium')
GOALS = (('metal_mine', 3), ('crystal_mine', 2), ('solar_plant', 3))
PREFIX = '#building-template-'
MODE = 'HTTP / native localStorage / synthetic pre-funded fixture and controlled simulation timestamps'
EPOCH = int(time.time() * 1000)
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests, evidence = [], [], [], []
completed, active_page, last_saved, diagnostics = False, None, None, None
case, source_sha = 'setup', None
CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const raf=window.requestAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('building-template-clock');
 const epoch=saved ? Number(saved) : __EPOCH__;
 let elapsed=0; Date.now=()=>epoch+elapsed;
 Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=callback=>raf(()=>callback(elapsed));
 window.__buildingAdvance=async ms=>{
  elapsed+=ms;sessionStorage.setItem('building-template-clock',String(epoch+elapsed));
  await new Promise(raf);await new Promise(raf);
 };
 window.__buildingNativeStorage=localStorage instanceof Storage &&
  [Storage.prototype.getItem,Storage.prototype.setItem].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 window.__buildingClicks=[];window.__buildingStorageEvents=[];window.__buildingFileSelections=[];
 window.__buildingNativeFileAndConfirm=[File.prototype.text,window.confirm].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn)));
 document.addEventListener('change',event=>{if(event.target.matches?.('[data-bind="import-file"]'))window.__buildingFileSelections.push({trusted:event.isTrusted,name:event.target.files[0]?.name,size:event.target.files[0]?.size,priorRaw:localStorage.getItem(__KEY__)});},true);
 document.addEventListener('click',event=>{
  const b=event.target.closest?.('#building-templates button');
  if(b)window.__buildingClicks.push({id:b.id,action:b.dataset.buildingTemplateAction,trusted:event.isTrusted});
 },true);
 // Registered by the harness only after the application's storage listener exists.
 window.__watchBuildingStorage=()=>window.addEventListener('storage',event=>{
  if(event.storageArea!==localStorage || event.key!==__KEY__)return;
  // Observe immediately after all storage handlers, before a later animation paint.
  queueMicrotask(()=>window.__buildingStorageEvents.push({trusted:event.isTrusted,
   allDisabled:[...document.querySelectorAll('#building-templates button,#building-templates input,#building-templates select')].every(e=>e.disabled),
   folded:!document.querySelector('#building-templates')?.open,
   ordersHidden:document.querySelector('#space-orders')?.hidden}));
 });
})();'''.replace('__EPOCH__', str(EPOCH)).replace('__KEY__', json.dumps(KEY)).replace('__ORIGIN__', json.dumps(f'{urlparse(args.url).scheme}://{urlparse(args.url).netloc}'))


def check(name, condition, detail=None):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), 'classification': MODE,
                   **({'detail': detail} if detail is not None else {})})
    # Retain completed assertions even if the outer watchdog must kill a stuck browser.
    atomic_json(out / 'building-templates-browser-report.json', {
        'completed': False, 'case': case, 'mode': MODE, 'checks': checks,
        'passed': sum(value['passed'] for value in checks), 'errors': errors,
        'sourceSha': source_sha, 'savedEvidence': evidence})
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__buildingAdvance(ms)', milliseconds)


def dismiss_offline(page):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()


def plans(page, expand=True):
    dismiss_offline(page)
    page.locator('[data-tab="orders"]').click(); advance(page)
    expect(page.locator('#space-orders')).to_be_visible()
    if expand and not page.locator('#building-templates').evaluate('(e)=>e.open'):
        page.locator('#building-templates > summary').click(); advance(page)


def raw(page):
    return page.evaluate('(key)=>localStorage.getItem(key)', KEY)


def read(page):
    global last_saved
    last_saved = json.loads(raw(page))['state']
    return last_saved


def save(page):
    dismiss_offline(page)
    page.locator('[data-tab="save"]').click(); page.locator('[data-action="save"]').click()
    result = read(page); plans(page)
    return result


def boot(which='seeded', corrupt=False):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Acceptance requires a real HTTP(S) production URL')
    fixture = copy.deepcopy(fixtures[which]); fixture['savedAt'] = fixture['lastTickAt'] = EPOCH
    if corrupt:
        fixture['state']['buildingTemplates']['nextTemplateId'] = 0
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': f'{parsed.scheme}://{parsed.netloc}', 'localStorage': [
            {'name': KEY, 'value': json.dumps(fixture, ensure_ascii=False)},
            {'name': 'infinity.ui.tab', 'value': 'overview'}]}]})
    context.add_init_script(CLOCK)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('actual HTTP production response', response is not None and response.status == 200)
    check('native Storage, File.text and confirm remain untouched', page.evaluate('window.__buildingNativeStorage && window.__buildingNativeFileAndConfirm'))
    page.evaluate('window.__watchBuildingStorage()')
    plans(page, expand=False)
    check('new building area starts folded', not page.locator('#building-templates').evaluate('(e)=>e.open'))
    plans(page)
    return context, page


def attach(page):
    page.set_default_timeout(8000); page.set_default_navigation_timeout(15000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))


def row_action(page, action, ident=1):
    page.locator(f'{PREFIX}library article[data-building-template-id="{ident}"] button[data-building-template-action="{action}"]').click()


def create(page, name='原生经济工位', goals=GOALS):
    page.locator(PREFIX + 'new').click(); page.locator(PREFIX + 'name').fill(name)
    for index, (building, target) in enumerate(goals):
        if index:
            page.locator(PREFIX + 'add-goal').click()
        row = page.locator(PREFIX + 'goals .building-template-goal').nth(index)
        row.locator('select').select_option(building); row.locator('input').fill(str(target))
    page.locator(PREFIX + 'save').click()
    return read(page)


def select(page, payer=COLONY):
    row_action(page, 'select'); page.locator(PREFIX + 'payer').select_option(payer)


def budget(page, building, resource):
    return page.locator(f'[data-building-template-building="{building}"] [data-building-template-budget="{resource}"]')


def review(page, fill=True):
    if fill:
        page.locator(PREFIX + 'fill-quotes').click()
    page.locator(PREFIX + 'review').click()


def apply(page):
    page.locator(PREFIX + 'review-panel ' + PREFIX + 'confirm-apply').click()
    return read(page)


def planet(state, ident=COLONY):
    return next(value for value in state['planets'] if value['id'] == ident)


def economic(state):
    return {key: state[key] for key in ('planets', 'orders', 'research', 'fleets', 'nextFleetId', 'totalTime')}


def import_fixture(page, which='seeded'):
    fixture = copy.deepcopy(fixtures[which]); fixture['savedAt'] = fixture['lastTickAt'] = page.evaluate('Date.now()')
    dismiss_offline(page); page.locator('[data-tab="save"]').click()
    path = out / f'native-import-{which}.json'; path.write_text(json.dumps(fixture, ensure_ascii=False))
    before = raw(page); selections = page.evaluate('window.__buildingFileSelections.length')
    confirmations = []
    def confirm(dialog):
        valid = 'v9/r9' in dialog.message and '是否替换当前进度' in dialog.message
        confirmations.append({'message': dialog.message, 'valid': valid})
        if valid:
            dialog.accept()
        else:
            dialog.dismiss()
    page.once('dialog', confirm)
    page.locator('[data-bind="import-file"]').set_input_files(str(path.resolve()))
    expect(page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
    selected = page.evaluate('window.__buildingFileSelections')
    check('real on-disk file uses one fresh native confirmation', len(confirmations) == 1 and confirmations[0]['valid'])
    check('file selection witness binds exact fixture and previous native bytes', len(selected) == selections + 1 and selected[-1]['trusted'] and selected[-1]['name'] == path.name and selected[-1]['size'] == path.stat().st_size and selected[-1]['priorRaw'] == before)
    plans(page)
    return read(page)


def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    page.evaluate('scrollTo(0,0)')
    page.screenshot(path=str(out / name), full_page=True)


def record_save(page, name):
    value = raw(page); filename = name + '.json'; (out / filename).write_text(value)
    evidence.append({'case': case, 'file': filename, 'sha256': hashlib.sha256(value.encode()).hexdigest(), 'bytes': len(value.encode())})


def timeout(_signal, _frame):
    raise TimeoutError('Building browser acceptance exceeded its 170-second work bound (180-second external supervisor)')


signal.signal(signal.SIGALRM, timeout); signal.alarm(170)
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        case = 'native empty-colony intent, exact budgets and finite actual scheduler'
        context, page = boot('base')
        release = page.request.get(urljoin(args.url, 'release.json'))
        check('production release metadata exists', release.ok)
        source_sha = release.json().get('sourceSha')
        if args.expected_sha:
            check('production release matches tested commit', source_sha == args.expected_sha, source_sha)
        baseline = save(page)
        check('real synthetic colony begins with every building at zero', all(value == 0 for value in planet(baseline)['buildings'].values()))
        created = create(page)
        check('trusted controls save three absolute goals', created['buildingTemplates']['templates'][0]['goals'] == [dict(building=b, targetLevel=n) for b, n in GOALS] and page.evaluate('window.__buildingClicks.some(e=>e.action==="save" && e.trusted)'))
        check('intent save has no economic effects', economic(created) == economic(baseline))
        page.reload(wait_until='networkidle'); plans(page)
        check('native reload preserves exact intent library', read(page)['buildingTemplates'] == created['buildingTemplates'])
        select(page)
        check('nine independent budget inputs begin at zero', page.locator(PREFIX + 'budgets input').evaluate_all('(xs)=>xs.length===9 && xs.every(x=>x.value==="0")'))
        page.locator('#planet-select').select_option(COLONY); page.locator('#planet-select').select_option(HOME)
        check('global navigation cannot change explicitly fixed colony', page.locator(PREFIX + 'payer').input_value() == COLONY)
        before_review = raw(page); review(page)
        check('fill and review leave exact native save bytes unchanged', raw(page) == before_review)
        for building, money in fixtures['expectedQuotes'].items():
            check(f'{building}: independent real level quote', all(budget(page, building, r).input_value() == money[r] for r in RESOURCES))
        summary = page.locator(PREFIX + 'review-summary').inner_text()
        check('review identifies colony, three tasks and exact 764/274/0 total', all(text in summary for text in ('合成空白建筑殖民地', '新增 3 个', '金属 764 / 晶体 274 / 重氢 0')))
        snap(page, 'economic-review.png')
        page.evaluate('window.__usedApply=document.querySelector("#building-template-confirm-apply")')
        authorized = apply(page)
        page.evaluate('window.__usedApply.click()')
        check('apply and synthetic double-confirm create exactly three tasks once', len(read(page)['orders']['tasks']) == 3 and read(page)['orders']['nextTaskId'] == 4)
        check('application is unpaid and fixes each local goal and budget', all(t['kind'] == 'building' and t['planetId'] == COLONY and t['transport'] is None and t['charged'] == dict.fromkeys(RESOURCES, '0') and t['budget'] == fixtures['expectedQuotes'][t['building']] for t in authorized['orders']['tasks']))
        check('application changes no wallet or paid queue', authorized['planets'] == baseline['planets'])
        check('normal review and apply were trusted browser clicks', page.evaluate('''() => ['review','apply'].every(action=>window.__buildingClicks.some(e=>e.action===action && e.trusted))'''))
        original_orders = copy.deepcopy(authorized['orders'])
        row_action(page, 'edit'); page.locator(PREFIX + 'name').fill('只影响未来的经济工位')
        page.locator(PREFIX + 'goals .building-template-goal input').first.fill('5'); page.locator(PREFIX + 'save').click()
        check('editing revision preserves exact original orders', read(page)['buildingTemplates']['templates'][0]['revision'] == 2 and read(page)['orders'] == original_orders)
        row_action(page, 'delete'); expect(page.locator(PREFIX + 'delete-dialog')).to_contain_text('已创建计划继续执行')
        page.locator(PREFIX + 'confirm-delete').click()
        check('deletion preserves exact original orders', not read(page)['buildingTemplates']['templates'] and read(page)['orders'] == original_orders)
        advance(page, 10000); paid = save(page)
        check('ordinary ten-second scheduler produces real paid work', bool(planet(paid)['buildQueue']) and any(any(Decimal(v) > 0 for v in t['charged'].values()) for t in paid['orders']['tasks']))
        for resource in RESOURCES:
            debit = sum(Decimal(t['charged'][resource]) - Decimal(t['refunded'][resource]) for t in paid['orders']['tasks'])
            check(f'{resource}: real fixed-colony debit reconciles to task ledger', Decimal(planet(baseline)['resources'][resource]) - Decimal(planet(paid)['resources'][resource]) == debit)
        check('other planet wallet and queue remain exact', planet(paid, HOME) == planet(baseline, HOME))
        record_save(page, 'paid-orders')
        page.reload(wait_until='networkidle'); plans(page)
        check('reload retains paid jobs and independent original authorizations', save(page)['orders'] == paid['orders'])
        advance(page, 180000); finished = save(page)
        check('real queue completes exactly original targets despite edit and deletion', all(planet(finished)['buildings'][b] == n for b, n in GOALS) and all(t['status'] == 'completed' for t in finished['orders']['tasks']))
        check('finished exact total debit is 764/274/0', all(sum(Decimal(t['charged'][r]) - Decimal(t['refunded'][r]) for t in finished['orders']['tasks']) == Decimal(fixtures['totalQuote'][r]) for r in RESOURCES))
        advance(page, 60000)
        check('completed finite tasks never restart', save(page)['orders']['tasks'] == finished['orders']['tasks'])
        record_save(page, 'completed-orders'); context.close()

        case = 'zero finite budget waits without reallocating other goals money'
        context, page = boot(); select(page); review(page)
        for r in RESOURCES:
            budget(page, 'crystal_mine', r).fill('0')
        review(page, fill=False); authorized = apply(page); advance(page, 180000); result = save(page)
        crystal = next(t for t in result['orders']['tasks'] if t['building'] == 'crystal_mine')
        check('zero cap stays a finite running wait with no charge or completed crystal', crystal['status'] == 'running' and crystal['targetLevel'] == 2 and crystal['charged'] == dict.fromkeys(RESOURCES, '0') and planet(result)['buildings']['crystal_mine'] == 0)
        check('other independent goals complete within their own exact caps', all(t['status'] == 'completed' and t['charged'] == t['budget'] for t in result['orders']['tasks'] if t['building'] != 'crystal_mine'))
        check('no replacement, budget increase or additional task is invented', result['orders']['nextTaskId'] == authorized['orders']['nextTaskId'] and all(t['budget'] == authorized['orders']['tasks'][i]['budget'] for i, t in enumerate(result['orders']['tasks'])))
        context.close()

        case = 'same-planet paused coverage, other-planet independence and atomic conflict'
        for variant, expected_new in (('covered', 2), ('elsewhere', 3)):
            context, page = boot(variant); select(page); review(page); before = read(page)
            status = page.locator('[data-building-template-map-building="metal_mine"]').get_attribute('data-building-template-map-status')
            check(f'{variant}: mapping respects actual execution planet', status == ('covered' if variant == 'covered' else 'new'))
            if variant == 'covered':
                expect(page.locator(PREFIX + 'mapping')).to_contain_text('已暂停')
            after = apply(page)
            check(f'{variant}: existing task is byte-equivalent and only new local work is added', after['orders']['tasks'][0] == before['orders']['tasks'][0] and len(after['orders']['tasks']) == 1 + expected_new and all(t['planetId'] == COLONY for t in after['orders']['tasks'][1:]))
            context.close()
        context, page = boot('conflict'); select(page); before = raw(page); review(page)
        expect(page.locator(PREFIX + 'mapping')).to_contain_text('整次不可创建')
        check('lower existing target blocks entire batch without effects', page.locator(PREFIX + 'confirm-apply').is_disabled() and raw(page) == before)
        context.close()

        case = 'real manual paid queue remains unclaimed and invalidates old review on completion'
        context, page = boot('manual'); baseline = save(page); select(page); review(page)
        expect(page.locator(PREFIX + 'mapping')).to_contain_text('已付款工作 #')
        check('manual first level is excluded from fresh metal budget', budget(page, 'metal_mine', 'metal').input_value() == '225' and budget(page, 'metal_mine', 'crystal').input_value() == '55')
        after = apply(page)
        check('application does not adopt original manual paid job', planet(after)['buildQueue'] == planet(baseline)['buildQueue'] and planet(after)['buildQueue'][0]['taskId'] is None)
        context.close()
        context, page = boot('manual'); select(page); review(page); advance(page, 10000)
        check('actual queue completion retires stale review', page.locator(PREFIX + 'review-panel').is_hidden() and not read(page)['orders']['tasks'])
        context.close()

        case = 'synthetic capability attacks cannot create or borrow authorization'
        context, page = boot(); select(page); review(page); before = raw(page)
        page.evaluate('''() => {const b=document.querySelector('#building-template-confirm-apply');const copy=b.cloneNode(true);b.after(copy);copy.click();copy.remove();}''')
        check('cloned confirm cannot spend live review authority', raw(page) == before)
        # Silent DOM mutation must be checked in the click handler without an input event.
        page.evaluate('''() => {document.querySelector('[data-building-template-building="metal_mine"] [data-building-template-budget="metal"]').value='1';document.querySelector('#building-template-confirm-apply').click();}''')
        check('no-event budget mutation invalidates review instead of using old caps', raw(page) == before and page.locator(PREFIX + 'review-panel').is_hidden())
        page.evaluate('''() => {document.querySelector('[data-building-template-building="metal_mine"] [data-building-template-budget="metal"]').value='285';document.querySelector('#building-template-confirm-apply').disabled=false;document.querySelector('#building-template-confirm-apply').click();}''')
        check('restoring DOM values after a rejected confirm does not revive its authority', raw(page) == before)
        review(page)
        page.evaluate('''() => {const b=document.querySelector('#building-template-confirm-apply');b.remove();document.querySelector('#building-template-review-panel .building-template-actions').prepend(b);b.click();}''')
        check('same-turn detached and reinserted original node loses authority', raw(page) == before)
        context.close()
        # A separate intact DOM distinguishes normal review renewal from damaged controls.
        context, page = boot(); select(page); review(page); before = raw(page)
        page.evaluate('window.__oldConfirm=document.querySelector("#building-template-confirm-apply")')
        budget(page, 'metal_mine', 'metal').fill('286'); review(page, fill=False)
        page.evaluate('''() => {const b=window.__oldConfirm;document.querySelector('#building-templates').append(b);b.disabled=false;b.click();}''')
        check('retired node cannot borrow newer explicit review', raw(page) == before)
        after = apply(page)
        check('fresh current confirm works exactly once with newly reviewed cap', len(after['orders']['tasks']) == 3 and after['orders']['tasks'][0]['budget']['metal'] == '286')
        context.close()

        case = 'global viewing preserves review while explicit execution-payer A-to-B-to-A retires it'
        context, page = boot(); select(page); review(page)
        page.locator('#planet-select').select_option(COLONY); page.locator('#planet-select').select_option(HOME)
        check('global view changes preserve fixed colony and existing explicit review', page.locator(PREFIX + 'payer').input_value() == COLONY and page.locator(PREFIX + 'confirm-apply').is_enabled())
        page.evaluate('window.__priorPayerConfirm=document.querySelector("#building-template-confirm-apply")')
        page.locator(PREFIX + 'payer').select_option(HOME); page.locator(PREFIX + 'payer').select_option(COLONY)
        before = raw(page)
        page.evaluate('''() => {const b=window.__priorPayerConfirm;document.querySelector('#building-templates').append(b);b.disabled=false;b.click();}''')
        check('restoring explicit execution payer never resurrects original review', raw(page) == before and page.locator(PREFIX + 'review-panel').is_hidden())
        review(page); check('explicit fresh review restores only new authority', len(apply(page)['orders']['tasks']) == 3)
        context.close()

        case = 'folded semantic A-to-B-to-A cannot revive a prior explicit review'
        context, page = boot('covered'); select(page); review(page)
        original_task = copy.deepcopy(read(page)['orders']['tasks'][0])
        page.evaluate('window.__foldedApply=document.querySelector("#building-template-confirm-apply")')
        page.locator('#building-templates > summary').click()
        page.locator('[data-order-id="1"] [data-order-action="order-resume"]').click()
        page.locator('[data-order-id="1"] [data-order-action="order-pause"]').click()
        check('real order actions return to byte-equivalent original paused task', read(page)['orders']['tasks'][0] == original_task)
        page.evaluate('''() => {const b=window.__foldedApply;if(!b.isConnected)document.querySelector('#building-templates').append(b);document.querySelector('#building-template-review-panel').hidden=false;b.disabled=false;b.click();}''')
        check('intervening folded semantic change permanently retires the review', len(read(page)['orders']['tasks']) == 1)
        plans(page); review(page)
        check('fresh explicit review after the transition can create uncovered goals', len(apply(page)['orders']['tasks']) == 3)
        context.close()

        case = 'trusted Enter works but detached editor and panel cannot retain capabilities'
        context, page = boot('base')
        page.locator(PREFIX + 'new').click(); page.locator(PREFIX + 'name').fill('原生键盘保存')
        page.locator(PREFIX + 'name').press('Enter')
        check('native Enter saves one explicitly opened draft', len(read(page)['buildingTemplates']['templates']) == 1)
        page.locator(PREFIX + 'new').click(); page.locator(PREFIX + 'name').fill('移除的表单不能保存')
        before = raw(page)
        page.evaluate('''() => {const f=document.querySelector('#building-template-editor'),p=f.parentNode;f.remove();p.append(f);f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}''')
        check('same-turn detached editor rejects submit without a live submitter', raw(page) == before)
        context.close()
        context, page = boot(); select(page); review(page); before = raw(page)
        page.evaluate('''() => {const panel=document.querySelector('#building-templates'),p=panel.parentNode,b=document.querySelector('#building-template-confirm-apply');panel.remove();p.append(panel);b.disabled=false;b.click();}''')
        check('whole-panel detach and reinsertion cannot restore old confirm authority', raw(page) == before)
        context.close()

        case = 'world replacement retires same-ID editor, list and review capabilities'
        context, page = boot(); row_action(page, 'edit'); select(page); review(page)
        page.evaluate('''() => {window.__oldBuildingButtons=[...document.querySelectorAll('#building-template-library button'),document.querySelector('#building-template-save'),document.querySelector('#building-template-confirm-apply')];window.__oldBuildingName=document.querySelector('#building-template-name');}''')
        import_fixture(page); before = raw(page)
        page.evaluate('''() => {const root=document.querySelector('#building-templates');for(const b of window.__oldBuildingButtons){root.append(b);b.disabled=false;b.click();}for(const type of ['input','change','blur'])window.__oldBuildingName.dispatchEvent(new Event(type,{bubbles:true}));document.querySelector('#building-template-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}''')
        check('old same-ID controls and late events cannot change imported bytes', raw(page) == before)
        check('replacement requires a fresh explicit selection', page.locator(PREFIX + 'apply').is_hidden())
        select(page); review(page); check('fresh new-world authorization succeeds', len(apply(page)['orders']['tasks']) == 3)
        context.close()

        case = 'responsive Unicode and XSS-like plain text preserve focused input identity'
        context, page = boot('base')
        name = '<img src=x onerror=alert(1)>基建🚀' + '星' * 30
        create(page, name=name)
        check('XSS-like name is literal text, never an HTML node', name in page.locator(PREFIX + 'library').inner_text() and page.locator(PREFIX + 'library img').count() == 0)
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 1100}); row_action(page, 'edit')
            field = page.locator(PREFIX + 'name'); field.fill(name)
            field.evaluate('(e)=>{window.__focusedBuildingName=e;e.focus();e.setSelectionRange(7,9)}')
            for _ in range(3):
                advance(page, 1000)
            check(f'{width}px: animation preserves actual focused node and caret', field.evaluate('(e)=>e===window.__focusedBuildingName && document.activeElement===e && e.selectionStart===7 && e.selectionEnd===9'))
            check(f'{width}px: document has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            snap(page, f'building-templates-{width}.png'); page.locator(PREFIX + 'cancel-edit').click()
        context.close()

        case = 'trusted cross-tab conflict reaches folded and hidden UI controls before paint'
        for visibility in ('folded', 'other-ui-tab'):
            context, page = boot(); select(page); review(page)
            page.evaluate('window.__protectedConfirm=document.querySelector("#building-template-confirm-apply")')
            if visibility == 'folded':
                page.locator('#building-templates > summary').click()
            else:
                page.locator('[data-tab="overview"]').click()
            second = context.new_page(); attach(second)
            response = second.goto(args.url, wait_until='networkidle')
            check('conflicting page is an actual HTTP browser tab', response is not None and response.status == 200)
            import_fixture(second, 'base'); committed = raw(second)
            page.wait_for_function('window.__buildingStorageEvents.length > 0')
            events = page.evaluate('window.__buildingStorageEvents')
            check(f'{visibility}: trusted StorageEvent disables mounted controls before later paint', any(e['trusted'] and e['allDisabled'] and (e['folded'] if visibility == 'folded' else e['ordersHidden']) for e in events), events)
            page.evaluate('''() => {const current=document.querySelector('#building-template-confirm-apply');current.disabled=false;current.click();const old=window.__protectedConfirm;if(!old.isConnected)document.querySelector('#building-templates').append(old);old.disabled=false;old.click();}''')
            check(f'{visibility}: handler guard prevents forced protected confirm from overwriting native bytes', raw(page) == committed)
            second.close(); page.reload(wait_until='networkidle'); plans(page)
            check('reload recovery carries no stale selection or review', page.locator(PREFIX + 'apply').is_hidden())
            create(page); select(page); review(page)
            check('recovery requires and accepts new native authorization', len(apply(page)['orders']['tasks']) == 3)
            context.close()

        case = 'invalid current save preserves raw bytes while protected'
        context, page = boot(corrupt=True); before = raw(page)
        check('strict-invalid save disables every mounted building action', page.locator('#building-templates button').evaluate_all('(xs)=>xs.length>0 && xs.every(e=>e.disabled)'))
        page.evaluate('''() => {const b=document.querySelector('#building-template-new');b.disabled=false;b.click();}''')
        advance(page, 60000)
        check('forced action and elapsed simulation cannot overwrite protected original', raw(page) == before)
        page.evaluate('window.__invalidSaveButton=document.querySelector("#building-template-save");window.__invalidNewButton=document.querySelector("#building-template-new")')
        import_fixture(page); recovered = raw(page)
        page.evaluate('''() => {for(const b of [window.__invalidSaveButton,window.__invalidNewButton]){document.querySelector('#building-templates').append(b);b.disabled=false;b.click();}}''')
        check('explicit valid import clears protection without reviving old controls', raw(page) == recovered and page.locator(PREFIX + 'apply').is_hidden())
        select(page); review(page)
        check('recovered world requires fresh selection and review before creating', len(apply(page)['orders']['tasks']) == 3)
        context.close()
        case = 'suite integrity'
        check('no JavaScript errors', not errors); check('no failed production requests', not failed_requests)
        completed = True; browser.close()
finally:
    signal.alarm(0)
    if not completed and active_page is not None:
        diagnostics = {'case': case, 'lastSavedSyntheticState': last_saved}
        try:
            diagnostics['currentRawSave'] = raw(active_page)
            diagnostics['buildingStatus'] = active_page.locator(PREFIX + 'status').all_text_contents()
            diagnostics['globalStatus'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure.png')
        except Exception as error:
            diagnostics['captureError'] = str(error)
    report = {'completed': completed, 'case': case, 'mode': MODE, 'url': args.url, 'sourceSha': source_sha,
        'fixture': fixtures.get('description'), 'wallTimeLimitSeconds': 180,
        'boundsSeconds': {'worker': 170, 'supervision': 175, 'cleanupReserve': 5},
        'fileImport': 'Real on-disk synthetic JSON through native File.text and one native dialog confirmation. File input event isTrusted and exact selected size/name/prior bytes are asserted.',
        'timing': 'Explicit controlled Date/performance/RAF. Real HTTP, native localStorage and trusted ordinary UI input; capability attacks dispatch synthetic DOM events. Hidden means the actual UI section/tab, not qualified native background suspension.',
        'passed': sum(value['passed'] for value in checks), 'checks': checks, 'errors': errors,
        'failedRequests': failed_requests, 'savedEvidence': evidence, 'failureDiagnostics': diagnostics}
    atomic_json(out / 'building-templates-browser-report.json', report)
    print(json.dumps({'completed': completed, 'passed': report['passed'], 'total': len(checks), 'failedCase': None if completed else case, 'errors': errors}, ensure_ascii=False))
