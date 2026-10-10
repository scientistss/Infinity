"""Single-source logistics using the actual HTTP app, native localStorage and native controls.

All clocks are explicitly controlled synthetic Date/performance/RAF timestamps. Initial
pre-funded fixtures contain no plans; normal scenarios create/dispatch/pay via real UI.
The blocked-dock scenario alone imports explicitly labeled synthetic fault/repair files.
Stale-control probes explicitly dispatch synthetic clicks/events, never app-state writes.
"""
import argparse
import copy
import json
import math
import shutil
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='orders-transport-review-save.json')
parser.add_argument('--output', default='orders-transport-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY, DONOR, PAYER = fixtures['key'], fixtures['donorId'], fixtures['payerId']
RESOURCES = ('metal', 'crystal', 'deuterium')
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests = [], [], []
completed, active_page, last_saved, diagnostics = False, None, None, None
case = 'setup'
EPOCH = int(time.time() * 1000)
MODE = 'HTTP / native localStorage / explicitly controlled simulation timestamps'
CLOCK = r"""(() => {
 const raf=window.requestAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('transport-clock');
 const epoch=saved ? Number(saved) : __EPOCH__;
 let time=0;
 Date.now=()=>epoch+time;
 Object.defineProperty(performance,'now',{value:()=>time});
 window.requestAnimationFrame=callback=>raf(()=>callback(time));
 window.__transportAdvance=async milliseconds=>{
   time+=milliseconds;sessionStorage.setItem('transport-clock',String(epoch+time));
   await new Promise(raf);await new Promise(raf);
 };
 window.__nativeTransportStorage=localStorage instanceof Storage && /\[native code\]/.test(Function.prototype.toString.call(Storage.prototype.setItem));
})();""".replace('__EPOCH__', str(EPOCH))


def check(name, condition):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), 'classification': MODE})
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__transportAdvance(ms)', milliseconds)


def dismiss(page):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()


def plans(page):
    dismiss(page)
    page.locator('[data-tab="orders"]').click()
    advance(page)
    expect(page.locator('#space-orders')).to_be_visible()


def read(page):
    global last_saved
    last_saved = json.loads(page.evaluate('(k)=>localStorage.getItem(k)', KEY))['state']
    return last_saved


def save(page):
    dismiss(page)
    page.locator('[data-tab="save"]').click()
    page.locator('[data-action="save"]').click()
    result = read(page)
    plans(page)
    return result


def boot(which='base'):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Acceptance requires actual HTTP(S)')
    fixture = copy.deepcopy(fixtures[which])
    fixture['savedAt'] = fixture['lastTickAt'] = EPOCH
    values = {KEY: json.dumps(fixture, ensure_ascii=False), 'infinity.ui.tab': 'overview'}
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': f'{parsed.scheme}://{parsed.netloc}',
        'localStorage': [{'name': k, 'value': v} for k, v in values.items()]}]})
    context.add_init_script(CLOCK)
    page = context.new_page()
    active_page = page
    page.set_default_timeout(10000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))
    response = page.goto(args.url, wait_until='networkidle')
    check('actual production HTTP response', response is not None and response.status == 200)
    check('native localStorage remains native', page.evaluate('window.__nativeTransportStorage'))
    plans(page)
    return context, page


def configure(page, kind='building', target='metal_mine', goal=16, trips=2, caps=('1000000',)*3):
    page.locator('#order-kind').select_option(kind)
    page.locator('#order-target').select_option(target)
    page.locator('#order-goal').fill(str(goal))
    page.locator('#order-planet').select_option(PAYER)
    for resource in RESOURCES:
        page.locator(f'#order-budget-{resource}').fill('1000000')
    page.locator('#order-transport-enabled').check()
    page.locator('#order-donor').select_option(DONOR)
    page.locator('#order-ship').select_option('small_cargo')
    page.locator('#order-ship-count').fill('100')
    page.locator('#order-speed').select_option('100')
    page.locator('#order-max-trips').fill(str(trips))
    for resource, cap in zip(RESOURCES, caps):
        page.locator(f'#order-cargo-cap-{resource}').fill(cap)


