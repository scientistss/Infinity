"""Curvature preview and manual save-before-adopt on the real HTTP production bundle.

Anonymous fixtures, native localStorage, native inputs and explicit controlled
Date/performance/RAF timestamps. Storage wrappers delegate to captured native
methods except labeled faults. This does not replace natural-time old suites.
"""
import argparse
import copy
import hashlib
import json
import platform
import re
import shutil
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='prestige-preview-review-save.json')
parser.add_argument('--output', default='prestige-preview-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY, HOME = fixtures['key'], fixtures['homeId']
EXPECTED = fixtures['expected']
ROOT = '#prestige-preview'
MODE = 'HTTP / native localStorage / anonymous synthetic controlled Date-performance-RAF timestamps'
EPOCH = int(time.time() * 1000)
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests, audits, timings, layout_proofs = [], [], [], [], [], []
completed, active_page, diagnostics = False, None, None
case = 'setup'

INIT = r"""(() => {
 const key=__KEY__, raf=requestAnimationFrame.bind(window), realNow=performance.now.bind(performance);
 const get=Storage.prototype.getItem, set=Storage.prototype.setItem;
 const previous=sessionStorage.getItem('prestige-test-clock');
 const epoch=previous ? Number(previous) : __EPOCH__;
 let time=0, written=false;
 Date.now=()=>epoch+time;
 Object.defineProperty(performance,'now',{value:()=>time});
 window.requestAnimationFrame=callback=>raf(()=>callback(time));
 window.__prestigeAdvance=async ms=>{
  time+=ms;sessionStorage.setItem('prestige-test-clock',String(epoch+time));
  await new Promise(raf);await new Promise(raf);
 };
 window.__prestigeRealNow=realNow;
 window.__prestigeNativeStorage=localStorage instanceof Storage &&
  /\[native code\]/.test(Function.prototype.toString.call(get)) &&
  /\[native code\]/.test(Function.prototype.toString.call(set));
 window.__prestigeNativeRead=()=>get.call(localStorage,key);
 window.__prestigeAudit=[];window.__prestigeFault=null;
 const view=()=>({planet:document.querySelector('[data-bind="ov-planet"]')?.textContent,
  status:document.querySelector('[data-bind="status"]')?.textContent,
  filled:document.querySelector('[data-ship="small_cargo"]')?.value});
 Storage.prototype.getItem=function(k){
  k=String(k);
  if(this===localStorage && k===key && window.__prestigeFault==='readback' && written){
   window.__prestigeAudit.push({operation:'read-throw',...view()});
   throw new DOMException('Injected post-write readback failure','SecurityError');
  }
  const value=get.call(this,k);
  if(this===localStorage && k===key)window.__prestigeAudit.push({operation:'read',value,...view()});
  return value;
 };
 Storage.prototype.setItem=function(k,v){
  k=String(k);v=String(v);
  if(this!==localStorage || k!==key)return set.call(this,k,v);
  window.__prestigeAudit.push({operation:'write-attempt',value:v,...view()});
  if(window.__prestigeFault==='write'){
   window.__prestigeAudit.push({operation:'write-throw',...view()});
   throw new DOMException('Injected current-slot quota failure','QuotaExceededError');
  }
  if(window.__prestigeFault==='drop'){
   window.__prestigeAudit.push({operation:'write-drop',...view()});return;
  }
  set.call(this,k,v);written=true;
  window.__prestigeAudit.push({operation:'write-return',value:v,...view()});
 };
 window.__prestigeClearAudit=()=>{window.__prestigeAudit.length=0;written=false;};
 window.addEventListener('storage',event=>{
  if(event.storageArea===localStorage && event.key===key)window.__prestigeAudit.push({operation:'storage-event',trusted:event.isTrusted});
 });
 let last='';
 new MutationObserver(()=>{
  const current=view(), text=JSON.stringify(current);
  if(text===last)return;last=text;
  window.__prestigeAudit.push({operation:'visible-update',...current,current:get.call(localStorage,key)});
 }).observe(document,{subtree:true,childList:true,characterData:true});
})();""".replace('__KEY__', json.dumps(KEY)).replace('__EPOCH__', str(EPOCH))


def check(name, condition):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), 'classification': MODE})
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds=0):
    page.evaluate('(ms)=>window.__prestigeAdvance(ms)', milliseconds)


