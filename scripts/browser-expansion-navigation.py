"""Read-only expansion inspection on the real HTTP production bundle.

Anonymous strictly settled fixtures, native localStorage and native input.
Date/performance/RAF are controlled explicitly. The visibility-gate case uses
an explicitly synthetic document.hidden getter; it is not an OS-background test.
All existing natural-time and mutation-authority suites remain separate.
"""
import argparse
import copy
import hashlib
import json
import platform
import shutil
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='expansion-navigation-review-save.json')
parser.add_argument('--output', default='expansion-navigation-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY, HOME, COLONY = fixtures['key'], fixtures['homeId'], fixtures['colonyId']
ROOT, POSITION = '#expansion-navigation', '#expansion-position'
MODE = 'HTTP / native Storage and input / controlled Date-performance-RAF'
EPOCH = int(time.time() * 1000)
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests, audits, layouts = [], [], [], [], []
completed, active_page, diagnostics = False, None, None
case = 'setup'

INIT = r"""(() => {
 window.__fileImportConfirmations=[];
 const nativeConfirm=window.confirm.bind(window);
 window.confirm=message=>{window.__fileImportConfirmations.push(String(message));return nativeConfirm(message);};
 const key=__KEY__, raf=requestAnimationFrame.bind(window);
 const get=Storage.prototype.getItem, set=Storage.prototype.setItem;
 let elapsed=0;
 Date.now=()=>__EPOCH__+elapsed;
 Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=callback=>raf(()=>callback(elapsed));
 window.__expansionAdvance=async ms=>{elapsed+=ms;await new Promise(raf);await new Promise(raf);};
 window.__expansionNativeStorage=localStorage instanceof Storage &&
  /\[native code\]/.test(Function.prototype.toString.call(get)) &&
  /\[native code\]/.test(Function.prototype.toString.call(set));
 window.__expansionRead=()=>get.call(localStorage,key);
 window.__expansionWrites=[];window.__expansionStorage=[];window.__expansionFault=false;
 Storage.prototype.getItem=function(k){
  k=String(k);
  if(this===localStorage)window.__expansionStorage.push({operation:'read',key:k,clock:Date.now()});
  return get.call(this,k);
 };
 Storage.prototype.setItem=function(k,v){
  k=String(k);v=String(v);
  if(this===localStorage)window.__expansionStorage.push({operation:'write',key:k,clock:Date.now()});
  if(this===localStorage && k===key){
   window.__expansionWrites.push({key:k,value:v,clock:Date.now(),fault:window.__expansionFault});
   if(window.__expansionFault)throw new DOMException('Controlled save write failure','QuotaExceededError');
  }
  return set.call(this,k,v);
 };
})();""".replace('__KEY__', json.dumps(KEY)).replace('__EPOCH__', str(EPOCH))


def check(name, condition):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), 'classification': MODE})
    if not condition:
        raise AssertionError(f'{case}: {name}')


def confirmation_count(page):
    return page.evaluate('window.__fileImportConfirmations.length')


def accept_file_confirmation(page, incoming, current):
    # Install only around this successful current read, never on every page/dialog.
    active = next(planet for planet in current['planets'] if planet['id'] == current['activePlanetId'])
    progress = f'第 {current["stats"]["launches"] + 1} 轮，{len(current["planets"])} 颗星球，当前“{active["name"]}”'
    seen = []
    def answer(dialog):
        seen.append({'type': dialog.type, 'message': dialog.message})
        assertions = [
            ('file import presents a native confirm', dialog.type == 'confirm'),
            ('file confirmation identifies the actual source version and revision', dialog.message.startswith(f'已读取存档 v{incoming["version"]}/r{incoming["revision"]}。')),
            ('file confirmation names the current round and planet progress', f'是否替换当前进度（{progress}）？' in dialog.message),
            ('file confirmation warns that read-time changes will be replaced', '读取期间产生的变化也会被替换' in dialog.message),
            ('file confirmation promises adoption only after verified persistence', '写入校验成功后才采用' in dialog.message),
        ]
        if not all(condition for _, condition in assertions):
            dialog.dismiss()
        for name, condition in assertions:
            check(name, condition)
        dialog.accept()
    page.once('dialog', answer)
    return seen


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__expansionAdvance(ms)', milliseconds)