def create(page, **kwargs):
    configure(page, **kwargs)
    page.locator('#order-create').click()
    return read(page)


def task(state, ident=1):
    return next(t for t in state['orders']['tasks'] if t['id'] == ident)


def planet(state, ident):
    return next(p for p in state['planets'] if p['id'] == ident)


def trip(state, ident=1):
    return task(state, ident)['transport']['trips'][0]


def action(page, name, ident=1):
    page.locator(f'[data-order-id="{ident}"] [data-order-action="order-{name}"]').click()
    return read(page)


def import_raw(page, raw, success=True):
    dismiss(page)
    page.locator('[data-tab="save"]').click()
    page.locator('[data-bind="transfer"]').fill(raw)
    page.locator('[data-action="import-text"]').click()
    if success:
        expect(page.locator('[data-bind="status"]')).to_have_text('已导入并存入本地')
    else:
        expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败')
    plans(page)
    return read(page)


def import_fixture(page, which):
    fixture = copy.deepcopy(fixtures[which])
    fixture['savedAt'] = fixture['lastTickAt'] = page.evaluate('Date.now()')
    return import_raw(page, json.dumps(fixture, ensure_ascii=False))


def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    page.screenshot(path=str(out / name), full_page=True)


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        for kind, target, goal in [('building', 'metal_mine', 16), ('research', 'energy_tech', 8), ('shipyard', 'battleship', 3)]:
            case = f'{kind}: real dispatch, unload, payment, return and bounded completion'
            context, page = boot()
            check('transport is off by default', not page.locator('#order-transport-enabled').is_checked())
            check('trip bound is explicitly 1 through 100', page.locator('#order-max-trips').get_attribute('min') == '1' and page.locator('#order-max-trips').get_attribute('max') == '100')
            check('trip limit defaults to one', page.locator('#order-max-trips').input_value() == '1')
            check('all gross cargo caps default to zero', all(page.locator(f'#order-cargo-cap-{r}').input_value() == '0' for r in RESOURCES))
            check('satellites and defenses excluded from transport choices', page.locator('#order-ship option[value="solar_satellite"],#order-ship option[value="rocket_launcher"]').count() == 0)
            baseline = save(page)
            created = create(page, kind=kind, target=target, goal=goal)
            check('native create saves fixed donor and payer without spending', task(created)['planetId'] == PAYER and task(created)['transport']['authorization']['donorPlanetId'] == DONOR and task(created)['charged'] == dict.fromkeys(RESOURCES, '0') and not created['fleets'])
            page.locator('#order-create').click()
            check('duplicate native click creates no second authorization', len(read(page)['orders']['tasks']) == 1)
            page.locator('#planet-select').select_option(PAYER)
            check('top navigation does not change donor or draft ship', page.locator('#order-donor').input_value() == DONOR and page.locator('#order-ship').input_value() == 'small_cargo')
            advance(page, 10000)
            dispatched = save(page)
            first = trip(dispatched)
            check('first pass dispatches exactly one real owned fleet', len(dispatched['fleets']) == 1 and dispatched['fleets'][0]['orderTransport'] == {'taskId': 1, 'workId': task(dispatched)['currentWork']['workId']})
            check('outbound current work is reserved and unpaid', task(dispatched)['currentWork']['stage'] == 'pending' and task(dispatched)['activeJob'] is None and first['phase']['kind'] == 'outbound')
            check('fixed ships actually leave donor', planet(dispatched, DONOR)['units']['small_cargo'] == planet(baseline, DONOR)['units']['small_cargo'] - 100)
            for resource in RESOURCES:
                debit = float(first['cargo'][resource]) + (float(first['fuel']) if resource == 'deuterium' else 0)
                check(f'{resource}: actual donor debit equals immutable manifest plus fuel', abs(float(planet(baseline, DONOR)['resources'][resource]) - float(planet(dispatched, DONOR)['resources'][resource]) - debit) < 1e-5)
                check(f'{resource}: destination has no pooled remote balance before arrival', planet(dispatched, PAYER)['resources'][resource] == planet(baseline, PAYER)['resources'][resource])
            check('only irreversible fuel charged at departure', task(dispatched)['charged'] == {'metal': '0', 'crystal': '0', 'deuterium': first['fuel']})
            check('visible row distinguishes reserved work and outbound flight', '预算预留' in page.locator('[data-order-id="1"] [data-order="work"]').inner_text() and '尚未交付' in page.locator('[data-order-id="1"] [data-order="transport"]').inner_text())
            page.reload(wait_until='networkidle'); plans(page)
            restored = save(page)
            check('native reload preserves the work identity, fleet and receipt exactly', task(restored) == task(dispatched) and restored['fleets'] == dispatched['fleets'])
            advance(page, math.ceil(restored['fleets'][0]['remaining'] * 1000))
            unloaded = save(page)
            check('real arrival records delivered while ship is still returning', trip(unloaded)['phase']['kind'] == 'returning' and trip(unloaded)['phase']['outcome']['kind'] == 'delivered' and unloaded['fleets'][0]['returning'])
            check('delivered flight has no cargo remaining', all(float(unloaded['fleets'][0]['cargo'][r]) == 0 for r in RESOURCES))
            check('unloading is not reported as real docking', '已实际卸货；真实返航中' in page.locator('[data-order-id="1"] [data-order="transport"]').inner_text())
            for resource in RESOURCES:
                check(f'{resource}: actual unload credits destination once', abs(float(planet(unloaded, PAYER)['resources'][resource]) - float(planet(baseline, PAYER)['resources'][resource]) - float(first['cargo'][resource])) < 1e-5)
            advance(page, 10000)
            paid = save(page)
            check('next order pass performs real local payment while fleet returns', task(paid)['activeJob'] is not None and task(paid)['currentWork']['stage'] == 'paid' and trip(paid)['phase']['kind'] == 'returning')
            check('paid work releases pending reservation', '预算预留 0' in page.locator('[data-order-id="1"] [data-order="work"]').inner_text())
            check('actual queue owns the matching job identity', any(j.get('taskId') == 1 and j['jobId'] == task(paid)['activeJob']['jobId'] for j in (planet(paid, PAYER)['buildQueue'] + paid['research']['queue'] + planet(paid, PAYER)['shipyardQueue'])))
            advance(page, 300000)
            finished = save(page)
            check('finite transport plan completes exactly once', task(finished)['status'] == 'completed' and task(finished)['activeJob'] is None and task(finished)['currentWork'] is None and len(task(finished)['transport']['trips']) == 1)
            check('real docking restores ships and retires fleet', not finished['fleets'] and trip(finished)['phase']['kind'] == 'returned' and planet(finished, DONOR)['units']['small_cargo'] == 1000)
            actual = planet(finished, PAYER)['buildings'][target] if kind == 'building' else finished['research']['levels'][target] if kind == 'research' else task(finished)['completedUnits']
            check('real finite target is reached', actual == goal)
            ledger = copy.deepcopy(finished['orders'])
            advance(page, 60000)
            check('further time cannot respend or redispatch completed plan', save(page)['orders'] == ledger)
            if kind == 'building':
                snap(page, 'transport-completed-desktop.png')
            context.close()

        case = 'zero gross cap cannot pool or take partial cargo'
        context, page = boot()
        create(page, caps=('0', '0', '0'))
        advance(page, 60000); waiting = save(page)
        check('zero cap leaves all donor resources and ships untouched', not waiting['fleets'] and not task(waiting)['transport']['trips'] and task(waiting)['charged'] == dict.fromkeys(RESOURCES, '0') and planet(waiting, DONOR)['units']['small_cargo'] == 1000)
        check('destination cannot use remote resources without a flight', not planet(waiting, PAYER)['buildQueue'] and planet(waiting, PAYER)['buildings']['metal_mine'] == 15)
        context.close()

        case = 'manual recall retains one-work authorization and nonrefundable fuel'
        context, page = boot()
        create(page); advance(page, 12000); before = save(page)
        work_id = task(before)['currentWork']['workId']
        page.locator('[data-tab="fleet"]').click()
        page.locator('[data-space="recall"]').click()
        recalled = read(page)
        check('native recall pauses exact owner and records non-delivery', task(recalled)['status'] == 'paused' and trip(recalled)['phase']['outcome'] == {'kind': 'not-delivered', 'reason': 'manual-recall'})
        check('recall never refunds consumed fuel or trip allowance', task(recalled)['charged'] == task(before)['charged'] and task(recalled)['refunded'] == dict.fromkeys(RESOURCES, '0') and len(task(recalled)['transport']['trips']) == 1)
        advance(page, 3000); returned = save(page)
        check('recalled real ships and cargo return exactly once', not returned['fleets'] and trip(returned)['phase']['kind'] == 'returned' and planet(returned, DONOR)['units']['small_cargo'] == 1000)
        action(page, 'resume'); advance(page, 60000); resumed = save(page)
        check('resume cannot redispatch same work after recall', not resumed['fleets'] and len(task(resumed)['transport']['trips']) == 1 and task(resumed)['currentWork']['workId'] == work_id and task(resumed)['currentWork']['shipmentFleetId'] == trip(resumed)['fleetId'])
        context.close()

        case = 'cancelled outbound plan remains until true return'
        context, page = boot()
        create(page); advance(page, 12000); before = save(page)
        cancelled = action(page, 'cancel')
        check('cancel records non-delivery and retains actual returning ship', task(cancelled)['status'] == 'cancelled' and task(cancelled)['currentWork'] is None and len(cancelled['fleets']) == 1 and trip(cancelled)['phase']['outcome'] == {'kind': 'not-delivered', 'reason': 'plan-cancel'})
        check('terminal returning record has no dismiss control', page.locator('[data-order-id="1"] [data-order-action="order-dismiss"]').is_hidden())
        page.reload(wait_until='networkidle'); plans(page)
        check('cancelled returning flight survives native reload', task(save(page)) == task(cancelled))
        advance(page, 3000); returned = save(page)
        check('fuel remains charged after actual return', task(returned)['charged'] == task(before)['charged'] and task(returned)['refunded'] == dict.fromkeys(RESOURCES, '0'))
        action(page, 'dismiss')
        check('settled terminal record can be dismissed', not read(page)['orders']['tasks'])
        context.close()

        case = 'unloaded resources may be spent manually without a second shipment'
        context, page = boot()
        create(page); advance(page, 10000); sent = save(page)
        work_id = task(sent)['currentWork']['workId']
        action(page, 'pause')
        advance(page, math.ceil(sent['fleets'][0]['remaining'] * 1000)); delivered = save(page)
        check('paused plan still accepts real delivery without paying', trip(delivered)['phase']['outcome']['kind'] == 'delivered' and task(delivered)['activeJob'] is None)
        page.locator('#planet-select').select_option(PAYER)
        page.locator('[data-tab="facilities"]').click()
        page.locator('[data-action="enqueue"][data-id="crystal_mine"]').click()
        spent = read(page)
        check('native manual work actually spends delivered metal', float(planet(spent, PAYER)['resources']['metal']) < float(planet(delivered, PAYER)['resources']['metal']))
        plans(page); action(page, 'resume'); advance(page, 120000); waiting = save(page)
        check('depleted pending work keeps original identity forever', task(waiting)['currentWork']['workId'] == work_id and task(waiting)['currentWork']['stage'] == 'pending' and task(waiting)['currentWork']['shipmentFleetId'] == trip(waiting)['fleetId'])
        check('same work cannot use a second authorized trip', len(task(waiting)['transport']['trips']) == 1 and not waiting['fleets'] and waiting['nextFleetId'] == sent['nextFleetId'])
        page.reload(wait_until='networkidle'); plans(page); advance(page, 60000)
        check('reload also cannot turn spent cargo into another dispatch', len(task(save(page))['transport']['trips']) == 1 and task(read(page))['currentWork']['workId'] == work_id)
        context.close()

        case = 'cancel exact paid job preserves work identity and fuel'
        context, page = boot()
        create(page); advance(page, 10000); sent = save(page)
        advance(page, math.ceil(sent['fleets'][0]['remaining'] * 1000) + 10000); paid = save(page)
        work_id = task(paid)['currentWork']['workId']
        page.locator('#planet-select').select_option(PAYER)
        page.locator('[data-tab="facilities"]').click()
        page.locator('[data-bind="queue-list"] .queue-cancel').click()
        cancelled = read(page)
        check('native paid cancellation restores same pending work', task(cancelled)['status'] == 'paused' and task(cancelled)['currentWork']['stage'] == 'pending' and task(cancelled)['currentWork']['workId'] == work_id)
        check('paid cancellation cannot refund departure fuel', float(task(cancelled)['charged']['deuterium']) - float(task(cancelled)['refunded']['deuterium']) >= float(trip(cancelled)['fuel']))
        plans(page); action(page, 'resume'); advance(page, 60000); resumed = save(page)
        check('refunded local work resumes without another shipment', len(task(resumed)['transport']['trips']) == 1 and resumed['nextFleetId'] == sent['nextFleetId'])
        context.close()

        case = 'same-ID import and reset retire ordinary fleet recall and task controls'
        context, page = boot()
        create(page); advance(page, 10000); save(page)
        incoming = page.evaluate('(k)=>localStorage.getItem(k)', KEY)
        page.evaluate("""()=>{
          window.__oldRecall=document.querySelector('[data-space="recall"]');
          window.__oldCancel=document.querySelector('[data-order-action="order-cancel"]');
        }""")
        advance(page, 1000); save(page)
        imported = import_raw(page, incoming)
        check('same-ID import rebuilds ordinary fleet control', page.evaluate("!window.__oldRecall.isConnected && document.querySelector('[data-space=\"recall\"]')!==window.__oldRecall"))
        page.evaluate("""()=>{
          document.querySelector('#space-fleets').append(window.__oldRecall);window.__oldRecall.click();window.__oldRecall.remove();
          document.querySelector('#order-list').append(window.__oldCancel);window.__oldCancel.click();window.__oldCancel.remove();
          const clone=document.querySelector('[data-space="recall"]').cloneNode(true);
          document.querySelector('#space-fleets').append(clone);clone.click();clone.remove();
        }""")
        check('retired and cloned numeric-ID controls cannot act on replacement save', read(page)['orders'] == imported['orders'] and read(page)['fleets'] == imported['fleets'])
        bad = json.loads(incoming); bad['state']['orders']['tasks'][0]['transport']['trips'][0]['fleetId'] += 50
        before_bad = page.evaluate('(k)=>localStorage.getItem(k)', KEY)
        import_raw(page, json.dumps(bad), success=False)
        check('invalid r6 receipt import leaves current native bytes unchanged', page.evaluate('(k)=>localStorage.getItem(k)', KEY) == before_bad)
        page.evaluate('window.__preResetRecall=document.querySelector(\'[data-space="recall"]\')')
        page.locator('[data-tab="save"]').click(); page.once('dialog', lambda dialog: dialog.accept())
        page.locator('[data-action="reset"]').click(); plans(page)
        check('successful reset retires recall DOM even before a new fleet', page.evaluate('!window.__preResetRecall.isConnected') and page.locator('[data-space="recall"]').count() == 0)
        reset = read(page)
        page.evaluate("""()=>{const old=window.__preResetRecall;document.querySelector('#space-fleets').append(old);old.click();old.remove();}""")
        check('old reset-save recall cannot allocate or mutate fleets', read(page)['fleets'] == reset['fleets'] and read(page)['nextFleetId'] == reset['nextFleetId'])
        context.close()

        case = 'every transport field participates in draft authority and delayed-blur retirement'
        context, page = boot()
        configure(page)
        fields = [('#order-ship-count', '101'), ('#order-max-trips', '3'), ('#order-speed', '90'),
                  ('#order-cargo-cap-metal', '999999'), ('#order-cargo-cap-crystal', '999998'), ('#order-cargo-cap-deuterium', '999997')]
        for selector, changed in fields:
            import_fixture(page, 'base')
            page.locator(selector).dispatch_event('change')
            page.locator(selector).dispatch_event('input')
            page.locator('#order-create').click()
            check(f'{selector}: late unchanged events do not revive imported draft', not read(page)['orders']['tasks'])
            if selector == '#order-speed':
                page.locator(selector).select_option(changed)
            else:
                page.locator(selector).fill(changed)
            page.locator('#order-create').click()
            check(f'{selector}: genuine input edit authorizes exact new task', len(read(page)['orders']['tasks']) == 1)
        # Selects and toggle are also signature-bearing, even when transport is disabled.
        import_fixture(page, 'base'); page.locator('#order-ship').select_option('large_cargo'); page.locator('#order-create').click()
        check('unavailable user-selected ship is preserved, never silently replaced', page.locator('#order-ship').input_value() == 'large_cargo' and task(read(page))['transport']['authorization']['ship'] == 'large_cargo')
        advance(page, 30000); unavailable = save(page)
        check('unavailable fixed ship waits without creating or replacing ships', not unavailable['fleets'] and not task(unavailable)['transport']['trips'] and planet(unavailable, DONOR)['units']['large_cargo'] == 0)
        import_fixture(page, 'base'); page.locator('#order-donor').select_option(PAYER); page.locator('#order-create').click()
        check('invalid same-planet donor is preserved without silent correction', not read(page)['orders']['tasks'] and page.locator('#order-donor').input_value() == PAYER)
        page.locator('#order-donor').select_option(DONOR); page.locator('#order-create').click()
        check('deliberate donor edit renews full authorization', task(read(page))['transport']['authorization']['donorPlanetId'] == DONOR)
        import_fixture(page, 'base'); page.locator('#order-transport-enabled').uncheck(); page.locator('#order-create').click()
        check('explicit toggle edit authorizes local-only task with null transport', task(read(page))['transport'] is None)
        context.close()

        case = 'asynchronous native file import also retires late transport edits'
        context, page = boot(); configure(page)
        page.locator('#order-ship-count').fill('102')
        page.locator('[data-tab="save"]').click()
        page.evaluate("""()=>{
          const nativeText=File.prototype.text;
          window.__transportFile=null;
          File.prototype.text=function(){return new Promise((resolve,reject)=>{
            nativeText.call(this).then(text=>{window.__transportFile=()=>resolve(text);},reject);
          });};
        }""")
        incoming = copy.deepcopy(fixtures['base'])
        incoming['savedAt'] = incoming['lastTickAt'] = page.evaluate('Date.now()')
        page.locator('[data-bind="import-file"]').set_input_files({'name': 'synthetic-transport-import.json', 'mimeType': 'application/json', 'buffer': json.dumps(incoming).encode()})
        page.wait_for_function('window.__transportFile !== null')
        page.evaluate('window.__transportFile()')
        expect(page.locator('[data-bind="status"]')).to_have_text('已导入并存入本地')
        plans(page); page.locator('#order-ship-count').dispatch_event('change'); page.locator('#order-max-trips').dispatch_event('change')
        page.locator('#order-create').click()
        check('late transport blur after asynchronous file import cannot restore authority', not read(page)['orders']['tasks'] and '旧草稿授权已失效' in page.locator('#order-draft-status').inner_text())
        page.locator('#order-ship-count').fill('103'); page.locator('#order-create').click()
        check('new native transport input reauthorizes replacement file', task(read(page))['transport']['authorization']['count'] == 103)
        context.close()

        case = 'controlled docking fault, stable retries, import retirement and controlled repair'
        context, page = boot('blocked')
        blocked = save(page)
        check('labeled fault starts with real blocked returning fleet', trip(blocked)['phase']['kind'] == 'returning' and trip(blocked)['phase']['dockBlocked'] and blocked['fleets'][0]['remaining'] == 0)
        check('terminal blocked plan remains visible and cannot dismiss', page.locator('[data-order-action="order-retry-dock"]').is_visible() and page.locator('[data-order-action="order-dismiss"]').is_hidden())
        snap(page, 'transport-blocked-return.png')
        page.locator('[data-order-action="order-retry-dock"]').click()
        check('unsafe retry is an atomic no-op', read(page)['orders'] == blocked['orders'] and read(page)['fleets'] == blocked['fleets'] and read(page)['planets'] == blocked['planets'])
        advance(page, 3600000); still = save(page)
        check('long controlled offline time does not loop or age blocked segment', still['fleets'] == blocked['fleets'] and task(still) == task(blocked))
        page.reload(wait_until='networkidle'); plans(page)
        check('native reload preserves explicit dockBlocked', trip(save(page))['phase']['dockBlocked'])
        page.evaluate('window.__oldRetry=document.querySelector(\'[data-order-action="order-retry-dock"]\')')
        repaired = import_fixture(page, 'repaired')
        check('controlled repair retains exactly the same fleet/work/task identities', repaired['fleets'][0]['id'] == blocked['fleets'][0]['id'] and task(repaired) == task(blocked))
        page.evaluate("""()=>{const old=window.__oldRetry;document.querySelector('#order-list').append(old);old.click();old.remove();}""")
        check('old retry node cannot dock a same-ID imported flight', read(page)['fleets'] == repaired['fleets'] and task(read(page)) == task(repaired))
        page.evaluate('window.__successfulRetry=document.querySelector(\'[data-order-action="order-retry-dock"]\')')
        page.locator('[data-order-action="order-retry-dock"]').click(); docked = read(page)
        check('fresh native retry performs exactly one actual docking', not docked['fleets'] and trip(docked)['phase']['kind'] == 'returned' and planet(docked, DONOR)['units']['small_cargo'] == 1000)
        page.evaluate("""()=>{const old=window.__successfulRetry;document.querySelector('#order-list').append(old);old.click();old.remove();}""")
        check('repeat detached retry cannot credit cargo or ships twice', read(page)['orders'] == docked['orders'] and read(page)['planets'] == docked['planets'])
        context.close()

        case = 'narrow mobile transport authorization remains usable'
        context, page = boot(); page.set_viewport_size({'width': 390, 'height': 844})
        configure(page)
        check('mobile transport inputs fit viewport', page.locator('#order-transport-fields input,#order-transport-fields select').evaluate_all('(els)=>els.every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1;})'))
        page.locator('#order-max-trips').fill('1'); page.locator('#order-create').click()
        check('mobile native create captures all fixed controls', task(read(page))['transport']['authorization']['maxTrips'] == 1 and task(read(page))['transport']['authorization']['count'] == 100)
        snap(page, 'transport-mobile-390.png')
        context.close()
        case = 'suite integrity'
        check('no uncaught JavaScript errors', not errors)
        check('no failed production requests', not failed_requests)
        completed = True
        browser.close()
finally:
    if not completed and active_page is not None:
        diagnostics = {'case': case, 'lastSavedSyntheticState': last_saved}
        try:
            diagnostics['currentSave'] = json.loads(active_page.evaluate('(k)=>localStorage.getItem(k)', KEY))
            diagnostics['status'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure.png')
        except Exception as failure:
            diagnostics['captureError'] = str(failure)
    report = {'completed': completed, 'mode': MODE, 'url': args.url, 'fixture': fixtures.get('description'),
        'timing': 'Explicit Date.now/performance.now/RAF timestamps; production HTTP, native input and native localStorage. Only stale-event probes dispatch synthetic events. Blocked dock and repair are separately labeled synthetic fixtures imported through normal UI.',
        'passed': sum(row['passed'] for row in checks), 'checks': checks, 'errors': errors,
        'failedRequests': failed_requests, 'failureDiagnostics': diagnostics}
    (out / 'orders-transport-browser-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'completed': completed, 'passed': report['passed'], 'total': len(checks), 'failedCase': None if completed else case, 'errors': errors}, ensure_ascii=False))
