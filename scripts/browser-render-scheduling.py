"""Controlled render scheduling correctness on real before/after HTTP bundles.

Date.now, performance.now, RAF and autosave callbacks are explicitly controlled.
Native Storage is delegated unchanged except named injected faults. The counter
wraps native DOMTokenList.toggle, observing the unchanged original energy chip
once per original view update; it is NOT a timing or compositor paint metric.
All normal clicks/typing are trusted browser input. Adversarial old-node replay,
synthetic hidden state and native File.text completion gates are clearly labeled.
"""
import argparse
import base64
import copy
import hashlib
import json
import platform
import shutil
from pathlib import Path
from urllib.parse import urlparse, urljoin
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url',default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--before-url',required=True)
parser.add_argument('--fixture',default='render-scheduling-review-save.json')
parser.add_argument('--output',default='render-scheduling-evidence')
parser.add_argument('--chromium')
args=parser.parse_args()
fixtures=json.loads(Path(args.fixture).read_text())
KEY,BACKUP,EPOCH=fixtures['key'],fixtures['backupKey'],fixtures['epoch']
HOME,COLONY=fixtures['homeId'],fixtures['colonyId']
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
MODE='controlled Date/performance/RAF/autosave callbacks; actual HTTP, native Storage and trusted browser input'
checks,errors,failed_requests,audits,differentials=[],[],[],[],[]
case,completed,active_page,diagnostics='setup',False,None,None

INIT=r"""(() => {
 window.__fileImportConfirmations=[];
 const nativeConfirm=window.confirm.bind(window);
 window.confirm=message=>{window.__fileImportConfirmations.push(String(message));return nativeConfirm(message);};
 const key=__KEY__,epoch=__EPOCH__,get=Storage.prototype.getItem,set=Storage.prototype.setItem;
 let elapsed=0,next=0,updates=0;const callbacks=new Map(),intervals=new Map();
 const native=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 const backing={get:native(get),set:native(set),toggle:native(DOMTokenList.prototype.toggle),storage:localStorage instanceof Storage};
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=fn=>{const id=++next;callbacks.set(id,fn);return id;};
 window.cancelAnimationFrame=id=>callbacks.delete(id);
 window.setInterval=(fn,ms,...args)=>{const id=++next;intervals.set(id,{fn,ms,args});return id;};
 window.clearInterval=id=>intervals.delete(id);
 const toggle=DOMTokenList.prototype.toggle;
 DOMTokenList.prototype.toggle=function(...args){
  if(this===document.querySelector('[data-bind="energy-chip"]')?.classList&&args[0]==='short')updates++;
  return toggle.apply(this,args);
 };
 const p={events:[],fault:null,files:[],gateFiles:false};
 Storage.prototype.setItem=function(k,v){
  if(this===localStorage&&String(k)===key){
   p.events.push({type:'write',at:elapsed,chars:String(v).length,injected:p.fault==='write'||p.fault==='drop'});
   if(p.fault==='write')throw new DOMException('Labeled controlled current-slot fault','QuotaExceededError');
   if(p.fault==='drop')return; // Labeled acknowledged-but-dropped write; native readback must reject it.
  }
  return set.call(this,k,v);
 };
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&event.key===key)p.events.push({type:'storage',trusted:event.isTrusted,at:elapsed});});
 for(const type of ['click','input','change','compositionstart','compositionupdate','compositionend','toggle'])document.addEventListener(type,event=>p.events.push({type,trusted:event.isTrusted,target:event.target.id||event.target.dataset?.action||event.target.dataset?.tab||event.target.tagName,at:elapsed}),true);
 const text=File.prototype.text;
 File.prototype.text=async function(){
  if(!p.gateFiles)return text.call(this);
  const entry={name:this.name,ready:false,release:null};p.files.push(entry);
  const result=await text.call(this);entry.ready=true;await new Promise(resolve=>entry.release=resolve);return result;
 };
 window.__renderProbe={
  at:()=>elapsed,advance:ms=>{if(ms<elapsed)throw Error('Controlled clock cannot move backwards');elapsed=ms;},
  frame:()=>{const due=[...callbacks.values()];callbacks.clear();for(const fn of due)fn(elapsed);return due.length;},
  autosave:()=>{const due=[...intervals.values()].filter(x=>x.ms===15000);for(const x of due)x.fn(...x.args);return due.length;},
  raw:()=>get.call(localStorage,key),updates:()=>updates,resetUpdates:()=>updates=0,
  snapshot:()=>({at:elapsed,updates,pendingRAF:callbacks.size,backing,events:p.events}),
  fault:value=>p.fault=value,gate:()=>p.gateFiles=true,files:p.files,
 };
})();""".replace('__KEY__',json.dumps(KEY)).replace('__EPOCH__',str(EPOCH))