def raw(page):
    return page.evaluate('window.__expansionRead()')


def writes(page):
    return page.evaluate('window.__expansionWrites')


def clear_audit(page):
    page.evaluate('window.__expansionWrites.length=0;window.__expansionStorage.length=0')


def storage_operations(page, current_only=False):
    values = page.evaluate('window.__expansionStorage')
    return [row for row in values if row['key'] == KEY] if current_only else values


def record_audit(page):
    values = writes(page)
    for row in values:
        value = row.pop('value')
        row['bytes'] = len(value.encode()); row['sha256'] = hashlib.sha256(value.encode()).hexdigest()
    audits.append({'case': case, 'writes': values, 'nativeLocalStorageOperations':storage_operations(page)})


def dismiss_offline(page):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()


def tab(page, name):
    dismiss_offline(page)
    page.locator(f'[data-tab="{name}"]').click(); advance(page)


def inspector(page, target=None):
    tab(page, 'galaxy')
    if target is not None:
        page.locator('#browse-galaxy').fill(str(target['galaxy']))
        page.locator('#browse-system').fill(str(target['system']))
        page.locator('[data-space="browse"]').click(); advance(page)
    if not page.locator(ROOT).evaluate('(e)=>e.open'):
        page.locator('#expansion-navigation-summary').click(); advance(page)
    if target is not None:
        page.locator(POSITION).select_option(str(target['position'])); advance(page)
    expect(page.locator(ROOT)).to_have_attribute('data-expansion-ready', 'true')


def boot(which='base', width=1440):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Acceptance requires real HTTP(S)')
    seed = copy.deepcopy(fixtures[which]); seed['savedAt'] = seed['lastTickAt'] = EPOCH
    context = browser.new_context(viewport={'width':width,'height':1100}, reduced_motion='reduce', accept_downloads=True,
        storage_state={'cookies':[],'origins':[{'origin':f'{parsed.scheme}://{parsed.netloc}','localStorage':[
            {'name':KEY,'value':json.dumps(seed,ensure_ascii=False)}, {'name':'infinity.ui.tab','value':'overview'}]}]})
    context.add_init_script(INIT)
    page = context.new_page(); active_page = page
    page.set_default_timeout(10000)
    page.on('pageerror', lambda error: errors.append({'case':case,'error':str(error)}))
    page.on('requestfailed', lambda request: failed_requests.append({'case':case,'url':request.url}))
    response = page.goto(args.url,wait_until='networkidle')
    check('actual HTTP production response', response is not None and response.status == 200)
    check('backing localStorage methods are native', page.evaluate('window.__expansionNativeStorage'))
    page.locator('[data-bind="amount-metal"]').wait_for(); advance(page)
    check('inspector starts folded', not page.locator(ROOT).evaluate('(e)=>e.open'))
    check('no expansion model computed before first visible opening', revision(page) == 0)
    return context, page


def revision(page):
    return int(page.locator(ROOT).get_attribute('data-expansion-revision'))


def exported(page, name):
    tab(page,'save')
    with page.expect_download() as pending:
        page.locator('[data-action="export"]').click()
    download = pending.value
    check('native full-save download succeeds', download.failure() is None)
    path = out / (name+'.json'); download.save_as(path)
    return json.loads(path.read_text())


def draft(page):
    return page.evaluate('''() => Object.fromEntries([
      ...document.querySelectorAll('[data-ship]'),
      ...['flight-mission','flight-speed','flight-galaxy','flight-system','flight-position','cargo-metal','cargo-crystal','cargo-deuterium','charge-slots','charge-bets']
       .map(id=>document.getElementById(id))
    ].map(e=>[e.id||e.dataset.ship,e.type==='checkbox'?e.checked:e.value]))''')


