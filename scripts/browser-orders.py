"""Finite local orders: actual HTTP bundle, native Storage and browser input.

Synthetic pre-funded fixture and explicitly controlled Date/performance/RAF timestamps
make payment, reload and stale-event assertions deterministic. No app interception,
in-memory Storage, inline bundle or claimed natural-progression timing is used.
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
parser.add_argument('--fixture', default='orders-review-save.json')
parser.add_argument('--output', default='orders-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests = [], [], []
completed, active_page, last_saved, diagnostics = False, None, None, None
case = 'setup'
EPOCH = int(time.time() * 1000)
MODE = 'HTTP / native localStorage / synthetic controlled simulation timestamps'
CLOCK = r"""(() => {
 const raf = window.requestAnimationFrame.bind(window);
 const saved = sessionStorage.getItem('orders-clock');
 const epoch = saved ? Number(saved) : __EPOCH__;
 let time = 0;
 Date.now = () => epoch + time;
 Object.defineProperty(performance, 'now', {value: () => time});
 window.requestAnimationFrame = callback => raf(() => callback(time));
 window.__ordersAdvance = async milliseconds => {
   time += milliseconds;
   sessionStorage.setItem('orders-clock', String(epoch + time));
   await new Promise(raf); await new Promise(raf);
 };
 window.__nativeOrderStorage = localStorage instanceof Storage &&
   /\[native code\]/.test(Function.prototype.toString.call(Storage.prototype.setItem));
})();""".replace('__EPOCH__', str(EPOCH))


def check(name, condition):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), 'classification': MODE})
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms) => window.__ordersAdvance(ms)', milliseconds)


def dismiss(page):
    modal = page.locator('[data-bind="offline-modal"]')
    if modal.is_visible():
        page.locator('[data-action="dismiss-offline"]').click()


def plans(page):
    dismiss(page)
    page.locator('[data-tab="orders"]').click()
    advance(page)
    expect(page.locator('#space-orders')).to_be_visible()


def read(page):
    global last_saved
    last_saved = json.loads(page.evaluate('(k) => localStorage.getItem(k)', KEY))['state']
    return last_saved


def save(page):
    dismiss(page)
    page.locator('[data-tab="save"]').click()
    page.locator('[data-action="save"]').click()
    value = read(page)
    plans(page)
    return value


def boot(which='base', corrupt=False):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Acceptance requires a real HTTP(S) server')
    fixture = copy.deepcopy(fixtures[which])
    fixture['savedAt'] = fixture['lastTickAt'] = EPOCH
    if corrupt:
        fixture['state']['orders']['nextTaskId'] = 0
    values = {KEY: json.dumps(fixture, ensure_ascii=False),
              'infinity.ui.tab': 'overview',
              'infinity.save.v1': 'SYNTHETIC LEGACY BYTES: retain unchanged'}
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': f'{parsed.scheme}://{parsed.netloc}',
        'localStorage': [{'name': k, 'value': v} for k, v in values.items()]}]})
    context.add_init_script(CLOCK)
    page = context.new_page()
    active_page = page
    page.set_default_timeout(8000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))
    response = page.goto(args.url, wait_until='networkidle')
    check('production page served by actual HTTP', response is not None and response.status == 200)
    check('native Storage retained', page.evaluate('window.__nativeOrderStorage'))
    plans(page)
    return context, page


def configure(page, kind='building', target='metal_mine', goal=3, payer=HOME, caps=('100000', '100000', '100000')):
    page.locator('#order-kind').select_option(kind)
    page.locator('#order-planet').select_option(payer)
    page.locator('#order-target').select_option(target)
    page.locator('#order-goal').fill(str(goal))
    for resource, cap in zip(('metal', 'crystal', 'deuterium'), caps):
        page.locator(f'#order-budget-{resource}').fill(cap)


def create(page, **kwargs):
    configure(page, **kwargs)
    page.locator('#order-create').click()
    return read(page)


def planet(state, ident=HOME):
    return next(p for p in state['planets'] if p['id'] == ident)


def task(state, ident=1):
    return next(t for t in state['orders']['tasks'] if t['id'] == ident)


def action(page, name, ident=1):
    page.locator(f'[data-order-id="{ident}"] [data-order-action="order-{name}"]').click()
    return read(page)


def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i => i.getClientRects().length).map(i => i.decode().catch(() => null)))')
    page.screenshot(path=str(out / name), full_page=True)


def ledger(state):
    return copy.deepcopy(state['orders'])


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        for kind, target, goal in [('building', 'metal_mine', 3), ('research', 'energy_tech', 2), ('shipyard', 'light_fighter', 5)]:
            case = f'{kind} finite payment, fixed payer, repeated creation and reload'
            context, page = boot()
            check('three budgets default to zero', all(page.locator(f'#order-budget-{r}').input_value() == '0' for r in ('metal', 'crystal', 'deuterium')))
            baseline = save(page)
            configure(page, kind=kind, target=target, goal=goal)
            page.locator('#planet-select').select_option(COLONY)
            check('global navigation does not retarget unfinished draft', page.locator('#order-planet').input_value() == HOME)
            check('review explicitly identifies payer', '合成付款母星' in page.locator('#order-review').inner_text())
            page.locator('#order-create').click()
            created = read(page)
            check('one finite task created without immediate payment', len(created['orders']['tasks']) == 1 and task(created)['charged'] == {'metal': '0', 'crystal': '0', 'deuterium': '0'})
            check('task stores the reviewed fixed payer and budget', task(created)['planetId'] == HOME and task(created)['budget'] == {'metal': '100000', 'crystal': '100000', 'deuterium': '100000'})
            page.locator('#order-create').click()
            check('repeat click retains consumed nonce', len(read(page)['orders']['tasks']) == 1 and read(page)['orders']['nextTaskId'] == 2)
            advance(page, 10000)
            paid = save(page)
            check('scheduler makes real first payment', any(float(v) > 0 for v in task(paid)['charged'].values()) and task(paid)['activeJob'] is not None)
            for resource in ('metal', 'crystal', 'deuterium'):
                debit = float(task(paid)['charged'][resource]) - float(task(paid)['refunded'][resource])
                check(f'{resource} exact fixed-payer debit', abs(float(planet(baseline)["resources"][resource]) - float(planet(paid)["resources"][resource]) - debit) < 1e-6)
                check(f'{resource} other planet untouched', planet(paid, COLONY)['resources'][resource] == planet(baseline, COLONY)['resources'][resource])
            page.reload(wait_until='networkidle'); plans(page)
            restored = save(page)
            check('native reload keeps paid receipt and ledger', task(restored) == task(paid))
            advance(page, 180000)
            finished = save(page)
            check('finite task completes and clears receipt', task(finished)['status'] == 'completed' and task(finished)['activeJob'] is None)
            actual = planet(finished)['buildings'][target] if kind == 'building' else finished['research']['levels'][target] if kind == 'research' else task(finished)['completedUnits']
            check('exact finite goal reached', actual == goal)
            before_more = ledger(finished)
            advance(page, 120000)
            check('completed finite plan never spends again', ledger(save(page)) == before_more)
            check('completed task exposes only dismiss', page.locator('[data-order-id="1"] [data-order-action="order-dismiss"]').is_visible() and page.locator('[data-order-id="1"] [data-order-action="order-cancel"]').is_hidden())
            if kind == 'shipyard':
                # Reload creates a fresh form, then a deliberate edit/creation creates
                # another finite additional quantity rather than filling inventory.
                configure(page, kind=kind, target=target, goal=2)
                page.locator('#order-create').click()
                check('deliberate new draft authorizes additional ship quantity', len(read(page)['orders']['tasks']) == 2 and task(read(page), 2)['quantity'] == 2)
                action(page, 'cancel', 2)
            context.close()

        case = 'consumed creation nonce remains consumed after completion'
        context, page = boot()
        create(page, kind='shipyard', target='light_fighter', goal=1)
        advance(page, 40000); finished = save(page)
        check('single ship plan completes before repeated creation', task(finished)['status'] == 'completed')
        page.locator('#order-create').click()
        check('ordinary completion and rendering do not refresh creation nonce', len(read(page)['orders']['tasks']) == 1)
        page.locator('#order-new').click(); page.locator('#order-create').click()
        check('explicit New plan renews creation authority', len(read(page)['orders']['tasks']) == 2 and task(read(page), 2)['quantity'] == 1)
        action(page, 'cancel', 2)
        context.close()

        case = 'rejected duplicate draft cannot become authorized after later completion'
        context, page = boot()
        create(page, kind='shipyard', target='light_fighter', goal=1)
        configure(page, kind='shipyard', target='light_fighter', goal=2)
        page.locator('#order-create').click()
        check('second live same-unit draft rejected without consuming ID', len(read(page)['orders']['tasks']) == 1 and read(page)['orders']['nextTaskId'] == 2)
        advance(page, 40000); finished = save(page)
        check('original same-unit plan completes while rejected draft remains', task(finished)['status'] == 'completed')
        page.locator('#order-create').click()
        check('previously rejected draft cannot silently retry after completion', len(read(page)['orders']['tasks']) == 1 and read(page)['orders']['nextTaskId'] == 2)
        page.locator('#order-new').click(); page.locator('#order-create').click()
        check('explicit New plan allows retry of rejected draft', len(read(page)['orders']['tasks']) == 2 and task(read(page), 2)['quantity'] == 2)
        action(page, 'cancel', 2)
        context.close()

        case = 'pause, resume and cancellation'
        context, page = boot()
        create(page, goal=4)
        advance(page, 10000); paid = save(page)
        action(page, 'pause')
        advance(page, 60000); paused = save(page)
        check('paused task allows already paid work to finish', task(paused)['status'] == 'paused' and task(paused)['activeJob'] is None and planet(paused)['buildings']['metal_mine'] == 2)
        check('paused task makes no further payment', task(paused)['charged'] == task(paid)['charged'])
        resumed = action(page, 'resume')
        check('resume retains progress and budget', task(resumed)['budget'] == task(paused)['budget'] and task(resumed)['charged'] == task(paused)['charged'])
        advance(page, 10000); resumed = save(page)
        check('resume makes the next bounded payment', task(resumed)['activeJob'] is not None)
        cancelled = action(page, 'cancel')
        check('cancel terminates and clears exact work', task(cancelled)['status'] == 'cancelled' and task(cancelled)['activeJob'] is None and not planet(cancelled)['buildQueue'])
        check('cancel retains costs of completed work', task(cancelled)['refunded'] != task(cancelled)['charged'])
        page.reload(wait_until='networkidle'); plans(page)
        check('cancelled state survives native reload', task(save(page)) == task(cancelled))
        action(page, 'dismiss')
        check('terminal record can be dismissed', not read(page)['orders']['tasks'])
        context.close()

        case = 'zero-budget waiting and paused reload'
        context, page = boot()
        create(page, caps=('0', '0', '0'))
        advance(page, 40000); waiting = save(page)
        check('zero budgets authorize no payment', task(waiting)['charged'] == {'metal': '0', 'crystal': '0', 'deuterium': '0'} and not planet(waiting)['buildQueue'])
        check('waiting reason displayed', bool(page.locator('[data-order-id="1"] [data-order="reason"]').inner_text()))
        paused = action(page, 'pause')
        page.reload(wait_until='networkidle'); plans(page)
        check('paused authorization survives reload', task(save(page)) == task(paused))
        context.close()

        case = 'partial ships, reload, dark-matter completion and refund'
        context, page = boot()
        create(page, kind='shipyard', target='light_fighter', goal=5)
        advance(page, 10000 + fixtures['shipSeconds'] * 1500)
        partial = save(page)
        check('real partial batch credits only completed units', task(partial)['completedUnits'] == 1 and task(partial)['activeJob']['credited'] == 1 and planet(partial)['shipyardQueue'][0]['count'] == 4)
        page.reload(wait_until='networkidle'); plans(page)
        reloaded = save(page)
        check('partial receipt and remaining quantity survive reload', task(reloaded) == task(partial))
        page.locator('#planet-select').select_option(HOME)
        page.locator('[data-tab="shipyard"]').click()
        page.locator('[data-bind="squeue-list"] [data-action="dm-speedup"][data-mode="finish"]').click()
        accelerated = read(page)
        check('dark matter completion credits exact remaining units', task(accelerated)['completedUnits'] == 5 and task(accelerated)['activeJob'] is None and planet(accelerated)['units']['light_fighter'] == 5)
        check('dark matter has actual cost', float(accelerated['darkMatter']) < float(partial['darkMatter']))
        advance(page, 10000); settled = save(page)
        check('duplicate later completion cannot credit twice', task(settled)['completedUnits'] == 5 and task(settled)['status'] == 'completed')
        context.close()
        context, page = boot()
        create(page, kind='shipyard', target='light_fighter', goal=5)
        advance(page, 10000 + fixtures['shipSeconds'] * 1500); partial = save(page)
        cancelled = action(page, 'cancel')
        check('partial cancel preserves produced unit and its cost', task(cancelled)['completedUnits'] == 1 and planet(cancelled)['units']['light_fighter'] == 1 and task(cancelled)['refunded'] == {'metal': '12000', 'crystal': '4000', 'deuterium': '0'})
        check('partial cancel has no remaining job', not planet(cancelled)['shipyardQueue'] and task(cancelled)['activeJob'] is None)
        context.close()

        case = 'stable paid job controls and stale commands'
        context, page = boot('manual')
        for kind, tab, bind, cancel_action in [('building', 'facilities', 'queue-list', 'cancel-queue'), ('research', 'research', 'rqueue-list', 'cancel-research'), ('shipyard', 'shipyard', 'squeue-list', 'cancel-units')]:
            page.locator('#planet-select').select_option(HOME)
            page.locator(f'[data-tab="{tab}"]').click()
            button = page.locator(f'[data-bind="{bind}"] .queue-cancel').first
            button.evaluate('(e) => window.__oldOrderButton=e')
            # Malformed metadata must be swallowed even though the legacy index is valid.
            before_invalid = read(page)
            button.evaluate('(e) => { window.__oldOrderMeta=e.dataset.paidJob; delete e.dataset.paidJob; e.click(); }')
            after_invalid = read(page)
            check(f'{kind} invalid metadata cannot fall back to index', after_invalid['planets'] == before_invalid['planets'] and after_invalid['research'] == before_invalid['research'])
            button.evaluate('(e) => { e.dataset.paidJob=window.__oldOrderMeta; }')
            if kind != 'shipyard':
                second = page.locator(f'[data-bind="{bind}"] .queue-cancel').nth(1)
                second.focus(); second.evaluate('(e) => window.__survivingOrderButton=e')
                # Synthetic event is labeled; native focus must survive a sibling edit.
                button.evaluate('(e) => e.click()')
                check(f'{kind} surviving logical job retains node and focus', page.evaluate('window.__survivingOrderButton.isConnected && document.activeElement===window.__survivingOrderButton'))
            else:
                button.click()
            check(f'{kind} cancelled job node becomes disconnected', page.evaluate('!window.__oldOrderButton.isConnected'))
            if kind == 'building':
                page.locator('[data-action="enqueue"][data-id="metal_mine"]').click()
            elif kind == 'research':
                page.locator('[data-action="research"][data-id="energy_tech"]').click()
            else:
                quantity = page.locator('[data-bind="uqty-light_fighter"]')
                if quantity.count():
                    quantity.fill('1')
                page.locator('[data-action="build-units"][data-id="light_fighter"][data-mode="count"]').click()
            after_new = read(page)
            check(f'{kind} replacement gets new node and identity', page.locator(f'[data-bind="{bind}"] .queue-cancel').evaluate_all('(els) => els.every(e => e!==window.__oldOrderButton && e.dataset.paidJob!==window.__oldOrderMeta)'))
            # Restore a stale rendered control into the DOM to deliver its original
            # identity. This is an explicit synthetic interrupted-event probe.
            page.evaluate('''() => { const old=window.__oldOrderButton; document.querySelector('#app').append(old); old.click(); old.remove(); }''')
            check(f'{kind} stale command cannot cancel replacement', read(page)['orders']['nextJobId'] == after_new['orders']['nextJobId'] and read(page)['planets'] == after_new['planets'] and read(page)['research'] == after_new['research'])
            # A still-live rendered home job also remains bound to home after
            # navigation. Same-type colony queue entries must not be cancelled.
            home_button = page.locator(f'[data-bind="{bind}"] .queue-cancel[data-paid-planet="{HOME}"]').last
            home_button.evaluate('(e) => window.__fixedPayerButton=e')
            page.locator('#planet-select').select_option(COLONY)
            before_origin_cancel = read(page)
            page.evaluate('''() => { const b=window.__fixedPayerButton; const detached=!b.isConnected; if(detached)document.querySelector('#app').append(b); b.click(); if(detached)b.remove(); }''')
            after_origin_cancel = read(page)
            check(f'{kind} old displayed command keeps exact home payer', planet(after_origin_cancel, COLONY) == planet(before_origin_cancel, COLONY))
            if kind == 'research':
                check('research cancellation preserves colony-paid job', all(j in after_origin_cancel['research']['queue'] for j in before_origin_cancel['research']['queue'] if j['planetId'] == COLONY))
        context.close()

        case = 'responsive draft controls, stable rows and read-only inspection'
        context, page = boot()
        create(page, caps=('0', '0', '0'))
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 1000})
            page.locator('#order-budget-metal').fill('1234.50')
            page.locator('#order-budget-metal').focus()
            page.locator('#order-budget-metal').evaluate('(e) => { window.__draftNode=e; e.setSelectionRange(2,5); window.__taskRow=document.querySelector("[data-order-id=\\"1\\"]"); }')
            advance(page, 1000)
            check(f'{width}px draft retains node, focus, text and caret', page.locator('#order-budget-metal').evaluate('(e) => e===window.__draftNode && e===document.activeElement && e.value==="1234.50" && e.selectionStart===2 && e.selectionEnd===5'))
            check(f'{width}px task row is stable', page.evaluate('window.__taskRow===document.querySelector("[data-order-id=\\"1\\"]")'))
            check(f'{width}px page has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
            if width == 390:
                snap(page, 'orders-mobile.png')
        snap(page, 'orders-desktop.png')
        before = save(page)
        # The intent library is a second, independent disclosure on this page.
        # Keep this regression scoped to the original payment/cancellation help.
        payment_help = page.locator('#space-orders .order-form-card > details > summary')
        expect(payment_help).to_have_count(1)
        payment_help.click()
        check('original payment help opens for read-only inspection', payment_help.locator('..').evaluate('(e) => e.open'))
        page.locator('#planet-select').select_option(COLONY)
        page.locator('#order-kind').select_option('research')
        page.locator('#order-target').select_option('laser_tech')
        after = save(page)
        check('inspection and unfinished draft authorize nothing', after['orders'] == before['orders'] and after['planets'] == before['planets'] and after['research'] == before['research'])
        check('original manual controls still exist', page.locator('[data-action="enqueue"]').count() > 0 and page.locator('[data-action="research"]').count() > 0 and page.locator('[data-action="build-units"]').count() > 0)
        check('legacy save bytes untouched', page.evaluate("localStorage.getItem('infinity.save.v1')") == 'SYNTHETIC LEGACY BYTES: retain unchanged')
        context.close()

        case = 'successful import retires the previous save identity namespace'
        context, page = boot()
        create(page, kind='shipyard', target='light_fighter', goal=5)
        advance(page, 10000); save(page)
        incoming = page.evaluate('(k) => localStorage.getItem(k)', KEY)
        advance(page, 1000); before_import = save(page)
        check('replacement source uses same IDs with different real progress', planet(before_import)['shipyardQueue'][0]['progress'] > json.loads(incoming)['state']['planets'][0]['shipyardQueue'][0]['progress'])
        configure(page, kind='building', target='metal_mine', goal=3)
        page.evaluate("""() => {
          window.__preImportQueue=document.querySelector('[data-bind="squeue-list"] .queue-cancel');
          window.__preImportTask=document.querySelector('[data-order-id="1"] [data-order-action="order-cancel"]');
          window.__preImportRow=document.querySelector('[data-order-id="1"]');
        }""")
        page.locator('[data-tab="save"]').click()
        page.locator('[data-bind="transfer"]').fill(incoming)
        page.locator('[data-action="import-text"]').click()
        expect(page.locator('[data-bind="status"]')).to_have_text('已导入并存入本地')
        plans(page)
        imported = read(page)
        check('same-ID import actually adopts distinct progress', planet(imported)['shipyardQueue'][0]['progress'] != planet(before_import)['shipyardQueue'][0]['progress'])
        check('same-ID import rebuilds queue controls and task rows', page.evaluate("""() => !window.__preImportQueue.isConnected && !window.__preImportRow.isConnected && document.querySelector('[data-bind="squeue-list"] .queue-cancel')!==window.__preImportQueue && document.querySelector('[data-order-id="1"]')!==window.__preImportRow"""))
        check('replaced draft visibly requires new authorization', '旧草稿授权已失效' in page.locator('#order-draft-status').inner_text())
        # Explicit synthetic late-event delivery from the retired save's nodes.
        page.evaluate("""() => {
          const q=window.__preImportQueue,t=window.__preImportTask;
          document.querySelector('#app').append(q); q.click(); q.remove();
          document.querySelector('#order-list').append(t); t.click(); t.remove();
        }""")
        check('retired queue and task controls cannot act on imported same IDs', read(page)['orders'] == imported['orders'] and read(page)['planets'] == imported['planets'])
        page.locator('#order-create').click()
        check('old valid nonce cannot create into imported save', read(page)['orders'] == imported['orders'])
        page.locator('#order-goal').fill('4'); page.locator('#order-create').click()
        check('explicit draft edit reauthorizes imported save', len(read(page)['orders']['tasks']) == 2 and task(read(page), 2)['targetLevel'] == 4)
        context.close()

        case = 'successful reset retires old matching IDs and creation nonce'
        context, page = boot()
        create(page, goal=3)
        advance(page, 10000); save(page)
        page.evaluate("""() => {
          window.__preResetQueue=document.querySelector('[data-bind="queue-list"] .queue-cancel');
          window.__preResetTask=document.querySelector('[data-order-id="1"] [data-order-action="order-cancel"]');
          window.__preResetRow=document.querySelector('[data-order-id="1"]');
        }""")
        page.locator('[data-tab="save"]').click()
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('[data-action="reset"]').click()
        expect(page.locator('[data-bind="status"]')).to_have_text('已重置并存入本地')
        plans(page)
        reset_state = read(page)
        check('reset restarts the colliding task/job counters', reset_state['orders']['nextTaskId'] == 1 and reset_state['orders']['nextJobId'] == 1)
        page.locator('#order-create').click()
        check('old consumed nonce cannot be reused by reset', not read(page)['orders']['tasks'])
        page.locator('#order-new').click(); page.locator('#order-create').click()
        advance(page, 10000); restarted = save(page)
        check('explicit New plan creates new task/job with reused numeric IDs', task(restarted)['id'] == 1 and task(restarted)['activeJob']['jobId'] == 1)
        check('reset uses fresh task and queue nodes', page.evaluate("""() => !window.__preResetRow.isConnected && !window.__preResetQueue.isConnected && document.querySelector('[data-order-id="1"]')!==window.__preResetRow && document.querySelector('[data-bind="queue-list"] .queue-cancel')!==window.__preResetQueue"""))
        page.evaluate("""() => {
          const q=window.__preResetQueue,t=window.__preResetTask;
          document.querySelector('#app').append(q); q.click(); q.remove();
          document.querySelector('#order-list').append(t); t.click(); t.remove();
        }""")
        check('retired controls cannot cancel reset save same-ID work', read(page)['orders'] == restarted['orders'] and read(page)['planets'] == restarted['planets'])
        context.close()

        case = 'failed import preserves the current legitimate draft'
        context, page = boot()
        configure(page, goal=3)
        page.locator('[data-tab="save"]').click()
        page.locator('[data-bind="transfer"]').fill('{"invalid":"synthetic"}')
        page.locator('[data-action="import-text"]').click()
        check('invalid import rejected', '导入失败' in page.locator('[data-bind="status"]').inner_text())
        plans(page); page.locator('#order-create').click()
        check('failed replacement does not retire valid current draft', len(read(page)['orders']['tasks']) == 1 and task(read(page))['targetLevel'] == 3)
        context.close()

        case = 'delayed blur from pre-import editing cannot revive retired draft'
        context, page = boot()
        configure(page, goal=3)
        page.locator('[data-tab="save"]').click()
        page.evaluate("""() => {
          const nativeText=File.prototype.text;
          window.__orderPendingFile=null;
          File.prototype.text=function(){return new Promise((resolve,reject)=>{
            nativeText.call(this).then(text=>{window.__orderPendingFile=()=>resolve(text);},reject);
          });};
          window.__budgetChanges=0;
          document.querySelector('#order-budget-metal').addEventListener('change',()=>window.__budgetChanges++);
        }""")
        page.locator('[data-bind="import-file"]').set_input_files({'name':'synthetic-delayed-success.json','mimeType':'application/json','buffer':json.dumps(fixtures['base']).encode()})
        page.wait_for_function('window.__orderPendingFile !== null')
        plans(page)
        page.locator('#order-budget-metal').fill('23456')
        page.locator('#order-budget-metal').focus()
        changes_before = page.evaluate('window.__budgetChanges')
        check('pre-import input remains focused while file read is pending', page.locator('#order-budget-metal').evaluate('(e)=>e===document.activeElement'))
        page.evaluate('window.__orderPendingFile()')
        expect(page.locator('[data-bind="status"]')).to_have_text('已导入并存入本地')
        check('successful file import retires draft while preserving focus and text', '旧草稿授权已失效' in page.locator('#order-draft-status').inner_text() and page.locator('#order-budget-metal').evaluate('(e)=>e===document.activeElement && e.value==="23456"'))
        page.locator('#order-create').click()
        check('native blur delivered the earlier pending change', page.evaluate('window.__budgetChanges') > changes_before)
        check('late text change cannot authorize old draft against imported counters', not read(page)['orders']['tasks'])
        page.locator('#order-kind').select_option('building')
        page.locator('#order-target').select_option('metal_mine')
        page.locator('#order-create').click()
        check('unchanged select input/change cannot revive retired draft', not read(page)['orders']['tasks'] and '旧草稿授权已失效' in page.locator('#order-draft-status').inner_text())
        page.locator('#order-budget-metal').fill('23457'); page.locator('#order-create').click()
        check('genuine post-import value edit grants fresh authority', len(read(page)['orders']['tasks']) == 1 and task(read(page))['budget']['metal'] == '23457')
        context.close()

        case = 'stale file import preserves the current legitimate draft'
        context, page = boot()
        configure(page, goal=3)
        page.locator('[data-tab="save"]').click()
        # Native File bytes with explicitly delayed promise completion. A normal
        # Save supersedes this read; its late result must not retire UI authority.
        page.evaluate("""() => {
          const nativeText=File.prototype.text;
          window.__orderPendingFile=null;
          File.prototype.text=function(){return new Promise((resolve,reject)=>{
            nativeText.call(this).then(text=>{window.__orderPendingFile=()=>resolve(text);},reject);
          });};
        }""")
        page.locator('[data-bind="import-file"]').set_input_files({'name':'synthetic-stale-orders.json','mimeType':'application/json','buffer':json.dumps(fixtures['base']).encode()})
        page.wait_for_function('window.__orderPendingFile !== null')
        page.locator('[data-action="save"]').click()
        page.evaluate('window.__orderPendingFile()'); advance(page)
        plans(page); page.locator('#order-create').click()
        check('stale import completion does not retire valid current draft', len(read(page)['orders']['tasks']) == 1 and task(read(page))['targetLevel'] == 3)
        context.close()

        case = 'protected save is read-only'
        context, page = boot(corrupt=True)
        raw = page.evaluate('(k) => localStorage.getItem(k)', KEY)
        check('invalid save disables creation controls', page.locator('#order-create').is_disabled() and page.locator('#order-planet').is_disabled())
        advance(page, 60000)
        check('protected original bytes remain exact', page.evaluate('(k) => localStorage.getItem(k)', KEY) == raw)
        context.close()
        case = 'suite integrity'
        check('no uncaught JavaScript errors', not errors)
        check('no failed production resource requests', not failed_requests)
        completed = True
        browser.close()
finally:
    if not completed and active_page is not None:
        diagnostics = {'case': case, 'lastSavedSyntheticState': last_saved}
        try:
            diagnostics['currentSave'] = json.loads(active_page.evaluate('(k) => localStorage.getItem(k)', KEY))
            diagnostics['status'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure.png')
        except Exception as failure:
            diagnostics['captureError'] = str(failure)
    report = {'completed': completed, 'mode': MODE, 'url': args.url, 'fixture': fixtures.get('description'),
        'timing': 'Explicit synthetic Date.now, performance.now and RAF timestamps; native scheduling, HTTP, input and localStorage. Stale-event probes explicitly dispatch synthetic clicks.',
        'passed': sum(row['passed'] for row in checks), 'checks': checks,
        'errors': errors, 'failedRequests': failed_requests, 'failureDiagnostics': diagnostics}
    (out / 'orders-browser-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'completed': completed, 'passed': report['passed'], 'total': len(checks), 'failedCase': None if completed else case, 'errors': errors}, ensure_ascii=False))