def check(name,condition,detail=None):
    row={'case':case,'name':name,'passed':bool(condition),'classification':MODE}
    if detail is not None:row['detail']=detail
    checks.append(row)
    if not condition:raise AssertionError(f'{case}: {name}')


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


def frame(page,at=None):
    if at is not None:page.evaluate('at=>window.__renderProbe.advance(at)',at)
    count=page.evaluate('window.__renderProbe.frame()')
    check('explicit RAF wave contains an application callback',count>=1)


def click(page,selector,flush=True):
    # force avoids RAF-based actionability stability polling, but still dispatches
    # real browser pointer input through Playwright, not element.click(). Center
    # first: a long retained draft can leave the next tab under the sticky header,
    # and forced clicks deliberately skip Playwright's ordinary hit-target check.
    target=page.locator(selector)
    hit=target.evaluate('''element => {
      element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const rect=element.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
      const actual=document.elementFromPoint(x,y);
      return {clear:actual===element||element.contains(actual),x,y,actual:actual?.id||actual?.tagName||null};
    }''')
    check('trusted pointer target is unobscured: '+selector,hit['clear'],hit)
    target.click(force=True)
    if flush:frame(page)


def tab(page,name):
    if page.locator('[data-bind="offline-modal"]').is_visible():click(page,'[data-action="dismiss-offline"]')
    click(page,f'[data-tab="{name}"]')
    expect(page.locator(f'[data-tab-panel="{name}"]')).to_be_visible()


def raw(page):return page.evaluate('window.__renderProbe.raw()')
def saved(page):return json.loads(raw(page))['state']
def updates(page):return page.evaluate('window.__renderProbe.updates()')
def clear_updates(page):page.evaluate('window.__renderProbe.resetUpdates()')


def save(page):
    tab(page,'save');click(page,'[data-action="save"]')
    return saved(page)


def whole(page,expected,label='complete serialized engine state matches independent production-engine oracle'):
    value=save(page)
    check(label,value==fixtures['expected'][expected],{'expected':expected})
    return value


def attach(page):
    page.set_default_timeout(10000)
    page.on('pageerror',lambda error:errors.append({'case':case,'error':str(error)}))
    page.on('requestfailed',lambda request:failed_requests.append({'case':case,'url':request.url}))


def boot(which='base',url=None,initial_tab='overview',corrupt=False):
    global active_page
    url=url or args.url;parsed=urlparse(url)
    check('production bundle is served over HTTP(S)',parsed.scheme in ('http','https'))
    seed=copy.deepcopy(fixtures[which]);seed['savedAt']=seed['lastTickAt']=EPOCH
    if corrupt:seed['state']['formations']['nextFormationId']=0
    context=browser.new_context(viewport={'width':1440,'height':1100},reduced_motion='reduce',accept_downloads=True,
        storage_state={'cookies':[],'origins':[{'origin':f'{parsed.scheme}://{parsed.netloc}','localStorage':[
            {'name':KEY,'value':json.dumps(seed,ensure_ascii=False)}, {'name':'infinity.ui.tab','value':initial_tab}]}]})
    context.add_init_script(INIT);page=context.new_page();active_page=page;attach(page)
    response=page.goto(url,wait_until='networkidle')
    check('actual HTTP production response',response is not None and response.status==200)
    page.locator('[data-bind="energy-chip"]').wait_for()
    check('counter and healthy Storage delegate to captured native implementations',all(page.evaluate('window.__renderProbe.snapshot().backing').values()))
    return context,page


def snapshot(page):
    return page.evaluate('''() => {
      const panel=[...document.querySelectorAll('[data-tab-panel]')].find(e=>!e.hidden);
      const visible=e=>{
        // Chromium may return geometry for closed-details content. Its first
        // summary remains visible; all other descendants are actually hidden.
        for(let ancestor=e;ancestor;ancestor=ancestor.parentElement){
          if(ancestor.hidden||getComputedStyle(ancestor).display==='none')return false;
          if(ancestor instanceof HTMLDetailsElement&&!ancestor.open){
            const summary=[...ancestor.children].find(child=>child.tagName==='SUMMARY');
            if(!summary?.contains(e))return false;
          }
        }
        const visibility=getComputedStyle(e).visibility;
        return e.getClientRects().length>0&&visibility!=='hidden'&&visibility!=='collapse';
      };
      return {tab:panel?.dataset.tabPanel,text:panel?.innerText,
       shared:Object.fromEntries(['amount-metal','amount-crystal','amount-deuterium','energy-top','played','status','gain','score','multiplier'].map(k=>[k,document.querySelector(`[data-bind="${k}"]`)?.textContent])),
       inputs:[...panel.querySelectorAll('input,select,textarea,button')].filter(visible).map(e=>({id:e.id,action:e.dataset.action??e.dataset.space??null,type:e.type,value:e.value,disabled:e.disabled,checked:e.checked??null,text:e.tagName==='BUTTON'?e.textContent:null}))};
    }''')