def configure_draft(page):
    tab(page,'fleet')
    page.locator('#flight-mission').select_option('charge'); advance(page)
    page.locator('#flight-speed').select_option('70')
    for key,value in {'galaxy':2,'system':19,'position':16}.items():
        page.locator('#flight-'+key).fill(str(value))
    for resource,value in zip(('metal','crystal','deuterium'),('43','17','9')):
        page.locator('#cargo-'+resource).fill(value)
    page.locator('#charge-slots').select_option('2'); page.locator('#charge-bets').check()
    page.locator('[data-ship="small_cargo"]').fill('7')
    page.locator('[data-ship="colony_ship"]').fill('2')
    advance(page)


def snapshot(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    page.evaluate('scrollTo(0,0)')
    page.screenshot(path=str(out/(name+'-top.png')))
    page.screenshot(path=str(out/(name+'.png')),full_page=True)


def expect_scenario(page, expected, index):
    row = page.locator(f'[data-expansion-scenario="{index}"]')
    quote = row.locator('[data-expansion-quote]')
    check('scenario mission is explicit '+expected['mission'], row.get_attribute('data-expansion-mission') == expected['mission'])
    check('quote result equals direct quoteFlight '+expected['mission'], row.get_attribute('data-expansion-ok') == str(expected['ok']).lower())
    check('exact first quote reason '+expected['mission'], quote.get_attribute('data-expansion-reason') == expected['reason'])
    assumptions = row.locator('[data-expansion-assumptions]').inner_text()
    check('one ship, full speed and zero cargo are stated '+expected['mission'], '1 艘' in assumptions and '100%' in assumptions and '零货物' in assumptions)
    risk = row.locator('[data-expansion-risk]').inner_text()
    check('scenario includes risk and prepaid fuel '+expected['mission'], '往返燃料预先扣除' in risk and len(risk) > 35)
    if expected['mission'] == 'charge':
        check('deep quote states one hold segment with no bets', '驻留 1 段' in assumptions and '无押注' in assumptions)
        check('deep risk includes losses and no prediction of outcome', '战损或全损' in risk and '尚未生成' in risk)
    if expected['ok']:
        check('exact unrounded duration equals real rules '+expected['mission'], float(quote.get_attribute('data-expansion-duration')) == expected['duration'])
        check('exact fuel and capacity equal real rules '+expected['mission'], quote.get_attribute('data-expansion-fuel') == expected['fuel'] and quote.get_attribute('data-expansion-capacity') == expected['capacity'])
        check('exact hold and stake equal real rules '+expected['mission'], float(quote.get_attribute('data-expansion-hold-seconds')) == expected.get('holdSeconds',0) and float(quote.get_attribute('data-expansion-stake')) == expected.get('stake',0))
    else:
        check('blocked quote displays exact first reason '+expected['mission'], quote.inner_text() == '当前场景不通过：'+expected['reason'])
        check('blocked quote has no fabricated zero duration, fuel or capacity '+expected['mission'], all(quote.get_attribute('data-expansion-'+field) is None for field in ('duration','fuel','capacity','hold-seconds','stake')))


def expect_projection(page, expected):
    check('exactly sixteen local status positions', page.locator(POSITION+' option').count() == 16)
    statuses = page.locator(POSITION+' option').evaluate_all('(xs)=>xs.map(x=>x.dataset.expansionStatus)')
    check('every status equals actual owned/NPC/outbound/deep rules', statuses == expected['statuses'])
    check('selected status is explicit', page.locator('#expansion-selected-status').get_attribute('data-expansion-status') == expected['status'])
    check('actual active origin is labeled without selecting target', page.locator(ROOT).get_attribute('data-expansion-origin') == expected['originId'] and expected['originName'] in page.locator('#expansion-origin').inner_text())
    check('ring distance comes from the actual origin', page.locator('#expansion-distance').inner_text().endswith('：'+str(expected['distance'])))
    if expected['properties'] is None:
        check('deep has no invented planet properties', '没有可殖民行星' in page.locator('#expansion-properties').inner_text() and page.locator('#expansion-properties').get_attribute('data-expansion-source') is None)
    else:
        properties = expected['properties']; text = page.locator('#expansion-properties').inner_text()
        check('properties use exact saved or generated values', f"{properties['tempMax']-40}～{properties['tempMax']} °C" in text and str(properties['fieldsMax'])+' 格' in text)
        check('property source is labeled honestly', page.locator('#expansion-properties').get_attribute('data-expansion-source') == ('stored' if expected['owned'] else 'provisional'))
    if expected['home']:
        check('homeworld keeps its baseline rather than coordinate bonuses', '母星基准：不应用位置矿产加成' == page.locator('#expansion-bonuses').inner_text())
    cap = expected['capacity']
    check('colony allowance uses completed levels and outbound reservations', f"殖民地 {cap['colonies']}/{cap['colonyLimit']}" in page.locator('#expansion-colony-limit').inner_text() and f"出航预留 {cap['reserved']}" in page.locator('#expansion-colony-limit').inner_text())
    check('global planet safety cap remains independently visible', f"{cap['planets']}/{cap['globalLimit']}" in page.locator('#expansion-planet-limit').inner_text())
    check('all flights including returns consume actual slots', f"舰队槽 {cap['fleets']}/{cap['fleetLimit']}" in page.locator('#expansion-fleet-limit').inner_text())
    check('all charge flights including returns consume expedition slots', f"远征槽 {cap['expeditions']}/{cap['expeditionLimit']}" in page.locator('#expansion-expedition-limit').inner_text())
    check('only selected scenarios are visible, never sixteen route quotes', page.locator('[data-expansion-scenario]:visible').count() == len(expected['scenarios']))
    check('displayed total capacity explicitly includes prepaid return fuel', '往返燃料也占用货舱' in page.locator(ROOT).inner_text())
    check('inspector has no dispatch, route, save, research or action controls', page.locator(ROOT+' [data-action], '+ROOT+' [data-space], '+ROOT+' button, '+ROOT+' input').count() == 0)
    for index,scenario in enumerate(expected['scenarios']):
        expect_scenario(page,scenario,index)


def replacement(page, which='incoming', invalid=False):
    seed = copy.deepcopy(fixtures[which]); seed['savedAt'] = seed['lastTickAt'] = page.evaluate('Date.now()')
    if invalid:
        seed['state']['formations']['nextFormationId'] = 0
    tab(page,'save'); page.locator('#transfer').fill(json.dumps(seed,ensure_ascii=False))
    page.locator('[data-action="import-text"]').click(); advance(page)


def run_cases():
    global case, completed
    case = 'frozen full-state, storage and independent fleet draft purity'
    context,page = boot('ready'); configure_draft(page)
    before = exported(page,'readonly-before'); original_draft = draft(page); original_raw = raw(page)
    check('settled native startup matches the entire strict fixture state', before['state'] == fixtures['ready']['state'])
    clear_audit(page)
    inspector(page,fixtures['empty'])
    check('opening inspector reads or writes no game-save slot', not storage_operations(page,current_only=True))
    clear_audit(page)
    for position in range(1,17):
        page.locator(POSITION).select_option(str(position)); advance(page)
    for action in ('next','prev','home'):
        page.locator('[data-space="'+action+'"]').click(); advance(page)
    page.locator('#expansion-navigation-summary').click(); advance(page)
    page.locator('#expansion-navigation-summary').click(); advance(page)
    check('inspection and browsing perform no current-slot writes', not writes(page) and raw(page) == original_raw)
    check('inspector-only positions browse and details read or write no localStorage key', not storage_operations(page))
    check('every independent fleet field remains byte-for-byte unchanged', draft(page) == original_draft)
    after = exported(page,'readonly-after')
    check('whole exported live state including RNG queues plans fleet counters and selection is unchanged', after == before)
    check('native export also performs no current-slot writes', not writes(page))
    note = page.locator('[data-tab-panel="save"] p').first.inner_text()
    check('save documentation advertises current v9 r9 and r2-r8 migrations', 'v9 / r9' in note and 'r2–r8' in note)
    record_audit(page); context.close()

    for row in fixtures['cases']:
        case = 'actual rules: '+row['name']
        context,page = boot(row['fixture']); original_raw = raw(page); clear_audit(page)
        inspector(page,row['target']); expect_projection(page,row['expected'])
        if row['name'] == 'noShipyard':
            check('missing new-build prerequisite does not block existing colony ship flight', '造船厂：已完成 0 / 需要 4 级（未满足）' in page.locator('#expansion-prerequisites').inner_text() and row['expected']['scenarios'][0]['ok'])
        if row['name'] == 'queued':
            check('queued astrophysics target has not become completed research', '天体物理学 2 级' in page.locator('#expansion-research').inner_text() and fixtures['queued']['state']['research']['queue'][0]['targetLevel'] == 3)
        if row['name'] == 'originColony':
            check('prerequisites use actual origin local buildings', '研究实验室：已完成 0 / 需要 3 级（未满足）' in page.locator('#expansion-prerequisites').inner_text())
        check('native rule inspection never reads or writes the current save slot', not storage_operations(page,current_only=True) and raw(page) == original_raw)
        record_audit(page); context.close()

    case = 'actual origin changes immediately while local selection stays local'
    context,page = boot(); inspector(page,fixtures['empty']); before = revision(page)
    page.locator('#planet-select').select_option(COLONY); advance(page)
    check('explicit global origin change refreshes without waiting one second', revision(page) > before and page.locator(ROOT).get_attribute('data-expansion-origin') == COLONY)
    check('global origin switch does not turn inspected target into active planet', page.locator(POSITION).input_value() == str(fixtures['empty']['position']) and json.loads(raw(page))['state']['activePlanetId'] == COLONY)
    context.close()

    case = 'pending native file read survives inspector-only interactions'
    context,page = boot(); inspector(page,fixtures['empty'])
    incoming = copy.deepcopy(fixtures['incoming']); incoming['savedAt'] = incoming['lastTickAt'] = page.evaluate('Date.now()')
    tab(page,'save')
    page.evaluate('''() => {const nativeText=File.prototype.text;window.__pendingExpansionFile=null;
      File.prototype.text=function(){return new Promise((resolve,reject)=>nativeText.call(this).then(text=>{
        window.__pendingExpansionFile={release:()=>resolve(text)};
      },reject));};}''')
    before_confirmations = confirmation_count(page)
    page.locator('[data-bind="import-file"]').set_input_files({'name':'anonymous-delayed-expansion.json','mimeType':'application/json','buffer':json.dumps(incoming,ensure_ascii=False).encode()})
    page.wait_for_function('window.__pendingExpansionFile !== null')
    original_raw = raw(page); clear_audit(page)
    inspector(page,fixtures['colonyCoordinates'])
    for position in (16,3,12):
        page.locator(POSITION).select_option(str(position)); advance(page)
    page.locator('[data-space="next"]').click(); advance(page)
    page.locator('#expansion-navigation-summary').click(); advance(page)
    page.locator('#expansion-navigation-summary').click(); advance(page)
    check('held file is still pending and inspection never reads or writes its save slot', raw(page) == original_raw and not storage_operations(page,current_only=True))
    check('native file read and read-only inspection never confirm before completion', confirmation_count(page) == before_confirmations)
    file_dialogs = accept_file_confirmation(page, incoming, json.loads(original_raw)['state'])
    page.evaluate('window.__pendingExpansionFile.release()'); advance(page)
    check('current read after inspection asks exactly one replacement confirmation', len(file_dialogs) == 1 and confirmation_count(page) == before_confirmations + 1)
    page.wait_for_function('document.querySelector("#expansion-position").value === "1"')
    adopted = json.loads(raw(page))['state']
    check('file completion adopts exact replacement after all read-only interactions', adopted == incoming['state'])
    check('successful pending replacement clears old local inspection', page.locator(POSITION).input_value() == '1' and page.locator(ROOT).get_attribute('data-expansion-origin') == HOME)
    record_audit(page); context.close()

    for mode in ('same-id-import','reset','manual','protocol-live','protocol-offline'):
        case = mode+': actual adoption clears old inspected position'
        context,page = boot('automatic' if mode.startswith('protocol') else 'curvature')
        inspector(page,{**fixtures['cursor'],'position':16})
        check('old inspection is selected before replacement', page.locator(POSITION).input_value() == '16')
        if mode == 'same-id-import':
            replacement(page)
        elif mode == 'reset':
            tab(page,'save'); page.once('dialog',lambda dialog:dialog.accept()); page.locator('[data-action="reset"]').click(); advance(page)
        elif mode == 'manual':
            tab(page,'curvature'); page.once('dialog',lambda dialog:dialog.accept()); page.locator('[data-action="prestige"]').click(); advance(page)
        elif mode == 'protocol-live':
            for _ in range(10):
                advance(page,1000)
        else:
            advance(page,60000)
        # Inspect the stable control before switching tabs or explicitly choosing anew.
        check('adoption synchronously resets local selection even with reused IDs', page.locator(POSITION).input_value() == '1')
        inspector(page)
        check('fresh inspection has no old deep scenario or position', page.locator(ROOT).get_attribute('data-expansion-selected') == '1' and page.locator('[data-expansion-scenario]:visible').count() == 1)
        if mode in ('manual','protocol-live','protocol-offline'):
            check('real manual or engine curvature happened exactly once', exported(page,'adoption-'+mode)['state']['stats']['launches'] == 1)
        if mode == 'same-id-import':
            check('same-ID replacement displays the new world name', '导入同 ID 的新母星' in page.locator('#expansion-origin').inner_text())
        context.close()

    for failure in ('invalid-import','cancelled-reset','cancelled-manual','write-failed-manual'):
        case = failure+': rejected replacement keeps inspected position'
        context,page = boot('curvature'); inspector(page,{**fixtures['cursor'],'position':16})
        before = exported(page,'failure-before-'+failure)['state']
        if failure == 'invalid-import':
            replacement(page,invalid=True)
        elif failure == 'cancelled-reset':
            tab(page,'save'); page.once('dialog',lambda dialog:dialog.dismiss()); page.locator('[data-action="reset"]').click()
        else:
            tab(page,'curvature')
            if failure == 'write-failed-manual':
                page.evaluate('window.__expansionFault=true')
            page.once('dialog',lambda dialog:dialog.accept() if failure == 'write-failed-manual' else dialog.dismiss())
            page.locator('[data-action="prestige"]').click()
        advance(page); inspector(page)
        check('failed or cancelled replacement retains current local inspection', page.locator(POSITION).input_value() == '16' and page.locator(ROOT).get_attribute('data-expansion-selected') == '16')
        after = exported(page,'failure-after-'+failure)['state']
        check('failed or cancelled replacement retains the whole world', after == before)
        record_audit(page); context.close()

    case = 'bounded model work, stable focus and four-width native controls'
    context,page = boot(); tab(page,'galaxy')
    for _ in range(3):
        advance(page,1000)
    check('visible galaxy with closed details does no expansion projection', revision(page) == 0)
    inspector(page,fixtures['empty'])
    for width in (320,390,768,1440):
        page.set_viewport_size({'width':width,'height':1100})
        field = page.locator(POSITION); field.focus()
        page.evaluate('window.__expansionFocus=document.activeElement')
        old = revision(page)
        for _ in range(6):
            advance(page)
        check(f'{width}px: zero-time ordinary frames do not recompute the model', revision(page) == old)
        advance(page,500)
        check(f'{width}px: ordinary model work is throttled below one second', revision(page) == old)
        advance(page,500)
        check(f'{width}px: one elapsed second produces exactly one current projection', revision(page) == old+1)
        check(f'{width}px: focused select node survives ordinary refresh', field.evaluate('(e)=>e===window.__expansionFocus && document.activeElement===e'))
        check(f'{width}px: bounded sixteen rows and at most two scenario nodes', page.locator(POSITION+' option').count() == 16 and page.locator('[data-expansion-scenario]').count() == 2)
        check(f'{width}px: no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
        geometry = page.locator(ROOT).evaluate('''e=>({width:innerWidth,box:e.getBoundingClientRect().toJSON(),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,
          overflowing:[...e.querySelectorAll('p,h3,h4,select')].filter(n=>n.getClientRects().length && n.scrollWidth>n.clientWidth+1).map(n=>({id:n.id,text:n.textContent,scroll:n.scrollWidth,width:n.clientWidth}))})''')
        layouts.append(geometry)
        check(f'{width}px: inspector text wraps within its own controls and boxes', not geometry['overflowing'] and geometry['scrollWidth'] <= geometry['clientWidth']+1)
        snapshot(page,'expansion-'+str(width))
        summary = page.locator('#expansion-navigation-summary'); summary.focus(); summary.press('Enter'); advance(page)
        old = revision(page); advance(page,1000)
        check(f'{width}px: keyboard closes native details and suppresses projection', not page.locator(ROOT).evaluate('(e)=>e.open') and revision(page) == old)
        summary.press('Enter'); advance(page)
        check(f'{width}px: reopening refreshes immediately and keeps summary focus', revision(page) == old+1 and summary.evaluate('(e)=>document.activeElement===e'))
    tab(page,'overview'); old = revision(page)
    for _ in range(3):
        advance(page,1000)
    check('hidden galaxy tab performs no expansion projection', revision(page) == old)
    inspector(page)
    check('galaxy reentry refreshes latest state immediately', revision(page) == old+1)
    old = revision(page)
    page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})")
    for _ in range(3):
        advance(page,1000)
    check('explicit synthetic hidden-document gate suppresses expansion projection', revision(page) == old)
    page.evaluate('delete document.hidden'); advance(page)
    check('document-visible reentry refreshes immediately', revision(page) == old+1)
    before = revision(page)
    page.locator('[data-space="next"]').click(); advance(page)
    check('browsed system change refreshes without advancing controlled time', revision(page) == before+1)
    context.close()
    case = 'suite integrity'
    check('no JavaScript page errors', not errors)
    check('no failed production HTTP requests', not failed_requests)
    completed = True


