"""Accounted snapshot regressions against the real HTTP production bundle.

Native localStorage and browser input; Date/performance, requestAnimationFrame and
15-second interval dispatch are EXPLICITLY CONTROLLED. No RAF executes unless
requested by this script. Synthetic visibility events are labeled and never
claimed as genuine OS-background evidence (the headed-CDP suite covers that).
Healthy Storage calls delegate to captured native methods; only named fault
cases inject failures. File races gate completion of native File.text().
"""
import argparse
import base64
import copy
import hashlib
import json
import platform
import shutil
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='accounted-clock-review-save.json')
parser.add_argument('--session-fixture', default=None,
                    help='Optional existing actual-source r2-r7 save-session fixture for migration clock checks')
parser.add_argument('--output', default='accounted-clock-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY, BACKUP, EPOCH = fixtures['key'], fixtures['backupKey'], fixtures['epoch']
EXPECTED = fixtures['expected']
MODE = 'HTTP / native Storage and input / explicitly controlled Date-performance-RAF-interval callbacks'
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
checks, errors, requests, audits = [], [], [], []
case, completed, active_page, diagnostics = 'setup', False, None, None

INIT = r"""(() => {
 const key=__KEY__, backup=__BACKUP__;
 const get=Storage.prototype.getItem, set=Storage.prototype.setItem;
 const prior=get.call(sessionStorage,'accounted-clock-wall');
 let wall=prior===null?__EPOCH__:Number(prior), frame=0, next=1, written=false;
 const callbacks=new Map(), intervals=new Map();
 window.__clockNativeStorage=localStorage instanceof Storage &&
  /\[native code\]/.test(Function.prototype.toString.call(get)) &&
  /\[native code\]/.test(Function.prototype.toString.call(set));
 Date.now=()=>wall;
 Object.defineProperty(performance,'now',{value:()=>frame});
 window.requestAnimationFrame=callback=>{const id=next++;callbacks.set(id,callback);return id;};
 window.cancelAnimationFrame=id=>callbacks.delete(id);
 window.setInterval=(callback,ms,...args)=>{const id=next++;intervals.set(id,{callback,ms:Number(ms),args});return id;};
 window.clearInterval=id=>intervals.delete(id);
 window.__clockAdvance=ms=>{wall+=ms;frame+=ms;set.call(sessionStorage,'accounted-clock-wall',String(wall));};
 window.__clockRAF=()=>{
  const due=[...callbacks.values()];callbacks.clear();
  window.__clockAudit.push({operation:'controlled-raf-wave',wall,frame,callbacks:due.length});
  for(const callback of due)callback(frame);
  return due.length;
 };
 window.__clockAutosave=()=>{
  const due=[...intervals.values()].filter(value=>value.ms===15000);
  window.__clockAudit.push({operation:'controlled-autosave-callback',wall,frame,callbacks:due.length});
  for(const value of due){if(typeof value.callback!=='function')throw Error('Unexpected string interval');value.callback(...value.args);}
  return due.length;
 };
 window.__clockRead=k=>get.call(localStorage,k??key);
 window.__clockAudit=[];window.__clockFault=null;
 window.__clockClear=()=>{window.__clockAudit.length=0;written=false;};
 window.__clockSnapshot=()=>({wall,frame,pendingRAF:callbacks.size,intervals:[...intervals.values()].map(x=>x.ms)});
 const visible=()=>({planet:document.querySelector('[data-bind="ov-planet"]')?.textContent,
  status:document.querySelector('[data-bind="status"]')?.textContent,
  played:document.querySelector('[data-bind="played"]')?.textContent});
 const watched=k=>k===key||k===backup||k.startsWith(backup+'.');
 Storage.prototype.getItem=function(k){
  k=String(k);
  if(this===localStorage&&k===key&&window.__clockFault==='readback'&&written){
   window.__clockAudit.push({operation:'read-throw',injected:true,key:k,wall,frame,...visible()});
   throw new DOMException('Labeled controlled readback fault','SecurityError');
  }
  const value=get.call(this,k);
  if(this===localStorage&&watched(k))window.__clockAudit.push({operation:'read',key:k,value,wall,frame,...visible()});
  return value;
 };
 Storage.prototype.setItem=function(k,v){
  k=String(k);v=String(v);
  if(this!==localStorage||!watched(k))return set.call(this,k,v);
  window.__clockAudit.push({operation:'write-attempt',key:k,value:v,wall,frame,...visible()});
  if(k===key&&(window.__clockFault==='write'||window.__clockFault==='drop')){
   window.__clockAudit.push({operation:'write-'+window.__clockFault,injected:true,key:k,wall,frame,...visible()});
   if(window.__clockFault==='write')throw new DOMException('Labeled controlled quota fault','QuotaExceededError');
   return;
  }
  set.call(this,k,v);if(k===key)written=true;
  window.__clockAudit.push({operation:'write-return',key:k,value:v,wall,frame,...visible()});
 };
 window.addEventListener('storage',event=>{
  if(event.storageArea===localStorage&&event.key===key)window.__clockAudit.push({operation:'storage-event',trusted:event.isTrusted,wall,frame});
 });
 window.__clockConfirmGap=0;
 const confirm=window.confirm.bind(window);
 window.confirm=message=>{const result=confirm(message);window.__clockAdvance(window.__clockConfirmGap);window.__clockConfirmGap=0;return result;};
 const fileText=File.prototype.text;
 window.__clockFiles=[];window.__clockGateFiles=false;
 File.prototype.text=async function(){
  if(!window.__clockGateFiles)return fileText.call(this);
  const entry={name:this.name,ready:false,release:null};window.__clockFiles.push(entry);
  const text=await fileText.call(this);entry.ready=true;
  await new Promise(resolve=>entry.release=resolve);return text;
 };
 let last='';
 new MutationObserver(()=>{const now=visible(), text=JSON.stringify(now);if(text===last)return;last=text;
  window.__clockAudit.push({operation:'visible-update',wall,frame,current:get.call(localStorage,key),...now});
 }).observe(document,{subtree:true,childList:true,characterData:true});
})();""".replace('__KEY__', json.dumps(KEY)).replace('__BACKUP__', json.dumps(BACKUP)).replace('__EPOCH__', str(EPOCH))


def check(name, condition):
    checks.append({'case':case, 'name':name, 'passed':bool(condition), 'classification':MODE})
    if not condition:
        raise AssertionError(f'{case}: {name}')


def advance(page, milliseconds):
    page.evaluate('ms=>window.__clockAdvance(ms)', milliseconds)


def frame(page):
    check('explicit RAF wave contains application callback', page.evaluate('window.__clockRAF()') >= 1)


def timer(page):
    check('one captured production 15000ms autosave callback', page.evaluate('window.__clockAutosave()') == 1)


def raw(page, key=KEY):
    return page.evaluate('key=>window.__clockRead(key)', key)


def saved(page):
    return json.loads(raw(page))


def events(page):
    return page.evaluate('window.__clockAudit')


def clear(page):
    page.evaluate('window.__clockClear()')


def audit(page, label=''):
    rows = events(page)
    for row in rows:
        for field in ('value','current'):
            value = row.get(field)
            if isinstance(value, str):
                row[field+'Sha256'] = hashlib.sha256(value.encode()).hexdigest()
                row[field+'Bytes'] = len(value.encode()); del row[field]
    audits.append({'case':case, 'label':label, 'clock':page.evaluate('window.__clockSnapshot()'), 'events':rows})


def click(page, selector):
    # force bypasses Playwright's RAF-based stability wait while preserving native
    # mouse input. Only the application callback queue is deliberately paused.
    page.locator(selector).click(force=True)


def dismiss(page):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        click(page, '[data-action="dismiss-offline"]')


def tab(page, name):
    dismiss(page); click(page, f'[data-tab="{name}"]')


def save(page):
    tab(page, 'save'); click(page, '[data-action="save"]')
    return saved(page)


def export_raw(page, name):
    tab(page, 'save')
    with page.expect_download() as pending:
        click(page, '[data-action="export"]')
    download = pending.value
    check('native save download succeeded', download.failure() is None)
    path = out / (name+'.json'); download.save_as(path)
    return path.read_text()


def export(page, name):
    return json.loads(export_raw(page, name))


def same_state(value, expected, label='exact whole serialized engine state'):
    check(label, value['state'] == EXPECTED[expected])


def envelope(value, wall, accounted):
    check('savedAt is current controlled wall time', value['savedAt'] == EPOCH + wall)
    check('lastTickAt is accounted snapshot watermark', value['lastTickAt'] == EPOCH + accounted)


def attach(page):
    page.set_default_timeout(10000)
    page.on('pageerror', lambda error: errors.append({'case':case,'error':str(error)}))
    page.on('requestfailed', lambda request: requests.append({'case':case,'url':request.url}))


def boot(which='mixed', value=None, wall=0, fault=None):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http','https'):
        raise ValueError('Native acceptance requires actual HTTP(S)')
    seed = copy.deepcopy(fixtures[which] if value is None else value)
    seed['savedAt'] = seed['lastTickAt'] = EPOCH
    context = browser.new_context(viewport={'width':1440,'height':1100}, reduced_motion='reduce', accept_downloads=True,
        storage_state={'cookies':[],'origins':[{'origin':f'{parsed.scheme}://{parsed.netloc}', 'localStorage':[
            {'name':KEY,'value':json.dumps(seed,ensure_ascii=False)}, {'name':'infinity.ui.tab','value':'overview'}]}]})
    script = INIT
    if wall:
        script += f'window.__clockAdvance({wall});'
    if fault:
        script += 'window.__clockFault='+json.dumps(fault)+';'
    context.add_init_script(script)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    check('actual HTTP production response', response is not None and response.status == 200)
    page.locator('[data-bind="amount-metal"]').wait_for()
    check('healthy backing Storage methods are native', page.evaluate('window.__clockNativeStorage'))
    check('startup has queued rather than executed first RAF', not any(row['operation']=='controlled-raf-wave' for row in events(page)))
    return context, page


def reload_at(page, milliseconds):
    advance(page, milliseconds); audit(page, 'before real navigation reload')
    page.reload(wait_until='networkidle')
    page.locator('[data-bind="amount-metal"]').wait_for()


def import_text(page, which='incoming', text=None):
    tab(page, 'save')
    page.locator('[data-bind="transfer"]').fill(text if text is not None else json.dumps(fixtures[which],ensure_ascii=False))
    click(page, '[data-action="import-text"]')


def confirm_action(page, action, accept=True, gap=0):
    messages=[]
    page.evaluate('gap=>window.__clockConfirmGap=gap', gap)
    def answer(dialog):
        messages.append(dialog.message)
        dialog.accept() if accept else dialog.dismiss()
    page.once('dialog', answer)
    click(page, f'[data-action="{action}"]')
    check('native confirmation displayed exactly once', len(messages) == 1)


def pending_file(page, which='incoming', text=None):
    tab(page,'save'); page.evaluate('window.__clockGateFiles=true')
    page.locator('[data-bind="import-file"]').set_input_files({'name':'controlled-'+which+'.json',
        'mimeType':'application/json','buffer':(text if text is not None else json.dumps(fixtures[which],ensure_ascii=False)).encode()})
    index = page.evaluate('window.__clockFiles.length-1')
    page.wait_for_function('i=>window.__clockFiles[i]?.ready&&typeof window.__clockFiles[i].release==="function"', arg=index, polling=20)
    return index


def release_file(page, index):
    page.evaluate('i=>window.__clockFiles[i].release()', index)
    # Browser task turn flushes both the real File.text wrapper and main's await.
    page.evaluate('()=>new Promise(resolve=>setTimeout(resolve,0))')


def arm_formation(page):
    tab(page, 'fleet')
    if not page.locator('#fleet-formations').evaluate('e=>e.open'):
        click(page, '#fleet-formations > summary')
    click(page, '[data-formation-id="1"] [data-formation-action="select"]')
    page.locator('#formation-payer').select_option(fixtures['homeId'])
    click(page, '#formation-fill'); click(page, '#formation-preview')
    page.evaluate('''() => {
      window.__clockOldFill=document.querySelector('#formation-fill');
      window.__clockOldReview=document.querySelector('#formation-confirm-replenish');
    }''')
    check('old world has an explicitly filled dispatch draft', page.locator('[data-ship="small_cargo"]').input_value() == '2')


def assert_adopted(page, expected, name):
    tab(page, 'fleet')
    check('adoption invalidates old selected formation', page.locator('#formation-selection').is_hidden())
    check('adoption clears old-world explicit dispatch fill', page.locator('[data-ship="small_cargo"]').input_value() == '0')
    page.evaluate('''() => {
      const root=document.querySelector('#fleet-formations');
      for(const button of [window.__clockOldFill,window.__clockOldReview]){
        root.append(button);button.disabled=false;button.click();
        const clone=button.cloneNode(true);root.append(clone);clone.disabled=false;clone.click();
      }
    }''')
    same_state(export(page,name), expected, 'retired and cloned old controls leave exact new engine world unchanged')


def hidden_save_series(page):
    page.evaluate('''() => {
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      document.dispatchEvent(new Event('visibilitychange'));
    }''')
    for second in (15,30,45):
        advance(page,15000); timer(page)
        value=saved(page); envelope(value,second*1000,0)
        same_state(value,'mixed.initial','hidden timer save retains complete unadvanced engine state')
    check('no RAF ran during explicitly controlled hidden interval', not any(row['operation']=='controlled-raf-wave' for row in events(page)))
    page.evaluate('delete document.visibilityState;delete document.hidden')


def run_cases():
    global case, completed
    case='controlled hidden: 15/30/45 second saves then real reload at 61 seconds'
    context,page=boot(); hidden_save_series(page)
    reload_at(page,16000)
    value=export(page,'hidden-reload61'); same_state(value,'mixed.offline61'); envelope(value,61000,61000)
    audit(page); context.close()

    case='controlled hidden: resume 61 seconds then reload after one second'
    context,page=boot(); hidden_save_series(page); advance(page,16000); frame(page)
    value=saved(page); same_state(value,'mixed.offline61'); envelope(value,61000,61000)
    reload_at(page,1000)
    value=export(page,'resume61-reload1'); same_state(value,'mixed.offline61.reload1'); envelope(value,62000,62000)
    audit(page); context.close()

    for which,cap in (('mixed',7200),('cap8',28800)):
        case=f'controlled {cap//3600}h cap consumes full raw frame gap'
        context,page=boot(which); raw_gap=(cap+3600)*1000
        for delta in (15000,15000,15000,raw_gap-45000):
            advance(page,delta); timer(page)
            check('unadvanced autosave never claims simulation time', saved(page)['lastTickAt']==EPOCH)
        frame(page); value=saved(page)
        same_state(value,which+'.capped'); envelope(value,raw_gap,raw_gap)
        reload_at(page,1000); value=export(page,which+'-cap-reload1')
        same_state(value,which+'.capped.reload1'); envelope(value,raw_gap+1000,raw_gap+1000)
        audit(page); context.close()

        case=f'compatible startup {cap//3600}h cap also consumes full raw load gap'
        context,page=boot(which)
        reload_at(page,raw_gap); value=save(page)
        same_state(value,which+'.capped'); envelope(value,raw_gap,raw_gap)
        reload_at(page,1000); value=export(page,which+'-startup-cap-reload1')
        same_state(value,which+'.capped.reload1'); envelope(value,raw_gap+1000,raw_gap+1000)
        audit(page); context.close()

    for seconds in (4.999,5,29.999,30):
        case=f'exact original single-engine-call boundary {seconds} seconds'
        context,page=boot(); advance(page,seconds*1000); frame(page)
        check('30-second offline modal boundary unchanged', page.locator('[data-bind="offline-modal"]').is_visible()==(seconds>=30))
        writes=[row for row in events(page) if row['operation']=='write-attempt' and row['key']==KEY]
        check('original five-second branch persists only catch-up branch',bool(writes)==(seconds>=5))
        value=export(page,'boundary-'+str(seconds)); same_state(value,'boundary.'+str(seconds)); envelope(value,seconds*1000,seconds*1000)
        audit(page); context.close()

    case='manual saves exports timers and visibility writes between frames cannot advance watermark'
    context,page=boot(); advance(page,1000); frame(page); advance(page,2000)
    value=save(page); same_state(value,'mixed.live1'); envelope(value,3000,1000)
    before=raw(page); value=export(page,'between-frames'); same_state(value,'mixed.live1'); envelope(value,3000,1000)
    check('export has no current-slot write side effect',raw(page)==before)
    advance(page,12000); timer(page); envelope(saved(page),15000,1000)
    page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))")
    same_state(saved(page),'mixed.live1'); envelope(saved(page),15000,1000)
    reload_at(page,46000); value=export(page,'between-frames-reload61')
    same_state(value,'mixed.live1.reload60'); envelope(value,61000,61000)
    audit(page); context.close()

    case='successful text import replaces epoch and discards only old-world pending gap'
    context,page=boot(); advance(page,60000); import_text(page)
    value=saved(page); same_state(value,'incoming.initial'); envelope(value,60000,60000)
    advance(page,1000); frame(page); value=save(page)
    same_state(value,'incoming.live1'); envelope(value,61000,61000)
    audit(page); context.close()

    case='delayed native File.text establishes epoch only after read completion'
    context,page=boot(); advance(page,10000); index=pending_file(page)
    advance(page,50000)
    check('read delay leaves stored old world intact',saved(page)['state']==EXPECTED['mixed.initial'])
    release_file(page,index); expect(page.locator('[data-bind="status"]')).to_contain_text('已导入')
    value=saved(page); same_state(value,'incoming.initial'); envelope(value,60000,60000)
    advance(page,1000); frame(page); value=save(page)
    same_state(value,'incoming.live1'); envelope(value,61000,61000)
    audit(page); context.close()

    case='failed text replacement retains old epoch and full pending backlog'
    context,page=boot(); advance(page,60000); import_text(page,text='{labeled invalid JSON')
    expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败')
    advance(page,1000); frame(page); value=saved(page)
    same_state(value,'mixed.offline61'); envelope(value,61000,61000)
    audit(page); context.close()

    case='delayed invalid native file completion retains old epoch and full pending backlog'
    context,page=boot(); advance(page,10000); index=pending_file(page,text='{labeled invalid JSON')
    advance(page,50000); release_file(page,index)
    expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败')
    advance(page,1000); frame(page); value=saved(page)
    same_state(value,'mixed.offline61'); envelope(value,61000,61000)
    audit(page); context.close()

    case='stale delayed file after intervening save retains old epoch and full backlog'
    context,page=boot(); advance(page,10000); index=pending_file(page)
    advance(page,50000); value=save(page); envelope(value,60000,0)
    advance(page,1000); release_file(page,index); frame(page)
    value=saved(page); same_state(value,'mixed.offline61'); envelope(value,61000,61000)
    check('stale file never adopts incoming planet',page.locator('[data-bind="ov-planet"]').text_content()==fixtures['mixed']['state']['planets'][0]['name'])
    audit(page); context.close()

    case='stale delayed file cannot rebase a newer successful replacement'
    context,page=boot(); advance(page,10000); index=pending_file(page,'mixed')
    advance(page,50000); import_text(page); advance(page,1000); release_file(page,index)
    advance(page,1000); frame(page); value=save(page)
    same_state(value,'incoming.live2'); envelope(value,62000,62000)
    audit(page); context.close()

    case='cancelled reset confirmation retains old clock and confirmation duration'
    context,page=boot(); advance(page,10000); tab(page,'save')
    confirm_action(page,'reset',accept=False,gap=50000); advance(page,1000); frame(page)
    value=saved(page); same_state(value,'mixed.offline61'); envelope(value,61000,61000)
    audit(page); context.close()

    case='successful reset epoch captured after confirmation duration'
    context,page=boot(); advance(page,10000); tab(page,'save')
    confirm_action(page,'reset',gap=50000); value=saved(page); envelope(value,60000,60000)
    check('new reset world starts at zero accounted play time',value['state']['totalTime']=='0')
    advance(page,1000); frame(page); value=save(page); envelope(value,61000,61000)
    check('first reset frame receives one second only',value['state']['totalTime']=='1')
    check('native reset entropy creates a valid fresh world',value['state']['stats']['launches']==0 and len(value['state']['planets'])==1)
    audit(page); context.close()

    case='empty file selection leaves old epoch and backlog untouched'
    context,page=boot(); advance(page,60000); tab(page,'save')
    page.locator('[data-bind="import-file"]').set_input_files([])
    advance(page,1000); frame(page); value=saved(page)
    same_state(value,'mixed.offline61'); envelope(value,61000,61000)
    audit(page); context.close()

    case='manual prestige saves before adoption with same watermark and confirmation gap'
    context,page=boot('prestige'); arm_formation(page); tab(page,'curvature'); clear(page)
    advance(page,10000); confirm_action(page,'prestige',gap=50000)
    value=saved(page); same_state(value,'prestige.candidate'); envelope(value,60000,0)
    current=[row for row in events(page) if row['operation'] in ('write-attempt','write-return','read') and row.get('key')==KEY]
    write_index=next(i for i,row in enumerate(current) if row['operation']=='write-return')
    check('manual candidate write observes old visible world', current[write_index]['planet']==fixtures['prestige']['state']['planets'][0]['name'])
    check('candidate readback succeeds before visible adoption',any(row['operation']=='read' and row['value']==raw(page) and row['planet']==fixtures['prestige']['state']['planets'][0]['name'] for row in current[write_index+1:]))
    advance(page,1000); frame(page); value=saved(page)
    same_state(value,'prestige.candidate.offline61'); envelope(value,61000,61000)
    assert_adopted(page,'prestige.candidate.offline61','manual-adopted')
    reload_at(page,1000); value=export(page,'manual-reload1')
    same_state(value,'prestige.candidate.offline61.reload1'); envelope(value,62000,62000)
    audit(page); context.close()

    case='cancelled manual prestige retains old epoch and full confirmation duration'
    context,page=boot('prestige'); tab(page,'curvature'); baseline=raw(page)
    advance(page,10000); confirm_action(page,'prestige',accept=False,gap=50000)
    check('cancelled prestige never writes a candidate',raw(page)==baseline)
    advance(page,1000); frame(page); value=saved(page)
    same_state(value,'prestige.offline61'); envelope(value,61000,61000)
    audit(page); context.close()

    for mode in ('live','offline'):
        case='automatic '+mode+' launch uses normal frame accounting and world-adoption guard'
        context,page=boot('automatic'); arm_formation(page)
        if mode=='live':
            for _ in range(10): advance(page,1000); frame(page)
            elapsed,expected=10000,'automatic.tenLive1'
        else:
            advance(page,60000); frame(page); elapsed,expected=60000,'automatic.offline60'
        value=save(page); same_state(value,expected); envelope(value,elapsed,elapsed)
        assert_adopted(page,expected,'automatic-'+mode)
        audit(page); context.close()

    for fault in ('write','drop','readback'):
        case='labeled native Storage fault during manual launch: '+fault
        context,page=boot('prestige'); baseline=raw(page); tab(page,'curvature'); clear(page)
        advance(page,10000); page.evaluate('fault=>window.__clockFault=fault',fault)
        confirm_action(page,'prestige',gap=50000)
        expect(page.locator('[data-bind="status"]')).to_contain_text('发射结果未采用')
        check('failed durable launch keeps visible old world',page.locator('[data-bind="ov-planet"]').text_content()==fixtures['prestige']['state']['planets'][0]['name'])
        uncertain_raw=raw(page)
        if fault!='readback': check('failed write preserves native current bytes',uncertain_raw==baseline)
        else:
            same_state(json.loads(uncertain_raw),'prestige.candidate','uncertain readback can leave candidate bytes without adoption')
            envelope(json.loads(uncertain_raw),60000,0)
        frozen=page.locator('[data-bind="played"]').text_content()
        advance(page,1000); frame(page); timer(page)
        check('protected RAF does not advance visible simulation',page.locator('[data-bind="played"]').text_content()==frozen)
        check('protected export is byte-exact remembered raw snapshot',export_raw(page,'protected-'+fault)==baseline)
        page.evaluate('window.__clockFault=null'); advance(page,39000); import_text(page)
        if fault=='readback':
            # A successful native write followed by read denial is uncertain.
            # The session still owns the original baseline, so the changed disk
            # candidate must conflict; clearing the fault cannot authorize it.
            expect(page.locator('[data-bind="status"]')).to_contain_text('其他标签页')
            check('same-session recovery conflict preserves exact uncertain disk bytes',raw(page)==uncertain_raw)
            check('conflicted recovery leaves original visible simulation frozen',page.locator('[data-bind="played"]').text_content()==frozen)
            check('conflicted recovery still exports exact remembered source',export_raw(page,'readback-conflict-source')==baseline)
            check('conflicted import makes no new backup',raw(page,BACKUP) is None)
            reload_at(page,0)
            check('reopening reads the uncertain candidate without rewriting it',raw(page)==uncertain_raw)
            value=export(page,'readback-reopened-candidate')
            same_state(value,'prestige.candidate.reload100','reopening adopts and catches up exactly the candidate actually on disk')
            envelope(value,100000,100000)
            import_text(page)
            check('explicit post-reload replacement backs up exact adopted disk candidate',raw(page,BACKUP)==uncertain_raw)
        expect(page.locator('[data-bind="status"]')).to_contain_text('已导入')
        same_state(saved(page),'incoming.initial','successful explicit recovery adopts only the replacement world')
        envelope(saved(page),100000,100000); advance(page,1000); frame(page)
        value=save(page); same_state(value,'incoming.live1'); envelope(value,101000,101000)
        audit(page); context.close()

    case='labeled invalid serialization after successful simulation does not roll back accounted frame'
    context,page=boot(); page.evaluate('''() => {
      const stringify=JSON.stringify;
      JSON.stringify=function(value,...args){
        if(value?.state?.orders && Number(value.state.totalTime)>0){
          JSON.stringify=stringify;window.__clockInvalidInjected=true;
          value={...value,state:{...value.state,orders:{...value.state.orders,nextTaskId:0}}};
        }
        return stringify(value,...args);
      };
    }''')
    advance(page,60000); frame(page)
    check('one explicitly labeled serializer fault occurred',page.evaluate('window.__clockInvalidInjected===true'))
    check('invalid candidate did not overwrite baseline',saved(page)['state']==EXPECTED['mixed.initial'])
    advance(page,1000); frame(page); value=save(page)
    same_state(value,'mixed.offline60.live1'); envelope(value,61000,61000)
    audit(page); context.close()

    case='labeled write failure after catch-up freezes already-adopted state and raw source'
    context,page=boot(); baseline=raw(page); page.evaluate("window.__clockFault='write'")
    advance(page,61000); frame(page)
    attempted=next(row for row in events(page) if row['operation']=='write-attempt' and row['key']==KEY)
    candidate=json.loads(attempted['value']); same_state(candidate,'mixed.offline61'); envelope(candidate,61000,61000)
    frozen=page.locator('[data-bind="played"]').text_content()
    check('failed save keeps already simulated 61-second visible state',frozen!='累计 0 秒')
    advance(page,60000); frame(page)
    check('protected subsequent RAF does not simulate',page.locator('[data-bind="played"]').text_content()==frozen)
    check('storage failure exports exact original bytes',export_raw(page,'catchup-failure-source')==baseline)
    audit(page); context.close()

    case='actual trusted cross-tab conflict freezes old session and raw export'
    context,page=boot(); baseline=raw(page); advance(page,45000)
    other=context.new_page(); attach(other); other.goto(args.url,wait_until='networkidle'); import_text(other)
    expect(page.locator('[data-bind="status"]')).to_contain_text('其他标签页')
    check('conflict was caused by a genuine trusted native storage event',any(row['operation']=='storage-event' and row['trusted'] for row in events(page)))
    advance(page,16000); frame(page); timer(page)
    check('conflicted page preserves original raw export',export_raw(page,'cross-tab-source')==baseline)
    check('other tab committed incoming world',saved(other)['state']==EXPECTED['incoming.initial'])
    audit(page); context.close()

    if args.session_fixture:
        legacy=json.loads(Path(args.session_fixture).read_text())
        for revision in range(2,8):
            case=f'actual-source r{revision} startup migration accounts through sampled wall'
            source=next(row for row in legacy['legacySources'] if row['revision']==revision)
            check('legacy fixture uses actual released serializer',source['generatedBy']=='actual source-revision createInitialState/exportSave')
            context,page=boot(value=legacy['legacy'][str(revision)],wall=61000)
            value=saved(page); envelope(value,61000,61000)
            check('successful migration includes full 61-second startup catch-up',value['state']['totalTime']=='61')
            backup=json.loads(raw(page,BACKUP)); check('migration backs up actual old-revision source',backup['revision']==revision and backup['lastTickAt']==EPOCH)
            audit(page); context.close()
        case='actual-source migration write fault freezes source and raw export'
        value=copy.deepcopy(legacy['legacy']['7']); value['savedAt']=value['lastTickAt']=EPOCH
        context,page=boot(value=value,wall=61000,fault='write'); baseline=raw(page)
        advance(page,1000); frame(page); timer(page)
        check('failed migration preserves old-revision bytes',json.loads(raw(page))['revision']==7)
        check('failed migration exports exact old raw source',export_raw(page,'failed-migration-source')==baseline)
        page.evaluate('window.__clockFault=null'); import_text(page); envelope(saved(page),62000,62000)
        advance(page,1000); frame(page); result=save(page)
        same_state(result,'incoming.live1'); envelope(result,63000,63000)
        audit(page); context.close()

    case='suite integrity'
    check('no JavaScript page errors',not errors)
    check('no failed production HTTP requests',not requests)
    completed=True