def differential_trace(name,url):
    context,page=boot(url=url);tab(page,'overview');clear_updates(page)
    for step in fixtures['traces'][name]:
        frame(page,step['atMs'])
        if step.get('action')=='scrape':click(page,'[data-bind="action-scrape-ov"]')
    count=updates(page)
    value=whole(page,name)
    row={'trace':name,'url':url,'originalViewUpdates':count,'stateSha256':hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()}
    differentials.append(row);context.close()
    return value,count


def forms(page):
    tab(page,'fleet')
    if not page.locator('#fleet-formations').evaluate('(e)=>e.open'):click(page,'#fleet-formations > summary')
    check('trusted native summary opens the formation library',page.locator('#fleet-formations').evaluate('(e)=>e.open'))


def arm_old(page):
    forms(page)
    click(page,'[data-formation-id="1"] [data-formation-action="select"]')
    page.locator('#formation-payer').select_option(HOME);frame(page)
    click(page,'#formation-fill');click(page,'#formation-preview')
    expect(page.locator('#formation-confirm-replenish')).to_be_enabled()
    page.evaluate('''() => {
      window.__retiredControls=[document.querySelector('#formation-fill'),document.querySelector('#formation-confirm-replenish')];
    }''')


def replay_old(page):
    # Deliberate adversarial replay, not normal input nor a native-event claim.
    forms(page)
    page.evaluate('''() => {
      const root=document.querySelector('#fleet-formations');
      for(const old of window.__retiredControls){
        root.append(old);old.disabled=false;old.click();
        const clone=old.cloneNode(true);root.append(clone);clone.disabled=false;clone.click();
      }
    }''');frame(page)


def import_text(page,which='incoming'):
    tab(page,'save');seed=copy.deepcopy(fixtures[which]);now=EPOCH+page.evaluate('window.__renderProbe.at()')
    seed['savedAt']=seed['lastTickAt']=now
    page.locator('#transfer').fill(json.dumps(seed,ensure_ascii=False));frame(page)
    click(page,'[data-action="import-text"]')


def protected_masks(page):
    for name,selector in [('order draft','#order-form'),('template library','#research-templates'),('formation library','#fleet-formations')]:
        check(name+' mounted inputs and actions are immediately disabled',page.locator(selector+' input,'+selector+' select,'+selector+' button').evaluate_all('(xs)=>xs.length>0&&xs.every(x=>x.disabled)'))
    check('all existing order row actions are immediately disabled',page.locator('#order-list button').evaluate_all('(xs)=>xs.every(x=>x.disabled)'))


def retain_ready_controls(page):
    tab(page,'orders');page.locator('#order-budget-metal').fill('12345');frame(page)
    click(page,'#research-templates > summary');click(page,'#template-new')
    page.locator('#template-name').fill('待保存研究草稿');frame(page)
    click(page,'[data-template-id="1"] [data-template-action="select"]')
    page.locator('#template-payer').select_option(HOME);frame(page)
    forms(page);click(page,'#formation-new');page.locator('#formation-name').fill('待保存编成草稿')
    page.locator('[data-formation-unit="small_cargo"]').fill('2');frame(page);arm_old(page)
    check('ready setup includes existing order rows',page.locator('#order-list button').count()>0)
    check('ready setup includes live editor and review authority',page.locator('#template-save').is_enabled() and page.locator('#formation-save').is_enabled() and page.locator('#formation-confirm-replenish').is_enabled())
    page.evaluate('''() => {
      const selectors=['#order-list button','#template-save','#formation-save','#formation-fill','#formation-confirm-replenish'];
      window.__protectedControls=selectors.flatMap(selector=>[...document.querySelectorAll(selector)]);
      const selector='#order-form input,#order-form select,#order-form button,#order-list button,#research-templates input,#research-templates select,#research-templates button,#fleet-formations input,#fleet-formations select,#fleet-formations button';
      window.__maskNodes={selector,body:document.body,nodes:[...document.querySelectorAll(selector)].map(node=>({node,value:node.value}))};
    }''')


