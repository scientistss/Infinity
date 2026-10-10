"""Named formations and finite replenishment: real HTTP bundle and native Storage.

Anonymous pre-funded fixtures, native input, and explicit Date/performance/RAF clocks.
No application-state injection, memory Storage, inline app bundles, or natural-timing claims.
"""
import argparse
import copy
import json
import shutil
import time
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='formations-review-save.json')
parser.add_argument('--output', default='formations-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
RESOURCES = ('metal', 'crystal', 'deuterium')
SHIPS = ('small_cargo', 'large_cargo', 'light_fighter', 'heavy_fighter', 'cruiser', 'battleship', 'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'recycler', 'espionage_probe', 'colony_ship')
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests = [], [], []
completed, active_page, last_saved, diagnostics = False, None, None, None
case = 'setup'
EPOCH = int(time.time() * 1000)
MODE = 'HTTP / native localStorage / anonymous synthetic controlled simulation timestamps'
CLOCK = r"""(() => {
 const raf=window.requestAnimationFrame.bind(window);
 const saved=sessionStorage.getItem('formation-clock');
 const epoch=saved ? Number(saved) : __EPOCH__;
 let time=0; Date.now=()=>epoch+time;
 Object.defineProperty(performance,'now',{value:()=>time});
 window.requestAnimationFrame=callback=>raf(()=>callback(time));
 window.__formationAdvance=async milliseconds=>{
  time+=milliseconds;sessionStorage.setItem('formation-clock',String(epoch+time));
  await new Promise(raf);await new Promise(raf);
 };
 window.__nativeFormationStorage=localStorage instanceof Storage && /\[native code\]/.test(Function.prototype.toString.call(Storage.prototype.setItem));
})();""".replace('__EPOCH__', str(EPOCH))


def check(name, condition):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), 'classification': MODE})
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__formationAdvance(ms)', milliseconds)


def dismiss_offline(page):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()


def fleet(page, expand=True):
    dismiss_offline(page)
    page.locator('[data-tab="fleet"]').click(); advance(page)
    expect(page.locator('#space-fleet')).to_be_visible()
    if expand and not page.locator('#fleet-formations').evaluate('(e)=>e.open'):
        page.locator('#fleet-formations > summary').click()


def plans(page):
    dismiss_offline(page); page.locator('[data-tab="orders"]').click(); advance(page)


def read(page):
    global last_saved
    last_saved = json.loads(page.evaluate('(key)=>localStorage.getItem(key)', KEY))['state']
    return last_saved


def save(page):
    dismiss_offline(page)
    page.locator('[data-tab="save"]').click(); page.locator('[data-action="save"]').click()
    result = read(page); fleet(page)
    return result


def boot(which='seeded', corrupt=False):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Acceptance requires real HTTP(S)')
    fixture = copy.deepcopy(fixtures[which]); fixture['savedAt'] = fixture['lastTickAt'] = EPOCH
    if corrupt:
        fixture['state']['formations']['nextFormationId'] = 0
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': f'{parsed.scheme}://{parsed.netloc}', 'localStorage': [
            {'name': KEY, 'value': json.dumps(fixture, ensure_ascii=False)}, {'name': 'infinity.ui.tab', 'value': 'overview'}]}]})
    context.add_init_script(CLOCK)
    page = context.new_page(); active_page = page; page.set_default_timeout(10000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))
    response = page.goto(args.url, wait_until='networkidle')
    check('actual HTTP production response', response is not None and response.status == 200)
    check('native Storage untouched', page.evaluate('window.__nativeFormationStorage'))
    fleet(page, expand=False)
    check('formation area starts folded', not page.locator('#fleet-formations').evaluate('(e)=>e.open'))
    fleet(page)
    return context, page


def row_action(page, action, ident=1):
    page.locator(f'#formation-library article[data-formation-id="{ident}"] button[data-formation-action="{action}"]').click()