def raw(page):
    return page.evaluate('window.__prestigeNativeRead()')


def read(page):
    return json.loads(raw(page))['state']


def dismiss_offline(page):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()


def tab(page, name):
    dismiss_offline(page); page.locator(f'[data-tab="{name}"]').click(); advance(page)


def preview(page):
    tab(page, 'curvature'); expect(page.locator(ROOT)).to_be_visible()


def boot(which='rich', width=1440):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Acceptance requires actual HTTP(S)')
    seed = copy.deepcopy(fixtures[which]); seed['savedAt'] = seed['lastTickAt'] = EPOCH
    context = browser.new_context(viewport={'width':width,'height':1100}, reduced_motion='reduce', accept_downloads=True,
        storage_state={'cookies':[],'origins':[{'origin':f'{parsed.scheme}://{parsed.netloc}','localStorage':[
            {'name':KEY,'value':json.dumps(seed, ensure_ascii=False)}, {'name':'infinity.ui.tab','value':'overview'}]}]})
    context.add_init_script(INIT)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('actual HTTP production response', response is not None and response.status == 200)
    check('backing Storage methods are native', page.evaluate('window.__prestigeNativeStorage'))
    page.locator('[data-bind="amount-metal"]').wait_for(); advance(page)
    return context, page


def attach(page):
    page.set_default_timeout(10000)
    page.on('pageerror', lambda error: errors.append({'case':case,'error':str(error)}))
    page.on('requestfailed', lambda request: failed_requests.append({'case':case,'url':request.url}))


def clear_audit(page):
    page.evaluate('window.__prestigeClearAudit()')


def events(page):
    return page.evaluate('window.__prestigeAudit')


def record_audit(page):
    rows = events(page)
    for row in rows:
        for field in ('value','current'):
            value = row.get(field)
            if isinstance(value, str):
                row[field+'Sha256'] = hashlib.sha256(value.encode()).hexdigest()
                row[field+'Bytes'] = len(value.encode()); del row[field]
    audits.append({'case':case,'events':rows})


def launch(page, accept=True):
    messages = []
    def confirm(dialog):
        messages.append(dialog.message)
        dialog.accept() if accept else dialog.dismiss()
    page.once('dialog', confirm)
    page.locator('[data-action="prestige"]').click()
    advance(page)
    check('one native confirmation shown', len(messages) == 1)
    return messages[0]


def export(page, name):
    tab(page, 'save')
    with page.expect_download() as pending:
        page.locator('[data-action="export"]').click()
    file = pending.value
    check('native download succeeds', file.failure() is None)
    path = out / name; file.save_as(path)
    return path.read_text()