def replay_protected_controls(page,reattach=False):
    # Deliberate hostile DOM replay, not normal/trusted input. Disabling is a UI
    # mask; registered-node and current-session authority must still guard writes.
    page.evaluate('''reattach => {
      for(const old of window.__protectedControls){
        const root=document.querySelector(old.dataset.orderAction?'#order-list':old.dataset.templateAction?'#research-templates':'#fleet-formations');
        const wasDisabled=old.disabled;
        if(reattach)root.append(old);
        old.disabled=false;old.click();
        const clone=old.cloneNode(true);root.append(clone);clone.disabled=false;clone.click();clone.remove();
        if(old.id==='template-save'||old.id==='formation-save'){
          const form=document.querySelector(old.id==='template-save'?'#template-editor':'#formation-editor');
          form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:old}));
        }
        old.disabled=wasDisabled;
        if(reattach)old.remove();
      }
      document.querySelector('#order-form').dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}));
    }''',reattach)


def run_cases():
    global case,completed
    case='initial protected boot masks folded hidden controls before any RAF'
    context,page=boot(corrupt=True);baseline=raw(page)
    check('protected boot stays on overview with both libraries folded',page.locator('[data-tab-panel="overview"]').is_visible() and not page.locator('#research-templates').evaluate('(e)=>e.open') and not page.locator('#fleet-formations').evaluate('(e)=>e.open'))
    protected_masks(page)
    check('protected boot does not build hidden library or order rows',page.locator('#formation-library article,#template-library article,#order-list article').count()==0)
    clear_updates(page)
    page.evaluate('''() => {
      for(const id of ['formation-new','template-new']){const button=document.getElementById(id);button.disabled=false;button.click();button.disabled=true;}
      for(const id of ['order-form','formation-editor','template-editor'])document.getElementById(id).dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}));
      window.__renderProbe.autosave();
    }''')
    check('initial protected forced clicks/submits grant no editor authority',page.locator('#formation-editor').is_hidden() and page.locator('#template-editor').is_hidden())
    check('initial protected replay never writes or paints',raw(page)==baseline and updates(page)==0 and not any(row['type']=='write' for row in page.evaluate('window.__renderProbe.snapshot().events')))
    context.close()

    for failure in ('autosave-write','import-readback'):
        case=failure+': hidden mode transition masks controls without projection'
        context,page=boot();retain_ready_controls(page);tab(page,'save')
        incoming=copy.deepcopy(fixtures['incoming']);incoming['savedAt']=incoming['lastTickAt']=EPOCH+1
        page.locator('#transfer').fill(json.dumps(incoming,ensure_ascii=False));frame(page)
        page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));}''')
        baseline=raw(page);clear_updates(page)
        page.evaluate('window.__renderProbe.advance(1)')
        page.evaluate('fault=>window.__renderProbe.fault(fault)','write' if failure=='autosave-write' else 'drop')
        if failure=='autosave-write':page.evaluate('window.__renderProbe.autosave()')
        else:click(page,'[data-action="import-text"]',flush=False)
        protected_masks(page)
        check('transition injected an actual current-slot write failure',any(row['type']=='write' and row['injected'] for row in page.evaluate('window.__renderProbe.snapshot().events')))
        check('hidden protection preserves every mounted node and draft value',page.evaluate('''() => {
          const {selector,body,nodes}=window.__maskNodes,current=[...document.querySelectorAll(selector)];
          return document.body===body&&current.length===nodes.length&&nodes.every(({node,value},i)=>current[i]===node&&node.value===value);
        }'''))
        check('hidden protection requires no original body projection or RAF',updates(page)==0)
        writes=len([row for row in page.evaluate('window.__renderProbe.snapshot().events') if row['type']=='write'])
        replay_protected_controls(page)
        check('forced protected controls and submissions never write or change native bytes',raw(page)==baseline and len([row for row in page.evaluate('window.__renderProbe.snapshot().events') if row['type']=='write'])==writes)
        check('forced protected replay still performs no original projection',updates(page)==0)
        page.evaluate('window.__renderProbe.fault(null)')
        page.evaluate('window.__renderProbe.autosave()')
        protected_masks(page)
        check('clearing storage fault does not implicitly recover authority',raw(page)==baseline)
        click(page,'[data-action="import-text"]',flush=False)
        check('explicit verified import recovers the complete incoming state',saved(page)==fixtures['expected']['incoming.initial'])
        check('recovery masks retire old editor and review authority before a paint',page.locator('#template-save').is_disabled() and page.locator('#formation-save').is_disabled() and page.locator('#formation-confirm-replenish').is_disabled() and page.locator('#template-confirm-apply').is_disabled())
        check('recovery restores only fresh entry controls without hidden lists',page.locator('#template-new').is_enabled() and page.locator('#formation-new').is_enabled() and page.locator('#order-create').is_enabled() and page.locator('#order-transport-fields input,#order-transport-fields select').evaluate_all('(xs)=>xs.every(x=>x.disabled)') and page.locator('#formation-library article,#template-library article,#order-list article').count()==0)
        recovered=raw(page);writes=len([row for row in page.evaluate('window.__renderProbe.snapshot().events') if row['type']=='write'])
        replay_protected_controls(page,reattach=True)
        check('reattached originals, clones and retired draft submissions have no recovered authority',raw(page)==recovered and len([row for row in page.evaluate('window.__renderProbe.snapshot().events') if row['type']=='write'])==writes)
        check('recovery and stale replay never project while document is hidden',updates(page)==0)
        page.evaluate('''() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));}''');frame(page)
        tab(page,'orders');click(page,'#order-create')
        check('visible retired order draft still needs explicit new authority',raw(page)==recovered)
        click(page,'#order-new');click(page,'#order-create')
        check('explicit fresh order draft creates exactly one plan after recovery',len(saved(page)['orders']['tasks'])==len(fixtures['expected']['incoming.initial']['orders']['tasks'])+1)
        click(page,'#template-new');check('explicit new template alone restores its editor',page.locator('#template-save').is_enabled())
        forms(page);click(page,'#formation-new');check('explicit new formation alone restores its editor',page.locator('#formation-save').is_enabled())
        context.close()

    for name in ('steady60','steady120','actions'):
        case='before/after identical controlled trace '+name
        before,count_before=differential_trace(name,args.before_url)
        after,count_after=differential_trace(name,args.url)
        check('exact entire state matches archived before bundle on identical trace',before==after)
        if name.startswith('steady'):
            check('old bundle updates on every requested frame',count_before==len(fixtures['traces'][name]))
            check('ordinary latest-only rendering is bounded at 10Hz',18<=count_after<=21,{'before':count_before,'after':count_after})
            check('render coalescing does not alter any serialized field',before==fixtures['expected'][name])

    case='visible panel parity against unchanged archived full projection'
    snapshots={}
    tabs=('overview','facilities','research','shipyard','defense','darkmatter','protocol','curvature','achievements','save','orders','galaxy','fleet','messages','deep','arcade')
    for label,url in [('before',args.before_url),('after',args.url)]:
        context,page=boot(url=url);snapshots[label]={}
        release=context.request.get(urljoin(url,'release.json'))
        check('served parity release manifest is available',release.status==200)
        expected_version='0.6.7-alpha.1' if label=='before' else '0.6.11-alpha.1'
        check('served version is the explicit expected before/after metadata',release.json()['version']==expected_version)
        for name in tabs:
            button=page.locator(f'[data-tab="{name}"]')
            if button.is_hidden():continue
            tab(page,name);snapshots[label][name]=snapshot(page)
            if name=='galaxy':
                # The intentional package version change is the only parity
                # exception. Restrict normalization to the exact #space-range
                # paragraph, never to names, controls or arbitrary panel text.
                range_text=page.locator('#space-range').inner_text();token='v'+expected_version
                check('galaxy phase has exactly its verified release version token',range_text.count(token)==1)
                check('visible galaxy snapshot contains exact phase paragraph once',snapshots[label][name]['text'].count(range_text)==1)
                normalized=range_text.replace(token,'v<verified-release-version>',1)
                snapshots[label][name]['text']=snapshots[label][name]['text'].replace(range_text,normalized,1)
            if name in ('orders','fleet'):
                details_id='research-templates' if name=='orders' else 'fleet-formations'
                new_id='template-new' if name=='orders' else 'formation-new'
                check('folded library controls are absent from actual-visible snapshot: '+details_id,
                      not any(control['id']==new_id for control in snapshots[label][name]['inputs']))
                click(page,f'#{details_id} > summary')
                check('native summary opens library for full visible parity: '+details_id,
                      page.locator('#'+details_id).evaluate('(element)=>element.open'))
                opened=snapshot(page)
                check('opened library controls enter the complete paired snapshot: '+details_id,
                      any(control['id']==new_id for control in opened['inputs']) and
                      len(opened['inputs'])>=len(snapshots[label][name]['inputs'])+4)
                snapshots[label][name+'-library-open']=opened
                click(page,f'#{details_id} > summary')
                check('library returns to folded state after parity observation: '+details_id,
                      not page.locator('#'+details_id).evaluate('(element)=>element.open'))
                click(page,f'#{details_id} > summary')
                reopened=snapshot(page)
                check('closed then reopened library retains complete visible snapshot: '+details_id,reopened==opened)
                snapshots[label][name+'-library-reopened']=reopened
                click(page,f'#{details_id} > summary')
        whole(page,'base.initial','read-only navigation leaves complete engine state unchanged');context.close()
    check('both bundles expose the same unlocked panels',set(snapshots['before'])==set(snapshots['after']))
    for name in snapshots['before']:
        equal=snapshots['before'][name]==snapshots['after'][name]
        if not equal:(out/f'panel-parity-{name}.json').write_text(json.dumps({key:value[name] for key,value in snapshots.items()},ensure_ascii=False,indent=2))
        check('fresh visible text/control parity: '+name,equal)
    differentials.append({'kind':'visible-panel-parity','tabs':list(snapshots['after'])})

    case='capture-stopped navigation and initial fixed payer defaults'
    context,page=boot()
    check('hidden extension heavy fleet rows are not eagerly projected',page.locator('#space-fleets [data-flight]').count()==0)
    page.locator('#planet-select').select_option(COLONY);frame(page)
    tab(page,'orders')
    check('first hidden orders visit preserves startup payer',page.locator('#order-planet').input_value()==HOME)
    check('first hidden orders visit preserves startup donor',page.locator('#order-donor').input_value()==COLONY)
    check('first hidden orders visit preserves real preferred donor ship',page.locator('#order-ship').input_value()=='large_cargo')
    page.locator('#order-transport-enabled').check(force=True);frame(page)
    page.locator('#order-budget-metal').fill('12345');frame(page)
    check('capture-stopped input updates visible review on next RAF','12345' in page.locator('#order-review').inner_text())
    tab(page,'galaxy');page.locator('#browse-system').fill('52');click(page,'[data-space="browse"]')
    check('capture-stopped galaxy browse refreshes rendered actual cursor',':52:' in page.locator('#space-worlds').inner_text())
    tab(page,'fleet');check('fresh navigation projects real in-flight row',page.locator('#space-fleets [data-flight]').count()==1)
    check('native navigation event path is trusted',any(row['type']=='click' and row['trusted'] for row in page.evaluate('window.__renderProbe.snapshot().events')))
    context.close()

    case='folded details, focus, selection and actual composition survive paints'
    context,page=boot();forms(page);click(page,'#formation-new')
    name=page.locator('#formation-name');name.fill('保存中的中文草稿');name.focus()
    name.evaluate('(e)=>{window.__focusedDraft=e;e.setSelectionRange(2,5);}')
    for at in (17,34,50,101,150,201):frame(page,at)
    check('paint preserves focused input identity',name.evaluate('(e)=>e===window.__focusedDraft&&document.activeElement===e'))
    check('paint preserves selection and draft',name.evaluate('(e)=>e.selectionStart===2&&e.selectionEnd===5&&e.value==="保存中的中文草稿"'))
    cdp=context.new_cdp_session(page)
    cdp.send('Input.imeSetComposition',{'text':'中文输入','selectionStart':4,'selectionEnd':4})
    composing=name.input_value();frame(page,220);frame(page,310)
    check('actual IME composition text and focus survive scheduled projection',name.input_value()==composing and name.evaluate('(e)=>document.activeElement===e'))
    cdp.send('Input.insertText',{'text':'中文输入'});frame(page)
    check('composition events were genuine browser events',any(row['type']=='compositionstart' and row['trusted'] for row in page.evaluate('window.__renderProbe.snapshot().events')))
    cdp.detach()
    click(page,'#fleet-formations > summary');check('native details closes',not page.locator('#fleet-formations').evaluate('(e)=>e.open'))
    frame(page,450);click(page,'#fleet-formations > summary')
    check('native details reopens without losing draft identity',page.locator('#fleet-formations').evaluate('(e)=>e.open') and name.evaluate('(e)=>e===window.__focusedDraft'))
    # True native implicit form submission exercises default action after click/keydown.
    name.fill('原生键盘提交编成');page.locator('[data-formation-unit="small_cargo"]').fill('2')
    name.press('Enter');frame(page)
    check('native keyboard form default action creates exactly one design',len(saved(page)['formations']['entries'])==2)
    context.close()

    case='fresh explicit preview sees state adopted between ordinary paint deadlines'
    context,page=boot('fresh');tab(page,'orders');click(page,'#research-templates > summary')
    click(page,'[data-template-id="1"] [data-template-action="select"]')
    page.locator('#template-payer').select_option(HOME);frame(page)
    frame(page,60)
    click(page,'#template-review')
    check('fresh review sees actual completed research','已达成' in page.locator('#template-review-rows').inner_text() or page.locator('[data-template-map-tech="energy_tech"]').get_attribute('data-template-map-status')=='achieved')
    whole(page,'fresh60');context.close()

    case='native pointer held across paid-head rollover cannot purchase newer head'
    context,page=boot('rollover');tab(page,'research')
    button=page.locator('[data-tab-panel="research"] [data-action="dm-speedup"][data-target="research"][data-mode="halve"]').first
    expect(button).to_be_enabled();button.evaluate("e=>e.scrollIntoView({block: 'center'})");box=button.bounding_box()
    check('old head speedup has a native pointer target',box is not None)
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
    frame(page,60);page.mouse.up();frame(page)
    whole(page,'rollover60','head-rollover pointer sequence does not spend on replacement work');context.close()

    case='synthetic hidden page skips projection and resumes latest engine state'
    context,page=boot();clear_updates(page)
    page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));}''')
    frame(page,40);frame(page,80)
    check('hidden page performs no original view update',updates(page)==0)
    page.evaluate('''() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));}''');frame(page)
    check('visibility resume paints latest snapshot immediately',updates(page)==1)
    whole(page,'hidden');context.close()

    case='locked persisted original tab projects fallback on initial render'
    context,page=boot('locked',initial_tab='research')
    expect(page.locator('[data-tab-panel="facilities"]')).to_be_visible()
    check('fallback facilities has fresh actual level text',bool(page.locator('[data-bind="level-metal_mine"]').inner_text()))
    whole(page,'locked.initial');context.close()

    for replacement in ('automatic-skipped','same-id-import','reset'):
        case=replacement+': adoption retires old hidden authority'
        context,page=boot('automatic' if replacement=='automatic-skipped' else 'base');arm_old(page);tab(page,'overview')
        if replacement=='automatic-skipped':
            for n in range(1,10):frame(page,n*1000)
            frame(page,9950);frame(page,10000)
            expected='automatic.skipped'
        elif replacement=='same-id-import':import_text(page);expected='incoming.initial'
        else:
            tab(page,'save');page.once('dialog',lambda dialog:dialog.accept());click(page,'[data-action="reset"]');expected=None
        before=save(page)
        if expected:check('replacement equals complete independent engine result',before==fixtures['expected'][expected])
        replay_old(page)
        check('retired original and cloned controls have no effect',save(page)==before)
        check('adoption clears old dispatch fill',page.locator('[data-ship="small_cargo"]').input_value()=='0')
        context.close()

    case='hidden automatic adoption retires old capabilities before any visible paint'
    context,page=boot('automatic');arm_old(page);tab(page,'overview')
    for n in range(1,10):frame(page,n*1000)
    frame(page,9950)
    page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));}''')
    clear_updates(page);frame(page,10000)
    check('automatic adoption occurs while original view painting is actually suppressed',updates(page)==0)
    page.evaluate('''() => {
      const root=document.querySelector('#fleet-formations');
      for(const old of window.__retiredControls){root.append(old);old.disabled=false;old.click();const clone=old.cloneNode(true);root.append(clone);clone.disabled=false;clone.click();}
    }''');frame(page)
    check('hidden retired-capability replay never forces a paint',updates(page)==0)
    page.evaluate('''() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));}''');frame(page)
    whole(page,'automatic.skipped','retirement occurred before the first visible post-adoption paint')
    context.close()

    case='navigation-only invalidation does not cancel delayed native file import'
    context,page=boot();tab(page,'save');page.evaluate('window.__renderProbe.gate()')
    before_confirmations = confirmation_count(page)
    page.locator('[data-bind="import-file"]').set_input_files({'name':'delayed-native.json','mimeType':'application/json','buffer':json.dumps(fixtures['incoming'],ensure_ascii=False).encode()})
    page.wait_for_function('window.__renderProbe.files[0]?.ready&&typeof window.__renderProbe.files[0].release==="function"',polling=20)
    for name in ('galaxy','orders','fleet','overview'):tab(page,name)
    check('pending file and ordinary navigation never confirm before read completion', confirmation_count(page) == before_confirmations)
    # This scenario runs on args.url only. Archived before traces never install
    # an import handler, so a later reset cannot accidentally consume one.
    file_dialogs = accept_file_confirmation(page, fixtures['incoming'], saved(page))
    page.evaluate('window.__renderProbe.files[0].release()')
    page.wait_for_function('document.querySelector("[data-bind=\\"status\\"]")?.textContent.includes("已导入")',polling=20)
    check('current navigation-only file asks exactly one replacement confirmation', len(file_dialogs) == 1 and confirmation_count(page) == before_confirmations + 1)
    frame(page);whole(page,'incoming.initial');context.close()

    case='labeled injected save failure freezes simulation and bounds protected painting'
    context,page=boot();baseline=raw(page);page.evaluate('window.__renderProbe.fault("write")')
    tab(page,'save');click(page,'[data-action="save"]');status=page.locator('[data-bind="status"]').inner_text()
    check('native delegated Storage fault exposes protection','失败' in status or '无法' in status or '暂停' in status)
    clear_updates(page)
    for at in (17,34,51,100,200,1000):frame(page,at)
    check('unchanged protected screen does not repaint every RAF',updates(page)==0)
    check('protected failure keeps exact native stored bytes',raw(page)==baseline)
    context.close()

    case='genuine cross-tab storage event immediately protects current authority'
    context,page=boot();retain_ready_controls(page);tab(page,'overview');baseline=raw(page)
    page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));}''')
    clear_updates(page)
    other=context.new_page();attach(other);other.goto(args.url,wait_until='networkidle')
    import_text(other);page.bring_to_front()
    page.wait_for_function('window.__renderProbe.snapshot().events.some(row=>row.type==="storage"&&row.trusted)',polling=20)
    protected_masks(page)
    check('trusted storage conflict masks hidden controls without any original projection',updates(page)==0)
    replacement=raw(page);replay_protected_controls(page)
    check('hidden conflict rejects forced old controls without overwriting replacement',raw(page)==replacement and updates(page)==0)
    page.evaluate('''() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));}''');frame(page)
    expect(page.locator('[data-bind="status"]')).to_contain_text('其他标签页')
    check('cross-tab event is actual trusted browser storage event',any(row['type']=='storage' and row['trusted'] for row in page.evaluate('window.__renderProbe.snapshot().events')))
    frozen=page.locator('[data-bind="amount-metal"]').text_content();clear_updates(page);frame(page,1000)
    check('cross-tab protected frames remain frozen without repaint loop',updates(page)==0 and page.locator('[data-bind="amount-metal"]').text_content()==frozen)
    check('other tab committed a replacement rather than copied old bytes',raw(page)!=baseline)
    context.close()

    case='original arcade every-RAF path and exact single/batch reward settlement'
    context,page=boot('ring');tab(page,'arcade');clear_updates(page)
    for _ in range(60):frame(page)
    check('visible idle original arcade receives every RAF including attract mode',updates(page)==60)
    click(page,'[data-action="arcade-run"]')
    check('manual single reward commits exactly once',saved(page)==fixtures['expected']['ring.single'])
    # Original animator may disable its button while showing the result. Advancing
    # zero engine time still gives every original RAF; use the separate all case
    # rather than fabricate animation completion or force a disabled control.
    whole(page,'ring.single');context.close()
    context,page=boot('ring');tab(page,'arcade');click(page,'[data-action="arcade-all"]')
    check('manual batch reward commits exactly once',saved(page)==fixtures['expected']['ring.all'])
    for _ in range(20):frame(page)
    whole(page,'ring.all','repeated original animation frames never settle rewards twice');context.close()

    case='suite integrity'
    check('no JavaScript page errors',not errors)
    check('no failed production requests',not failed_requests)
    completed=True