def create(page, name='原生混编 <舰&🚀>', ships=None):
    ships = {'small_cargo': 4, 'light_fighter': 10} if ships is None else ships
    page.locator('#formation-new').click(); page.locator('#formation-name').fill(name)
    for ship, count in ships.items():
        page.locator(f'[data-formation-unit="{ship}"]').fill(str(count))
    page.locator('#formation-save').click()
    return read(page)


def select(page, payer=None, ident=1):
    row_action(page, 'select', ident)
    if payer is not None:
        page.locator('#formation-payer').select_option(payer)


def preview(page):
    page.locator('#formation-preview').click()


def apply(page):
    page.locator('#formation-review-panel #formation-confirm-replenish').click()
    return read(page)


def planet(state, ident=HOME):
    return next(value for value in state['planets'] if value['id'] == ident)


def economic_projection(state):
    return {key: state[key] for key in ('planets', 'research', 'orders', 'fleets', 'nextFleetId', 'totalTime')}


def ship_values(page):
    return page.locator('[data-ship]').evaluate_all('(xs)=>Object.fromEntries(xs.map(x=>[x.dataset.ship,x.value]))')


def other_values(page):
    return page.evaluate('''() => Object.fromEntries(['flight-mission','flight-speed','flight-galaxy','flight-system','flight-position','cargo-metal','cargo-crystal','cargo-deuterium','charge-slots','charge-bets'].map(id=>{const e=document.getElementById(id);return [id,e.type==='checkbox'?e.checked:e.value]}))''')


def configure_transport(page, count=1):
    page.locator('#flight-mission').select_option('transport')
    for key, value in fixtures['colonyCoordinates'].items():
        page.locator('#flight-' + key).fill(str(value))
    page.locator('#flight-speed').select_option('100')
    for ship in SHIPS:
        page.locator(f'[data-ship="{ship}"]').fill(str(count if ship == 'light_fighter' else 0))
    for resource in RESOURCES:
        page.locator('#cargo-' + resource).fill('0')
    advance(page)


def import_fixture(page, which='seeded', invalid=False):
    fixture = copy.deepcopy(fixtures[which]); now = page.evaluate('Date.now()')
    fixture['savedAt'] = fixture['lastTickAt'] = now
    if invalid:
        fixture['state']['formations']['nextFormationId'] = 0
    page.locator('[data-tab="save"]').click()
    page.locator('#transfer').fill(json.dumps(fixture, ensure_ascii=False)); page.locator('[data-action="import-text"]').click()
    fleet(page)
    return read(page)


def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    page.evaluate('scrollTo(0,0)')
    # Capture the actual top viewport before full-page stitching can change scroll.
    page.screenshot(path=str(out / (name + '-top.png')))
    page.screenshot(path=str(out / (name + '.png')), full_page=True)


