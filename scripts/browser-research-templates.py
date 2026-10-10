"""Research intent templates: actual HTTP bundle, native Storage and browser controls.

Anonymous pre-funded fixtures and explicitly controlled Date/performance/RAF clocks;
no memory Storage, app-state injection, inline bundles, or natural-timing claims.
"""
import argparse
import copy
import json
import shutil
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='research-templates-review-save.json')
parser.add_argument('--output', default='research-templates-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
RESOURCES = ('metal', 'crystal', 'deuterium')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests = [], [], []
completed, active_page, last_saved, diagnostics = False, None, None, None
case = 'setup'
EPOCH = int(time.time() * 1000)
MODE = 'HTTP / native localStorage / anonymous synthetic controlled simulation timestamps'
CLOCK = r"""(() => {
 const raf=window.requestAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('template-clock');
 const epoch=saved ? Number(saved) : __EPOCH__;
 let time=0; Date.now=()=>epoch+time;
 Object.defineProperty(performance,'now',{value:()=>time});
 window.requestAnimationFrame=callback=>raf(()=>callback(time));
 window.__templateAdvance=async milliseconds=>{
  time+=milliseconds;sessionStorage.setItem('template-clock',String(epoch+time));
  await new Promise(raf);await new Promise(raf);
 };
 window.__nativeTemplateStorage=localStorage instanceof Storage && /\[native code\]/.test(Function.prototype.toString.call(Storage.prototype.setItem));
})();""".replace('__EPOCH__', str(EPOCH))


def check(name, condition):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), 'classification': MODE})
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__templateAdvance(ms)', milliseconds)


def plans(page, expand=True):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator('[data-tab="orders"]').click(); advance(page)
    expect(page.locator('#space-orders')).to_be_visible()
    if expand and not page.locator('#research-templates').evaluate('(e)=>e.open'):
        page.locator('#research-templates > summary').click()


def read(page):
    global last_saved
    last_saved = json.loads(page.evaluate('(key)=>localStorage.getItem(key)', KEY))['state']
    return last_saved


def save(page):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator('[data-tab="save"]').click(); page.locator('[data-action="save"]').click()
    result = read(page); plans(page)
    return result


def boot(which='base', corrupt=False):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Acceptance requires real HTTP(S)')
    fixture = copy.deepcopy(fixtures[which]); fixture['savedAt'] = fixture['lastTickAt'] = EPOCH
    if corrupt:
        fixture['state']['researchTemplates']['nextTemplateId'] = 0
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': f'{parsed.scheme}://{parsed.netloc}', 'localStorage': [
            {'name': KEY, 'value': json.dumps(fixture, ensure_ascii=False)}, {'name': 'infinity.ui.tab', 'value': 'overview'}]}]})
    context.add_init_script(CLOCK)
    page = context.new_page(); active_page = page; page.set_default_timeout(10000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))
    response = page.goto(args.url, wait_until='networkidle')
    check('actual HTTP production response', response is not None and response.status == 200)
    check('native Storage untouched', page.evaluate('window.__nativeTemplateStorage'))
    plans(page, expand=False)
    check('template area starts folded', not page.locator('#research-templates').evaluate('(e)=>e.open'))
    plans(page)
    return context, page


def row_action(page, name, ident=1):
    page.locator(f'#template-library [data-template-id="{ident}"] button[data-template-action="{name}"]').click()


def create_template(page, name='原生多科技意图', targets=(('energy_tech', 2), ('computer_tech', 1))):
    page.locator('#template-new').click(); page.locator('#template-name').fill(name)
    for index, (tech, goal) in enumerate(targets):
        if index:
            page.locator('#template-add-goal').click()
        row = page.locator('#template-goals .template-goal').nth(index)
        row.locator('select').select_option(tech); row.locator('input').fill(str(goal))
    page.locator('#template-save').click()
    return read(page)


def select(page, payer=HOME, ident=1):
    row_action(page, 'select', ident); page.locator('#template-payer').select_option(payer)