with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    try:run_cases()
    except BaseException:
        diagnostics={'case':case}
        if active_page is not None and not active_page.is_closed():
            try:
                diagnostics['probe']=active_page.evaluate('window.__renderProbe.snapshot()')
                diagnostics['status']=active_page.locator('[data-bind="status"]').all_text_contents()
                diagnostics['stored']=raw(active_page)
                cdp=active_page.context.new_cdp_session(active_page)
                shot=cdp.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True})
                (out/'render-scheduling-failure.png').write_bytes(base64.b64decode(shot['data']));cdp.detach()
            except Exception as error:diagnostics['captureError']=str(error)
        raise
    finally:
        report={'completed':completed,'mode':MODE,'url':args.url,'beforeUrl':args.before_url,'fixture':fixtures['description'],
            'parityMetadataException':'Only the exact galaxy #space-range paragraph version token is normalized after checking the served manifests equal before 0.6.7-alpha.1 and after 0.6.11-alpha.1. All other visible text and controls stay exact.',
            'counterMeaning':'Native DOMTokenList.toggle delegated energy-chip update calls, one per unchanged original view.update. These are instrumented render invocation counts, never CPU/presentation timings.',
            'scope':'New controlled scheduler coverage supplements, never replaces, original 13 suites and Stage6A accounted-clock controlled/native-background suites. Native performance belongs exclusively to browser-presentation-performance.py.',
            'environment':{'platform':platform.platform(),'python':platform.python_version(),'browser':browser.version},
            'passed':sum(row['passed'] for row in checks),'checks':checks,'errors':errors,'failedRequests':failed_requests,
            'differentials':differentials,'audit':audits,'failureDiagnostics':diagnostics}
        (out/'render-scheduling-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps({'completed':completed,'passed':report['passed'],'total':len(checks),'failedCase':None if completed else case},ensure_ascii=False))
        browser.close()