try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        case = 'native named multiship CRUD and explicit dispatch fill'
        context, page = boot('base'); baseline = save(page); created = create(page)
        design = created['formations']['entries'][0]
        check('native save contains named multiship design', design['name'] == '原生混编 <舰&🚀>' and design['ships'] == {'small_cargo': 4, 'light_fighter': 10})
        check('saving a pure design has no economic or dispatch effects', economic_projection(created) == economic_projection(baseline))
        check('literal HTML-like Unicode name is text, not markup', '<舰&🚀>' in page.locator('#formation-library').inner_text() and page.locator('#formation-library img, #formation-library script').count() == 0)
        page.reload(wait_until='networkidle'); fleet(page)
        check('native reload retains exact design', read(page)['formations'] == created['formations'])
        page.locator('#flight-mission').select_option('charge'); advance(page)
        page.locator('#flight-speed').select_option('70'); page.locator('#flight-galaxy').fill('2'); page.locator('#flight-system').fill('19'); page.locator('#flight-position').fill('16')
        for resource, value in zip(RESOURCES, ('43', '17', '9')):
            page.locator('#cargo-' + resource).fill(value)
        page.locator('#charge-slots').select_option('2'); page.locator('#charge-bets').check()
        page.locator('[data-ship="large_cargo"]').fill('7')
        original_other, original_ships = other_values(page), ship_values(page)
        select(page)
        check('selection alone leaves every dispatch field unchanged', other_values(page) == original_other and ship_values(page) == original_ships)
        check('payer requires an explicit initial choice', page.locator('#formation-payer').input_value() == '' and page.locator('#formation-preview').is_disabled())
        page.locator('#formation-fill').click()
        copied = ship_values(page)
        check('fill replaces every ship field, including unlisted zeroes', all(copied[ship] == str(design['ships'].get(ship, 0)) for ship in SHIPS))
        check('fill preserves mission, coordinates, speed, cargo and charge options', other_values(page) == original_other)
        check('fill never silently clamps to local stock', copied['light_fighter'] == '10' and planet(created)['units']['light_fighter'] == 3)
        check('fill shows detached editable source snapshot', '#1' in page.locator('#formation-dispatch-source').inner_text() and '<舰&🚀>' in page.locator('#formation-dispatch-source').inner_text())
        check('selection and fill have no economic or dispatch effects', economic_projection(save(page)) == economic_projection(created))
        check('original dispatch validation rejects insufficient ships', page.locator('#space-send').is_disabled() and '不足' in page.locator('#space-quote').inner_text())
        row_action(page, 'edit'); page.locator('#formation-name').fill('🚀' * 64); page.locator('#formation-save').click()
        check('64 astral Unicode codepoints save without UTF-16 truncation', read(page)['formations']['entries'][0]['name'] == '🚀' * 64)
        check('editing does not rewrite filled dispatch snapshot', ship_values(page) == copied and '<舰&🚀>' in page.locator('#formation-dispatch-source').inner_text())
        row_action(page, 'delete'); page.locator('#formation-confirm-delete').click()
        check('unused design deletes without changing filled quantities or real fleet', not read(page)['formations']['entries'] and ship_values(page) == copied and not read(page)['fleets'])
        context.close()

        case = 'finite quote exact budgets, real fixed-payer payments and old origin'
        context, page = boot('paid'); baseline = save(page); select(page, HOME); preview(page)
        fighter = page.locator('[data-formation-review-unit="light_fighter"]')
        check('deficit counts local stock plus actual paid queue remaining', '现货 3' in fighter.inner_text() and '已付款待造 2' in fighter.inner_text() and '固定新增 5' in fighter.inner_text())
        check('exact per-child quantity times catalog budget shown', '金属 15000 / 晶体 5000 / 重氢 0' in fighter.inner_text())
        check('exact total sums distinct child budgets once', '金属 21000 / 晶体 11000 / 重氢 0' in page.locator('#formation-review-total').inner_text())
        page.locator('#planet-select').select_option(COLONY)
        check('global planet switching preserves explicit fixed payer', page.locator('#formation-payer').input_value() == HOME)
        check('preview leaves economy and orders untouched', economic_projection(save(page)) == economic_projection(baseline))
        page.evaluate('window.__usedFormationConfirm=document.querySelector("#formation-confirm-replenish")')
        authorized = apply(page)
        page.evaluate('window.__usedFormationConfirm.click()')
        check('one review creates exactly two finite tasks once', len(read(page)['orders']['tasks']) == 2 and read(page)['orders']['nextTaskId'] == 3)
        check('children keep exact independent finite quantities', {task['unit']: task['quantity'] for task in authorized['orders']['tasks']} == {'small_cargo': 3, 'light_fighter': 5})
        check('creation is unpaid and transport remains disabled', all(task['planetId'] == HOME and task['transport'] is None and task['charged'] == dict.fromkeys(RESOURCES, '0') for task in authorized['orders']['tasks']))
        check('manual paid job retains its original owner and identity', planet(authorized)['shipyardQueue'] == planet(baseline)['shipyardQueue'] and planet(authorized)['shipyardQueue'][0]['taskId'] is None)
        original_tasks = copy.deepcopy(authorized['orders']['tasks'])
        row_action(page, 'edit'); page.locator('#formation-name').fill('未来版本'); page.locator('[data-formation-unit="light_fighter"]').fill('20'); page.locator('#formation-save').click()
        check('edit changes only future design revision', read(page)['formations']['entries'][0]['revision'] == 2 and read(page)['orders']['tasks'] == original_tasks)
        plans(page)
        check('existing order shows creation-time name and revision as text', '<舰&🚀> / r1（创建时版本）' in page.locator('#order-list').inner_text() and '未来版本' not in page.locator('#order-list').inner_text())
        fleet(page); row_action(page, 'delete')
        check('any retained old-revision reference blocks deletion with task IDs', page.locator('#formation-confirm-delete').is_disabled() and '#1' in page.locator('#formation-delete-references').inner_text() and '#2' in page.locator('#formation-delete-references').inner_text())
        page.locator('#formation-cancel-delete').click()
        advance(page, 10000); paid_state = save(page)
        check('real scheduler creates real paid formation jobs', any(job['taskId'] is not None for job in planet(paid_state)['shipyardQueue']) and any(Decimal(task['charged']['metal']) > 0 for task in paid_state['orders']['tasks']))
        for resource in RESOURCES:
            debit = sum(Decimal(task['charged'][resource]) - Decimal(task['refunded'][resource]) for task in paid_state['orders']['tasks'])
            check(resource + ': exact fixed-payer debit', Decimal(planet(baseline)['resources'][resource]) - Decimal(planet(paid_state)['resources'][resource]) == debit)
            check(resource + ': other planet untouched', planet(baseline, COLONY)['resources'][resource] == planet(paid_state, COLONY)['resources'][resource])
        page.reload(wait_until='networkidle'); fleet(page)
        check('native reload preserves origin snapshots, budgets and real paid receipts', save(page)['orders'] == paid_state['orders'])
        advance(page, 180000); finished = save(page)
        check('finite children finish original quantities despite design edit', all(task['status'] == 'completed' and task['completedUnits'] == task['quantity'] for task in finished['orders']['tasks']) and planet(finished)['units']['light_fighter'] == 10)
        row_action(page, 'delete'); check('terminal retained references still block deletion', page.locator('#formation-confirm-delete').is_disabled())
        page.locator('#formation-cancel-delete').click(); plans(page)
        for ident in (1, 2):
            page.locator(f'[data-order-id="{ident}"] [data-order-action="order-dismiss"]').click()
        fleet(page); row_action(page, 'delete'); page.locator('#formation-confirm-delete').click()
        check('final explicit record dismissal releases formation deletion', not read(page)['formations']['entries'] and not read(page)['orders']['tasks'])
        context.close()

        case = 'partial completion then explicit cancellation keeps fixed quantity and exact refund'
        context, page = boot('single'); baseline = save(page); select(page, HOME); preview(page); apply(page)
        advance(page, 10000); advance(page, fixtures['unitMilliseconds'] + 1); partial = save(page)
        current = partial['orders']['tasks'][0]
        check('real partial production credits a strict prefix', 0 < current['completedUnits'] < current['quantity'] == 7)
        plans(page); page.locator('[data-order-id="1"] [data-order-action="order-cancel"]').click(); cancelled = read(page)
        task = cancelled['orders']['tasks'][0]
        check('cancelled finite task retains original quantity and completed count', task['status'] == 'cancelled' and task['quantity'] == 7 and task['completedUnits'] == current['completedUnits'])
        check('real cancellation removes remaining paid job', not planet(cancelled)['shipyardQueue'])
        for resource, unit in zip(RESOURCES, (3000, 1000, 0)):
            net = Decimal(task['charged'][resource]) - Decimal(task['refunded'][resource])
            check(resource + ': partial cancellation refunds only unbuilt units', net == current['completedUnits'] * unit)
            check(resource + ': wallet equals completed-unit cost', Decimal(planet(baseline)['resources'][resource]) - Decimal(planet(cancelled)['resources'][resource]) == net)
        fleet(page); advance(page, 180000)
        check('cancelled finite quantity never expands or restarts', save(page)['orders']['tasks'] == cancelled['orders']['tasks'])
        context.close()

        case = 'manual cancellation of a paid child pauses without growing fixed authorization'
        context, page = boot('single'); select(page, HOME); preview(page); apply(page); advance(page, 10000)
        before = save(page); original = before['orders']['tasks'][0]
        page.locator('[data-tab="shipyard"]').click(); page.locator('[data-bind="squeue-list"] [data-action="cancel-units"]').click()
        paused = read(page)['orders']['tasks'][0]
        check('manual paid-job cancellation pauses original finite child', paused['status'] == 'paused' and paused['quantity'] == original['quantity'] and paused['budget'] == original['budget'] and paused['formationOrigin'] == original['formationOrigin'])
        plans(page); page.locator('[data-order-id="1"] [data-order-action="order-resume"]').click(); fleet(page)
        advance(page, 180000); resumed = save(page)['orders']['tasks'][0]
        check('existing resume control finishes only original finite quantity', resumed['status'] == 'completed' and resumed['completedUnits'] == resumed['quantity'] == 7 and resumed['budget'] == original['budget'])
        context.close()

        case = 'zero deficit, conflicting unpaid plans and in-flight exclusion'
        context, page = boot('covered'); before = save(page); select(page, HOME); preview(page)
        check('zero deficit shows no replenishment needed', '无需补船' in page.locator('#formation-status').inner_text() and page.locator('#formation-confirm-replenish').is_disabled())
        check('zero deficit does not consume task IDs or conflict with unused old plan', save(page)['orders'] == before['orders'])
        context.close()
        context, page = boot('conflict'); select(page, HOME); preview(page)
        check('old unpaid plan is not counted as paid inventory', '固定新增 7' in page.locator('[data-formation-review-unit="light_fighter"]').inner_text())
        check('nonzero deficit with paused old plan blocks whole review and lists ID', page.locator('#formation-confirm-replenish').is_disabled() and '#1' in page.locator('[data-formation-review-unit="light_fighter"]').inner_text() and len(read(page)['orders']['tasks']) == 1)
        context.close()
        context, page = boot('inflight'); select(page, HOME); preview(page)
        check('real in-flight ships do not reduce the one-shot deficit', '固定新增 5' in page.locator('[data-formation-review-unit="light_fighter"]').inner_text())
        check('UI warns that returning ships may overshoot', '返航后可能超过目标' in page.locator('#formation-selection').inner_text())
        authorized = apply(page); fixed = {task['unit']: task['quantity'] for task in authorized['orders']['tasks']}
        trip = authorized['fleets'][0]
        advance(page, max(180000, (trip['remaining'] + trip['duration']) * 1000 + 1000)); returned = save(page)
        check('real return can exceed target while fixed created quantity remains unchanged', not returned['fleets'] and planet(returned)['units']['light_fighter'] == 14 and {task['unit']: task['quantity'] for task in returned['orders']['tasks']} == fixed)
        configure_transport(page); page.locator('#space-send').click(); departed = read(page)
        check('explicit later departure does not grow completed finite plans', len(departed['fleets']) == 1 and departed['orders']['tasks'] == returned['orders']['tasks'])
        context.close()

        case = 'equivalent paid-queue completion preserves exact reviewed authorization'
        context, page = boot('paid'); select(page, HOME); preview(page)
        page.evaluate('window.__equivalentConfirm=document.querySelector("#formation-confirm-replenish")')
        advance(page, fixtures['unitMilliseconds'] * 2 + 1)
        check('paid production moves queue into stock without retiring same-deficit review', page.locator('#formation-review-panel').is_visible() and page.locator('#formation-confirm-replenish').is_enabled())
        check('same-deficit render does not replace review button or refresh nonce', page.locator('#formation-confirm-replenish').evaluate('(e)=>e===window.__equivalentConfirm'))
        authorized = apply(page)
        check('original authorization after paid completion creates same deficit', next(task for task in authorized['orders']['tasks'] if task['unit'] == 'light_fighter')['quantity'] == 5)
        context.close()

        case = 'changed queue deficit retires preview and old confirm cannot consume a new one'
        context, page = boot('paid'); select(page, HOME); preview(page)
        page.evaluate('window.__priorConfirm=document.querySelector("#formation-confirm-replenish")')
        page.locator('[data-tab="shipyard"]').click(); page.locator('[data-bind="squeue-list"] [data-action="cancel-units"]').click(); fleet(page)
        check('actual paid-queue cancellation retires changed-deficit review', page.locator('#formation-review-panel').is_hidden())
        preview(page)
        page.evaluate('''() => {const b=window.__priorConfirm;document.querySelector('#fleet-formations').append(b);b.disabled=false;b.click();}''')
        check('retired node cannot spend a newer review capability', not read(page)['orders']['tasks'])
        authorized = apply(page)
        check('current review alone accepts increased deficit after explicit re-preview', next(task for task in authorized['orders']['tasks'] if task['unit'] == 'light_fighter')['quantity'] == 7)
        context.close()

        for attack in ('clone', 'remove-reinsert', 'old-editor'):
            case = 'true-node authority: ' + attack
            context, page = boot(); before = save(page)
            if attack == 'old-editor':
                row_action(page, 'edit'); page.evaluate('window.__oldSave=document.querySelector("#formation-save")')
                page.locator('#formation-cancel-edit').click(); row_action(page, 'edit'); page.locator('#formation-name').fill('新编辑意图')
                page.evaluate('''() => {const b=window.__oldSave;document.querySelector('#formation-editor').append(b);b.disabled=false;b.click();}''')
                check('old save node cannot consume a newly opened editor', read(page)['formations'] == before['formations'])
                page.locator('#formation-editor .formation-actions #formation-save').click()
                check('fresh editor save remains usable', read(page)['formations']['entries'][0]['name'] == '新编辑意图')
            else:
                select(page, HOME); preview(page)
                if attack == 'clone':
                    page.evaluate('''() => {const b=document.querySelector('#formation-confirm-replenish').cloneNode(true);document.querySelector('#formation-review-panel').append(b);b.click();}''')
                else:
                    page.evaluate('''() => {const b=document.querySelector('#formation-confirm-replenish');b.remove();document.querySelector('#formation-review-panel .formation-actions').prepend(b);b.click();}''')
                check('unregistered or removed capability cannot create tasks', not read(page)['orders']['tasks'])
            context.close()

        case = 'task identity changes invalidate preview without automatic renewal'
        context, page = boot(); select(page, HOME); preview(page); plans(page)
        page.locator('#order-budget-metal').fill('1000'); page.locator('#order-create').click(); fleet(page)
        check('another order consuming task identity retires formation preview', page.locator('#formation-review-panel').is_hidden() and len(read(page)['orders']['tasks']) == 1)
        context.close()

        for replacement in ('import', 'reset'):
            case = replacement + ': successful world replacement retires same IDs and dispatch provenance'
            context, page = boot(); row_action(page, 'edit'); select(page, HOME); page.locator('#formation-fill').click(); preview(page)
            original_other = other_values(page)
            page.evaluate('''() => {window.__oldFormationButtons=[...document.querySelectorAll('#formation-library button'),document.querySelector('#formation-fill'),document.querySelector('#formation-save'),document.querySelector('#formation-confirm-replenish')];window.__oldFormationName=document.querySelector('#formation-name');}''')
            if replacement == 'reset':
                page.locator('[data-tab="save"]').click(); page.once('dialog', lambda dialog: dialog.accept()); page.locator('[data-action="reset"]').click(); fleet(page)
                check('real reset clears library', not read(page)['formations']['entries'])
                create(page, name='同编号的新世界编成')
            else:
                import_fixture(page)
            before = copy.deepcopy(read(page))
            check('successful replacement clears all formation-filled ship quantities', all(value == '0' for value in ship_values(page).values()) and page.locator('#formation-dispatch-source').is_hidden())
            check('replacement clearing leaves non-ship dispatch fields alone', other_values(page) == original_other)
            page.evaluate('''() => {const root=document.querySelector('#fleet-formations');for(const b of window.__oldFormationButtons){root.append(b);b.disabled=false;b.click();}for(const kind of ['input','change','blur'])window.__oldFormationName.dispatchEvent(new Event(kind,{bubbles:true}));document.querySelector('#formation-editor').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}''')
            check('old list, fill, editor and review nodes cannot bind same IDs', read(page)['formations'] == before['formations'] and read(page)['orders'] == before['orders'] and all(value == '0' for value in ship_values(page).values()))
            check('fresh explicit selection required after replacement', page.locator('#formation-selection').is_hidden())
            check('cleared old formation cannot dispatch in replacement world', page.locator('#space-send').is_disabled())
            context.close()

        case = 'failed import preserves current fill, drafts and review authority'
        context, page = boot(); select(page, HOME); page.locator('#formation-fill').click(); preview(page)
        before, filled = save(page), ship_values(page); import_fixture(page, invalid=True)
        check('failed replacement preserves current world and filled quantities', read(page) == before and ship_values(page) == filled and page.locator('#formation-dispatch-source').is_visible())
        check('failed import does not falsely retire valid review', page.locator('#formation-review-panel').is_visible() and page.locator('#formation-confirm-replenish').is_enabled())
        apply(page); check('preserved review still creates once after failed import', len(read(page)['orders']['tasks']) == 2)
        context.close()

        case = 'explicit fill supersedes pending native file read'
        context, page = boot(); select(page)
        incoming = copy.deepcopy(fixtures['base']); incoming['savedAt'] = incoming['lastTickAt'] = page.evaluate('Date.now()')
        page.locator('[data-tab="save"]').click()
        page.evaluate('''() => {const nativeText=File.prototype.text;window.__pendingFormationFile=null;File.prototype.text=function(){return new Promise((resolve,reject)=>nativeText.call(this).then(text=>{window.__pendingFormationFile={release:()=>resolve(text)}},reject))};}''')
        page.locator('[data-bind="import-file"]').set_input_files({'name': 'anonymous-delayed-formation.json', 'mimeType': 'application/json', 'buffer': json.dumps(incoming, ensure_ascii=False).encode()})
        page.wait_for_function('window.__pendingFormationFile !== null'); fleet(page); page.locator('#formation-fill').click()
        before, filled = copy.deepcopy(read(page)), ship_values(page)
        page.evaluate('window.__pendingFormationFile.release()'); advance(page)
        check('new explicit fill cancels pending replacement intent', read(page) == before and ship_values(page) == filled and len(read(page)['formations']['entries']) == 1)
        context.close()

        case = 'cancelled manual curvature preserves current explicit fill and review'
        context, page = boot('curvature'); select(page, HOME); page.locator('#formation-fill').click(); preview(page); filled = ship_values(page)
        page.locator('[data-tab="curvature"]').click(); page.once('dialog', lambda dialog: dialog.dismiss()); page.locator('[data-action="prestige"]').click(); fleet(page)
        check('cancelled launch retains valid review and filled snapshot', page.locator('#formation-confirm-replenish').is_enabled() and ship_values(page) == filled)
        context.close()
        for mode in ('manual', 'protocol-live', 'protocol-offline'):
            case = mode + ': actual curvature clears formation-derived dispatch and review'
            context, page = boot('curvature' if mode == 'manual' else 'automatic')
            row_action(page, 'edit'); select(page, HOME); page.locator('#formation-fill').click(); preview(page)
            page.evaluate('window.__preLaunchFormation=document.querySelector("#formation-confirm-replenish")')
            before = copy.deepcopy(read(page)['formations'])
            if mode == 'manual':
                page.locator('[data-tab="curvature"]').click(); page.once('dialog', lambda dialog: dialog.accept()); page.locator('[data-action="prestige"]').click(); fleet(page)
            elif mode == 'protocol-live':
                for _ in range(10):
                    advance(page, 1000)
            else:
                advance(page, 60000); fleet(page)
            launched = save(page)
            check('actual curvature adoption preserves pure library without applying', launched['stats']['launches'] == 1 and launched['formations'] == before and not launched['orders']['tasks'])
            check('world adoption retires editor and selected review synchronously', page.locator('#formation-selection').is_hidden() and page.locator('#formation-save').is_disabled())
            check('world adoption clears filled quantities and provenance before dispatch', all(value == '0' for value in ship_values(page).values()) and page.locator('#formation-dispatch-source').is_hidden() and page.locator('#space-send').is_disabled())
            page.evaluate('''() => {const b=window.__preLaunchFormation;document.querySelector('#fleet-formations').append(b);b.disabled=false;b.click();const n=document.querySelector('#formation-name');for(const kind of ['input','change','blur'])n.dispatchEvent(new Event(kind,{bubbles:true}));}''')
            check('old post-launch controls cannot create new-world plans', not read(page)['orders']['tasks'])
            context.close()

        case = 'responsive stable drafts, focus, caret, IME and keyboard'
        context, page = boot()
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 1100}); row_action(page, 'edit')
            field = page.locator('#formation-name'); field.fill('编成草稿' * 12)
            page.locator('[data-formation-unit="cruiser"]').fill('987654')
            field.evaluate('(e)=>{e.focus();e.setSelectionRange(7,9);e.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:"编"}));window.__focusedFormation=e}')
            for _ in range(3):
                advance(page, 1000)
            check(f'{width}px: focused node, caret and draft preserved during ordinary updates', field.evaluate('(e)=>document.activeElement===e && e===window.__focusedFormation && e.selectionStart===7 && e.selectionEnd===9') and field.input_value() == '编成草稿' * 12)
            check(f'{width}px: independent quantities survive ordinary updates', page.locator('[data-formation-unit="cruiser"]').input_value() == '987654')
            field.evaluate('(e)=>e.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"编"}))')
            check(f'{width}px: no document horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            snap(page, f'formations-{width}'); page.locator('#formation-cancel-edit').click()
        page.locator('#formation-new').click(); page.locator('#formation-name').fill('键盘保存'); page.locator('[data-formation-unit="light_fighter"]').fill('1'); page.locator('#formation-name').press('Enter')
        check('keyboard submit saves one explicitly opened design', len(read(page)['formations']['entries']) == 2)
        context.close()

        case = 'protected save disables all formation writes and preserves raw bytes'
        context, page = boot(corrupt=True); raw = page.evaluate('(key)=>localStorage.getItem(key)', KEY)
        check('protected save disables formation creation and all action controls', page.locator('#formation-new').is_disabled() and page.locator('#fleet-formations button').evaluate_all('(xs)=>xs.every(x=>x.disabled)'))
        page.evaluate('''() => {const b=document.querySelector('#formation-new');b.disabled=false;b.click();}'''); advance(page, 60000)
        check('protected native save remains byte exact', page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw)
        context.close()
        case = 'suite integrity'
        check('no JavaScript errors', not errors); check('no failed production requests', not failed_requests)
        completed = True; browser.close()
finally:
    if not completed and active_page is not None:
        diagnostics = {'case': case, 'lastSavedSyntheticState': last_saved}
        try:
            diagnostics['currentSave'] = json.loads(active_page.evaluate('(key)=>localStorage.getItem(key)', KEY))
            diagnostics['formationStatus'] = active_page.locator('#formation-status').all_text_contents()
            diagnostics['globalStatus'] = active_page.locator('[data-bind="status"]').all_text_contents()
            snap(active_page, 'failure')
        except Exception as error:
            diagnostics['captureError'] = str(error)
    report = {'completed': completed, 'mode': MODE, 'url': args.url, 'fixture': fixtures.get('description'),
        'timing': 'Explicit synthetic Date/performance/RAF timestamps. Real HTTP, native localStorage and input. Stale-node attacks dispatch synthetic events; pending File test delays native File.text completion only.',
        'passed': sum(value['passed'] for value in checks), 'checks': checks, 'errors': errors,
        'failedRequests': failed_requests, 'failureDiagnostics': diagnostics}
    (out / 'formations-browser-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'completed': completed, 'passed': report['passed'], 'total': len(checks), 'failedCase': None if completed else case, 'errors': errors}, ensure_ascii=False))