def review(page, fill=True):
    if fill:
        page.locator('#template-fill-quotes').click()
    page.locator('#template-review').click()


def apply(page):
    page.locator('#template-confirm-apply').click()
    return read(page)


def task(state, ident=1):
    return next(value for value in state['orders']['tasks'] if value['id'] == ident)


def planet(state, ident=HOME):
    return next(value for value in state['planets'] if value['id'] == ident)


def unchanged_intent_effects(before, after):
    return all(before[key] == after[key] for key in ('planets', 'research', 'orders', 'fleets', 'totalTime'))


def import_fixture(page, which='seeded'):
    fixture = copy.deepcopy(fixtures[which]); now = page.evaluate('Date.now()')
    fixture['savedAt'] = fixture['lastTickAt'] = now
    page.locator('[data-tab="save"]').click()
    page.locator('#transfer').fill(json.dumps(fixture, ensure_ascii=False)); page.locator('[data-action="import-text"]').click()
    plans(page)
    return read(page)


def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    page.evaluate('scrollTo(0,0)')
    page.screenshot(path=str(out / name), full_page=True)


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        case = 'native CRUD, explicit review and finite execution'
        context, page = boot(); baseline = save(page)
        created = create_template(page)
        check('named multiple absolute goals saved', created['researchTemplates']['templates'][0]['name'] == '原生多科技意图' and len(created['researchTemplates']['templates'][0]['goals']) == 2)
        check('saving intent leaves economic and scheduler projection exact', unchanged_intent_effects(baseline, created))
        page.reload(wait_until='networkidle'); plans(page)
        check('native reload retains template', read(page)['researchTemplates'] == created['researchTemplates'])
        select(page)
        check('independent budgets all default zero', all(value == '0' for value in page.locator('#template-budgets input').evaluate_all('(xs)=>xs.map(x=>x.value)')))
        page.locator('#planet-select').select_option(COLONY)
        check('global planet navigation preserves fixed payer', page.locator('#template-payer').input_value() == HOME)
        review(page)
        before_apply = save(page)
        check('review and explicit quote fill do not pay', before_apply['orders'] == baseline['orders'] and before_apply['research'] == baseline['research'] and before_apply['planets'] == baseline['planets'])
        check('review identifies fixed payer and count', '合成模板母星' in page.locator('#template-review-summary').inner_text() and '新增 2 个' in page.locator('#template-review-summary').inner_text())
        page.evaluate('window.__usedTemplateApply=document.querySelector("#template-confirm-apply")')
        authorized = apply(page)
        page.evaluate('window.__usedTemplateApply.click()')
        check('double confirm creates exactly two finite local tasks', len(read(page)['orders']['tasks']) == 2 and read(page)['orders']['nextTaskId'] == 3)
        check('creation is unpaid and local with fixed payer', all(value['planetId'] == HOME and value['transport'] is None and value['charged'] == dict.fromkeys(RESOURCES, '0') for value in authorized['orders']['tasks']))
        original_orders = copy.deepcopy(authorized['orders'])
        row_action(page, 'edit'); page.locator('#template-name').fill('未来意图已修改')
        page.locator('#template-goals .template-goal').first.locator('input').fill('4'); page.locator('#template-save').click()
        check('editing intent increments revision and leaves existing orders exact', read(page)['researchTemplates']['templates'][0]['revision'] == 2 and read(page)['orders'] == original_orders)
        row_action(page, 'delete'); expect(page.locator('#template-delete-dialog')).to_contain_text('已创建计划继续执行')
        page.locator('#template-confirm-delete').click()
        check('deleting intent preserves exact existing orders', not read(page)['researchTemplates']['templates'] and read(page)['orders'] == original_orders)
        advance(page, 10000); paid = save(page)
        check('ten second scheduler actually pays research', any(any(float(amount) > 0 for amount in value['charged'].values()) for value in paid['orders']['tasks']) and bool(paid['research']['queue']))
        for resource in RESOURCES:
            debit = sum(float(value['charged'][resource]) - float(value['refunded'][resource]) for value in paid['orders']['tasks'])
            check(f'{resource}: exact fixed payer debit', abs(float(planet(baseline)['resources'][resource]) - float(planet(paid)['resources'][resource]) - debit) < 1e-6)
            check(f'{resource}: other payer untouched', planet(baseline, COLONY)['resources'][resource] == planet(paid, COLONY)['resources'][resource])
        page.reload(wait_until='networkidle'); plans(page)
        check('reload retains fixed budget, target and paid receipt', save(page)['orders'] == paid['orders'])
        advance(page, 180000); finished = save(page)
        check('original finite targets complete after editing and deletion', finished['research']['levels']['energy_tech'] == 2 and finished['research']['levels']['computer_tech'] == 1 and all(value['status'] == 'completed' for value in finished['orders']['tasks']))
        advance(page, 120000)
        check('finished tasks never restart', save(page)['orders']['tasks'] == finished['orders']['tasks'])
        context.close()

        case = 'real payment and explicit cancellation refund'
        context, page = boot('seeded'); baseline = save(page); select(page); review(page); apply(page)
        advance(page, 10000); paid = save(page)
        for ident in (1, 2):
            page.locator(f'[data-order-id="{ident}"] [data-order-action="order-cancel"]').click()
        cancelled = read(page)
        check('cancelling finite plans refunds their real paid jobs', all(value['status'] == 'cancelled' and value['charged'] == value['refunded'] for value in cancelled['orders']['tasks']) and not cancelled['research']['queue'])
        check('real payer resources restored', planet(cancelled)['resources'] == planet(baseline)['resources'])
        context.close()

        case = 'paused cross-planet coverage and lower-goal atomic conflict'
        context, page = boot('covered'); select(page); review(page)
        text = page.locator('#template-mapping').inner_text()
        check('paused coverage reports real status, payer and target', '已暂停' in text and '合成模板第二星球' in text and '原目标 3 级' in text)
        before = save(page); after = apply(page)
        check('only uncovered tech is created', len(after['orders']['tasks']) == 2 and task(after, 2)['tech'] == 'computer_tech')
        check('coverage never resumes or changes old payer/budget', task(after) == task(before))
        context.close()
        context, page = boot('conflict'); select(page); review(page)
        check('lower existing goal visibly conflicts', '整次不可创建' in page.locator('#template-mapping').inner_text())
        check('atomic confirm unavailable for any conflicting item', page.locator('#template-confirm-apply').is_disabled() and len(read(page)['orders']['tasks']) == 1)
        context.close()

        case = 'manual paid work remains owned by its original payer'
        context, page = boot('manual'); baseline = save(page); select(page); review(page)
        check('manual paid work explicitly shown', '已付款工作 #' in page.locator('#template-mapping').inner_text() and '合成模板第二星球' in page.locator('#template-mapping').inner_text())
        check('quote excludes paid first level', page.locator('[data-template-tech="energy_tech"] [data-template-budget="crystal"]').input_value() == '1600')
        after = apply(page)
        check('application does not claim or change existing paid work', after['research']['queue'] == baseline['research']['queue'] and after['research']['queue'][0]['taskId'] is None)
        context.close()
        context, page = boot('manual'); select(page); review(page)
        check('paid queue scenario starts with live review authority', page.locator('#template-confirm-apply').is_enabled())
        advance(page, 60000)
        check('queue completion retires review without fresh authorization', page.locator('#template-review-panel').is_hidden())
        context.close()

        case = 'review retires when another order consumes task identity'
        context, page = boot('seeded'); select(page); review(page)
        page.locator('#order-budget-metal').fill('1000'); page.locator('#order-create').click()
        check('new order changes task counter and retires template review', page.locator('#template-review-panel').is_hidden() and len(read(page)['orders']['tasks']) == 1)
        context.close()

        case = 'new review never lends its authority to a previous confirm node'
        context, page = boot('seeded'); select(page); review(page)
        page.evaluate('window.__priorReviewConfirm=document.querySelector("#template-confirm-apply")')
        page.locator('[data-template-tech="energy_tech"] [data-template-budget="metal"]').fill('1')
        page.locator('#template-review').click()
        page.evaluate('''() => {const b=window.__priorReviewConfirm;document.querySelector('#research-templates').append(b);b.disabled=false;b.click();}''')
        check('retired confirm cannot consume later explicit review', not read(page)['orders']['tasks'])
        # Only the current review's own button can apply that current authorization.
        page.locator('#template-review-panel #template-confirm-apply').click()
        check('fresh current review still applies once', len(read(page)['orders']['tasks']) == 2)
        context.close()

        case = 'removed button cannot regain authority within same event turn'
        context, page = boot('seeded'); select(page); review(page)
        page.evaluate('''() => {const b=document.querySelector('#template-confirm-apply'); b.remove(); document.querySelector('#template-review-panel .template-actions').prepend(b); b.click();}''')
        check('synchronously detached and reinserted confirm is rejected', not read(page)['orders']['tasks'])
        context.close()

        for replacement in ('import', 'reset'):
            case = f'{replacement}: same-ID templates and late event authority'
            context, page = boot('seeded'); row_action(page, 'edit'); select(page); review(page)
            page.evaluate('''() => { window.__oldTemplateButtons=[...document.querySelectorAll('#template-library button'),document.querySelector('#template-save'),document.querySelector('#template-confirm-apply')]; window.__oldName=document.querySelector('#template-name'); }''')
            if replacement == 'reset':
                page.locator('[data-tab="save"]').click(); page.once('dialog', lambda dialog: dialog.accept()); page.locator('[data-action="reset"]').click(); plans(page)
                check('actual reset clears template library', not read(page)['researchTemplates']['templates'])
                create_template(page, name='同编号的新局模板')
            else:
                import_fixture(page)
            before = copy.deepcopy(read(page))
            page.evaluate('''() => { const root=document.querySelector('#research-templates'); for(const b of window.__oldTemplateButtons){root.append(b);b.disabled=false;b.click();} for(const type of ['input','change','blur']) window.__oldName.dispatchEvent(new Event(type,{bubbles:true})); document.querySelector('#template-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); }''')
            check('old list/editor/review controls and unchanged late events cannot bind matching IDs', read(page)['researchTemplates'] == before['researchTemplates'] and read(page)['orders'] == before['orders'])
            check('replacement requires explicit fresh selection', page.locator('#template-apply').is_hidden())
            context.close()

        case = 'cancelled manual curvature preserves current explicit authorization'
        context, page = boot('curvature'); select(page); review(page)
        page.locator('[data-tab="curvature"]').click(); page.once('dialog', lambda dialog: dialog.dismiss()); page.locator('[data-action="prestige"]').click(); plans(page)
        check('cancelled launch does not retire valid review', page.locator('#template-review-panel').is_visible() and page.locator('#template-confirm-apply').is_enabled())
        apply(page); check('review remains usable after cancelling launch', len(read(page)['orders']['tasks']) == 2)
        context.close()

        for mode in ('manual', 'protocol-live', 'protocol-offline'):
            case = f'{mode} curvature adopts world and retires old capabilities'
            context, page = boot('curvature' if mode == 'manual' else 'automatic')
            row_action(page, 'edit'); select(page); review(page)
            page.evaluate('window.__preLaunchApply=document.querySelector("#template-confirm-apply");window.__preLaunchSave=document.querySelector("#template-save")')
            before = copy.deepcopy(read(page)['researchTemplates'])
            if mode == 'manual':
                page.locator('[data-tab="curvature"]').click(); page.once('dialog', lambda dialog: dialog.accept()); page.locator('[data-action="prestige"]').click(); plans(page)
            elif mode == 'protocol-live':
                for _ in range(10):
                    advance(page, 1000)
            else:
                advance(page, 60000); plans(page)
            launched = save(page)
            check('actual world adoption occurred', launched['stats']['launches'] == 1)
            check('curvature preserves intent library without applying it', launched['researchTemplates'] == before and not launched['orders']['tasks'])
            check('curvature closes old review and disables editor authority', page.locator('#template-apply').is_hidden() and page.locator('#template-save').is_disabled())
            page.evaluate('''() => {for(const b of [window.__preLaunchApply,window.__preLaunchSave]){document.querySelector('#research-templates').append(b);b.disabled=false;b.click();} const n=document.querySelector('#template-name'); for(const type of ['input','change','blur']) n.dispatchEvent(new Event(type,{bubbles:true}));}''')
            check('old same-template buttons cannot authorize in new world', not read(page)['orders']['tasks'] and read(page)['researchTemplates'] == before)
            context.close()

        case = 'responsive focus, caret and keyboard paths'
        context, page = boot('seeded')
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 1100}); row_action(page, 'edit')
            field = page.locator('#template-name'); field.fill('研究意图' * 14)
            field.evaluate('(e)=>{e.focus();e.setSelectionRange(7,9)}')
            for _ in range(3):
                advance(page, 1000)
            check(f'{width}px: focused input identity and caret preserved', field.evaluate('(e)=>document.activeElement===e && e.selectionStart===7 && e.selectionEnd===9'))
            check(f'{width}px: no document horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            snap(page, f'templates-{width}.png')
            page.locator('#template-cancel-edit').click()
        page.locator('#template-new').click(); page.locator('#template-name').fill('键盘保存'); page.locator('#template-name').press('Enter')
        check('keyboard submit creates exactly one explicit intent', len(read(page)['researchTemplates']['templates']) == 2)
        row_action(page, 'select', 2); page.locator('#template-payer').select_option(HOME); review(page, fill=False)
        check('explicit zero budgets can be reviewed', page.locator('#template-confirm-apply').is_enabled())
        page.locator('#template-cancel-review').click()
        check('keyboard-focusable cancel retires review', page.locator('#template-review-panel').is_hidden())
        context.close()

        case = 'protected save gates all mutations'
        context, page = boot('seeded', corrupt=True)
        raw = page.evaluate('(k)=>localStorage.getItem(k)', KEY)
        check('protected session disables template creation and all action controls', page.locator('#template-new').is_disabled() and page.locator('#research-templates button').evaluate_all('(xs)=>xs.every(x=>x.disabled)'))
        page.evaluate('''() => {const b=document.querySelector('#template-new');b.disabled=false;b.click();}''')
        advance(page, 60000)
        check('protected native save remains byte exact', page.evaluate('(k)=>localStorage.getItem(k)', KEY) == raw)
        context.close()
        case = 'suite integrity'
        check('no JavaScript errors', not errors); check('no failed production requests', not failed_requests)
        completed = True; browser.close()
finally:
    if not completed and active_page is not None:
        diagnostics = {'case': case, 'lastSavedSyntheticState': last_saved}
        try:
            diagnostics['currentSave'] = json.loads(active_page.evaluate('(k)=>localStorage.getItem(k)', KEY))
            diagnostics['templateStatus'] = active_page.locator('#template-status').all_text_contents()
            diagnostics['globalStatus'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure.png')
        except Exception as error:
            diagnostics['captureError'] = str(error)
    report = {'completed': completed, 'mode': MODE, 'url': args.url, 'fixture': fixtures.get('description'),
        'timing': 'Explicit synthetic Date/performance/RAF timestamps. Real HTTP, native localStorage, native UI input. Stale controls explicitly dispatch synthetic events.',
        'passed': sum(value['passed'] for value in checks), 'checks': checks, 'errors': errors,
        'failedRequests': failed_requests, 'failureDiagnostics': diagnostics}
    (out / 'research-templates-browser-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'completed': completed, 'passed': report['passed'], 'total': len(checks), 'failedCase': None if completed else case, 'errors': errors}, ensure_ascii=False))