def snapshot(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    page.evaluate('scrollTo(0,0)')
    page.screenshot(path=str(out / (name+'-top.png')))
    page.screenshot(path=str(out / (name+'.png')), full_page=True)



def original_curvature_text_geometry(page):
    # Range boxes expose the actual laid-out text lines. A narrow paragraph alone
    # is insufficient proof: overflow:hidden/ellipsis could merely conceal digits.
    return page.locator('[data-bind="unspent-line"], [data-bind^="tech-preview-"]').evaluate_all(r"""elements => elements.map(element => {
      const style=getComputedStyle(element), box=element.getBoundingClientRect();
      const range=document.createRange();range.selectNodeContents(element);
      const rects=[...range.getClientRects()].filter(rect=>rect.width>0 && rect.height>0);
      const clippedBy=[];
      for(let parent=element;parent;parent=parent.parentElement){
        const css=getComputedStyle(parent), bounds=parent.getBoundingClientRect();
        const clipsX=['hidden','clip','scroll','auto'].includes(css.overflowX);
        const clipsY=['hidden','clip','scroll','auto'].includes(css.overflowY);
        if(rects.some(rect=>(clipsX && (rect.left<bounds.left-1 || rect.right>bounds.right+1)) ||
          (clipsY && (rect.top<bounds.top-1 || rect.bottom>bounds.bottom+1)))){
          clippedBy.push(parent.id || parent.getAttribute('data-bind') || parent.tagName.toLowerCase());
        }
      }
      return {bind:element.getAttribute('data-bind'),text:element.textContent,
        visible:element.getClientRects().length>0 && style.visibility==='visible' && style.display!=='none',
        rect:{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height},
        lineCount:rects.length,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,
        scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,
        allTextInside:rects.length>0 && rects.every(rect=>rect.left>=box.left-1 && rect.right<=box.right+1 && rect.top>=box.top-1 && rect.bottom<=box.bottom+1),
        whiteSpace:style.whiteSpace,overflowWrap:style.overflowWrap,wordBreak:style.wordBreak,
        overflowX:style.overflowX,overflowY:style.overflowY,textOverflow:style.textOverflow,
        lineClamp:style.webkitLineClamp,clippedBy};
    })""")


def overflow_diagnostics(page):
    return page.evaluate(r"""() => {
      const rect=box=>({left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height});
      const overflowing=[...document.querySelectorAll('body *')].flatMap(element=>{
        const box=element.getBoundingClientRect(),style=getComputedStyle(element);
        if(!element.getClientRects().length || !box.width || !box.height || style.visibility!=='visible' || style.display==='none')return [];
        if(box.left>=-1 && box.right<=innerWidth+1 && element.scrollWidth<=element.clientWidth+1)return [];
        return [{tag:element.tagName.toLowerCase(),id:element.id,classes:element.className,
          bind:element.getAttribute('data-bind'),text:element.textContent?.slice(0,600),rect:rect(box),
          scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,
          style:Object.fromEntries(['display','position','width','minWidth','maxWidth','height','minHeight','maxHeight','whiteSpace','overflowWrap','wordBreak','overflowX','overflowY','textOverflow','contain'].map(key=>[key,style[key]]))}];
      });
      return {viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},document:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},
        renderedOverflowCount:overflowing.length,elements:overflowing.slice(0,80),omitted:Math.max(0,overflowing.length-80)};
    }""")


def forms(page):
    tab(page, 'fleet')
    if not page.locator('#fleet-formations').evaluate('(e)=>e.open'):
        page.locator('#fleet-formations > summary').click()


def arm_review(page):
    forms(page)
    page.locator('[data-formation-id="2"] [data-formation-action="edit"]').click()
    page.locator('#formation-name').fill('未保存的曲率取消草稿')
    page.locator('[data-formation-id="2"] [data-formation-action="select"]').click()
    page.locator('#formation-payer').select_option(HOME)
    page.locator('#formation-fill').click(); page.locator('#formation-preview').click()
    expect(page.locator('#formation-confirm-replenish')).to_be_enabled()
    page.evaluate('''() => {
      window.__oldPrestigeReview=document.querySelector('#formation-confirm-replenish');
      window.__oldPrestigeSave=document.querySelector('#formation-save');
      window.__oldPrestigeName=document.querySelector('#formation-name');
      window.__oldPrestigeFill=document.querySelector('#formation-fill');
    }''')
    return page.locator('[data-ship="small_cargo"]').input_value()


def retained_forms(page, filled, enabled=True):
    forms(page)
    check('old-world explicit ship fill survives', page.locator('[data-ship="small_cargo"]').input_value() == filled)
    check('old-world unsaved editor draft survives', page.locator('#formation-name').input_value() == '未保存的曲率取消草稿')
    check('same review capability node remains', page.locator('#formation-confirm-replenish').evaluate('(e)=>e===window.__oldPrestigeReview'))
    if enabled:
        check('cancel or validation failure preserves usable review', page.locator('#formation-confirm-replenish').is_enabled())
    else:
        check('storage protection disables execution without false adoption', page.locator('#formation-confirm-replenish').is_disabled())


def inject_retired_controls(page):
    forms(page)
    page.evaluate('''() => {
      const root=document.querySelector('#fleet-formations');
      for(const b of [window.__oldPrestigeReview,window.__oldPrestigeSave,window.__oldPrestigeFill]){
       root.append(b);b.disabled=false;b.click();
       const clone=b.cloneNode(true);root.append(clone);clone.disabled=false;clone.click();
      }
      for(const kind of ['input','change','blur'])window.__oldPrestigeName.dispatchEvent(new Event(kind,{bubbles:true}));
    }''')


def verify_commit(page, which, before_name):
    expect(page.locator('[data-bind="status"]')).to_have_text('已发射殖民舰并存入本地')
    actual = read(page); expected = EXPECTED[which]['candidate']['state']
    check('whole persisted state equals fresh real shared-rule candidate', actual == expected)
    rows = events(page)
    writes = [(i,row) for i,row in enumerate(rows) if row['operation'] == 'write-return']
    check('manual launch performs exactly one current-slot write', len(writes) == 1)
    index, write = writes[0]
    check('old visible planet still present during native write', write['planet'] == before_name)
    successes = [(i,row) for i,row in enumerate(rows) if row['operation'] == 'visible-update' and row['status'] == '已发射殖民舰并存入本地']
    check('actual successful status mutation observed', bool(successes))
    success_index, success = successes[0]
    check('native write precedes visible success', index < success_index)
    check('exact native readback precedes visible success', any(row['operation'] == 'read' and row['value'] == raw(page) for row in rows[index+1:success_index]))
    check('visible success observes the exact persisted candidate', success['current'] == raw(page))
    check('manual save does not claim or create a separate backup', page.evaluate('(key)=>Object.keys(localStorage).filter(k=>k.startsWith(key+".backup")).length', KEY) == 0)
    record_audit(page)
    return actual


def verify_domains(before, after):
    check('all old worlds replaced by exactly one actual seed-stock home', after['planets'] == EXPECTED['rich']['candidate']['state']['planets'] and len(before['planets']) == 2)
    check('completed research levels retained but pending research dropped', after['research']['levels'] == before['research']['levels'] and not after['research']['queue'] and bool(before['research']['queue']))
    check('real fleet cargo and ships disappear without return credit', bool(before['fleets']) and not after['fleets'] and after['nextFleetId'] == before['nextFleetId'])
    check('edited current formation and creation-time old origin remain independent', after['formations'] == before['formations'] and any(task['formationOrigin'] and task['formationOrigin']['formation']['revision'] == 1 for task in after['orders']['tasks']) and after['formations']['entries'][0]['revision'] == 2)
    check('template library retained without automatically applying it', after['researchTemplates'] == before['researchTemplates'] and len(after['orders']['tasks']) == len(before['orders']['tasks']))
    check('live finite plans cancelled without changed budget, charged, refunded or completion', all(new['status'] == 'cancelled' and all(new[field] == old[field] for field in ('budget','charged','refunded','formationOrigin')) and new.get('completedUnits') == old.get('completedUnits') for old,new in zip(before['orders']['tasks'],after['orders']['tasks'])))
    trips = [trip for task in after['orders']['tasks'] if task['transport'] for trip in task['transport']['trips']]
    check('actual owned transport receipts are prestige-retired', bool(trips) and all(trip['phase']['kind'] == 'prestige-retired' for trip in trips))
    check('armed ring batch ends while paid ticket identities and pre-rolls persist', before['arcade']['autoBatch']['armed'] and not after['arcade']['autoBatch']['armed'] and after['arcade']['runs'] == before['arcade']['runs'])
    check('booster expiration and current inventory are retained exactly', after['boosters'] == before['boosters'] and after['items'] == before['items'])


def run_cases():
    global case, completed
    case = 'readonly open close folded details and cancel preserve whole exported state'
    context, page = boot(); before = json.loads(export(page,'readonly-before.json'))['state']; filled = arm_review(page)
    preview(page); clear_audit(page)
    check('eligible preview exact score and gain', page.locator(ROOT).get_attribute('data-eligible') == 'true' and page.locator(ROOT).get_attribute('data-score') == EXPECTED['rich']['score'] and page.locator(ROOT).get_attribute('data-gain') == EXPECTED['rich']['gain'])
    model=EXPECTED['rich']['preview']
    details=page.locator('#prestige-preview-details')
    if not details.evaluate('(e)=>e.open'): page.locator('#prestige-preview-details > summary').click()
    def resources(values):
        return f"金属 {values['metal']} / 晶体 {values['crystal']} / 重氢 {values['deuterium']}"
    check('actual candidate seed inventory displayed', resources(model['newHome']) in page.locator('#prestige-preview-home').inner_text())
    check('existing world inventories displayed separately from paid work', resources(model['worlds']['resources']) in page.locator('#prestige-preview-worlds').inner_text())
    check('paid loss counts remaining units rather than original quantity', f"剩余 {model['paid']['remainingUnits']} 单位" in page.locator('#prestige-preview-paid').inner_text() and resources(model['paid']['remainingUnitPaid']) in page.locator('#prestige-preview-paid').inner_text())
    check('actual cargo displayed without adding historical shipped cargo', resources(model['fleets']['cargo']) in page.locator('#prestige-preview-fleets').inner_text())
    check('paid costs and history are explicitly not double-counted', '不是现有库存' in page.locator('#prestige-preview-rows').inner_text() and '不合并成重复计价' in page.locator('#prestige-preview-accounting').inner_text())
    check('retained design requires explicit reapplication', '须重新应用' in page.locator('#prestige-preview-kept').inner_text())
    for _ in range(2):
        page.locator('#prestige-preview-details > summary').click(); tab(page,'overview'); preview(page)
    confirmation = launch(page, False)
    check('native confirm is exact fresh model summary', confirmation == EXPECTED['rich']['confirmation'])
    check('view and cancelled confirm produce no save writes', not any(row['operation'].startswith('write') for row in events(page)))
    retained_forms(page, filled)
    after = json.loads(export(page,'readonly-after.json'))['state']
    check('entire exported simulation unchanged by preview and cancel', after == before)
    record_audit(page); context.close()

    case = 'below threshold cannot show confirmation or write a candidate'
    context, page = boot('below'); preview(page); clear_audit(page); dialogs=[]
    page.on('dialog', lambda dialog:(dialogs.append(dialog.message),dialog.dismiss()))
    page.evaluate('''() => {const b=document.querySelector('[data-action="prestige"]');b.disabled=false;b.click();}'''); advance(page)
    check('blocked preview explicitly ineligible', page.locator(ROOT).get_attribute('data-eligible') == 'false')
    check('blocked forced action never confirms or writes', not dialogs and not any(row['operation'].startswith('write') for row in events(page)))
    check('blocked world unchanged', read(page) == fixtures['below']['state']); context.close()

    case = 'actual rich manual candidate persists before visible adoption'
    context, page = boot(); before=copy.deepcopy(read(page)); filled=arm_review(page); preview(page); clear_audit(page)
    check('rich confirmation agrees shared candidate', launch(page) == EXPECTED['rich']['confirmation'])
    after=verify_commit(page,'rich',before['planets'][0]['name']); verify_domains(before,after)
    forms(page)
    check('successful adoption clears filled ships and source', page.locator('[data-ship="small_cargo"]').input_value() == '0' and page.locator('#formation-dispatch-source').is_hidden())
    inject_retired_controls(page)
    check('old reinserted and cloned design controls cannot operate new world', read(page) == after)
    preview(page)
    check('post-launch preview invalidated to new-world ineligibility', page.locator(ROOT).get_attribute('data-eligible') == 'false')
    page.reload(wait_until='networkidle'); preview(page)
    check('reload reads exact committed candidate', read(page) == after)
    check('reload exported live world equals committed outcome', json.loads(export(page,'successful-reload.json'))['state'] == after)
    forms(page); page.locator('[data-formation-id="1"] [data-formation-action="delete"]').click()
    check('retained cancelled old-origin history still blocks design deletion', page.locator('#formation-confirm-delete').is_disabled())
    context.close()

    case = 'fresh click sees actual progress after previous preview'
    context, page = boot('fresh'); preview(page); old_gain=page.locator(ROOT).get_attribute('data-gain')
    tab(page,'overview');page.locator('[data-bind="action-scrape-ov"]').click();preview(page);clear_audit(page)
    confirmation=launch(page)
    check('fresh confirmation crosses actual core boundary', old_gain != EXPECTED['progressed']['gain'] and confirmation == EXPECTED['progressed']['confirmation'])
    verify_commit(page,'progressed',fixtures['fresh']['state']['planets'][0]['name'])
    clear_audit(page); page.evaluate('''() => {const b=document.querySelector('[data-action="prestige"]');b.disabled=false;b.click();}'''); advance(page)
    check('repeat click cannot adopt or save a second reset', read(page)['stats']['launches'] == 1 and not any(row['operation'].startswith('write') for row in events(page)))
    context.close()

    for which in ('deepPending','deepReturning','deepReturned'):
        case = which + ': actual deep stake and pending rewards'
        context,page=boot(which); preview(page); before=copy.deepcopy(read(page)); clear_audit(page); launch(page)
        after=verify_commit(page,which,before['planets'][0]['name'])
        check('charge report history preserved exactly', after['deepSpace']['reports'] == before['deepSpace']['reports'])
        check('charge replay tickets retained without a second grant', after['arcade']['runs'] == before['arcade']['runs'] and after['arcade']['nextRunId'] == before['arcade']['nextRunId'])
        check('unreturned reward is not credited by the preview or launch', after['darkMatter'] == EXPECTED[which]['candidate']['state']['darkMatter'] and after['items'] == before['items'])
        context.close()

    for fault in ('write','drop','readback'):
        case = 'labeled native Storage failure: ' + fault
        context,page=boot(); baseline=raw(page); before=copy.deepcopy(read(page)); filled=arm_review(page); preview(page); clear_audit(page)
        page.evaluate('(fault)=>window.__prestigeFault=fault',fault); launch(page)
        expect(page.locator('[data-bind="status"]')).to_contain_text('发射结果未采用')
        check('failed commit keeps old visible planet', page.locator('[data-bind="ov-planet"]').text_content() == before['planets'][0]['name'])
        retained_forms(page,filled,enabled=False)
        check('no false successful adoption status', not any(row['operation']=='visible-update' and row.get('status')=='已发射殖民舰并存入本地' for row in events(page)))
        if fault == 'readback':
            check('unknown write may contain candidate bytes while old world stays visible', read(page) == EXPECTED['rich']['candidate']['state'])
        else:
            check('thrown or dropped write left original bytes intact', raw(page) == baseline)
        frozen=page.locator('[data-bind="amount-metal"]').text_content()
        page.evaluate('document.querySelector(\'[data-action="scrape"]\').click()'); advance(page,60000)
        check('protected economic actions and simulated time are frozen', page.locator('[data-bind="amount-metal"]').text_content() == frozen)
        check('protected export returns exact remembered old bytes', export(page,'fault-'+fault+'-old-raw.json') == baseline)
        record_audit(page); context.close()

    case = 'labeled invalid candidate serialization is rejected before native write'
    context,page=boot(); baseline=raw(page); filled=arm_review(page); preview(page); clear_audit(page)
    page.evaluate('''() => {
      const stringify=JSON.stringify;
      JSON.stringify=function(value,...args){
       if(value?.state?.stats?.launches===1 && value.state.orders){
        window.__invalidCandidateInjected=true;JSON.stringify=stringify;
        value={...value,state:{...value.state,orders:{...value.state.orders,nextTaskId:0}}};
       }
       return stringify(value,...args);
      };
    }''')
    launch(page)
    check('fault reached candidate serialization boundary', page.evaluate('window.__invalidCandidateInjected === true'))
    check('invalid candidate leaves native bytes and visible world unchanged', raw(page) == baseline and page.locator('[data-bind="ov-planet"]').text_content() == fixtures['rich']['state']['planets'][0]['name'])
    check('invalid candidate fails before current-slot write', not any(row['operation'].startswith('write') for row in events(page)))
    retained_forms(page,filled)
    page.locator('#formation-review-panel #formation-confirm-replenish').click()
    check('validation-only failure keeps ready old-world authority usable', len(read(page)['orders']['tasks']) == len(fixtures['rich']['state']['orders']['tasks'])+1)
    record_audit(page); context.close()

    case = 'actual other-tab storage event freezes old visible world'
    context,page=boot(); baseline=raw(page); filled=arm_review(page); preview(page); clear_audit(page)
    other=context.new_page(); attach(other); other.goto(args.url,wait_until='networkidle')
    tab(other,'save'); other.locator('#transfer').fill(json.dumps(fixtures['below'],ensure_ascii=False)); other.locator('[data-action="import-text"]').click()
    page.bring_to_front(); advance(page)
    expect(page.locator('[data-bind="status"]')).to_contain_text('其他标签页')
    check('native cross-tab event is trusted', any(row['operation']=='storage-event' and row['trusted'] for row in events(page)))
    retained_forms(page,filled,enabled=False)
    page.evaluate('''() => {const b=document.querySelector('[data-action="prestige"]');b.disabled=false;b.click();}'''); advance(page)
    check('cross-tab conflict never adopts a candidate', page.locator('[data-bind="ov-planet"]').text_content() == fixtures['rich']['state']['planets'][0]['name'])
    check('cross-tab protected export preserves this page original', export(page,'cross-tab-old-raw.json') == baseline)
    record_audit(page); context.close()

    for replacement in ('same-id-import','reset','manual','protocol-live','protocol-offline'):
        case = replacement + ': actual world adoption invalidates preview and old design authority'
        which='automatic' if replacement.startswith('protocol') else 'base'
        context,page=boot(which); filled=arm_review(page); preview(page)
        check('old-world preview is eligible before replacement', page.locator(ROOT).get_attribute('data-eligible') == 'true')
        if replacement == 'same-id-import':
            seed=copy.deepcopy(fixtures['below']);seed['savedAt']=seed['lastTickAt']=page.evaluate('Date.now()')
            tab(page,'save');page.locator('#transfer').fill(json.dumps(seed,ensure_ascii=False));page.locator('[data-action="import-text"]').click()
        elif replacement == 'reset':
            tab(page,'save');page.once('dialog',lambda dialog:dialog.accept());page.locator('[data-action="reset"]').click()
        elif replacement == 'manual':
            launch(page)
        elif replacement == 'protocol-live':
            for _ in range(10): advance(page,1000)
        else:
            advance(page,60000)
        preview(page)
        check('old eligible preview released after actual replacement', page.locator(ROOT).get_attribute('data-eligible') == 'false')
        before=json.loads(export(page,'adopt-'+replacement+'.json'))['state']
        if replacement in ('manual','protocol-live','protocol-offline'):
            check('actual shared-rule curvature occurred once', before['stats']['launches'] == 1)
        forms(page)
        check('adoption retires selection and filled dispatch source', page.locator('#formation-selection').is_hidden() and page.locator('[data-ship="small_cargo"]').input_value() == '0')
        inject_retired_controls(page)
        after=json.loads(export(page,'stale-'+replacement+'.json'))['state']
        check('reinserted cloned and late old-world controls have no effects', after == before)
        context.close()

    case = 'four-width native details focus layout and bounded visible rendering'
    context,page=boot('longAmounts'); preview(page)
    original_texts={row['bind']:row['text'] for row in original_curvature_text_geometry(page)}
    check('large-value fixture retains original long passive strings', len(original_texts) == 9 and any(len(part) >= 150 for text in original_texts.values() for part in re.findall(r'\d+',text)))
    page.evaluate('''() => {
      window.__previewMutations=0;
      new MutationObserver(xs=>window.__previewMutations+=xs.length).observe(document.querySelector('#prestige-preview'),{subtree:true,childList:true,characterData:true,attributes:true});
    }''')
    for width in (320,390,768,1440):
        page.set_viewport_size({'width':width,'height':1100});preview(page)
        details=page.locator('#prestige-preview-details');summary=page.locator('#prestige-preview-details > summary')
        if not details.evaluate('(e)=>e.open'): summary.click()
        summary.focus(); page.evaluate('window.__prestigeSummary=document.activeElement')
        start=page.evaluate('window.__prestigeRealNow()')
        for _ in range(6): advance(page)
        elapsed=page.evaluate('window.__prestigeRealNow()')-start
        timings.append({'width':width,'sixZeroDeltaFramesWallMilliseconds':elapsed,'classification':'browser-wall measurement; controlled simulation clock; not reset-algorithm benchmark'})
        check(f'{width}px: expanded detail and keyboard focus retained', details.evaluate('(e)=>e.open') and summary.evaluate('(e)=>document.activeElement===e && e===window.__prestigeSummary'))
        check(f'{width}px: no horizontal document overflow', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
        geometry=original_curvature_text_geometry(page);layout_proofs.append({'width':width,'originalCurvatureText':geometry})
        check(f'{width}px: original full unspent and technology preview strings unchanged', {row['bind']:row['text'] for row in geometry} == original_texts)
        check(f'{width}px: original long strings wrap with every text line inside its box', all(row['visible'] and row['allTextInside'] and row['scrollWidth'] <= row['clientWidth']+1 and row['scrollHeight'] <= row['clientHeight']+1 for row in geometry))
        check(f'{width}px: original long strings have no clipping ellipsis or line clamp', all(not row['clippedBy'] and row['textOverflow'] != 'ellipsis' and row['lineClamp'] in ('none','0','') for row in geometry))
        check(f'{width}px: detail rendering bounded to 20 rows', page.locator('#prestige-preview-rows [data-preview-row]').count() <= 20)
        snapshot(page,'prestige-preview-'+str(width))
        summary.press('Enter');check(f'{width}px: native keyboard detail toggle works',not details.evaluate('(e)=>e.open'))
    preview(page);page.evaluate('window.__previewMutations=0')
    for _ in range(10):advance(page)
    check('zero-time ordinary RAF does not rewrite preview DOM every frame',page.evaluate('window.__previewMutations') == 0)
    tab(page,'overview');page.evaluate('window.__previewMutations=0')
    for _ in range(3):advance(page,1000)
    check('hidden preview receives no ordinary-update DOM work',page.evaluate('window.__previewMutations') == 0)
    preview(page);check('reentry refreshes actual current preview',page.locator(ROOT).get_attribute('data-eligible') == 'true')
    context.close()
    case='suite integrity';check('no JavaScript page errors',not errors);check('no failed production requests',not failed_requests)
    completed=True


# Capture diagnostics while Playwright and the browser connection are still alive.
# An outer finally would run after sync_playwright.__exit__ and lose the evidence.
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        run_cases()
    except BaseException:
        diagnostics={'case':case}
        if active_page is not None and not active_page.is_closed():
            try:
                diagnostics['nativeCurrentRaw']=raw(active_page)
                diagnostics['globalStatus']=active_page.locator('[data-bind="status"]').all_text_contents()
                diagnostics['preview']=active_page.locator(ROOT).all_text_contents()
                diagnostics['formationStatus']=active_page.locator('#formation-status').all_text_contents()
                diagnostics['renderedOverflow']=overflow_diagnostics(active_page)
                diagnostics['originalCurvatureText']=original_curvature_text_geometry(active_page)
                record_audit(active_page);snapshot(active_page,'failure')
            except Exception as error:
                diagnostics['captureError']=str(error)
        raise
    finally:
        report={'completed':completed,'mode':MODE,'url':args.url,'fixture':fixtures.get('description'),
            'timing':'Explicit Date/performance/RAF timestamps. Natural-time old acceptance scripts remain separate and unchanged. Storage fault, candidate-serialization fault and late-node cases are explicitly synthetic.',
            'environment':{'platform':platform.platform(),'python':platform.python_version(),'browser':browser.version},
            'passed':sum(row['passed'] for row in checks),'checks':checks,'errors':errors,'failedRequests':failed_requests,
            'audit':audits,'timings':timings,'layoutProofs':layout_proofs,'failureDiagnostics':diagnostics}
        (out/'prestige-preview-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps({'completed':completed,'passed':report['passed'],'total':len(checks),'failedCase':None if completed else case},ensure_ascii=False))
        browser.close()