# Failure evidence is captured before leaving the active Playwright connection.
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        run_cases()
    except BaseException:
        diagnostics = {'case':case}
        if active_page is not None and not active_page.is_closed():
            try:
                diagnostics['nativeCurrentRaw'] = raw(active_page)
                diagnostics['globalStatus'] = active_page.locator('[data-bind="status"]').all_text_contents()
                diagnostics['inspector'] = active_page.locator(ROOT).all_text_contents()
                diagnostics['fleetDraft'] = draft(active_page)
                diagnostics['revision'] = revision(active_page)
                record_audit(active_page); snapshot(active_page,'failure')
            except Exception as error:
                diagnostics['captureError'] = str(error)
        raise
    finally:
        report = {'completed':completed,'mode':MODE,'url':args.url,'fixture':fixtures.get('description'),
            'timing':'Date/performance/RAF controlled explicitly. Existing natural-time suites unchanged. Native File.text is delayed only in the named pending-file case. document.hidden override is a synthetic visibility-gate test, not genuine OS background timing.',
            'environment':{'platform':platform.platform(),'python':platform.python_version(),'browser':browser.version},
            'passed':sum(row['passed'] for row in checks),'checks':checks,'errors':errors,'failedRequests':failed_requests,
            'audit':audits,'layouts':layouts,'failureDiagnostics':diagnostics}
        (out/'expansion-navigation-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps({'completed':completed,'passed':report['passed'],'total':len(checks),'failedCase':None if completed else case},ensure_ascii=False))
        browser.close()