# Capture failure state and screenshot INSIDE the live Playwright connection.
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),
        headless=True,args=['--no-sandbox'])
    try:
        run_cases()
    except BaseException:
        diagnostics={'case':case}
        if active_page is not None and not active_page.is_closed():
            try:
                diagnostics['nativeCurrentRaw']=raw(active_page)
                diagnostics['status']=active_page.locator('[data-bind="status"]').all_text_contents()
                diagnostics['played']=active_page.locator('[data-bind="played"]').all_text_contents()
                diagnostics['clock']=active_page.evaluate('window.__clockSnapshot()')
                audit(active_page,'failure')
                cdp=active_page.context.new_cdp_session(active_page)
                screenshot=cdp.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True})
                (out/'accounted-clock-failure.png').write_bytes(base64.b64decode(screenshot['data']))
                cdp.detach()
            except Exception as error:
                diagnostics['captureError']=str(error)
        raise
    finally:
        report={'completed':completed,'mode':MODE,'url':args.url,'fixture':fixtures['description'],
            'scope':'Controlled scheduler regression only. Date.now, performance.now, RAF and 15-second interval callbacks are explicitly driven. Native input and Storage delegate to real browser. Visibility state overrides and synthetic events are labeled. No genuine OS-hidden or natural throttle claim. Confirmation gap is controlled around native confirm; File.text uses native bytes with explicitly delayed completion. Original natural-time suites and headed-CDP background acceptance remain separate.',
            'legacyMigrationFixtures':args.session_fixture,'environment':{'platform':platform.platform(),'python':platform.python_version(),'browser':browser.version},
            'passed':sum(row['passed'] for row in checks),'checks':checks,'errors':errors,'failedRequests':requests,'audit':audits,'failureDiagnostics':diagnostics}
        (out/'accounted-clock-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps({'completed':completed,'passed':report['passed'],'total':len(checks),'failedCase':None if completed else case},ensure_ascii=False))
        browser.close()
